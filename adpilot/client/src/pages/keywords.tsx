import { useState, useMemo } from "react";
import { useClient } from "@/lib/client-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Search,
  Target,
  TrendingUp,
  AlertTriangle,
  ArrowUpDown,
  ChevronDown,
  ChevronUp,
  MousePointerClick,
  BarChart3,
  Filter,
} from "lucide-react";
import { formatINR, formatPct, truncate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { DataTablePagination } from "@/components/data-table-pagination";

interface KeywordEntry {
  keyword: string;
  match_type: string;
  campaign: string;
  ad_group: string;
  spend: number;
  clicks: number;
  impressions: number;
  conversions: number;
  cpl: number;
  ctr: number;
  cpc: number;
  quality_score: number;
  status: string;
  cvr: number;
  top_is: number;
  classification?: string;
  recommendation?: string;
}

export default function KeywordsPage() {
  const { analysisData: data, isLoadingAnalysis: isLoading } = useClient();
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCampaign, setSelectedCampaign] = useState("all");
  const [sortKey, setSortKey] = useState<keyof KeywordEntry>("spend");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const keywords: KeywordEntry[] = useMemo(() => {
    if (!data) return [];
    // Extract keywords from various potential places in analysis data
    const fromQs = (data as any).quality_score_analysis?.keywords || [];
    const fromBreakdowns = (data as any).keyword_breakdowns || [];
    
    // Merge and normalize
    const merged = [...fromQs, ...fromBreakdowns].map((k: any) => ({
      keyword: k.keyword_text || k.keyword || "Unknown",
      match_type: k.match_type || "—",
      campaign: k.campaign_name || k.campaign || "—",
      ad_group: k.ad_group_name || k.ad_group || "—",
      spend: k.cost || k.spend || 0,
      clicks: k.clicks || 0,
      impressions: k.impressions || 0,
      conversions: k.conversions || 0,
      cpl: k.cpl || (k.conversions > 0 ? (k.cost || k.spend || 0) / k.conversions : 0),
      ctr: k.ctr || (k.impressions > 0 ? (k.clicks / k.impressions) * 100 : 0),
      cpc: k.cpc || (k.clicks > 0 ? (k.cost || k.spend || 0) / k.clicks : 0),
      quality_score: k.quality_score || 0,
      status: k.status || "active",
      cvr: k.cvr || (k.clicks > 0 ? (k.conversions / k.clicks) * 100 : 0),
      top_is: k.top_is || k.search_top_impression_share || 0,
      classification: k.classification,
      recommendation: k.recommendation,
    }));

    return merged;
  }, [data]);

  const campaigns = useMemo(() => {
    const set = new Set<string>();
    keywords.forEach(k => k.campaign !== "—" && set.add(k.campaign));
    return Array.from(set);
  }, [keywords]);

  const filteredKeywords = useMemo(() => {
    let list = keywords.filter(k => {
      const matchSearch = k.keyword.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          k.campaign.toLowerCase().includes(searchTerm.toLowerCase());
      const matchCampaign = selectedCampaign === "all" || k.campaign === selectedCampaign;
      return matchSearch && matchCampaign;
    });

    list.sort((a, b) => {
      const aVal = a[sortKey];
      const bVal = b[sortKey];
      if (typeof aVal === "number" && typeof bVal === "number") {
        return sortDir === "asc" ? aVal - bVal : bVal - aVal;
      }
      return sortDir === "asc"
        ? String(aVal).localeCompare(String(bVal))
        : String(bVal).localeCompare(String(aVal));
    });

    return list;
  }, [keywords, searchTerm, selectedCampaign, sortKey, sortDir]);

  const paginatedKeywords = useMemo(() => {
    return filteredKeywords.slice((page - 1) * pageSize, page * pageSize);
  }, [filteredKeywords, page, pageSize]);

  const stats = useMemo(() => {
    const totalSpend = filteredKeywords.reduce((s, k) => s + k.spend, 0);
    const totalConversions = filteredKeywords.reduce((s, k) => s + k.conversions, 0);
    const avgCpl = totalConversions > 0 ? totalSpend / totalConversions : 0;
    const spendWeightedQs = totalSpend > 0 
      ? filteredKeywords.reduce((s, k) => s + (k.quality_score * k.spend), 0) / totalSpend 
      : (filteredKeywords.length > 0 ? filteredKeywords.reduce((s, k) => s + k.quality_score, 0) / filteredKeywords.length : 0);
    
    return { totalSpend, totalConversions, avgCpl, avgQs: spendWeightedQs };
  }, [filteredKeywords]);

  function toggleSort(key: keyof KeywordEntry) {
    if (sortKey === key) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-4 gap-4">
          <Skeleton className="h-24 rounded-lg" />
          <Skeleton className="h-24 rounded-lg" />
          <Skeleton className="h-24 rounded-lg" />
          <Skeleton className="h-24 rounded-lg" />
        </div>
        <Skeleton className="h-[600px] rounded-lg" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-5 max-w-[1600px]">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="t-page-title text-foreground">Keyword Intelligence</h1>
          <p className="text-xs text-muted-foreground uppercase tracking-widest font-bold mt-1">Search Performance Audit & QS Engine</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search keywords..."
              className="pl-10 pr-4 py-2 text-sm rounded-xl bg-card border border-border/60 text-foreground w-72 focus:ring-2 focus:ring-primary/20 transition-all shadow-sm"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <Select value={selectedCampaign} onValueChange={setSelectedCampaign}>
            <SelectTrigger className="w-[240px] h-10 text-sm bg-card border-border/60 rounded-xl shadow-sm">
              <SelectValue placeholder="All Campaigns" />
            </SelectTrigger>
            <SelectContent className="rounded-xl border-border/60 shadow-2xl">
              <SelectItem value="all" className="font-semibold">All Campaigns View</SelectItem>
              {campaigns.map(c => (
                <SelectItem key={c} value={c}>{truncate(c, 40)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="bg-card shadow-lg border-border/40 hover:shadow-xl transition-shadow duration-200">
          <CardContent className="p-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <BarChart3 className="w-4 h-4 text-primary" />
              </div>
              <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Total Spend</span>
            </div>
            <p className="text-3xl font-black tracking-tight text-foreground tabular-nums leading-none">{formatINR(stats.totalSpend, 0)}</p>
          </CardContent>
        </Card>
        <Card className="bg-card shadow-lg border-border/40 hover:shadow-xl transition-shadow duration-200">
          <CardContent className="p-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="p-2 rounded-lg bg-emerald-500/10">
                <Target className="w-4 h-4 text-emerald-500" />
              </div>
              <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Conversions</span>
            </div>
            <p className="text-3xl font-black tracking-tight text-foreground tabular-nums leading-none">{Math.round(stats.totalConversions)}</p>
          </CardContent>
        </Card>
        <Card className="bg-card shadow-lg border-border/40 hover:shadow-xl transition-shadow duration-200">
          <CardContent className="p-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <TrendingUp className="w-4 h-4 text-primary" />
              </div>
              <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Avg CPL</span>
            </div>
            <p className="text-3xl font-black tracking-tight text-foreground tabular-nums leading-none">{formatINR(stats.avgCpl, 0)}</p>
          </CardContent>
        </Card>
        <Card className="bg-card shadow-lg border-border/40 hover:shadow-xl transition-shadow duration-200">
          <CardContent className="p-5">
            <div className="flex items-center gap-2 mb-3">
              <div className={cn("p-2 rounded-lg", stats.avgQs >= 7 ? "bg-emerald-500/10" : stats.avgQs >= 5 ? "bg-amber-500/10" : "bg-red-500/10")}>
                <MousePointerClick className={cn("w-4 h-4", stats.avgQs >= 7 ? "text-emerald-500" : stats.avgQs >= 5 ? "text-amber-500" : "text-red-500")} />
              </div>
              <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Quality Score</span>
            </div>
            <p className={cn("text-3xl font-black tracking-tight tabular-nums leading-none",
              stats.avgQs >= 7 ? "text-emerald-600" : stats.avgQs >= 5 ? "text-amber-600" : "text-red-600"
            )}>
              {stats.avgQs.toFixed(1)}
              <span className="text-lg font-medium text-muted-foreground ml-1">/ 10</span>
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="border-border/40 shadow-sm overflow-hidden bg-card/30">
        <div className="overflow-x-auto">
          <table className="t-table w-full">
            <thead>
              <tr className="bg-muted/30 border-b border-border/60">
                {[
                  { key: "keyword", label: "Keyword / Ad Group", align: "left" },
                  { key: "classification", label: "Class", align: "center" },
                  { key: "spend", label: "Spend", align: "right" },
                  { key: "impressions", label: "Impr", align: "right" },
                  { key: "clicks", label: "Clicks", align: "right" },
                  { key: "ctr", label: "CTR", align: "right" },
                  { key: "conversions", label: "Conv", align: "right" },
                  { key: "cvr", label: "CVR", align: "right" },
                  { key: "cpl", label: "CPL", align: "right" },
                  { key: "cpc", label: "CPC", align: "right" },
                  { key: "quality_score", label: "QS", align: "center" },
                  { key: "top_is", label: "Top IS %", align: "right" },
                  { key: "action", label: "Action", align: "center" },
                ].map(col => (
                  <th
                    key={col.key}
                    className={cn(
                      "p-4 text-sm font-black uppercase tracking-widest text-muted-foreground cursor-pointer select-none transition-colors hover:text-foreground border-r border-border/10 last:border-0 bg-muted/40",
                      col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : "text-left"
                    )}
                    onClick={() => toggleSort(col.key as any)}
                  >
                    <div className={cn("flex items-center gap-1.5", col.align === "right" && "justify-end", col.align === "center" && "justify-center")}>
                      {col.label}
                      {sortKey === col.key && (sortDir === "asc" ? <ChevronUp className="w-4 h-4 text-primary" /> : <ChevronDown className="w-4 h-4 text-primary" />)}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {paginatedKeywords.map((kw, idx) => {
                const targetCpl = (data as any)?.benchmarks?.cpl || 1000;
                
                // Engine SOP Rules
                let action = "HOLD";
                let actionCls = "bg-muted text-muted-foreground";
                
                if (kw.conversions === 0 && kw.clicks >= 40 && kw.spend > (1.5 * targetCpl)) {
                  action = "PAUSE";
                  actionCls = "bg-red-500/10 text-red-500 border-red-500/20";
                } else if (kw.conversions > 0 && kw.cpl <= (1.3 * targetCpl)) {
                  action = "SCALE";
                  actionCls = "bg-emerald-500/10 text-emerald-500 border-emerald-500/20";
                }

                let classification = kw.classification || "WATCH";
                let classCls = "bg-amber-500/10 text-amber-500 border-amber-500/20";
                if (classification.toUpperCase() === "WINNER") {
                  classCls = "bg-emerald-500/10 text-emerald-500 border-emerald-500/20";
                } else if (classification.toUpperCase() === "UNDERPERFORMER") {
                  classCls = "bg-red-500/10 text-red-500 border-red-500/20";
                } else if (classification.toUpperCase() === "NEW") {
                  classCls = "bg-blue-500/10 text-blue-500 border-blue-500/20";
                }

                return (
                  <tr key={idx} className="border-b border-border/30 hover:bg-muted/20 transition-all">
                    <td className="p-4 max-w-[300px]">
                      <div className="font-bold text-foreground text-base flex items-center gap-2 truncate leading-tight">
                        {kw.keyword}
                        {kw.status !== "active" && <span className="text-[10px] uppercase bg-muted px-1 py-0.5 rounded text-muted-foreground font-bold tracking-wider">{kw.status}</span>}
                      </div>
                      <div className="text-[12px] text-slate-500 font-semibold truncate uppercase mt-1 tracking-wide opacity-80">
                        {kw.match_type} • {truncate(kw.ad_group, 30)}
                      </div>
                    </td>
                    <td className="p-4 text-center">
                      <Badge variant="outline" className={cn("text-xs px-2 py-1 rounded font-bold uppercase w-[100px] justify-center tracking-widest", classCls)}>
                        {classification}
                      </Badge>
                    </td>
                    <td className="p-4 text-right tabular-nums font-bold text-foreground text-base">{formatINR(kw.spend, 0)}</td>
                    <td className="p-4 text-right tabular-nums text-slate-500 font-semibold text-sm">{kw.impressions.toLocaleString()}</td>
                    <td className="p-4 text-right tabular-nums text-slate-500 font-semibold text-sm">{kw.clicks.toLocaleString()}</td>
                    <td className="p-4 text-right tabular-nums text-slate-500 font-semibold text-sm">{kw.ctr.toFixed(1)}%</td>
                    <td className="p-4 text-right tabular-nums font-bold text-foreground text-base">{Math.round(kw.conversions)}</td>
                    <td className="p-4 text-right tabular-nums text-slate-500 font-semibold text-sm">{kw.cvr.toFixed(1)}%</td>
                    <td className="p-4 text-right tabular-nums font-bold text-foreground text-base">{kw.cpl > 0 ? formatINR(kw.cpl, 0) : "—"}</td>
                    <td className="p-4 text-right tabular-nums font-semibold text-slate-500 text-sm">{kw.cpc > 0 ? formatINR(kw.cpc, 0) : "—"}</td>
                    <td className="p-3">
                      <div className="flex flex-col items-center gap-1.5">
                        <div className="w-14 h-1.5 rounded-full bg-muted/50 overflow-hidden shadow-inner">
                          <div
                            className={cn("h-full transition-all duration-500",
                              kw.quality_score >= 7 ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]" : kw.quality_score >= 5 ? "bg-amber-500" : "bg-red-500"
                            )}
                            style={{ width: `${(kw.quality_score / 10) * 100}%` }}
                          />
                        </div>
                        <span className={cn("font-bold tabular-nums text-[11px] tracking-tight",
                          kw.quality_score >= 7 ? "text-emerald-600" : kw.quality_score >= 5 ? "text-amber-600" : "text-red-600"
                        )}>{kw.quality_score}/10</span>
                      </div>
                    </td>
                    <td className="p-4 text-right tabular-nums text-foreground/80 font-bold text-sm">{((kw as any).top_is || 0).toFixed(1)}%</td>
                    <td className="p-4 text-center">
                      <Badge variant="outline" className={cn("text-xs px-2 py-1 rounded font-bold uppercase w-[100px] justify-center tracking-widest", actionCls)}>
                        {action}
                      </Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <DataTablePagination
          totalItems={filteredKeywords.length}
          pageSize={pageSize}
          currentPage={page}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
        />
      </Card>
    </div>
  );
}
