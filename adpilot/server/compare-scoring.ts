/**
 * Before/after scoring comparison.
 *
 * Scores every campaign in a client's stored analysis under the OLD formulas
 * (quadratic decay + 70/35 classification) and the NEW ones (stepped bands +
 * 75/50 with the CPL rule), then prints the diff.
 *
 * Run this before deploying so the team knows which accounts will visibly change:
 *   npx tsx server/compare-scoring.ts <clientId> [meta|google]
 *   npx tsx server/compare-scoring.ts --all
 *
 * This is a throwaway migration aid, not part of the running app.
 */

import fs from "fs";
import path from "path";
import { scoreStagedCostDynamic } from "./scoring-config";
import { getClassification } from "../shared/classification";

const DATA_BASE = path.resolve(import.meta.dirname, "../../ads_agent/data");
const CLIENTS_BASE = path.join(DATA_BASE, "clients");

/** The formula that used to run in the TypeScript layer. */
function oldCostScore(actual: number, target: number): number {
  if (target <= 0) return 100; // the old "no target = full marks" behaviour
  const d = Math.max(0, (actual - target) / target);
  return Math.round(Math.max(0, 1 - 1.5 * d - 5 * d * d) * 100);
}

/** The classification that used to run in the TypeScript layer. */
function oldClassification(score: number): string {
  if (score >= 70) return "WINNER";
  if (score < 35) return "UNDERPERFORMER";
  return "WATCH";
}

function readAnalysis(clientId: string, platform: string): any | null {
  const dir = platform === "google" ? "google" : "meta";
  for (const name of ["analysis.json", "analysis_twice_weekly.json"]) {
    const p = path.join(CLIENTS_BASE, clientId, dir, name);
    if (fs.existsSync(p)) {
      try {
        return JSON.parse(fs.readFileSync(p, "utf-8"));
      } catch {
        return null;
      }
    }
  }
  return null;
}

function resolveTarget(clientId: string, platform: string): number {
  for (const name of [`benchmarks_${platform}.json`, "benchmarks.json"]) {
    const p = path.join(CLIENTS_BASE, clientId, name);
    if (!fs.existsSync(p)) continue;
    try {
      const bm = JSON.parse(fs.readFileSync(p, "utf-8"));
      const t = platform === "google"
        ? (bm.google_cpl ?? bm.cpl)
        : (bm.cpl ?? bm.cpl_target);
      if (typeof t === "number" && t > 0) return t;
    } catch { /* fall through to the default */ }
  }
  return platform === "google" ? 850 : 720;
}

function compareClient(clientId: string, platform: string): void {
  const data = readAnalysis(clientId, platform);
  if (!data) return;

  const campaigns: any[] = data.campaign_audit || data.campaigns || [];
  if (campaigns.length === 0) return;

  const target = resolveTarget(clientId, platform);
  const rows: string[] = [];
  let moved = 0;
  let zeroLeadFixes = 0;

  for (const c of campaigns) {
    const name = (c.campaign_name || c.name || "?").slice(0, 44);
    const leads = Number(c.leads ?? c.conversions ?? 0);
    const spend = Number(c.spend ?? c.cost ?? 0);
    const cpl = Number(c.cpl ?? 0);
    const noLeads = leads <= 0 && spend > 0;

    const before = oldCostScore(cpl, target);
    const after = scoreStagedCostDynamic(noLeads ? Number.POSITIVE_INFINITY : cpl, target);
    const afterNum = after === null ? NaN : after;

    const score = Number(c.health_score ?? c.score ?? 0);
    const beforeCls = oldClassification(score);
    const afterCls = getClassification(score, noLeads ? Number.POSITIVE_INFINITY : cpl, target);

    const cplDelta = Math.abs(afterNum - before);
    if (cplDelta >= 1 || beforeCls !== afterCls) {
      moved++;
      if (noLeads) zeroLeadFixes++;
      const flag = noLeads ? "  ← spend, ZERO leads" : "";
      rows.push(
        `    ${name.padEnd(46)} spend ${String(Math.round(spend)).padStart(7)}  ` +
        `leads ${String(leads).padStart(4)}  ` +
        `cplScore ${String(before).padStart(3)}→${String(afterNum).padStart(3)}  ` +
        `${beforeCls} → ${afterCls}${flag}`
      );
    }
  }

  if (moved === 0) {
    console.log(`\n${clientId} / ${platform}: ${campaigns.length} campaigns, none change.`);
    return;
  }

  console.log(`\n${clientId} / ${platform}  (CPL target ${target})`);
  console.log(`  ${moved} of ${campaigns.length} campaigns change` +
    (zeroLeadFixes > 0 ? `, ${zeroLeadFixes} were zero-lead campaigns scoring as healthy` : ""));
  rows.slice(0, 25).forEach((r) => console.log(r));
  if (rows.length > 25) console.log(`    … and ${rows.length - 25} more`);
}

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("usage: npx tsx server/compare-scoring.ts <clientId> [meta|google]");
  console.error("       npx tsx server/compare-scoring.ts --all");
  process.exit(1);
}

const clientIds = args[0] === "--all"
  ? fs.readdirSync(CLIENTS_BASE).filter((d) => fs.statSync(path.join(CLIENTS_BASE, d)).isDirectory())
  : [args[0]];
const platforms = args[1] ? [args[1]] : ["meta", "google"];

console.log("Scoring change preview — old (quadratic, 70/35) vs new (stepped bands, 75/50 + CPL rule)");
for (const clientId of clientIds) {
  for (const platform of platforms) {
    try {
      compareClient(clientId, platform);
    } catch (err: any) {
      console.error(`  ${clientId}/${platform}: ${err?.message || err}`);
    }
  }
}
