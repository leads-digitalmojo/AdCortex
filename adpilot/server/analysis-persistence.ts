import { db } from "./db";
import { analysisSnapshots, performanceAlerts } from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import fs from "fs";
import path from "path";
import { invalidateCachePattern } from "./cache";

const DATA_BASE = path.resolve(import.meta.dirname, "../../ads_agent/data");

// ─── In-memory analysis cache ────────────────────────────────────────
// Shared here so both routes.ts (reads) and this module (writes) can
// invalidate it without a circular dependency.
export const ANALYSIS_CACHE_TTL = 10 * 1000; // 10 seconds (temporarily reduced)
export const analysisCache = new Map<string, { data: any; ts: number }>();

export function getCacheKey(clientId: string, platform: string, cadence?: string) {
  return `${clientId}:${platform}:${cadence ?? "default"}`;
}

export function invalidateAnalysisCache(clientId: string, platform: string) {
  Array.from(analysisCache.keys()).forEach((key) => {
    if (key.startsWith(`${clientId}:${platform}:`)) analysisCache.delete(key);
  });
}

/**
 * Saves analysis data to both PostgreSQL (upsert) and the local filesystem.
 * Invalidates the in-memory cache so the next read reflects fresh data.
 */
export async function saveAnalysisSnapshot(clientId: string, platform: string, data: any, cadence: string = "twice_weekly") {
  try {
    if (process.env.DATABASE_URL) {
      // Upsert into DB — unique index on (client_id, platform, cadence)
      await db
        .insert(analysisSnapshots)
        .values({ clientId, platform, cadence, data, createdAt: new Date() })
        .onConflictDoUpdate({
          target: [analysisSnapshots.clientId, analysisSnapshots.platform, analysisSnapshots.cadence],
          set: { data, createdAt: new Date() },
        });
      console.log(`[Analysis] [DB] Successfully upserted ${platform} (${cadence}) snapshot for ${clientId}.`);
    } else {
      console.warn(`[Analysis] [DB] No DATABASE_URL found, skipping Postgres persistence for ${clientId}.`);
    }

    // Sync to local file for backward compatibility
    const platformDir = platform === "google" ? "google" : "meta";
    const filename = cadence === "twice_weekly" ? "analysis.json" : `analysis_${cadence}.json`;
    const targetFile = path.join(DATA_BASE, "clients", clientId, platformDir, filename);
    const dir = path.dirname(targetFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(targetFile, JSON.stringify(data, null, 2));

    // Bust both analysis and intelligence caches so the next load fetches fresh data
    invalidateAnalysisCache(clientId, platform);
    invalidateCachePattern(`intelligence:${clientId}:${platform}`);

    console.log(`[Analysis] [File] Persisted ${platform} (${cadence}) snapshot to local disk for ${clientId}.`);

    // --- SYNC PERFORMANCE ALERTS ---
    if (process.env.DATABASE_URL && cadence === "twice_weekly") {
      await syncPerformanceAlerts(clientId, platform, data);
    }
  } catch (err) {
    console.error(`[Analysis] [CRITICAL] Error persisting snapshot for ${clientId}/${platform}/${cadence}:`, err);
    // Don't rethrow, ensure the scheduler continues even if persistence for one cadence fails
  }
}

async function syncPerformanceAlerts(clientId: string, platform: string, data: any) {
  const alerts: any[] = [];

  // --- 1. Extract from Account Health Breakdown (The health-drivers) ---
  if (data.account_health_breakdown) {
    const weights: Record<string, number> = {
      cpsv: 25,
      budget: 25,
      cpql: 20,
      cpl: 20,
      creative: 10
    };

    Object.entries(data.account_health_breakdown).forEach(([metric, score]: [string, any]) => {
      const weight = weights[metric] || (metric === 'creative' ? 10 : 20);
      const ratio = score / weight; // 0.0 to 1.0

      if (ratio < 0.5) { // Under 50% performance is an alert
        const severity = ratio < 0.2 ? "CRITICAL" : "HIGH";
        let message = "";
        
        switch(metric) {
          case 'cpl': message = "Cost Per Lead (CPL) is significantly above target, dragging down account health."; break;
          case 'cpql': message = "Quality Lead cost is excessive, indicating poor lead quality or high acquisition costs."; break;
          case 'cpsv': message = "Cost Per Site Visit is critical; traffic acquisition is expensive and inefficient."; break;
          case 'budget': message = "Budget pacing is erratic (significant underspend or overspend), impacting scaling stability."; break;
          case 'creative': message = "Creative performance is lagging; high fatigue or low engagement detected across active ads."; break;
          default: message = `${metric.toUpperCase()} performance is dragging down account health.`;
        }

        alerts.push({
          clientId,
          platform,
          type: "HEALTH_DRIVER",
          entityName: "Account",
          severity,
          message,
          metric: metric.toUpperCase(),
        });
      }
    });
  }

  // --- 2. Extract from Intellect Insights ---
  if (Array.isArray(data.intellect_insights)) {
    data.intellect_insights.forEach((insight: any) => {
      // Only promote high/critical severity insights to the alert system
      if (insight.severity === "CRITICAL" || insight.severity === "HIGH") {
        alerts.push({
          clientId,
          platform,
          type: insight.type || "Performance",
          entityName: insight.entity || "Account",
          severity: insight.severity || "MEDIUM",
          message: insight.detail || insight.observation || "",
          metric: insight.type === "CPL" ? "CPL" : insight.type === "CTR" ? "CTR" : null,
        });
      }
    });
  }

  // --- 3. Extract from Fatigue Alerts ---
  if (Array.isArray(data.fatigue_alerts)) {
    data.fatigue_alerts.forEach((fatigue: any) => {
      alerts.push({
        clientId,
        platform,
        type: "FATIGUE",
        entityName: fatigue.ad_name,
        severity: fatigue.severity || "HIGH",
        message: fatigue.message,
        metric: "CTR",
      });
    });
  }

  // Upsert into performance_alerts
  for (const alert of alerts) {
    try {
      // Find if alert already exists to prevent duplicates and preserve status
      const [existing] = await db.select().from(performanceAlerts).where(
        and(
          eq(performanceAlerts.clientId, clientId),
          eq(performanceAlerts.platform, platform),
          eq(performanceAlerts.type, alert.type),
          eq(performanceAlerts.entityName, alert.entityName),
          eq(performanceAlerts.message, alert.message)
        )
      ).limit(1);

      if (!existing) {
        await db.insert(performanceAlerts).values(alert);
      }
    } catch (err) {
      console.error("[Analysis] Alert sync error:", err);
    }
  }
}

/**
 * Loads the latest analysis snapshot — DB first, then falls back to file.
 */
export async function loadAnalysisSnapshot(clientId: string, platform: string, cadence: string = "twice_weekly"): Promise<any | null> {
  try {
    if (process.env.DATABASE_URL) {
      const [dbResult] = await db
        .select()
        .from(analysisSnapshots)
        .where(and(
          eq(analysisSnapshots.clientId, clientId),
          eq(analysisSnapshots.platform, platform),
          eq(analysisSnapshots.cadence, cadence),
        ))
        .orderBy(desc(analysisSnapshots.createdAt))
        .limit(1);

      if (dbResult?.data) return dbResult.data;
    }

    // Fallback to file (local dev / legacy)
    const platformDir = platform === "google" ? "google" : "meta";
    const filename = cadence === "twice_weekly" ? "analysis.json" : `analysis_${cadence}.json`;
    const targetFile = path.join(DATA_BASE, "clients", clientId, platformDir, filename);
    if (fs.existsSync(targetFile)) {
      return JSON.parse(fs.readFileSync(targetFile, "utf-8"));
    }

    return null;
  } catch (err) {
    console.error(`[Analysis] Error loading snapshot for ${clientId}/${platform} (${cadence}):`, err);
    return null;
  }
}
