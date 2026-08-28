/**
 * Turn off the Google platform for clients whose Google account is dead.
 *
 * A suspended/canceled account still gets a Python process spawned for it on
 * every run, still burns its slot in the queue, and still reports sync_status
 * "success" — because fetching an empty result set succeeds. This finds those
 * clients from the live MCC and disables the platform so they stop costing
 * time and stop showing a misleading green state.
 *
 * Disabling is reversible: flip google.enabled back on in Manage Clients, or
 * re-run with --enable once the Google account is live again.
 *
 *   npx tsx scripts/disable-dead-google-clients.ts            # preview (default)
 *   npx tsx scripts/disable-dead-google-clients.ts --apply    # write changes
 *   npx tsx scripts/disable-dead-google-clients.ts --apply --include-empty
 *   npx tsx scripts/disable-dead-google-clients.ts --enable <clientId>...
 */
import "dotenv/config";
import { Pool } from "pg";

const BASE_URL = "https://googleads.googleapis.com/v25";
const norm = (v: unknown) => String(v ?? "").replace(/\D/g, "");

// Statuses that mean the account can never return data.
const DEAD_STATUSES = new Set(["SUSPENDED", "CANCELED", "CLOSED"]);

interface GoogleCreds {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  developerToken: string;
  mccId: string;
  customerId: string;
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
  if (!resp.ok) throw new Error(`OAuth refresh failed (${resp.status}): ${data?.error_description || data?.error}`);
  return data.access_token;
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
    method: "POST", headers, body: JSON.stringify({ query }),
  });
  const data: any = await resp.json().catch(() => null);
  if (!resp.ok) {
    throw new Error(
      data?.error?.details?.[0]?.errors?.[0]?.message || data?.error?.message || `HTTP ${resp.status}`,
    );
  }
  return (data?.results || []) as any[];
}

async function setGoogleEnabled(pool: Pool, clientId: string, enabled: boolean) {
  // jsonb_set on the nested key leaves every other platform and field untouched.
  await pool.query(
    `update clients
        set platforms = jsonb_set(platforms, '{google,enabled}', $2::jsonb, false),
            updated_at = now()
      where id = $1
        and platforms ? 'google'`,
    [clientId, JSON.stringify(enabled)],
  );
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const includeEmpty = args.includes("--include-empty");
  const enableIdx = args.indexOf("--enable");

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required — run this on the server holding the production DB");
  const pool = new Pool({ connectionString });

  if (enableIdx !== -1) {
    const ids = args.slice(enableIdx + 1).filter((a) => !a.startsWith("--"));
    if (!ids.length) throw new Error("--enable needs at least one client id");
    for (const id of ids) {
      await setGoogleEnabled(pool, id, true);
      console.log(`re-enabled google for ${id}`);
    }
    await pool.end();
    return;
  }

  const { rows } = await pool.query(
    `select c.id, c.name, c.platforms, cc.google
       from clients c
       left join client_credentials cc on cc.client_id = c.id
      order by c.name`,
  );

  const live = rows.filter((r) => {
    const g = r.google as GoogleCreds | null;
    return Boolean((r.platforms as any)?.google?.enabled) && g?.refreshToken && g?.customerId;
  });

  // Build the MCC account tree once per distinct manager account.
  const tree = new Map<string, { name: string; status: string }>();
  const seenMcc = new Set<string>();
  for (const r of live) {
    const g = r.google as GoogleCreds;
    const mcc = norm(g.mccId);
    if (!mcc || seenMcc.has(mcc)) continue;
    seenMcc.add(mcc);
    try {
      const token = await getAccessToken(g);
      const results = await search(token, g, mcc, `
        SELECT customer_client.id, customer_client.descriptive_name, customer_client.status
        FROM customer_client WHERE customer_client.level <= 2`);
      for (const row of results) {
        const cc = row.customerClient;
        tree.set(norm(cc.id), { name: cc.descriptiveName || "", status: cc.status || "UNKNOWN" });
      }
      console.log(`MCC ${mcc}: ${results.length} accounts`);
    } catch (err: any) {
      console.error(`MCC ${mcc}: enumeration failed — ${err.message}`);
      console.error("Refusing to disable anything while an MCC is unreadable.");
      await pool.end();
      process.exit(1);
    }
  }

  const targets: Array<{ id: string; name: string; customerId: string; reason: string }> = [];
  for (const r of live) {
    const g = r.google as GoogleCreds;
    const cid = norm(g.customerId);
    const account = tree.get(cid);

    if (!account) {
      targets.push({ id: r.id, name: r.name, customerId: cid, reason: "not under the MCC" });
      continue;
    }
    if (DEAD_STATUSES.has(account.status)) {
      targets.push({ id: r.id, name: r.name, customerId: cid, reason: account.status });
      continue;
    }
    if (!includeEmpty) continue;

    // --include-empty also disables ENABLED accounts with nothing running.
    try {
      const token = await getAccessToken(g);
      const campaigns = await search(token, g, cid,
        `SELECT campaign.id FROM campaign WHERE campaign.status = 'ENABLED' LIMIT 1`);
      if (campaigns.length === 0) {
        targets.push({ id: r.id, name: r.name, customerId: cid, reason: "no enabled campaigns" });
      }
    } catch (err: any) {
      console.error(`  ${r.id}: campaign probe failed, leaving enabled — ${err.message}`);
    }
  }

  console.log(`\n${live.length} google-enabled clients | ${targets.length} to disable\n`);
  for (const t of targets) {
    console.log(`  ${t.id.padEnd(34)}${t.customerId.padEnd(13)}${t.reason}`);
  }

  if (!targets.length) {
    await pool.end();
    return;
  }

  if (!apply) {
    console.log("\nPreview only — re-run with --apply to write these changes.");
    await pool.end();
    return;
  }

  for (const t of targets) {
    await setGoogleEnabled(pool, t.id, false);
    console.log(`disabled google for ${t.id}`);
  }
  await pool.end();
  console.log(`\n${targets.length} client(s) disabled. Re-enable with:`);
  console.log(`  npx tsx scripts/disable-dead-google-clients.ts --enable ${targets.map((t) => t.id).join(" ")}`);
}

main().catch((err) => {
  console.error(`[dead-clients] ${err?.message || err?.code || String(err)}`);
  process.exit(1);
});
