import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "../shared/schema.js";
import dotenv from "dotenv";
import path from "path";

const __root = import.meta.dirname || process.cwd();
dotenv.config({ path: path.resolve(__root, "../.env") });

if (!process.env.DATABASE_URL) {
  if (process.env.NODE_ENV === "production") {
    throw new Error("DATABASE_URL must be set in production");
  }
  console.warn("DATABASE_URL is missing! Persistence will be limited to JSON files.");
}

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  // SSL configuration for Render Postgres:
  // - Internal URL (postgres://dpg-xxxxx-a): Set ssl: false (encrypted on Render's network)
  // - External URL (postgresql://...postgres.render.com): Set ssl: true (but only if using proper cert validation)
  // For production, use the internal URL when app and DB are in the same region.
  // The DATABASE_URL should start with "postgres://dpg-" for internal (no SSL needed)
  // or "postgresql://" for external (requires SSL, handled by connection string if suffixed with ?sslmode=require).
  ssl: process.env.NODE_ENV === "production"
    ? (
        process.env.DATABASE_URL?.includes("dpg-") || 
        process.env.DATABASE_URL?.includes("localhost") || 
        process.env.DATABASE_URL?.includes("127.0.0.1") 
          ? false 
          : { rejectUnauthorized: false }
      )
    : false,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on("error", (err) => {
  console.error("[DB] Unexpected pool error:", err.message);
});

// Graceful shutdown — close pool when the process exits
process.once("SIGTERM", () => pool.end());
process.once("SIGINT", () => pool.end());

export const db = drizzle(pool, { schema });

export async function runMigrations() {
  if (!process.env.DATABASE_URL) return;
  const client = await pool.connect();
  try {
    // This project is intentionally "migration-light" in dev and uses a small
    // idempotent bootstrap to keep local DBs compatible across schema changes.
    // Keep statements ordered so older DBs can be upgraded safely.

    // --- clients table ---
    await client.query(`
      CREATE TABLE IF NOT EXISTS "clients" (
        "id" text PRIMARY KEY NOT NULL,
        "name" text NOT NULL,
        "short_name" text NOT NULL,
        "project" text NOT NULL,
        "location" text NOT NULL,
        "target_locations" jsonb DEFAULT '[]'::jsonb,
        "platforms" jsonb DEFAULT '{}'::jsonb NOT NULL,
        "targets" jsonb DEFAULT '{}'::jsonb,
        "created_at" timestamp DEFAULT now(),
        "updated_at" timestamp DEFAULT now(),
        "created_by" text
      );
    `);

    // --- client_credentials table (required for scheduler "Run Agent") ---
    await client.query(`
      CREATE TABLE IF NOT EXISTS "client_credentials" (
        "client_id" text PRIMARY KEY NOT NULL REFERENCES "clients"("id") ON DELETE CASCADE,
        "meta" jsonb,
        "google" jsonb,
        "updated_at" timestamp DEFAULT now()
      );
    `);

    // --- analysis_snapshots table (cadence-aware) ---
    await client.query(`
      CREATE TABLE IF NOT EXISTS "analysis_snapshots" (
        "id" serial PRIMARY KEY NOT NULL,
        "client_id" text NOT NULL,
        "platform" text NOT NULL,
        "cadence" text NOT NULL DEFAULT 'twice_weekly',
        "data" jsonb NOT NULL,
        "created_at" timestamp DEFAULT now()
      );
    `);
    // Upgrade older DBs that were created before cadence existed.
    await client.query(`
      ALTER TABLE "analysis_snapshots"
        ADD COLUMN IF NOT EXISTS "cadence" text NOT NULL DEFAULT 'twice_weekly';
    `);
    // Replace the old uniqueness constraint (client, platform) with (client, platform, cadence).
    await client.query(`DROP INDEX IF EXISTS "uq_analysis_client_platform";`);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_analysis_client_platform_cadence"
      ON "analysis_snapshots" USING btree ("client_id","platform","cadence");
    `);

    // --- performance_alerts table (fixes /api/performance-alerts 500s) ---
    await client.query(`
      CREATE TABLE IF NOT EXISTS "performance_alerts" (
        "id" serial PRIMARY KEY NOT NULL,
        "client_id" text NOT NULL,
        "platform" text NOT NULL,
        "type" text NOT NULL,
        "entity_id" text,
        "entity_name" text,
        "metric" text,
        "severity" text NOT NULL,
        "message" text NOT NULL,
        "status" text DEFAULT 'active' NOT NULL,
        "created_at" timestamp DEFAULT now(),
        "updated_at" timestamp DEFAULT now()
      );
    `);

    console.log("[DB] Migrations applied (bootstrap)");
  } catch (err) {
    console.error("[DB] Migration failed:", err);
    throw err;
  } finally {
    client.release();
  }
}
