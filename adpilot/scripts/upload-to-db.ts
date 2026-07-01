import { db } from "../server/db";
import { creativeHubs, analysisSnapshots, clients, users } from "../shared/schema";
import fs from "fs";
import path from "path";
import { eq } from "drizzle-orm";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: path.join(__dirname, "../.env") });

const DATA_BASE = path.resolve(__dirname, "../../ads_agent/data");
const USERS_FILE = path.join(DATA_BASE, "access_users.json");

async function syncLocalToDb() {
  console.log("🚀 Starting One-Time Data Sync to PostgreSQL...");

// Skipped for force sync

  // 3. Sync Latest Analysis (Dashboard Data)
  console.log("  Syncing Dashboard Snapshots...");
  const CLIENTS_BASE = path.join(DATA_BASE, "clients");
  if (fs.existsSync(CLIENTS_BASE)) {
    const clientDirs = fs.readdirSync(CLIENTS_BASE).filter(f => fs.lstatSync(path.join(CLIENTS_BASE, f)).isDirectory());
    
    for (const clientId of clientDirs) {
      const metaPath = path.join(CLIENTS_BASE, clientId, "meta");
      if (fs.existsSync(metaPath)) {
        // Read all cadences in meta directory
        const files = fs.readdirSync(metaPath);
        for (const f of files) {
          const match = f.match(/^analysis(?:_(.+))?\.json$/);
          if (match) {
            const cadence = match[1] || "twice_weekly";
            const data = JSON.parse(fs.readFileSync(path.join(metaPath, f), "utf-8"));
            await db.insert(analysisSnapshots).values({
              clientId,
              platform: "meta",
              cadence,
              data,
            }).onConflictDoUpdate({
              target: [analysisSnapshots.clientId, analysisSnapshots.platform, analysisSnapshots.cadence],
              set: { data, createdAt: new Date() },
            });
          }
        }
      }

      const googlePath = path.join(CLIENTS_BASE, clientId, "google");
      if (fs.existsSync(googlePath)) {
        // Read all cadences in google directory
        const files = fs.readdirSync(googlePath);
        for (const f of files) {
          const match = f.match(/^analysis(?:_(.+))?\.json$/);
          if (match) {
            const cadence = match[1] || "twice_weekly";
            const data = JSON.parse(fs.readFileSync(path.join(googlePath, f), "utf-8"));
            await db.insert(analysisSnapshots).values({
              clientId,
              platform: "google",
              cadence,
              data,
            }).onConflictDoUpdate({
              target: [analysisSnapshots.clientId, analysisSnapshots.platform, analysisSnapshots.cadence],
              set: { data, createdAt: new Date() },
            });
          }
        }
      }
    }
  }

  console.log("✅ Sync Complete! Your database is now populated with all local data.");
  process.exit(0);
}

syncLocalToDb().catch(err => {
  console.error("❌ Sync Failed:", err);
  process.exit(1);
});
