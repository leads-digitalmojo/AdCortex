/**
 * Bulk-create AdPilot users for a team rollout.
 *
 * Mirrors the hashing + storage behaviour of POST /api/access/users in
 * server/auth.ts (scrypt salt:hash, DB-first with access_users.json fallback)
 * so users created here log in exactly like UI-created ones.
 *
 * Usage:
 *   npx tsx scripts/create-users.ts team.json           # create
 *   npx tsx scripts/create-users.ts team.json --dry-run # preview only
 *
 * team.json:
 *   [ { "email": "a@dm.com", "name": "A", "role": "member" },
 *     { "email": "b@dm.com", "name": "B", "role": "admin", "password": "..." } ]
 *
 * role defaults to "member". password is generated when omitted and printed
 * once — it is not recoverable afterwards, only resettable.
 */
import "dotenv/config";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { Pool } from "pg";

type Role = "admin" | "member";
interface TeamEntry {
  email: string;
  name: string;
  role?: Role;
  password?: string;
}

const DATA_BASE = path.resolve(import.meta.dirname, "../../ads_agent/data");
const USERS_FILE = path.join(DATA_BASE, "access_users.json");

// Same scheme as auth.ts createPasswordHash — keep the two in sync.
function createPasswordHash(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${derived}`;
}

// Ambiguous glyphs (0/O, 1/l/I) are excluded so passwords survive being
// read aloud or copied out of a chat message.
function generatePassword(): string {
  const alphabet = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from(crypto.randomBytes(16))
    .map((b) => alphabet[b % alphabet.length])
    .join("");
}

function parseTeamFile(file: string): TeamEntry[] {
  const raw = JSON.parse(fs.readFileSync(file, "utf-8"));
  if (!Array.isArray(raw)) throw new Error(`${file} must contain a JSON array`);
  return raw.map((entry: any, i: number) => {
    const email = String(entry?.email || "").trim().toLowerCase();
    const name = String(entry?.name || "").trim();
    if (!email.includes("@")) throw new Error(`entry ${i}: invalid email ${JSON.stringify(entry?.email)}`);
    if (!name) throw new Error(`entry ${i} (${email}): name is required`);
    const role: Role = entry?.role === "admin" ? "admin" : "member";
    const password = entry?.password ? String(entry.password) : undefined;
    if (password && password.length < 8) throw new Error(`entry ${i} (${email}): password must be >= 8 chars`);
    return { email, name, role, password };
  });
}

function readUsersFile(): any[] {
  if (!fs.existsSync(USERS_FILE)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(USERS_FILE, "utf-8"));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

async function main() {
  const [file, ...flags] = process.argv.slice(2);
  const dryRun = flags.includes("--dry-run");
  if (!file) {
    console.error("usage: npx tsx scripts/create-users.ts <team.json> [--dry-run]");
    process.exit(1);
  }

  const team = parseTeamFile(file);
  const dupes = team.map((t) => t.email).filter((e, i, a) => a.indexOf(e) !== i);
  if (dupes.length) throw new Error(`duplicate emails in ${file}: ${[...new Set(dupes)].join(", ")}`);

  const connectionString = process.env.DATABASE_URL;
  const pool = connectionString ? new Pool({ connectionString }) : null;
  let useDb = false;
  if (pool) {
    try {
      await pool.query("select 1 from users limit 1");
      useDb = true;
    } catch (err: any) {
      console.warn(`[users] Postgres unavailable (${err?.message || err?.code || String(err)}); falling back to ${USERS_FILE}`);
    }
  } else {
    console.warn(`[users] DATABASE_URL not set; falling back to ${USERS_FILE}`);
  }

  const existing = new Set<string>(
    useDb
      ? (await pool!.query("select email from users")).rows.map((r: any) => String(r.email).toLowerCase())
      : readUsersFile().map((u: any) => String(u.email).toLowerCase()),
  );

  const created: Array<{ email: string; name: string; role: Role; password: string }> = [];
  const skipped: string[] = [];

  for (const entry of team) {
    if (existing.has(entry.email)) {
      skipped.push(entry.email);
      continue;
    }
    const password = entry.password || generatePassword();
    const record = {
      id: crypto.randomUUID(),
      email: entry.email,
      name: entry.name,
      passwordHash: createPasswordHash(password),
      role: entry.role as Role,
      status: "active" as const,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    if (!dryRun) {
      if (useDb) {
        await pool!.query(
          `insert into users (id, email, name, password_hash, role, status, created_at, updated_at)
           values ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [record.id, record.email, record.name, record.passwordHash, record.role,
           record.status, record.createdAt, record.updatedAt],
        );
      } else {
        const all = readUsersFile();
        all.push({
          ...record,
          createdAt: record.createdAt.toISOString(),
          updatedAt: record.updatedAt.toISOString(),
        });
        fs.mkdirSync(DATA_BASE, { recursive: true });
        fs.writeFileSync(USERS_FILE, JSON.stringify(all, null, 2));
      }
    }
    created.push({ email: entry.email, name: entry.name, role: entry.role as Role, password });
  }

  await pool?.end();

  console.log(`\nstore: ${useDb ? "postgres" : USERS_FILE}${dryRun ? "  (DRY RUN — nothing written)" : ""}`);
  if (skipped.length) console.log(`skipped (already exist): ${skipped.join(", ")}`);
  if (!created.length) {
    console.log("no new users to create.");
    return;
  }
  console.log(`\n${created.length} user(s) ${dryRun ? "would be created" : "created"} — share these credentials once, then have each person change their password:\n`);
  console.log(`${"email".padEnd(34)}${"name".padEnd(24)}${"role".padEnd(9)}password`);
  console.log("-".repeat(90));
  for (const u of created) {
    console.log(`${u.email.padEnd(34)}${u.name.padEnd(24)}${u.role.padEnd(9)}${u.password}`);
  }
  console.log("");
}

main().catch((err) => {
  console.error(`[users] ${err?.message || err?.code || String(err)}`);
  process.exit(1);
});
