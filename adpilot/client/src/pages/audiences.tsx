import { useState, useMemo } from "react";
import { useClient } from "@/lib/client-context";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Users,
  Target,
  TrendingUp,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Filter,
} from "lucide-react";
import { formatINR, truncate } from "@/lib/format";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface AudienceRow {
  name: string;
  type: string;           // adset layer or campaign type
  campaign?: string;
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
  cpl: number;
  ctr: number;
  cpc: number;
  frequency?: number;
  health_score?: number;
  classification?: string;
  should_pause?: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function classificationBadge(cls?: string): { label: string; cls: string } {
  switch ((cls || "").toUpperCase()) {
    case "WINNER": return { label: "Winner", cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" };
    case "MONITOR": return { label: "Monitor", cls: "bg-amber-500/15 text-amber-400 border-amber-500/30" };
    case "PAUSE": case "LOSER": return { label: "Pause", cls: "bg-red-500/15 text-red-400 border-red-500/30" };
    default: return { label: cls || "—", cls: "bg-muted text-muted-foreground border-border" };
  }
}

function layerBadge(layer: string): { label: string; cls: string } {
  switch ((layer || "").toUpperCase()) {
    case "TOFU": return { label: "TOFU", cls: "bg-blue-500/15 text-blue-400 border-blue-500/30" };
    case "MOFU": return { label: "MOFU", cls: "bg-purple-500/15 text-purple-400 border-purple-500/30" };
    case "BOFU": return { label: "BOFU", cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" };
    default: return { label: layer || "—", cls: "bg-muted text-muted-foreground border-border" };
  }
}

function cplColor(cpl: number, target: number): string {
  if (cpl <= 0) return "text-muted-foreground";
  if (cpl <= target) return "text-emerald-400";
  if (cpl <= target * 1.3) return "text-amber-400";
  return "text-red-400";
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AudiencesPage() {
  const { analysisData: data, isLoadingAnalysis: isLoading, activePlatform } = useClient();
  const [searchTerm, setSearchTerm] = useState("");
  const [sortKey, setSortKey] = useState<keyof AudienceRow>("spend");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [filterLayer, setFilterLayer] = useState<string>("all");

  // ── Extract audience rows from actual data ──────────────────────────────────
  const audiences = useMemo((): AudienceRow[] => {
    if (!data) return [];

    // META: use adset_analysis — each adset defines an audience/targeting group
    const adsets: any[] = (data as any).adset_analysis || [];
    if (adsets.length > 0) {
      return adsets.map((a: any) => ({
        name: a.adset_name || "Unnamed adset",
        type: a.layer || "—",
        campaign: a.campaign_name,
        spend: a.spend || 0,
        impressions: a.impressions || 0,
        clicks: a.clicks || 0,
        leads: a.leads || 0,
        cpl: a.cpl || 0,
        ctr: a.ctr || 0,
        cpc: a.cpc || 0,
        frequency: a.frequency,
        health_score: a.health_score,
        classification: a.classification,
        should_pause: a.should_pause,
      }));
    }

    // GOOGLE: fall back to campaigns
    const campaigns: any[] = (data as any).campaigns || [];
    if (campaigns.length > 0) {
      return campaigns.map((c: any) => ({
        name: c.name || c.campaign_name || "Unnamed campaign",
        type: c.channel_type || c.campaign_type || "Campaign",
        spend: c.cost || 0,
        impressions: c.impressions || 0,
        clicks: c.clicks || 0,
        leads: c.conversions || 0,
        cpl: c.cpl || 0,
        ctr: c.ctr || 0,
        cpc: c.avg_cpc || 0,
        classification: c.classification,
      }));
    }

    return [];
  }, [data]);

  const targetCpl: number = useMemo(() => {
    return (data as any)?.targets?.cpl ||
      (data as any)?.targets?.google?.target_cpa ||
      (data as any)?.sop_benchmarks?.target_cpl ||
      850;
  }, [data]);

  // Unique layers for filter
  const layers = useMemo(() => {
    const set = new Set(audiences.map((a) => a.type).filter(Boolean));
    return Array.from(set);
  }, [audiences]);

  const filtered = useMemo(() => {
    let list = audiences.filter((a) =>
      a.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (a.campaign || "").toLowerCase().includes(searchTerm.toLowerCase())
    );
    if (filterLayer !== "all") {
      list = list.filter((a) => a.type === filterLayer);
    }
    return [...list].sort((a, b) => {
      const av = a[sortKey] as number | string;
      const bv = b[sortKey] as number | string;
      if (typeof av === "number" && typeof bv === "number") {
        return sortDir === "asc" ? av - bv : bv - av;
      }
      return sortDir === "asc"
        ? String(av).localeCompare(String(bv))
        : String(bv).localeCompare(String(av));
    });
  }, [audiences, searchTerm, sortKey, sortDir, filterLayer]);

  const totalSpend = filtered.reduce((s, a) => s + a.spend, 0);
  const totalLeads = filtered.reduce((s, a) => s + a.leads, 0);
  const avgCpl = totalLeads > 0 ? totalSpend / totalLeads : 0;
  const winners = audiences.filter((a) => (a.classification || "").toUpperCase() === "WINNER").length;
  const pauseCandidates = audiences.filter((a) => a.should_pause || (a.classification || "").toUpperCase() === "PAUSE").length;

  function toggleSort(key: keyof AudienceRow) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("desc"); }
  }

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-20 rounded-lg" />)}
        </div>
        <Skeleton className="h-[500px] rounded-lg" />
      </div>
    );
  }

  if (!data || audiences.length === 0) {
    return (
      <div className="p-6 space-y-5 max-w-[1400px]">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Users className="w-5 h-5 text-primary" />
            Audience Intelligence
          </h1>
          <h1 className="t-page-title flex items-center gap-2">
            <Users className="w-5 h-5 text-primary" />
            Audience Intelligence
          </h1>
          <p className="t-label text-muted-foreground">Targeting group performance and efficiency</p>
        </div>
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center gap-3">
            <AlertTriangle className="w-10 h-10 text-muted-foreground" />
            <div>
              <p className="t-body font-medium text-foreground">No audience data available</p>
              <p className="text-xs text-muted-foreground mt-1">
                Run the {activePlatform === "google" ? "Google Ads" : "Meta Ads"} agent to populate audience data.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-5 max-w-[1400px]">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="t-page-title flex items-center gap-2">
            <Users className="w-5 h-5 text-primary" />
            Audience Intelligence
          </h1>
          <p className="t-label text-muted-foreground">
            {activePlatform === "google" ? "Campaign-level" : "Adset-level"} targeting performance · Target CPL:{" "}
            {formatINR(targetCpl, 0)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Layer filter */}
          {layers.length > 1 && (
            <div className="flex items-center gap-0.5 p-1 bg-muted/30 rounded-lg border border-border/50">
              <button
                onClick={() => setFilterLayer("all")}
                className={cn(
                  "px-2.5 py-1 text-xs font-bold rounded-md transition-all",
                  filterLayer === "all" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                )}
              >
                All
              </button>
              {layers.map((l) => {
                const lb = layerBadge(l);
                return (
                  <button
                    key={l}
                    onClick={() => setFilterLayer(l)}
                    className={cn(
                      "px-2.5 py-1 text-xs font-bold rounded-md transition-all",
                      filterLayer === l ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {lb.label}
                  </button>
                );
              })}
            </div>
          )}
          <div className="relative">
            <Filter className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search audiences..."
              className="pl-8 pr-3 py-1.5 text-xs rounded-md bg-muted/50 border border-border/50 text-foreground w-52"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card className="border-border/50">
          <CardContent className="card-content-premium">
            <p className="t-label uppercase tracking-wider text-muted-foreground mb-1">Segments</p>
            <p className="t-display tabular-nums">{audiences.length}</p>
          </CardContent>
        </Card>
        <Card className="border-emerald-500/30 bg-emerald-500/3">
          <CardContent className="card-content-premium">
            <p className="t-label uppercase tracking-wider text-muted-foreground mb-1">Winners</p>
            <p className="t-display text-emerald-400 tabular-nums">{winners}</p>
          </CardContent>
        </Card>
        <Card className={cn("border-border/50", pauseCandidates > 0 && "border-red-500/30 bg-red-500/3")}>
          <CardContent className="card-content-premium">
            <p className="t-label uppercase tracking-wider text-muted-foreground mb-1">Pause Candidates</p>
            <p className={cn("t-display tabular-nums", pauseCandidates > 0 ? "text-red-400" : "text-foreground")}>
              {pauseCandidates}
            </p>
          </CardContent>
        </Card>
        <Card className="border-border/50">
          <CardContent className="card-content-premium">
            <p className="t-label uppercase tracking-wider text-muted-foreground mb-1">Total Leads</p>
            <p className="t-display text-emerald-400 tabular-nums">{totalLeads}</p>
          </CardContent>
        </Card>
        <Card className="border-border/50">
          <CardContent className="card-content-premium">
            <p className="t-label uppercase tracking-wider text-muted-foreground mb-1">Avg CPL</p>
            <p className={cn("t-display tabular-nums", cplColor(avgCpl, targetCpl))}>
              {avgCpl > 0 ? formatINR(avgCpl, 0) : "—"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Table */}
      <Card className="border-border/50 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="t-table w-full">
            <thead>
              {/* Pivot Group Header Row */}
              <tr className="border-b border-border/10 bg-muted/5">
                <th colSpan={2} className="px-3 py-1.5 text-xs font-black uppercase tracking-[0.2em] text-muted-foreground border-r border-border/10 text-center">Identity</th>
                <th colSpan={3} className="px-3 py-1.5 text-xs font-black uppercase tracking-[0.2em] text-muted-foreground border-r border-border/10 text-center">Delivery</th>
                <th colSpan={4} className="px-3 py-1.5 text-xs font-black uppercase tracking-[0.2em] text-muted-foreground border-r border-border/10 text-center">Efficiency/Performance</th>
                <th colSpan={2} className="px-3 py-1.5 text-xs font-black uppercase tracking-[0.2em] text-muted-foreground text-center">Health</th>
              </tr>
              <tr className="bg-muted/20 border-b border-border/50">
                {([
                  { key: "name", label: "Audience / Adset", align: "left" },
                  { key: "type", label: "Layer", align: "left" },
                  { key: "spend", label: "Spend", align: "right" },
                  { key: "impressions", label: "Impr.", align: "right" },
                  { key: "clicks", label: "Clicks", align: "right" },
                  { key: "ctr", label: "CTR", align: "right" },
                  { key: "leads", label: "Leads", align: "right" },
                  { key: "cpl", label: "CPL", align: "right" },
                  { key: "frequency", label: "Freq.", align: "right" },
                  { key: "health_score", label: "Score", align: "right" },
                  { key: "classification", label: "Status", align: "center" },
                ] as { key: keyof AudienceRow; label: string; align: string }[]).map((col) => (
                  <th
                    key={col.key}
                    className={cn(
                      "p-3 py-4 text-xs font-black uppercase tracking-wider text-muted-foreground cursor-pointer select-none whitespace-nowrap border-r border-border/5 last:border-0 hover:text-foreground transition-colors",
                      col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : "text-left"
                    )}
                    onClick={() => toggleSort(col.key)}
                  >
                    <span className="inline-flex items-center gap-1">
                      {col.label}
                      {sortKey === col.key && (
                        sortDir === "asc"
                          ? <ChevronUp className="w-3 h-3" />
                          : <ChevronDown className="w-3 h-3" />
                      )}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={11} className="p-10 text-center text-xs text-muted-foreground ">
                    No audiences match your filter.
                  </td>
                </tr>
              ) : (
                filtered.map((a, idx) => {
                  const lBadge = layerBadge(a.type);
                  const clsBadge = classificationBadge(a.classification);
                  return (
                    <tr
                      key={idx}
                      className={cn(
                        "border-b border-border/20 hover:bg-muted/10 transition-colors",
                        a.should_pause && "bg-red-500/3"
                      )}
                    >
                      {/* Name */}
                      <td className="p-3 max-w-[280px]">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div>
                              <p className="t-body font-semibold text-foreground truncate">{truncate(a.name, 45)}</p>
                              {a.campaign && (
                                <p className="t-label text-muted-foreground truncate">{truncate(a.campaign, 40)}</p>
                              )}
                            </div>
                          </TooltipTrigger>
                          {a.name.length > 45 && (
                            <TooltipContent className="max-w-xs text-xs">{a.name}</TooltipContent>
                          )}
                        </Tooltip>
                      </td>

                      {/* Layer */}
                      <td className="p-3">
                        <Badge variant="outline" className={cn("text-xs px-1.5 py-0 border whitespace-nowrap", lBadge.cls)}>
                          {lBadge.label}
                        </Badge>
                      </td>

                      {/* Spend */}
                      <td className="p-3 text-right tabular-nums font-medium">
                        {formatINR(a.spend, 0)}
                      </td>

                      {/* Impressions */}
                      <td className="p-3 text-right tabular-nums text-muted-foreground">
                        {a.impressions > 0 ? a.impressions.toLocaleString() : "—"}
                      </td>

                      {/* Clicks */}
                      <td className="p-3 text-right tabular-nums text-muted-foreground">
                        {a.clicks > 0 ? a.clicks.toLocaleString() : "—"}
                      </td>

                      {/* CTR */}
                      <td className={cn(
                        "p-3 text-right tabular-nums font-medium",
                        a.ctr >= 1 ? "text-emerald-400" : a.ctr >= 0.5 ? "text-amber-400" : "text-red-400"
                      )}>
                        {a.ctr > 0 ? `${a.ctr.toFixed(2)}%` : "—"}
                      </td>

                      {/* Leads */}
                      <td className={cn(
                        "p-3 text-right tabular-nums font-bold",
                        a.leads >= 10 ? "text-emerald-400" : a.leads >= 3 ? "text-amber-400" : a.leads > 0 ? "text-foreground" : "text-muted-foreground"
                      )}>
                        {a.leads > 0 ? a.leads : "—"}
                      </td>

                      {/* CPL */}
                      <td className={cn("p-3 text-right tabular-nums font-bold", cplColor(a.cpl, targetCpl))}>
                        {a.cpl > 0 ? formatINR(a.cpl, 0) : "—"}
                      </td>

                      {/* Frequency */}
                      <td className={cn(
                        "p-3 text-right tabular-nums",
                        a.frequency == null ? "text-muted-foreground" :
                        a.frequency >= 6 ? "text-red-400" :
                        a.frequency >= 4 ? "text-amber-400" : "text-emerald-400"
                      )}>
                        {a.frequency != null ? `${a.frequency.toFixed(1)}×` : "—"}
                      </td>

                      {/* Health Score */}
                      <td className="p-3 text-right">
                        {a.health_score != null ? (
                          <span className={cn(
                            "text-xs font-bold px-1.5 py-0.5 rounded",
                            a.health_score >= 70 ? "bg-emerald-500/15 text-emerald-400" :
                            a.health_score >= 50 ? "bg-amber-500/15 text-amber-400" : "bg-red-500/15 text-red-400"
                          )}>
                            {a.health_score.toFixed(0)}
                          </span>
                        ) : <span className="text-muted-foreground">—</span>}
                      </td>

                      {/* Classification */}
                      <td className="p-3 text-center">
                        {a.classification ? (
                          <Badge variant="outline" className={cn("text-xs px-1.5 py-0 border whitespace-nowrap", clsBadge.cls)}>
                            {clsBadge.label}
                          </Badge>
                        ) : a.should_pause ? (
                          <Badge variant="outline" className="text-xs px-1.5 py-0 border bg-red-500/15 text-red-400 border-red-500/30">
                            Pause
                          </Badge>
                        ) : <span className="text-muted-foreground">—</span>}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Pause alert */}
      {pauseCandidates > 0 && (
        <Card className="bg-red-500/5 border-red-500/30">
          <CardContent className="card-content-premium p-4 space-y-1">
            <p className="t-page-title text-red-400 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5" />
              {pauseCandidates} audience{pauseCandidates > 1 ? "s" : ""} recommended for pause
            </p>
            {audiences
              .filter((a) => a.should_pause || (a.classification || "").toUpperCase() === "PAUSE")
              .map((a, i) => (
                <p key={i} className="t-label text-muted-foreground ml-5">
                  <span className="font-medium text-foreground">{truncate(a.name, 50)}</span>
                  {" — "}CPL {a.cpl > 0 ? formatINR(a.cpl, 0) : "no conversions"} vs target {formatINR(targetCpl, 0)}
                </p>
              ))}
          </CardContent>
        </Card>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between text-xs text-muted-foreground border-t border-border/30 pt-3">
        <span>
          {filtered.length} of {audiences.length} segments · {totalLeads} leads · {formatINR(totalSpend, 0)} spend
        </span>
        <span className="flex items-center gap-1">
          <Target className="w-3 h-3 text-primary" />
          Target CPL: {formatINR(targetCpl, 0)}
        </span>
      </div>
    </div>
  );
}
