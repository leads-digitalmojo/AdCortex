import fs from "fs";
import path from "path";
import { storage } from "./storage";

// 18% GST is the statutory rate applied to Indian ad billing. Google states open-ended
// prepaid wallet balances pre-tax; Meta's wallet balance is already tax-inclusive while
// campaign daily budgets are pre-tax. Gross-up is applied on whichever side needs it so
// availableFunds and runway stay in consistent, tax-inclusive terms.
const GST_RATE = 0.18;
const TAX_MULTIPLIER = 1 + GST_RATE;

// Zero-decimal currencies report whole-unit amounts already (no /100 conversion needed).
const ZERO_DECIMAL_CURRENCIES = new Set(["JPY", "KRW", "VND", "CLP", "ISK", "BIF", "DJF", "GNF", "KMF", "PYG", "RWF", "UGX", "VUV", "XAF", "XOF", "XPF"]);

const META_BASE_URL = "https://graph.facebook.com/v21.0";
// v21 sunset on 2026-08-05 — bump this whenever Google retires the current version.
const GOOGLE_ADS_BASE_URL = "https://googleads.googleapis.com/v25";
const GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";

const CACHE_FILE = path.resolve(import.meta.dirname, "../../ads_agent/data/available_funds_state.json");

export interface MetaFundsCreds {
  accessToken: string;
  adAccountId: string;
}

export interface GoogleFundsCreds {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  developerToken: string;
  mccId?: string;
  customerId?: string;
}

export interface FundsResult {
  platform: string;
  currency: string | null;
  availableFunds: number | null;
  daysRemaining: number | null;
  source: string;
  error?: string;
}

interface CachedFundsResult extends FundsResult {
  fetchedAt: string;
}

type FundsCacheStore = Record<string, Record<string, CachedFundsResult>>;

function parseGoogleAdsApiError(body: any): string {
  try {
    const details = body?.error?.details ?? [];
    const messages: string[] = [];
    for (const detail of details) {
      for (const err of detail?.errors ?? []) {
        messages.push(err?.message ?? JSON.stringify(err?.errorCode ?? {}));
      }
    }
    if (messages.length) return messages.join("; ");
    return body?.error?.message || JSON.stringify(body).slice(0, 500);
  } catch {
    return "Unknown Google Ads API error";
  }
}

async function getGoogleAccessToken(google: GoogleFundsCreds): Promise<string> {
  const body = new URLSearchParams({
    client_id: google.clientId,
    client_secret: google.clientSecret,
    refresh_token: google.refreshToken,
    grant_type: "refresh_token",
  });

  const resp = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  const data = await resp.json().catch(() => null);
  if (!resp.ok || !data?.access_token) {
    throw new Error(`Token refresh failed: ${resp.status}${data ? ` - ${parseGoogleAdsApiError(data)}` : ""}`);
  }

  return data.access_token;
}

export async function computeMetaAvailableFunds(meta: MetaFundsCreds): Promise<FundsResult> {
  const fields = ["spend_cap", "amount_spent", "balance", "currency", "funding_source_details", "is_prepay_account"].join(",");
  const acctUrl = `${META_BASE_URL}/${meta.adAccountId}?fields=${fields}&access_token=${meta.accessToken}`;
  const acctResp = await fetch(acctUrl);
  const acct = await acctResp.json().catch(() => null);
  if (!acctResp.ok) {
    throw new Error(acct?.error?.message || `Meta API request failed (${acctResp.status})`);
  }

  const currency = acct.currency || "USD";
  const divisor = ZERO_DECIMAL_CURRENCIES.has(currency) ? 1 : 100;
  const rawSpendCap = acct.spend_cap != null ? Number(acct.spend_cap) / divisor : 0;
  const rawAmountSpent = acct.amount_spent != null ? Number(acct.amount_spent) / divisor : 0;

  // balance is debt owed (postpaid), never treated as available funds.
  let rawBalance = 0;
  let accountIsPrepaid = false;
  let source = "unavailable";

  if (acct.is_prepay_account === true) {
    const displayString: string | undefined = acct.funding_source_details?.display_string;
    const match = displayString?.match(/(?:[$₹£€¥]|\w{3})\s*([\d,]+\.?\d*)/);
    if (match) {
      rawBalance = parseFloat(match[1].replace(/,/g, ""));
      accountIsPrepaid = true;
      source = "prepaid_wallet";
    } else if (rawSpendCap > 0) {
      rawBalance = Math.max(0, rawSpendCap - rawAmountSpent);
      accountIsPrepaid = true;
      source = "prepaid_spend_cap";
    }
  }

  let availableFunds: number | null;
  if (accountIsPrepaid) {
    availableFunds = rawBalance;
  } else if (rawSpendCap > 0) {
    availableFunds = Math.max(0, rawSpendCap - rawAmountSpent);
    source = "spend_cap";
  } else {
    availableFunds = null;
  }

  // Daily budget & runway: campaign daily budgets are pre-tax while the wallet is
  // tax-inclusive, so the burn side needs the gross-up (it doesn't cancel out here).
  let daysRemaining: number | null = null;
  try {
    const campUrl = `${META_BASE_URL}/${meta.adAccountId}/campaigns?fields=daily_budget,effective_status&limit=500&access_token=${meta.accessToken}`;
    const campResp = await fetch(campUrl);
    const camp = await campResp.json().catch(() => null);
    if (campResp.ok && Array.isArray(camp?.data)) {
      const totalDailyBudget = camp.data
        .filter((c: any) => c.effective_status === "ACTIVE")
        .reduce((sum: number, c: any) => sum + (c.daily_budget ? Number(c.daily_budget) / divisor : 0), 0);
      const effectiveDailyBurn = totalDailyBudget * TAX_MULTIPLIER;
      if (effectiveDailyBurn > 0 && availableFunds != null && availableFunds > 0) {
        daysRemaining = Math.round((availableFunds / effectiveDailyBurn) * 10) / 10;
      }
    }
  } catch {
    // Runway is a bonus metric; ignore campaign-fetch failures.
  }

  return { platform: "meta", currency, availableFunds, daysRemaining, source };
}

export async function computeGoogleAvailableFunds(google: GoogleFundsCreds): Promise<FundsResult> {
  const { mccId, customerId, developerToken } = google;
  if (!customerId) {
    throw new Error("Google customer ID is required");
  }

  const accessToken = await getGoogleAccessToken(google);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "developer-token": developerToken,
    "Content-Type": "application/json",
  };
  if (mccId && mccId !== customerId) {
    headers["login-customer-id"] = mccId;
  }

  // account_budget is only populated for customers on monthly invoicing; most
  // card-billed accounts won't have one, which is a normal, expected outcome.
  const budgetResp = await fetch(`${GOOGLE_ADS_BASE_URL}/customers/${customerId}/googleAds:search`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      query: `
        SELECT
          account_budget.status,
          account_budget.approved_spending_limit_micros,
          account_budget.approved_spending_limit_type,
          account_budget.amount_served_micros,
          account_budget.total_adjustments_micros,
          account_budget.approved_start_date_time,
          account_budget.approved_end_date_time,
          customer.currency_code
        FROM account_budget
        WHERE account_budget.status = 'APPROVED'
      `,
    }),
  });

  const budgetData = await budgetResp.json().catch(() => null);
  if (!budgetResp.ok) {
    throw new Error(parseGoogleAdsApiError(budgetData) || `Google Ads API request failed (${budgetResp.status})`);
  }

  const rows: any[] = budgetData?.results || [];
  const currency = rows[0]?.customer?.currencyCode || null;

  if (rows.length === 0) {
    return { platform: "google", currency, availableFunds: null, daysRemaining: null, source: "unavailable" };
  }

  const now = Date.now();
  const isActive = (r: any) => {
    const start = r.accountBudget.approvedStartDateTime ? Date.parse(r.accountBudget.approvedStartDateTime) : null;
    const end = r.accountBudget.approvedEndDateTime ? Date.parse(r.accountBudget.approvedEndDateTime) : null;
    return (start == null || start <= now) && (end == null || end >= now);
  };
  let active = rows.filter(isActive);
  if (active.length === 0) {
    // Fall back to the most recently started order.
    const sorted = [...rows].sort((a, b) =>
      Date.parse(b.accountBudget.approvedStartDateTime || 0) - Date.parse(a.accountBudget.approvedStartDateTime || 0)
    );
    active = sorted.length > 0 ? [sorted[0]] : [];
  }

  if (active.length === 0) {
    return { platform: "google", currency, availableFunds: null, daysRemaining: null, source: "unavailable" };
  }

  const primary = active[0].accountBudget;
  let grossFactor = 1;
  let source = "account_budget";
  if (primary.approvedSpendingLimitType === "INFINITE") {
    source = "postpaid";
  } else if (!primary.approvedEndDateTime) {
    grossFactor = TAX_MULTIPLIER;
    source = "prepaid_open_ended";
  } else {
    source = "prepaid_month_bounded";
  }

  let remaining = 0;
  for (const row of active) {
    const ab = row.accountBudget;
    const limitMicros = Number(ab.approvedSpendingLimitMicros || 0);
    if (limitMicros <= 0) continue;
    const served = Number(ab.amountServedMicros || 0);
    const adjustments = Number(ab.totalAdjustmentsMicros || 0);
    remaining += Math.max(0, (limitMicros + adjustments - served) / 1_000_000);
  }

  const availableFunds = primary.approvedSpendingLimitType === "INFINITE" ? null : remaining * grossFactor;

  // Daily budget & runway: dedupe shared budgets by budget id.
  let daysRemaining: number | null = null;
  try {
    const campResp = await fetch(`${GOOGLE_ADS_BASE_URL}/customers/${customerId}/googleAds:search`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        query: `
          SELECT campaign.id, campaign.status, campaign_budget.id, campaign_budget.amount_micros
          FROM campaign
          WHERE campaign.status = 'ENABLED'
        `,
      }),
    });
    const campData = await campResp.json().catch(() => null);
    if (campResp.ok && Array.isArray(campData?.results)) {
      const seenBudgetIds = new Set<string>();
      let dailyBudgetMicros = 0;
      for (const r of campData.results) {
        const budgetId = r.campaignBudget?.id;
        if (!budgetId || seenBudgetIds.has(budgetId)) continue;
        seenBudgetIds.add(budgetId);
        dailyBudgetMicros += Number(r.campaignBudget?.amountMicros || 0);
      }
      const dailyBudget = dailyBudgetMicros / 1_000_000;
      const effectiveDailyBurn = dailyBudget * grossFactor;
      if (effectiveDailyBurn > 0 && availableFunds != null && availableFunds > 0) {
        daysRemaining = Math.round((availableFunds / effectiveDailyBurn) * 10) / 10;
      }
    }
  } catch {
    // Runway is a bonus metric; ignore campaign-fetch failures.
  }

  return { platform: "google", currency, availableFunds, daysRemaining, source };
}

// ─── Cache (analogous to Firestore's spendSnapshots — read by the route, written by the scheduler) ───

let cache: FundsCacheStore = {};

function loadCache(): void {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      cache = JSON.parse(fs.readFileSync(CACHE_FILE, "utf-8"));
    }
  } catch {
    cache = {};
  }
}

function saveCache(): void {
  const dir = path.dirname(CACHE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
}

loadCache();

export function getCachedAvailableFunds(clientId: string, platform: string): CachedFundsResult | null {
  return cache[clientId]?.[platform] || null;
}

export function setCachedAvailableFunds(clientId: string, platform: string, result: FundsResult): CachedFundsResult {
  const entry: CachedFundsResult = { ...result, fetchedAt: new Date().toISOString() };
  if (!cache[clientId]) cache[clientId] = {};
  cache[clientId][platform] = entry;
  saveCache();
  return entry;
}

function isPlaceholderSecret(value?: string): boolean {
  return !value || value.trim() === "" || value.trim().startsWith("YOUR_");
}

export interface RefreshOutcome {
  clientId: string;
  platform: string;
  ok: boolean;
  error?: string;
}

/**
 * Fetches available funds for every client's connected ad accounts and refreshes the
 * cache. Run on a 30-minute schedule plus on-demand, mirroring the reference
 * googleSync/metaSync Cloud Scheduler jobs.
 */
export async function refreshAllAvailableFunds(): Promise<RefreshOutcome[]> {
  const clients = await storage.getAllClients();
  const outcomes: RefreshOutcome[] = [];

  for (const client of clients) {
    const creds = await storage.getCredentials(client.id);

    const meta = creds?.meta as MetaFundsCreds | undefined;
    if (meta?.accessToken && meta?.adAccountId && !isPlaceholderSecret(meta.accessToken) && !isPlaceholderSecret(meta.adAccountId)) {
      try {
        const result = await computeMetaAvailableFunds(meta);
        setCachedAvailableFunds(client.id, "meta", result);
        outcomes.push({ clientId: client.id, platform: "meta", ok: true });
      } catch (err: any) {
        outcomes.push({ clientId: client.id, platform: "meta", ok: false, error: err.message });
      }
    }

    const google = creds?.google as GoogleFundsCreds | undefined;
    if (
      google?.clientId && google?.clientSecret && google?.refreshToken &&
      !isPlaceholderSecret(google.clientId) && !isPlaceholderSecret(google.clientSecret) && !isPlaceholderSecret(google.refreshToken)
    ) {
      try {
        const result = await computeGoogleAvailableFunds(google);
        setCachedAvailableFunds(client.id, "google", result);
        outcomes.push({ clientId: client.id, platform: "google", ok: true });
      } catch (err: any) {
        outcomes.push({ clientId: client.id, platform: "google", ok: false, error: err.message });
      }
    }
  }

  return outcomes;
}
