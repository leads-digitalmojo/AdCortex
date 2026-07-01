/**
 * SOP Loader — loads and evaluates SOPs from the structured database
 * Replaces hardcoded rules in sop-engine.ts with a configurable database
 */

import * as fs from "fs";
import * as path from "path";

export interface SopCondition {
  type: "threshold" | "compound";
  field?: string;
  operator?: string;
  value?: number | string;
  reference?: string;
  platformThresholds?: Record<string, number>;
  conditions?: SopCondition[];
  comparison?: string;
  threshold?: number;
}

export interface SopDefinition {
  id: string;
  name: string;
  category: string;
  metric: string;
  platforms: string[];
  entityType: string;
  enabled: boolean;
  priority: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  iceScore: number;
  condition: SopCondition;
  issue: string;
  impactTemplate?: string;
  impactTemplateEntity?: string;
  recommendation: string;
  recommendationTemplate?: string;
  notes?: string;
}

export interface SopDatabase {
  version: string;
  lastUpdated: string;
  source: string;
  description: string;
  shared_sops: SopDefinition[];
  meta_sops: SopDefinition[];
  google_sops: SopDefinition[];
}

let cachedDatabase: SopDatabase | null = null;

/**
 * Load the SOP database from JSON file
 */
export function loadSopDatabase(): SopDatabase {
  if (cachedDatabase) return cachedDatabase;

  const dbPath = path.join(import.meta.dirname, "sop-database.json");

  if (!fs.existsSync(dbPath)) {
    console.warn(`⚠️  SOP database not found at ${dbPath}. Using fallback SOPs only.`);
    return { version: "1.0", lastUpdated: "", source: "", description: "", shared_sops: [], meta_sops: [], google_sops: [] };
  }

  try {
    const raw = fs.readFileSync(dbPath, "utf-8");
    const parsed = JSON.parse(raw) as SopDatabase;
    cachedDatabase = parsed;

    // Calculate total loaded SOPs
    const totalSops = (parsed.shared_sops?.length || 0) + (parsed.meta_sops?.length || 0) + (parsed.google_sops?.length || 0);
    console.log(`✓ Loaded SOP database v${parsed.version} (${totalSops} SOPs).`);
    return parsed;
  } catch (err: any) {
    console.error(`✗ Failed to parse SOP database: ${err.message}`);
    return { version: "1.0", lastUpdated: "", source: "", description: "", shared_sops: [], meta_sops: [], google_sops: [] };
  }
}

/**
 * Evaluate a single SOP condition against data
 */
function evaluateCondition(
  condition: SopCondition,
  data: Record<string, any>,
  targets: Record<string, any>,
  platform: string
): boolean {
  if (condition.type === "threshold") {
    const field = condition.field!;
    const operator = condition.operator!;
    let actual = data[field];
    let threshold = condition.value!;

    // Resolve reference-based thresholds (multiplier × reference value)
    const multiplier = (typeof condition.value === "number") ? condition.value : 1;

    if (condition.reference === "target_cpl") {
      threshold = (targets.cpl || 800) * multiplier;
    } else if (condition.reference === "platform_baseline") {
      threshold = 120 * multiplier; // Meta default
    } else if (condition.reference === "trailing_7day_average") {
      actual = data[field];
      threshold = (data.trailing_7day_cvr || 1.0) * 0.5;
    } else if (condition.reference === "platform_benchmark") {
      const benchmarks = condition.platformThresholds || { google: 3.0, meta: 4.0 };
      threshold = benchmarks[platform] || 3.0;
    } else if (condition.reference === "hot_warm_ratio") {
      actual = data.lead_quality_ratio || 0;
      threshold = 0.6;
    }

    // Handle comparisons
    if (operator === ">") return actual > threshold;
    if (operator === "<") return actual < threshold;
    if (operator === ">=") return actual >= threshold;
    if (operator === "<=") return actual <= threshold;
    if (operator === "==") return actual === threshold;
    if (operator === "!=") return actual !== threshold;
    if (operator === "increased") {
      // Baseline comparison: check if actual > baseline
      return actual > (threshold || data.baseline || 0);
    }
    if (operator === "decreased") {
      // Baseline comparison: check if actual < baseline
      return actual < (data.baseline || threshold || 100);
    }
    if (operator === "vs_plan") {
      // Budget variance check: ±20%
      const variance = Math.abs((actual - (data.plan || 0)) / (data.plan || 1));
      return variance > (condition.threshold || 0.2);
    }
    return false;
  }

  if (condition.type === "compound") {
    const subConditions = condition.conditions || [];
    const operator = condition.operator!; // AND or OR

    if (operator === "AND") {
      return subConditions.every(cond =>
        evaluateCondition(cond, data, targets, platform)
      );
    }
    if (operator === "OR") {
      return subConditions.some(cond =>
        evaluateCondition(cond, data, targets, platform)
      );
    }
  }

  return false;
}

/**
 * Format template string with data values
 */
function formatTemplate(
  template: string | undefined,
  data: Record<string, any>,
  targets: Record<string, any>
): string {
  if (!template) return "";

  let result = template;

  // Replace {field} placeholders with actual values
  const matches = template.match(/\{([^}]+)\}/g) || [];
  matches.forEach(match => {
    const field = match.slice(1, -1); // Remove { }
    let value = data[field];

    // Compute derived fields on-the-fly
    if (field === "ratio" && data.overall_cpl && targets.cpl) {
      value = (data.overall_cpl / targets.cpl).toFixed(1);
    } else if (field === "target_cpl") {
      value = targets.cpl || 800;
    } else if (field === "benchmark") {
      value = data.benchmark || targets.cpl || 800;
    } else if (field === "spend") {
      value = Math.round(value || 0);
    } else if (field === "cpl" || field === "cpc" || field === "cpm") {
      value = value ? parseFloat(value).toFixed(2) : "0";
    } else if (field === "cvr") {
      value = value ? parseFloat(value).toFixed(2) : "0";
    } else if (field === "leads" || field === "impressions") {
      value = value ? Math.round(value).toLocaleString() : "0";
    } else if (field === "days_active") {
      value = Math.round(value || 0);
    } else if (field === "lost_budget" || field === "lost_rank") {
      value = value ? parseFloat(value).toFixed(0) : "0";
    } else if (field === "frequency") {
      value = value ? parseFloat(value).toFixed(1) : "0";
    } else if (field === "quality_ratio" || field === "baseline" || field === "spend_variance") {
      value = value ? parseFloat(value).toFixed(2) : "0";
    } else if (field === "disapprovals") {
      value = value || 0;
    } else if (field === "leads_today") {
      value = value || 0;
    }

    result = result.replace(match, String(value));
  });

  return result;
}

/**
 * Get SOPs that match the given data, filtered by platform
 * Returns matched SOPs in priority order
 */
export function getMatchingSops(
  data: Record<string, any>,
  entityType: "account" | "campaign" | "adset" | "ad_group" | "ad",
  targets: Record<string, any>,
  platform: "meta" | "google"
): Array<{
  sop: SopDefinition;
  issue: string;
  impact: string;
  recommendation: string;
}> {
  const db = loadSopDatabase();
  const matched: Array<{
    sop: SopDefinition;
    issue: string;
    impact: string;
    recommendation: string;
  }> = [];

  const allSops = [
    ...(db.shared_sops || []),
    ...(db.meta_sops || []),
    ...(db.google_sops || []),
  ];

  allSops.forEach(sop => {
    // Filter by enabled, platform, entity type
    if (!sop.enabled) return;
    if (!sop.platforms.includes(platform) && !sop.platforms.includes("all")) return;
    if (sop.entityType !== entityType) return;

    // Evaluate condition
    if (!evaluateCondition(sop.condition, data, targets, platform)) return;

    // Format templates with actual data
    const issue = sop.issue;
    const impact = formatTemplate(sop.impactTemplate, data, targets);
    const recommendation = formatTemplate(sop.recommendation, data, targets);

    // Handle template-based recommendations (with placeholders like {name})
    let finalRecommendation = recommendation;
    if (sop.recommendationTemplate && data.name) {
      finalRecommendation = formatTemplate(sop.recommendationTemplate, data, targets);
    }

    matched.push({
      sop,
      issue,
      impact: impact || sop.issue,
      recommendation: finalRecommendation || sop.recommendation,
    });
  });

  // Sort by priority (CRITICAL > HIGH > MEDIUM > LOW) then by ice_score
  const priorityMap = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
  matched.sort((a, b) => {
    const aPriority = priorityMap[a.sop.priority] || 0;
    const bPriority = priorityMap[b.sop.priority] || 0;
    if (aPriority !== bPriority) return bPriority - aPriority;
    return (b.sop.iceScore || 0) - (a.sop.iceScore || 0);
  });

  return matched;
}

/**
 * Get all enabled SOPs for a platform
 */
export function getEnabledSops(platform: "meta" | "google"): SopDefinition[] {
  const db = loadSopDatabase();
  const allSops = [
    ...(db.shared_sops || []),
    ...(db.meta_sops || []),
    ...(db.google_sops || []),
  ];
  return allSops.filter(sop => sop.enabled && (sop.platforms.includes(platform) || sop.platforms.includes("all")));
}

/**
 * Reload the SOP database (useful for testing or manual refresh)
 */
export function reloadSopDatabase(): SopDatabase {
  cachedDatabase = null;
  return loadSopDatabase();
}
