/**
 * Audit Google Ads data flow for every AdPilot client.
 *
 * Joins three sources that can silently drift apart:
 *   1. clients / client_credentials in Postgres (which account a client points at)
 *   2. the live Google Ads MCC tree (whether that account still exists + is ENABLED)
 *   3. a live 30-day metrics probe (whether data is actually coming back)
 *
 * Run it on the server that holds the production DATABASE_URL:
 *   npx tsx scripts/audit-google-flow.ts
 *   npx tsx scripts/audit-google-flow.ts --json > audit.json
 */
import "dotenv/config";
import { Pool } from "pg";

const API_VERSION = "v25";
const BASE_URL = `https://googleads.googleapis.com/${API_VERSION}`;

const norm = (v: unknown) => String(v ?? "").replace(/\D/g, "");

interface GoogleCreds {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  developerToken: string;
  mccId: string;
  customerId: string;
}

interface Row {
  clientId: string;
  clientName: string;
  enabled: boolean;
  customerId: string;
  mccId: string;
  accountName: string;
  accountStatus: string;
  verdict: string;
  cost30d: number;
  impressions30d: number;
  conversions30d: number;
  detail: string;
}

async function getAccessToken(c: GoogleCreds): Promise<string> {
  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: c.clientId,
      client_secret: c.clientSecret,
      refresh_token: c.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const data: any = await resp.json().catch(() => null);
  if (!resp.ok) throw new Error(`OAuth refresh failed (${resp.status}): ${data?.error_description || data?.error || "unknown"}`);
  return data.access_token;
}

function apiError(data: any, status: number): string {
  return (
    data?.error?.details?.[0]?.errors?.[0]?.message ||
    data?.error?.message ||
    `Google Ads API request failed (${status})`
  );
}

async function search(token: string, creds: GoogleCreds, customerId: string, query: string) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "developer-token": creds.developerToken,
    "Content-Type": "application/json",
  };
  const login = norm(creds.mccId);
  if (login && login !== norm(customerId)) headers["login-customer-id"] = login;

  const resp = await fetch(`${BASE_URL}/customers/${norm(customerId)}/googleAds:search`, {
    method: "POST",
    headers,
    body: JSON.stringify({ query }),
  });
  const data: any = await resp.json().catch(() => null);
  if (!resp.ok) throw new Error(apiError(data, resp.status));
  return (data?.results || []) as any[];
}

async function main() {
  const asJson = process.argv.includes("--json");
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required — run this on the server that holds the production DB");
  const pool = new Pool({ connectionString });

  const { rows: clientRows } = await pool.query(
    `select c.id, c.name, c.platforms, cc.google
       from clients c
       left join client_credentials cc on cc.client_id = c.id
      order by c.name`,
  );

  // Enumerate every MCC referenced by any client, so accounts spread across
  // more than one manager account are all covered.
  const mccGroups = new Map<string, GoogleCreds>();
  for (const r of clientRows) {
    const g = r.google as GoogleCreds | null;
    if (!g?.refreshToken || !g?.mccId) continue;
    const key = norm(g.mccId);
    if (!mccGroups.has(key)) mccGroups.set(key, g);
  }

  const tree = new Map<string, { name: string; status: string; manager: boolean }>();
  for (const [mccId, creds] of mccGroups) {
    try {
      const token = await getAccessToken(creds);
      const results = await search(token, creds, mccId, `
        SELECT customer_client.id, customer_client.descriptive_name,
               customer_client.status, customer_client.manager
        FROM customer_client WHERE customer_client.level <= 2`);
      for (const r of results) {
        const cc = r.customerClient;
        tree.set(norm(cc.id), {
          name: cc.descriptiveName || `Account ${cc.id}`,
          status: cc.status || "UNKNOWN",
          manager: Boolean(cc.manager),
        });
      }
      console.error(`[audit] MCC ${mccId}: ${results.length} accounts in tree`);
    } catch (err: any) {
      console.error(`[audit] MCC ${mccId}: enumeration failed — ${err.message}`);
    }
  }

  const tokenCache = new Map<string, string>();
  const rows: Row[] = [];

  for (const r of clientRows) {
    const platforms = (r.platforms || {}) as Record<string, any>;
    const enabled = Boolean(platforms.google?.enabled);
    const g = r.google as GoogleCreds | null;
    const base = {
      clientId: r.id as string,
      clientName: r.name as string,
      enabled,
      customerId: norm(g?.customerId),
      mccId: norm(g?.mccId),
      cost30d: 0,
      impressions30d: 0,
      conversions30d: 0,
    };

    if (!enabled) {
      rows.push({ ...base, accountName: "", accountStatus: "", verdict: "PLATFORM OFF", detail: "google platform disabled for this client" });
      continue;
    }
    if (!g?.refreshToken || !g?.developerToken || !g?.customerId) {
      rows.push({ ...base, accountName: "", accountStatus: "", verdict: "NO CREDENTIALS", detail: "missing google credentials in client_credentials" });
      continue;
    }

    const account = tree.get(norm(g.customerId));
    const accountName = account?.name || "";
    const accountStatus = account?.status || "NOT IN MCC";

    if (!account) {
      rows.push({ ...base, accountName, accountStatus, verdict: "NOT UNDER MCC", detail: `customer ${norm(g.customerId)} is not under MCC ${norm(g.mccId)}` });
      continue;
    }
    if (account.status !== "ENABLED") {
      rows.push({ ...base, accountName, accountStatus, verdict: `ACCOUNT ${account.status}`, detail: "Google account is not ENABLED — no data will ever flow" });
      continue;
    }

    try {
      const cacheKey = `${g.clientId}:${g.refreshToken.slice(-12)}`;
      let token = tokenCache.get(cacheKey);
      if (!token) {
        token = await getAccessToken(g);
        tokenCache.set(cacheKey, token);
      }

      const metrics = await search(token, g, g.customerId, `
        SELECT metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions
        FROM customer WHERE segments.date DURING LAST_30_DAYS`);
      let impressions = 0, cost = 0, conversions = 0;
      for (const m of metrics) {
        impressions += Number(m.metrics?.impressions || 0);
        cost += Number(m.metrics?.costMicros || 0) / 1e6;
        conversions += Number(m.metrics?.conversions || 0);
      }

      const campaigns = await search(token, g, g.customerId,
        `SELECT campaign.id FROM campaign WHERE campaign.status = 'ENABLED' LIMIT 50`);

      const verdict =
        impressions > 0 || cost > 0 ? "DATA OK"
        : campaigns.length === 0 ? "NO ACTIVE CAMPAIGNS"
        : "ZERO DATA (30d)";

      rows.push({
        ...base, accountName, accountStatus, verdict,
        cost30d: cost, impressions30d: impressions, conversions30d: conversions,
        detail: `${campaigns.length} enabled campaign(s)`,
      });
    } catch (err: any) {
      rows.push({ ...base, accountName, accountStatus, verdict: "API ERROR", detail: err.message });
    }
  }

  await pool.end();

  if (asJson) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  const pad = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s.padEnd(n));
  console.log(
    "\n" + pad("adpilot client", 34) + pad("customer id", 13) + pad("google account", 30) +
    pad("verdict", 21) + "30d cost".padStart(12) + "impr".padStart(12) + "conv".padStart(8),
  );
  console.log("-".repeat(130));
  const order = ["API ERROR", "NOT UNDER MCC", "NO CREDENTIALS", "ZERO DATA (30d)", "NO ACTIVE CAMPAIGNS"];
  const rank = (v: string) => { const i = order.indexOf(v); return i === -1 ? (v === "DATA OK" ? 99 : 50) : i; };
  for (const row of [...rows].sort((a, b) => rank(a.verdict) - rank(b.verdict) || a.clientName.localeCompare(b.clientName))) {
    console.log(
      pad(row.clientName, 34) + pad(row.customerId || "-", 13) + pad(row.accountName || "-", 30) +
      pad(row.verdict, 21) +
      Math.round(row.cost30d).toLocaleString().padStart(12) +
      row.impressions30d.toLocaleString().padStart(12) +
      Math.round(row.conversions30d).toLocaleString().padStart(8),
    );
    if (row.verdict !== "DATA OK" && row.detail) console.log(" ".repeat(34) + `└─ ${row.detail}`);
  }

  const counts = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.verdict] = (acc[r.verdict] || 0) + 1;
    return acc;
  }, {});
  console.log("\nSUMMARY:", counts);
  const broken = rows.filter((r) => r.enabled && r.verdict !== "DATA OK").length;
  console.log(`${rows.length} clients | google-enabled but not returning data: ${broken}`);
  if (broken > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(`[audit] ${err?.message || err?.code || String(err)}`);
  process.exit(1);
});
