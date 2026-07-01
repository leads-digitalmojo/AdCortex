import path from "path";
import fs from "fs";
import { db, pool } from "../server/db.js";
import { analysisSnapshots } from "../shared/schema.js";
import { and, eq } from "drizzle-orm";

/**
 * Migration script to push local JSON analysis results to the production PostgreSQL database.
 * Run this locally with: DATABASE_URL=your_render_url npx tsx script/push-data.ts
 */

const __root = import.meta.dirname || process.cwd();
const DATA_BASE = path.resolve(__root, "../../ads_agent/data");

async function pushData() {
  console.log(`[Push] Scanning ${DATA_BASE} for analysis files...`);
  
  if (!fs.existsSync(DATA_BASE)) {
    console.error(`[Error] Data directory not found at ${DATA_BASE}`);
    process.exit(1);
  }

  const clientsDir = path.join(DATA_BASE, "clients");
  const clients = fs.readdirSync(clientsDir).filter(f => fs.statSync(path.join(clientsDir, f)).isDirectory());

  for (const clientId of clients) {
    const platforms = ["meta", "google"];
    for (const platform of platforms) {
      const platformDir = path.join(clientsDir, clientId, platform);
      if (!fs.existsSync(platformDir)) continue;

      const cadences = [
        { key: "daily", file: "analysis_daily.json" },
        { key: "twice_weekly", file: "analysis.json" },
        { key: "weekly", file: "analysis_weekly.json" },
        { key: "biweekly", file: "analysis_biweekly.json" },
        { key: "monthly", file: "analysis_monthly.json" },
      ];

      for (const { key: cadence, file: filename } of cadences) {
        const filePath = path.join(platformDir, filename);
        if (fs.existsSync(filePath)) {
          try {
            const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
            
            console.log(`[Push] Pushing ${clientId}/${platform} (${cadence}) to DB...`);
            
            await db
              .insert(analysisSnapshots)
              .values({
                clientId,
                platform,
                cadence,
                data,
                createdAt: new Date(),
              })
              .onConflictDoUpdate({
                target: [analysisSnapshots.clientId, analysisSnapshots.platform, analysisSnapshots.cadence],
                set: { data, createdAt: new Date() },
              });
              
            console.log(`[Push] ✓ Successfully pushed ${filename}`);
          } catch (e) {
            console.error(`[Push] ✗ Failed to push ${filename}:`, e);
          }
        }
      }
    }
  }

  console.log("[Push] Completed syncing all local data to DB.");
  await pool.end();
}

pushData().catch(e => {
  console.error("[Push] Global Error:", e);
  process.exit(1);
});
