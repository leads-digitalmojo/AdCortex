import { useMemo, useState } from "react";
import { useClient } from "@/lib/client-context";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { formatINR, formatNumber, truncate } from "@/lib/format";
import { AlertTriangle, Users, ChevronDown, ChevronRight, Zap, TrendingUp, TrendingDown, Minus } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface DgAdGroup {
  id?: string;
  name: string;
  status?: string;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  ctr: number;
  avg_cpc: number;
  cvr: number;
  cpl: number;
  health_score?: number;
}

interface DgHealth {
  cpm?: number;
  cpm_baseline?: number;
  cpm_status?: string;
  ctr?: number;
  cpc?: number;
  frequency_note?: string;
}

interface DgCampaign {
  id?: string;
  name: string;
  channel_type: string;
  campaign_type?: string;
  status?: string;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  ctr: number;
  avg_cpc: number;
  cvr: number;
  cpl: number;
  daily_budget?: number;
  dg_health?: DgHealth;
  ad_groups?: DgAdGroup[];
  classification?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getAudienceType(c: DgCampaign): { label: string; color: string } {
  const t = (c.campaign_type || "").toLowerCase();
  if (t.includes("lookalike")) return { label: "Lookalike", color: "bg-blue-500/15 text-blue-400 border-blue-500/30" };
  if (t.includes("inmarket") || t.includes("in_market")) return { label: "In-Market", color: "bg-purple-500/15 text-purple-400 border-purple-500/30" };
  if (t.includes("affinity")) return { label: "Affinity", color: "bg-amber-500/15 text-amber-400 border-amber-500/30" };
  return { label: "Demand Gen", color: "bg-muted text-muted-foreground border-border" };
}

function getClassBadge(cls?: string): { label: string; color: string } {
  switch ((cls || "").toUpperCase()) {
    case "WINNER": return { label: "Winner", color: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" };
    case "MONITOR": return { label: "Watch", color: "bg-amber-500/15 text-amber-400 border-amber-500/30" };
    case "PAUSE": return { label: "Underperformer", color: "bg-red-500/15 text-red-400 border-red-500/30" };
    default: return { label: cls || "—", color: "bg-muted/50 text-muted-foreground border-border/50" };
  }
}

function getAction(c: DgCampaign, targetCpl: number): { label: string; icon: React.ReactNode; color: string } {
  const cls = (c.classification || "").toUpperCase();
  if (cls === "WINNER" && c.cpl > 0 && c.cpl <= targetCpl) return { label: "Scale", icon: <TrendingUp className="w-3 h-3" />, color: "text-emerald-400" };
  if (cls === "MONITOR" || (c.cpl > targetCpl && c.cpl <= targetCpl * 1.5)) return { label: "Optimize", icon: <Minus className="w-3 h-3" />, color: "text-amber-400" };
  if (cls === "PAUSE" || c.cpl > targetCpl * 1.5) return { label: "Pause", icon: <TrendingDown className="w-3 h-3" />, color: "text-red-400" };
  return { label: "Hold", icon: <Minus className="w-3 h-3" />, color: "text-muted-foreground" };
}

function cplColor(cpl: number, targetCpl: number): string {
  if (cpl <= 0) return "text-muted-foreground";
  if (cpl <= targetCpl) return "text-emerald-400";
  if (cpl <= targetCpl * 1.3) return "text-amber-400";
  return "text-red-400";
}

function ctrColor(ctr: number): string {
  if (ctr >= 0.5) return "text-emerald-400";
  if (ctr >= 0.2) return "text-amber-400";
  return "text-red-400";
}

function pct(v: number): string {
  return v > 0 ? v.toFixed(2) + "%" : "—";
}

// ─── Ad Group Sub-Table ───────────────────────────────────────────────────────

function AdGroupSubTable({ adGroups, targetCpl }: { adGroups: DgAdGroup[]; targetCpl: number }) {
  if (adGroups.length === 0) return null;
  return (
    <tr>
      <td colSpan={16} className="p-0 bg-muted/5">
        <div className="ml-10 mr-4 my-2 rounded border border-border/30 overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-muted/20 border-b border-border/20">
                <th className="px-3 py-1.5 text-left t-label text-muted-foreground font-bold uppercase tracking-wider w-[280px]">Ad Group</th>
                <th className="px-3 py-1.5 text-right t-label text-muted-foreground font-bold uppercase tracking-wider">Impressions</th>
                <th className="px-3 py-1.5 text-right t-label text-muted-foreground font-bold uppercase tracking-wider">Clicks</th>
                <th className="px-3 py-1.5 text-right t-label text-muted-foreground font-bold uppercase tracking-wider">CTR</th>
                <th className="px-3 py-1.5 text-right t-label text-muted-foreground font-bold uppercase tracking-wider">Leads</th>
                <th className="px-3 py-1.5 text-right t-label text-muted-foreground font-bold uppercase tracking-wider">CPL</th>
                <th className="px-3 py-1.5 text-right t-label text-muted-foreground font-bold uppercase tracking-wider">CVR</th>
                <th className="px-3 py-1.5 text-right t-label text-muted-foreground font-bold uppercase tracking-wider">Spend</th>
                <th className="px-3 py-1.5 text-right t-label text-muted-foreground font-bold uppercase tracking-wider">Health</th>
              </tr>
            </thead>
            <tbody>
              {adGroups.map((ag, i) => {
                const cvr = ag.clicks > 0 ? (ag.conversions / ag.clicks) * 100 : 0;
                return (
                  <tr key={i} className="border-b border-border/10 last:border-b-0 hover:bg-muted/10 transition-colors">
                    <td className="px-3 py-1.5 text-muted-foreground">{truncate(ag.name, 40)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{formatNumber(ag.impressions)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{formatNumber(ag.clicks)}</td>
                    <td className={cn("px-3 py-1.5 text-right tabular-nums font-medium", ctrColor(ag.ctr))}>{pct(ag.ctr)}</td>
                    <td className={cn("px-3 py-1.5 text-right tabular-nums font-bold", ag.conversions >= 5 ? "text-emerald-400" : ag.conversions >= 1 ? "text-amber-400" : "text-muted-foreground")}>{ag.conversions}</td>
                    <td className={cn("px-3 py-1.5 text-right tabular-nums font-bold", cplColor(ag.cpl, targetCpl))}>{ag.cpl > 0 ? formatINR(ag.cpl, 0) : "—"}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{pct(cvr)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{formatINR(ag.cost, 0)}</td>
                    <td className="px-3 py-1.5 text-right">
                      {ag.health_score != null ? (
                        <span className={cn(
                          "text-xs font-black px-1.5 py-0.5 rounded tabular-nums",
                          ag.health_score >= 70 ? "bg-emerald-500/15 text-emerald-400" :
                          ag.health_score >= 50 ? "bg-amber-500/15 text-amber-400" : "bg-red-500/15 text-red-400"
                        )}>
                          {ag.health_score.toFixed(0)}
                        </span>
                      ) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </td>
    </tr>
  );
}

// ─── Campaign Row ─────────────────────────────────────────────────────────────

function DgCampaignRow({ camp, targetCpl }: { camp: DgCampaign; targetCpl: number }) {
  const [expanded, setExpanded] = useState(false);
  const adGroups = camp.ad_groups || [];
  const audienceType = getAudienceType(camp);
  const classBadge = getClassBadge(camp.classification);
  const action = getAction(camp, targetCpl);
  const cvr = camp.clicks > 0 ? (camp.conversions / camp.clicks) * 100 : 0;
  const cpm = camp.dg_health?.cpm ?? (camp.impressions > 0 ? (camp.cost / camp.impressions) * 1000 : 0);
  const cpmStatus = camp.dg_health?.cpm_status;
  const hasFrequencyNote = !!camp.dg_health?.frequency_note;

  return (
    <>
      <tr
        className={cn(
          "border-b border-border/30 hover:bg-muted/5 transition-colors cursor-pointer",
          camp.classification === "PAUSE" && "border-l-2 border-l-red-500"
        )}
        onClick={() => adGroups.length > 0 && setExpanded(!expanded)}
      >
        {/* Expand */}
        <td className="px-3 py-2.5 w-8">
          {adGroups.length > 0
            ? (expanded ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />)
            : <span className="w-3.5 h-3.5 block" />
          }
        </td>

        {/* Campaign name + subtext */}
        <td className="px-3 py-2.5 max-w-[220px]">
          <p className="font-bold text-foreground text-xs leading-tight truncate">{truncate(camp.name, 50)}</p>
          <div className="flex items-center gap-1 mt-0.5">
            <Badge variant="outline" className={cn("text-xs px-1 py-0 border", audienceType.color)}>{audienceType.label}</Badge>
            {camp.status && (
              <span className="text-xs text-muted-foreground">{camp.status}</span>
            )}
          </div>
        </td>

        {/* Class */}
        <td className="px-3 py-2.5">
          <Badge variant="outline" className={cn("text-xs px-1.5 py-0 border font-bold", classBadge.color)}>
            {classBadge.label}
          </Badge>
        </td>

        {/* Status */}
        <td className="px-3 py-2.5">
          <Badge variant="outline" className={cn(
            "text-xs px-1.5 py-0",
            camp.status === "ENABLED" || camp.status === "ACTIVE"
              ? "text-emerald-400 border-emerald-500/30"
              : "text-muted-foreground border-border/50"
          )}>
            {camp.status || "—"}
          </Badge>
        </td>

        {/* Budget */}
        <td className="px-3 py-2.5 text-right tabular-nums text-xs">
          {camp.daily_budget ? formatINR(camp.daily_budget, 0) : "—"}
        </td>

        {/* Spend */}
        <td className="px-3 py-2.5 text-right tabular-nums text-xs font-bold">
          {formatINR(camp.cost, 0)}
        </td>

        {/* Impressions */}
        <td className="px-3 py-2.5 text-right tabular-nums text-xs">
          {camp.impressions > 0 ? formatNumber(camp.impressions) : "—"}
        </td>

        {/* Clicks */}
        <td className="px-3 py-2.5 text-right tabular-nums text-xs">
          {camp.clicks > 0 ? formatNumber(camp.clicks) : "—"}
        </td>

        {/* CTR */}
        <td className={cn("px-3 py-2.5 text-right tabular-nums text-xs font-medium", ctrColor(camp.ctr))}>
          {pct(camp.ctr)}
        </td>

        {/* Leads */}
        <td className={cn(
          "px-3 py-2.5 text-right tabular-nums text-xs font-bold",
          camp.conversions >= 5 ? "text-emerald-400" : camp.conversions >= 1 ? "text-amber-400" : "text-muted-foreground"
        )}>
          {camp.conversions}
        </td>

        {/* CPL */}
        <td className={cn("px-3 py-2.5 text-right tabular-nums text-xs font-black", cplColor(camp.cpl, targetCpl))}>
          {camp.cpl > 0 ? formatINR(camp.cpl, 0) : "—"}
        </td>

        {/* CPM */}
        <td className={cn(
          "px-3 py-2.5 text-right tabular-nums text-xs",
          cpmStatus === "high" ? "text-red-400" : cpmStatus === "ok" ? "text-emerald-400" : ""
        )}>
          {cpm > 0 ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="cursor-default">{formatINR(cpm, 0)}</span>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">
                {cpmStatus === "high" ? "CPM above baseline" : cpmStatus === "ok" ? "CPM within baseline" : "CPM data"}
                {camp.dg_health?.cpm_baseline ? ` · Baseline: ${formatINR(camp.dg_health.cpm_baseline, 0)}` : ""}
              </TooltipContent>
            </Tooltip>
          ) : "—"}
        </td>

        {/* CVR */}
        <td className="px-3 py-2.5 text-right tabular-nums text-xs text-muted-foreground">
          {pct(cvr)}
        </td>

        {/* CPC */}
        <td className="px-3 py-2.5 text-right tabular-nums text-xs text-muted-foreground">
          {camp.avg_cpc > 0 ? formatINR(camp.avg_cpc, 0) : "—"}
        </td>

        {/* Frequency (note) */}
        <td className="px-3 py-2.5 text-right tabular-nums text-xs">
          {hasFrequencyNote ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="text-amber-400 cursor-default underline decoration-dotted">Note</span>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-[220px] text-xs">
                {camp.dg_health!.frequency_note}
              </TooltipContent>
            </Tooltip>
          ) : "—"}
        </td>

        {/* Action */}
        <td className="px-3 py-2.5">
          <span className={cn("flex items-center gap-1 text-xs font-bold", action.color)}>
            {action.icon}
            {action.label}
          </span>
        </td>
      </tr>

      {/* Expanded ad groups */}
      {expanded && <AdGroupSubTable adGroups={adGroups} targetCpl={targetCpl} />}
    </>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function GoogleAudiencesPage() {
  const { analysisData: data, isLoadingAnalysis: isLoading, activeClient } = useClient();

  const dgCampaigns = useMemo((): DgCampaign[] => {
    if (!data) return [];
    const campaigns: any[] = (data as any).campaigns || [];
    return campaigns
      .filter((c) => String(c.channel_type || "").toUpperCase() === "DEMAND_GEN")
      .map((c) => ({
        id: c.id,
        name: c.name || c.campaign_name || "Unnamed",
        channel_type: c.channel_type,
        campaign_type: c.campaign_type,
        status: c.status,
        impressions: c.impressions || 0,
        clicks: c.clicks || 0,
        cost: c.cost || 0,
        conversions: c.conversions || 0,
        ctr: c.ctr || 0,
        avg_cpc: c.avg_cpc || 0,
        cvr: c.cvr || 0,
        cpl: c.cpl || 0,
        daily_budget: c.daily_budget,
        dg_health: c.dg_health,
        ad_groups: c.ad_groups || [],
        classification: c.classification,
      }));
  }, [data]);

  const targetCpl: number = useMemo(() => {
    return (data as any)?.targets?.google?.target_cpa || (data as any)?.targets?.cpl || 850;
  }, [data]);

  const totalImpressions = dgCampaigns.reduce((s, c) => s + c.impressions, 0);
  const totalLeads = dgCampaigns.reduce((s, c) => s + c.conversions, 0);
  const totalSpend = dgCampaigns.reduce((s, c) => s + c.cost, 0);
  const totalClicks = dgCampaigns.reduce((s, c) => s + c.clicks, 0);
  const avgCpl = totalLeads > 0 ? totalSpend / totalLeads : 0;
  const blendedCtr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;
  const blendedCvr = totalClicks > 0 ? (totalLeads / totalClicks) * 100 : 0;

  const lookalikes = dgCampaigns.filter((c) => (c.campaign_type || "").toLowerCase().includes("lookalike")).length;
  const inMarket = dgCampaigns.filter((c) => { const t = (c.campaign_type || "").toLowerCase(); return t.includes("inmarket") || t.includes("in_market"); }).length;
  const affinity = dgCampaigns.filter((c) => (c.campaign_type || "").toLowerCase().includes("affinity")).length;
  const highCpmCampaigns = dgCampaigns.filter((c) => c.dg_health?.cpm_status === "high");

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-56" />
        <div className="grid grid-cols-4 gap-3">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-20 rounded-lg" />)}
        </div>
        <Skeleton className="h-[400px] rounded-lg" />
      </div>
    );
  }

  if (!data || dgCampaigns.length === 0) {
    return (
      <div className="p-6 space-y-4 max-w-[1600px]">
        <div>
          <h1 className="text-lg font-black text-foreground uppercase tracking-tight flex items-center gap-2">
            <Users className="w-4 h-4 text-primary" /> Audiences · Demand Gen
          </h1>
          <p className="text-xs text-muted-foreground">Demand Gen audience performance · Lookalike, In-Market, Affinity</p>
        </div>
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center gap-3">
            <AlertTriangle className="w-10 h-10 text-muted-foreground" />
            <div>
              <p className="text-base font-medium text-foreground">No Demand Gen data found</p>
              <p className="text-xs text-muted-foreground mt-1">
                No active Demand Gen campaigns for{" "}
                <span className="font-semibold">{activeClient?.shortName || activeClient?.name || "this client"}</span>.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-5 max-w-[1800px]">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-black text-foreground uppercase tracking-tight flex items-center gap-2">
            <Users className="w-4 h-4 text-primary" /> Audiences · Demand Gen
          </h1>
          <p className="text-xs text-muted-foreground">
            {dgCampaigns.length} campaigns · Target CPL: {formatINR(targetCpl, 0)} · Click a row to expand ad groups
          </p>
        </div>
        {highCpmCampaigns.length > 0 && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs font-bold">
            <AlertTriangle className="w-3 h-3" />
            {highCpmCampaigns.length} high CPM {highCpmCampaigns.length === 1 ? "campaign" : "campaigns"}
          </div>
        )}
      </div>

      {/* Summary KPI strip */}
      <div className="grid grid-cols-4 md:grid-cols-7 gap-2">
        {[
          { label: "Campaigns", value: dgCampaigns.length, fmt: "num" },
          { label: "Lookalike", value: lookalikes, fmt: "num", color: "text-blue-400" },
          { label: "In-Market", value: inMarket, fmt: "num", color: "text-purple-400" },
          { label: "Affinity", value: affinity, fmt: "num", color: "text-amber-400" },
          { label: "Total Leads", value: totalLeads, fmt: "num", color: totalLeads > 0 ? "text-emerald-400" : "" },
          { label: "Avg CPL", value: avgCpl, fmt: "inr", color: cplColor(avgCpl, targetCpl) },
          { label: "Blended CTR", value: blendedCtr, fmt: "pct", color: ctrColor(blendedCtr) },
        ].map((kpi) => (
          <Card key={kpi.label} className="border-border/50">
            <CardContent className="card-content-premium">
              <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">{kpi.label}</p>
              <p className={cn("text-2xl font-black tabular-nums", kpi.color || "text-foreground")}>
                {kpi.fmt === "inr" ? (kpi.value > 0 ? formatINR(kpi.value as number, 0) : "—")
                  : kpi.fmt === "pct" ? pct(kpi.value as number)
                  : kpi.value}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Main Table */}
      <Card className="border-border/50 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="t-table w-full">
            <thead>
              {/* Column group labels */}
              <tr className="border-b border-border/20 bg-muted/20">
                <th className="p-0 w-8" />
                <th colSpan={3} className="px-3 py-1.5 text-left text-xs uppercase tracking-widest font-black text-muted-foreground border-r border-border/20">
                  Identity
                </th>
                <th colSpan={2} className="px-3 py-1.5 text-right text-xs uppercase tracking-widest font-black text-muted-foreground border-r border-border/20">
                  Budget
                </th>
                <th colSpan={3} className="px-3 py-1.5 text-right text-xs uppercase tracking-widest font-black text-muted-foreground border-r border-border/20">
                  Delivery
                </th>
                <th colSpan={2} className="px-3 py-1.5 text-right text-xs uppercase tracking-widest font-black text-muted-foreground border-r border-border/20">
                  Performance
                </th>
                <th colSpan={4} className="px-3 py-1.5 text-right text-xs uppercase tracking-widest font-black text-muted-foreground border-r border-border/20">
                  Efficiency
                </th>
                <th className="px-3 py-1.5 text-left text-xs uppercase tracking-widest font-black text-muted-foreground" />
              </tr>
              {/* Column headers */}
              <tr className="border-b border-border/50">
                <th className="w-8 p-0" />
                <th className="px-3 py-3 text-left t-label font-black uppercase tracking-widest text-muted-foreground w-[220px]">Campaign</th>
                <th className="px-3 py-3 text-left t-label font-black uppercase tracking-widest text-muted-foreground">Class</th>
                <th className="px-3 py-3 text-left t-label font-black uppercase tracking-widest text-muted-foreground border-r border-border/20">Status</th>
                <th className="px-3 py-3 text-right t-label font-black uppercase tracking-widest text-muted-foreground">Budget</th>
                <th className="px-3 py-3 text-right t-label font-black uppercase tracking-widest text-muted-foreground border-r border-border/20">Spend</th>
                <th className="px-3 py-3 text-right t-label font-black uppercase tracking-widest text-muted-foreground">Impr</th>
                <th className="px-3 py-3 text-right t-label font-black uppercase tracking-widest text-muted-foreground">Clicks</th>
                <th className="px-3 py-3 text-right t-label font-black uppercase tracking-widest text-muted-foreground border-r border-border/20">CTR</th>
                <th className="px-3 py-3 text-right t-label font-black uppercase tracking-widest text-muted-foreground">Leads</th>
                <th className="px-3 py-3 text-right t-label font-black uppercase tracking-widest text-muted-foreground border-r border-border/20">CPL</th>
                <th className="px-3 py-3 text-right t-label font-black uppercase tracking-widest text-muted-foreground">CPM</th>
                <th className="px-3 py-3 text-right t-label font-black uppercase tracking-widest text-muted-foreground">CVR</th>
                <th className="px-3 py-3 text-right t-label font-black uppercase tracking-widest text-muted-foreground">CPC</th>
                <th className="px-3 py-3 text-right t-label font-black uppercase tracking-widest text-muted-foreground border-r border-border/20">Freq</th>
                <th className="px-3 py-3 text-left t-label font-black uppercase tracking-widest text-muted-foreground">Action</th>
              </tr>
            </thead>
            <tbody>
              {dgCampaigns.map((camp, i) => (
                <DgCampaignRow key={camp.id || i} camp={camp} targetCpl={targetCpl} />
              ))}
              {dgCampaigns.length === 0 && (
                <tr>
                  <td colSpan={16} className="p-8 text-center text-muted-foreground text-xs">No Demand Gen campaigns found</td>
                </tr>
              )}
            </tbody>
            {/* Footer totals */}
            <tfoot>
              <tr className="border-t border-border/50 bg-muted/10">
                <td className="w-8" />
                <td colSpan={3} className="px-3 py-2 text-xs font-black text-foreground uppercase tracking-wider">
                  Total · {dgCampaigns.length} campaigns
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-xs text-muted-foreground">—</td>
                <td className="px-3 py-2 text-right tabular-nums text-xs font-bold border-r border-border/20">{formatINR(totalSpend, 0)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-xs">{formatNumber(totalImpressions)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-xs">{formatNumber(totalClicks)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-xs border-r border-border/20">{pct(blendedCtr)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-xs font-bold">{totalLeads}</td>
                <td className={cn("px-3 py-2 text-right tabular-nums text-xs font-black border-r border-border/20", cplColor(avgCpl, targetCpl))}>
                  {avgCpl > 0 ? formatINR(avgCpl, 0) : "—"}
                </td>
                <td colSpan={4} className="px-3 py-2 text-right tabular-nums text-xs border-r border-border/20">
                  <span className="flex items-center justify-end gap-1 text-muted-foreground">
                    <Zap className="w-3 h-3 text-primary" /> CVR {pct(blendedCvr)}
                  </span>
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>
    </div>
  );
}
