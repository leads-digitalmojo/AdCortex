import { useState, useMemo, useCallback, useEffect } from "react";
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ArrowUpDown,
  ChevronDown,
  ChevronUp,
  Search,
  AlertTriangle,
  MinusCircle,
  PlusCircle,
  BarChart3,
  Ban,
  Loader2,
  CheckCircle,
  TrendingUp,
  List,
  XCircle,
  ShieldBan,
  ShieldAlert,
  Eye,
} from "lucide-react";
import { formatINR, formatPct, truncate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

// ─── Types ───────────────────────────────────────────────────────────

interface SearchTermEntry {
  search_term: string;
  term?: string;
  campaign?: string;
  campaign_id?: string;
  ad_group?: string;
  ad_group_name?: string;
  ad_group_id?: string;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  cpl?: number;
  ctr?: number;
  cvr?: number;
  match_type?: string;
  status?: string;
  recommendation?: string;
  reason?: string;
  classification?: string;
  is_relevant_competitor?: boolean;
  competitor_name?: string;
}

interface NgramEntry {
  ngram: string;
  n?: number;
  count?: number;
  frequency?: number;
  cost?: number;
  conversions?: number;
  impressions?: number;
  clicks?: number;
  cvr?: number;
  avg_cvr?: number;
  recommendation?: string;
}

interface SearchTermsData {
  terms_reviewed: number;
  total_search_terms?: number;
  all_terms?: SearchTermEntry[];
  negative_candidates: SearchTermEntry[];
  competitor_terms: SearchTermEntry[];
  high_value_terms: SearchTermEntry[];
  ngram_patterns?: NgramEntry[];
  ngram_analysis?: {
    one_grams?: NgramEntry[];
    two_grams?: NgramEntry[];
    three_grams?: NgramEntry[];
  };
  junk_spend?: number;
  junk_pct?: number;
}

interface NegativeKeyword {
  criterionId: string;
  keyword: string;
  matchType: string;
  campaignId: string;
  campaignName: string;
}

type TabId = "all" | "high_value" | "junk" | "competitors" | "ngrams" | "existing_negatives";

// ─── Component ───────────────────────────────────────────────────────

export default function GoogleSearchTermsPage() {
  const { analysisData: data, isLoadingAnalysis: isLoading, apiBase } = useClient();
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useState<TabId>("all");
  const [searchFilter, setSearchFilter] = useState("");
  const [selectedCampaign, setSelectedCampaign] = useState<string>("all");
  const [sortKey, setSortKey] = useState<string>("cost");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [ngramType, setNgramType] = useState<"1" | "2" | "3">("2");
  const [executedTerms, setExecutedTerms] = useState<Set<string>>(new Set());

  // ─── Memoized Data ─────────────────────────────────────────────
  
  const stData: SearchTermsData | null = useMemo(() => {
    if (!data) return null;
    return (data as any).search_terms_analysis || null;
  }, [data]);

  const campaigns = useMemo(() => {
    if (!stData) return [];
    const allTerms = [
      ...(Array.isArray(stData.all_terms) ? stData.all_terms : []),
      ...(Array.isArray(stData.negative_candidates) ? stData.negative_candidates : []),
      ...(Array.isArray(stData.competitor_terms) ? stData.competitor_terms : []),
      ...(Array.isArray(stData.high_value_terms) ? stData.high_value_terms : []),
    ];
    const campSet = new Map<string, string>();
    allTerms.forEach((t) => {
      if (t.campaign) campSet.set(t.campaign, t.campaign_id || "");
    });
    return Array.from(campSet.entries()).map(([name, id]) => ({ name, id }));
  }, [stData]);

  const getTermText = useCallback((t: SearchTermEntry): string => {
    return t.search_term || t.term || "";
  }, []);

  const getTermKey = useCallback((t: SearchTermEntry): string => {
    return `${getTermText(t)}__${t.campaign_id || t.campaign}`;
  }, [getTermText]);

  const filteredTerms = useMemo(() => {
    if (!stData) return [];
    let list: SearchTermEntry[] = [];
    switch (activeTab) {
      case "all":
        list = Array.isArray(stData.all_terms) ? stData.all_terms : [
          ...(Array.isArray(stData.negative_candidates) ? stData.negative_candidates : []),
          ...(Array.isArray(stData.competitor_terms) ? stData.competitor_terms : []),
          ...(Array.isArray(stData.high_value_terms) ? stData.high_value_terms : []),
        ];
        break;
      case "high_value":
        list = stData.high_value_terms || [];
        break;
      case "junk":
        list = stData.negative_candidates || [];
        break;
      case "competitors":
        list = stData.competitor_terms || [];
        break;
      default:
        return [];
    }

    // Filter by Campaign
    if (selectedCampaign !== "all") {
      list = list.filter((t) => t.campaign === selectedCampaign);
    }

    // Filter by Search
    if (searchFilter) {
      const q = searchFilter.toLowerCase();
      list = list.filter(
        (t) =>
          getTermText(t).toLowerCase().includes(q) ||
          (t.campaign || "").toLowerCase().includes(q) ||
          (t.ad_group || "").toLowerCase().includes(q)
      );
    }

    // Sort
    return [...list].sort((a, b) => {
      const aVal = sortKey === "search_term" ? getTermText(a) : (a as any)[sortKey];
      const bVal = sortKey === "search_term" ? getTermText(b) : (b as any)[sortKey];
      if (typeof aVal === "number" && typeof bVal === "number") {
        return sortDir === "asc" ? aVal - bVal : bVal - aVal;
      }
      return sortDir === "asc"
        ? String(aVal || "").localeCompare(String(bVal || ""))
        : String(bVal || "").localeCompare(String(aVal || ""));
    });
  }, [stData, activeTab, selectedCampaign, searchFilter, sortKey, sortDir, getTermText]);

  const activeNgrams = useMemo(() => {
    if (!stData || activeTab !== "ngrams") return [];
    const nga = stData.ngram_analysis;
    let list: NgramEntry[] = [];
    if (nga) {
      switch (ngramType) {
        case "1": list = nga.one_grams || []; break;
        case "2": list = nga.two_grams || []; break;
        case "3": list = nga.three_grams || []; break;
      }
    } else {
      list = (stData.ngram_patterns || []).filter(
        (n) => !n.n || String(n.n) === ngramType
      );
    }

    if (searchFilter) {
      const q = searchFilter.toLowerCase();
      list = list.filter((n) => n.ngram.toLowerCase().includes(q));
    }

    return [...list].sort((a, b) => {
      if (sortKey === "ngram") {
        return sortDir === "asc" ? a.ngram.localeCompare(b.ngram) : b.ngram.localeCompare(a.ngram);
      }
      const aVal = (a as any)[sortKey] || 0;
      const bVal = (b as any)[sortKey] || 0;
      return sortDir === "asc" ? aVal - bVal : bVal - aVal;
    });
  }, [stData, activeTab, ngramType, searchFilter, sortKey, sortDir]);

  // ─── Block Dialog State ─────────────────────────────────────────
  const [blockDialogOpen, setBlockDialogOpen] = useState(false);
  const [blockTerm, setBlockTerm] = useState<SearchTermEntry | null>(null);
  const [blockMatchType, setBlockMatchType] = useState<"EXACT" | "PHRASE" | "BROAD">("PHRASE");
  const [blockCampaignId, setBlockCampaignId] = useState<string>("");
  const [blockSubmitting, setBlockSubmitting] = useState(false);

  // ─── Bulk Select State ──────────────────────────────────────────
  const [selectedTermKeys, setSelectedTermKeys] = useState<Set<string>>(new Set());
  const [bulkDialogOpen, setBulkDialogOpen] = useState(false);
  const [bulkMatchType, setBulkMatchType] = useState<"EXACT" | "PHRASE" | "BROAD">("PHRASE");
  const [bulkCampaignId, setBulkCampaignId] = useState<string>("");
  const [bulkSubmitting, setBulkSubmitting] = useState(false);

  // ─── Existing Negatives State ───────────────────────────────────
  const [existingNegatives, setExistingNegatives] = useState<NegativeKeyword[]>([]);
  const [negativesLoading, setNegativesLoading] = useState(false);
  const [negativesCampaignId, setNegativesCampaignId] = useState<string>("");

  const getActiveTerms = useCallback(() => {
    return filteredTerms;
  }, [filteredTerms]);

  function getNgrams(): NgramEntry[] {
    if (!stData) return [];
    const nga = stData.ngram_analysis;
    let list: NgramEntry[] = [];
    if (nga) {
      switch (ngramType) {
        case "1": list = nga.one_grams || []; break;
        case "2": list = nga.two_grams || []; break;
        case "3": list = nga.three_grams || []; break;
      }
    } else {
      list = (stData.ngram_patterns || []).filter(
        (n) => !n.n || String(n.n) === ngramType
      );
    }
    if (searchFilter) {
      list = list.filter((n) => n.ngram.toLowerCase().includes(searchFilter.toLowerCase()));
    }
    return [...list].sort((a, b) => {
      if (sortKey === "ngram") {
        return sortDir === "asc" ? a.ngram.localeCompare(b.ngram) : b.ngram.localeCompare(a.ngram);
      }
      const aVal = (a as any)[sortKey] || 0;
      const bVal = (b as any)[sortKey] || 0;
      return sortDir === "asc" ? aVal - bVal : bVal - aVal;
    });
  }

  function toggleSort(key: string) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  function SortIcon({ col }: { col: string }) {
    if (sortKey !== col) return <ArrowUpDown className="w-3 h-3 opacity-30" />;
    return sortDir === "asc" ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />;
  }

  // ─── Block Single Term (opens dialog) ───────────────────────────
  const openBlockDialog = useCallback((term: SearchTermEntry) => {
    setBlockTerm(term);
    setBlockMatchType("PHRASE");
    setBlockCampaignId(term.campaign_id || campaigns.find(c => c.name === term.campaign)?.id || "");
    setBlockDialogOpen(true);
  }, [campaigns]);

  const handleBlockConfirm = useCallback(async () => {
    if (!blockTerm || !blockCampaignId) return;
    setBlockSubmitting(true);
    try {
      const resp = await apiRequest("POST", `${apiBase}/google/add-negative-keyword`, {
        campaignId: blockCampaignId,
        keyword: getTermText(blockTerm),
        matchType: blockMatchType,
      });
      const result = await resp.json();
      if (result.success) {
        const termKey = getTermKey(blockTerm);
        setExecutedTerms((prev) => new Set(prev).add(termKey));
        toast({
          title: "Negative keyword added",
          description: `"${getTermText(blockTerm)}" (${blockMatchType}) added successfully`,
        });
      } else {
        toast({
          title: "Failed to add negative",
          description: result.error || result.message || "Unknown error",
          variant: "destructive",
        });
      }
    } catch (err: any) {
      toast({
        title: "Error",
        description: err.message || "Failed to add negative keyword",
        variant: "destructive",
      });
    } finally {
      setBlockSubmitting(false);
      setBlockDialogOpen(false);
      setBlockTerm(null);
    }
  }, [blockTerm, blockCampaignId, blockMatchType, apiBase, toast]);

  // ─── Legacy quick-add (fallback for junk tab) ──────────────────
  const handleAddNegative = useCallback(async (term: SearchTermEntry) => {
    openBlockDialog(term);
  }, [openBlockDialog]);

  // ─── Bulk Selection Helpers ─────────────────────────────────────
  const toggleTermSelection = useCallback((term: SearchTermEntry) => {
    const key = getTermKey(term);
    setSelectedTermKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const isTermSelected = useCallback((term: SearchTermEntry) => {
    return selectedTermKeys.has(getTermKey(term));
  }, [selectedTermKeys]);

  const selectAllVisible = useCallback(() => {
    const terms = getActiveTerms();
    setSelectedTermKeys((prev) => {
      const next = new Set(prev);
      terms.forEach(t => next.add(getTermKey(t)));
      return next;
    });
  }, [getActiveTerms]);

  const deselectAll = useCallback(() => {
    setSelectedTermKeys(new Set());
  }, []);

  // ─── Bulk Add Dialog ────────────────────────────────────────────
  const openBulkDialog = useCallback(() => {
    if (selectedTermKeys.size === 0) return;
    setBulkMatchType("PHRASE");
    // Default to first campaign in selection
    const firstKey = Array.from(selectedTermKeys)[0];
    const allTermsList = stData ? [
      ...(Array.isArray(stData.all_terms) ? stData.all_terms : []),
      ...(Array.isArray(stData.negative_candidates) ? stData.negative_candidates : []),
      ...(Array.isArray(stData.competitor_terms) ? stData.competitor_terms : []),
      ...(Array.isArray(stData.high_value_terms) ? stData.high_value_terms : []),
    ] : [];
    const firstTerm = allTermsList.find(t => getTermKey(t) === firstKey);
    setBulkCampaignId(firstTerm?.campaign_id || campaigns[0]?.id || "");
    setBulkDialogOpen(true);
  }, [selectedTermKeys, stData, campaigns]);

  const handleBulkConfirm = useCallback(async () => {
    if (!bulkCampaignId || selectedTermKeys.size === 0) return;
    setBulkSubmitting(true);

    const allTermsList = stData ? [
      ...(stData.all_terms || []),
      ...(stData.negative_candidates || []),
      ...(stData.competitor_terms || []),
      ...(stData.high_value_terms || []),
    ] : [];

    const keywordsPayload = Array.from(selectedTermKeys).map(key => {
      const term = allTermsList.find(t => getTermKey(t) === key);
      return {
        keyword: term ? getTermText(term) : key.split("__")[0],
        matchType: bulkMatchType,
      };
    });

    try {
      const resp = await apiRequest("POST", `${apiBase}/google/negative-keywords/bulk`, {
        campaignId: bulkCampaignId,
        keywords: keywordsPayload,
      });
      const result = await resp.json();
      if (result.success) {
        setExecutedTerms((prev) => {
          const next = new Set(prev);
          selectedTermKeys.forEach(k => next.add(k));
          return next;
        });
        setSelectedTermKeys(new Set());
        toast({
          title: "Bulk negatives added",
          description: `${result.count || keywordsPayload.length} negative keywords added successfully`,
        });
      } else {
        toast({
          title: "Bulk add failed",
          description: result.error || "Unknown error",
          variant: "destructive",
        });
      }
    } catch (err: any) {
      toast({
        title: "Error",
        description: err.message || "Bulk add failed",
        variant: "destructive",
      });
    } finally {
      setBulkSubmitting(false);
      setBulkDialogOpen(false);
    }
  }, [bulkCampaignId, bulkMatchType, selectedTermKeys, stData, apiBase, toast]);

  // ─── Fetch Existing Negatives ───────────────────────────────────
  const fetchExistingNegatives = useCallback(async (campaignId: string) => {
    if (!campaignId) return;
    setNegativesLoading(true);
    try {
      const resp = await apiRequest("GET", `${apiBase}/google/negative-keywords?campaignId=${campaignId}`);
      const result = await resp.json();
      if (result.success) {
        setExistingNegatives(result.negatives || []);
      } else {
        setExistingNegatives([]);
        toast({
          title: "Failed to load negatives",
          description: result.error || "Unknown error",
          variant: "destructive",
        });
      }
    } catch (err: any) {
      setExistingNegatives([]);
    } finally {
      setNegativesLoading(false);
    }
  }, [apiBase, toast]);

  // When existing negatives tab is activated or campaign changes, fetch
  useEffect(() => {
    if (activeTab === "existing_negatives" && negativesCampaignId) {
      fetchExistingNegatives(negativesCampaignId);
    }
  }, [activeTab, negativesCampaignId, fetchExistingNegatives]);

  // Auto-set negativesCampaignId when tab opens
  useEffect(() => {
    if (activeTab === "existing_negatives" && !negativesCampaignId && campaigns.length > 0) {
      setNegativesCampaignId(campaigns[0].id);
    }
  }, [activeTab, negativesCampaignId, campaigns]);

  const tabs: { id: TabId; label: string; icon: typeof MinusCircle; count: number }[] = useMemo(() => {
    if (!stData) return [];
    const allCount = (stData.all_terms || []).length ||
      ((stData.negative_candidates || []).length + (stData.competitor_terms || []).length + (stData.high_value_terms || []).length);
    return [
      { id: "all" as TabId, label: "All Terms", icon: List, count: allCount },
      { id: "high_value" as TabId, label: "High-Value", icon: TrendingUp, count: (stData.high_value_terms || []).length },
      { id: "junk" as TabId, label: "Junk / Negative", icon: Ban, count: (stData.negative_candidates || []).length },
      { id: "competitors" as TabId, label: "Competitors", icon: AlertTriangle, count: (stData.competitor_terms || []).length },
      { id: "ngrams" as TabId, label: "N-Grams", icon: BarChart3, count: 0 },
      { id: "existing_negatives" as TabId, label: "Existing Negatives", icon: ShieldBan, count: 0 },
    ];
  }, [stData]);

  // Loading
  if (isLoading || !data) {
    return (
      <div className="p-8 space-y-8 min-h-screen bg-background" data-testid="search-terms-loading">
        <div className="space-y-2">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-4 w-96" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i} className="border-border/40 overflow-hidden">
              <CardContent className="p-6 space-y-4">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-10 w-32" />
              </CardContent>
            </Card>
          ))}
        </div>
        <Card className="border-border/40 rounded-3xl overflow-hidden">
          <CardContent className="p-0">
            <Skeleton className="h-[600px] w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  // Empty state
  if (!stData) {
    return (
      <div className="p-8 space-y-8 max-w-[1800px] min-h-screen bg-background" data-testid="search-terms-empty">
        <div className="space-y-2">
          <h1 className="text-4xl font-black tracking-tighter text-foreground flex items-center gap-3 italic">
            <Search className="w-10 h-10 text-primary not-italic" />
            SEARCH TERMS ANALYSIS
          </h1>
          <p className="text-sm text-muted-foreground uppercase tracking-[0.2em] font-bold">Identify waste, find negatives, and expand high-value terms</p>
        </div>
        <Card className="bg-card border-border/60 rounded-3xl overflow-hidden shadow-2xl">
          <CardContent className="flex flex-col items-center justify-center py-32 text-center">
            <div className="p-6 bg-muted rounded-full mb-8">
              <AlertTriangle className="w-12 h-12 text-muted-foreground" />
            </div>
            <p className="text-2xl font-black text-foreground uppercase tracking-widest">Data Synchronization Pending</p>
            <p className="text-sm text-muted-foreground mt-4 max-w-md leading-relaxed">
              Search terms data requires search_term_view API access.
              This will become available after the next automated analysis run with search terms data collection enabled.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const termsReviewed = stData.terms_reviewed || stData.total_search_terms || 0;
  const negativesCount = (stData.negative_candidates || []).length;
  const competitorsCount = (stData.competitor_terms || []).length;
  const highValueCount = (stData.high_value_terms || []).length;

  const isTermTableTab = activeTab !== "ngrams" && activeTab !== "existing_negatives";
  const hasSelection = selectedTermKeys.size > 0;

  return (
    <div className="p-6 space-y-4 max-w-[1800px]" data-testid="search-terms-page">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="t-page-title text-foreground">Search Terms Intelligence</h1>
          <p className="text-xs text-muted-foreground uppercase tracking-[0.15em] font-medium mt-1">
            Analyzing <span className="font-black text-foreground tabular-nums">{termsReviewed}</span> terms reviewed across search campaigns
          </p>
        </div>

        <div className="flex items-center gap-3">
          {stData.junk_spend != null && (
            <Badge variant="outline" className="bg-red-500/10 text-red-500 border-red-500/30 font-bold px-3 py-1 text-xs uppercase tracking-wider rounded-lg">
              Junk spend: {formatINR(stData.junk_spend, 0)} ({stData.junk_pct?.toFixed(1)}%)
            </Badge>
          )}
          {hasSelection && isTermTableTab && (
            <div className="flex items-center gap-2 p-1 bg-primary/5 border border-primary/20 rounded-xl animate-in zoom-in-95 duration-300">
              <span className="text-xs font-bold text-primary px-3 uppercase tracking-wider">{selectedTermKeys.size} Selected</span>
              <button
                className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider px-4 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700 shadow-sm transition-all active:scale-95"
                onClick={openBulkDialog}
                data-testid="btn-bulk-add-negatives"
              >
                <Ban className="w-3.5 h-3.5" />
                Bulk Block
              </button>
              <button
                className="text-xs font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors px-3 py-1.5 hover:bg-muted rounded-md"
                onClick={deselectAll}
              >
                Clear
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4" data-testid="search-terms-summary">
        {[
          { label: "Terms Reviewed", value: termsReviewed.toLocaleString(), icon: List, color: "text-primary", bg: "bg-primary/10" },
          { label: "Negatives Found", value: negativesCount, icon: Ban, color: negativesCount > 0 ? "text-red-500" : "text-emerald-500", bg: negativesCount > 0 ? "bg-red-500/10" : "bg-emerald-500/10" },
          { label: "Competitor Terms", value: competitorsCount, icon: AlertTriangle, color: "text-amber-500", bg: "bg-amber-500/10" },
          { label: "High-Value Terms", value: highValueCount, icon: TrendingUp, color: "text-emerald-500", bg: "bg-emerald-500/10" },
        ].map((kpi, i) => (
          <Card key={i} className="bg-card shadow-lg border-border/40 hover:shadow-xl transition-shadow duration-200">
            <CardContent className="p-5">
              <div className="flex items-center gap-2 mb-3">
                <div className={cn("p-2 rounded-lg", kpi.bg)}>
                  <kpi.icon className={cn("w-4 h-4", kpi.color)} />
                </div>
                <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground leading-tight">{kpi.label}</span>
              </div>
              <p className="text-3xl font-bold tracking-tight text-foreground tabular-nums leading-none">
                {kpi.value}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Junk Spend Alert */}
      {stData.junk_pct != null && stData.junk_pct > 10 && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-5 py-4 flex items-center gap-4 shadow-sm animate-in fade-in duration-500">
          <AlertTriangle className="w-5 h-5 text-red-500 shrink-0" />
          <div className="flex-1">
            <p className="text-[11px] font-bold text-red-600 uppercase tracking-widest">CRITICAL WASTE WARNING</p>
            <p className="text-xs text-red-900/70 font-medium leading-relaxed">
              Junk spend is at <span className="font-bold text-red-600">{stData.junk_pct.toFixed(1)}%</span> of total spend. 
              Estimated budget waste: <span className="font-bold text-red-600">{formatINR(stData.junk_spend || 0, 0)}</span>
            </p>
          </div>
          <button 
            className="text-[10px] font-bold uppercase tracking-widest px-3 py-1.5 bg-red-600/10 text-red-600 border border-red-600/20 rounded-lg hover:bg-red-600 hover:text-white transition-all shadow-sm"
            onClick={() => setActiveTab("junk")}
          >
            Review Junk Terms
          </button>
        </div>
      )}

      {/* Campaign Filter + Search */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search keywords..."
            className="pl-10 pr-4 h-10 text-sm rounded-full bg-white border border-slate-200 text-slate-800 w-[300px] focus:outline-none focus:border-slate-300 focus:ring-2 focus:ring-slate-100 transition-all placeholder:text-slate-400"
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
          />
        </div>

        <Select value={selectedCampaign} onValueChange={setSelectedCampaign}>
          <SelectTrigger className="w-[280px] h-10 text-sm bg-white border-slate-200 rounded-full font-medium text-slate-800 focus:ring-2 focus:ring-slate-100 focus:ring-offset-0">
            <SelectValue placeholder="All Campaigns View" />
          </SelectTrigger>
          <SelectContent className="rounded-xl border-slate-200 shadow-lg">
            <SelectItem value="all" className="font-medium text-sm py-2">All Campaigns View</SelectItem>
            {campaigns.map((c) => (
              <SelectItem key={c.id} value={c.name} className="text-sm py-2">{truncate(c.name, 40)}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {isTermTableTab && (
          <button
            className="h-10 px-4 text-sm font-medium text-slate-600 hover:text-slate-900 transition-all bg-white border border-slate-200 rounded-full flex items-center gap-2 hover:bg-slate-50"
            onClick={selectAllVisible}
          >
            <CheckCircle className="w-4 h-4" />
            Select Visible
          </button>
        )}
      </div>


      {/* Tab Navigation */}
      <div className="flex items-center gap-2 bg-slate-50/80 p-2.5 rounded-2xl border border-slate-100 overflow-x-auto w-full">
        {tabs.map((tab) => {
          const words = tab.label.split(" ");
          return (
            <button
              key={tab.id}
              className={cn(
                "px-7 py-3.5 text-xs font-bold uppercase tracking-[0.1em] rounded-xl transition-all flex items-center gap-4 shrink-0",
                activeTab === tab.id
                  ? "bg-[#FFB800] text-black shadow-sm"
                  : "text-slate-500 hover:text-slate-800 hover:bg-slate-200/50"
              )}
              onClick={() => { 
                setActiveTab(tab.id as TabId); 
                setSortKey(tab.id === "ngrams" ? "count" : "cost"); 
                setSortDir("desc"); 
              }}
              data-testid={`tab-${tab.id}`}
            >
              <tab.icon className="w-4 h-4 shrink-0" />
              <div className="flex flex-col items-start leading-[1.1] text-left">
                <span>{words[0]}</span>
                {words.length > 1 && <span>{words.slice(1).join(" ")}</span>}
              </div>
              {tab.count > 0 && (
                <span className={cn(
                  "px-2.5 py-1 rounded-md text-[11px] font-semibold tabular-nums ml-1",
                  activeTab === tab.id ? "bg-white/40 text-black" : "bg-slate-200 text-slate-600"
                )}>
                  {tab.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Term Tables */}
      {isTermTableTab && (
        <Card className="bg-card shadow-sm border-border/40">
          <CardContent className="p-0">
            <div className="overflow-x-auto custom-scrollbar">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-muted/30 border-b border-border/60">
                    <th className="px-6 py-4 w-10">
                      <span className="sr-only">Select</span>
                    </th>
                    {[
                      { key: "search_term", label: "Search Query", align: "left" },
                      { key: "campaign", label: "Source Context", align: "left" },
                      { key: "match_type", label: "Match", align: "left" },
                      { key: "intent", label: "Intent", align: "left" },
                      { key: "impressions", label: "Impr", align: "right" },
                      { key: "clicks", label: "Clicks", align: "right" },
                      { key: "cost", label: "Cost", align: "right" },
                      { key: "conversions", label: "Leads", align: "right" },
                      { key: "cpl", label: "CPL", align: "right" },
                      { key: "recommendation", label: "Recommendation", align: "right" },
                    ].map((col) => (
                      <th
                        key={col.key}
                        className={cn(
                          "p-6 text-[11px] font-bold uppercase tracking-[0.2em] text-muted-foreground cursor-pointer select-none transition-colors hover:text-foreground group whitespace-nowrap",
                          col.align === "right" ? "text-right" : "text-left"
                        )}
                        onClick={() => toggleSort(col.key)}
                      >
                        <span className="inline-flex items-center gap-2">
                          {col.label}
                          <SortIcon col={col.key} />
                        </span>
                      </th>
                    ))}
                    <th className="p-6 text-[11px] font-bold uppercase tracking-[0.2em] text-muted-foreground text-left">Strategic Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {filteredTerms.map((term, idx) => {
                    const termText = getTermText(term);
                    const termKey = getTermKey(term);
                    const isExecuted = executedTerms.has(termKey);
                    const isSelected = isTermSelected(term);
                    const isNegativeCandidate =
                      activeTab === "junk" ||
                      term.classification === "junk" ||
                      term.classification === "negative" ||
                      (term.recommendation || "").toLowerCase().includes("negative");

                    return (
                      <tr
                        key={`${termText}-${idx}`}
                        className={cn(
                          "group hover:bg-muted/40 transition-all duration-300 border-l-4 border-transparent",
                          isSelected && "bg-primary/5 border-l-primary shadow-inner",
                          isExecuted && "opacity-50 grayscale bg-muted/10 pointer-events-none"
                        )}
                        data-testid={`row-term-${idx}`}
                      >
                        <td className="p-6 w-16 text-center">
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => toggleTermSelection(term)}
                            className="border-border/60 rounded-lg w-6 h-6 transition-all data-[state=checked]:bg-primary data-[state=checked]:border-primary hover:border-primary/60"
                            data-testid={`checkbox-term-${idx}`}
                          />
                        </td>
                        <td className="p-6 max-w-[320px]">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="text-base font-bold text-foreground truncate block cursor-help tracking-tight">
                                {truncate(termText, 48)}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="right" className="bg-card border-border shadow-[0_32px_64px_-12px_rgba(0,0,0,0.5)] p-5 rounded-2xl max-w-md border-2 border-primary/20">
                              <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                  <Badge className="bg-primary/10 text-primary border-primary/20 text-[10px] font-black uppercase tracking-widest px-2 py-0.5">FULL QUERY</Badge>
                                  {isNegativeCandidate && <Badge className="bg-red-500/10 text-red-500 border-red-500/20 text-[10px] font-black uppercase tracking-widest px-2 py-0.5">JUNK SIGNAL</Badge>}
                                </div>
                                <p className="text-base font-bold text-foreground leading-relaxed italic">"{termText}"</p>
                                {term.reason && <p className="text-xs text-muted-foreground bg-muted/40 p-3 rounded-xl border border-border/40 font-medium">Reason: {term.reason}</p>}
                              </div>
                            </TooltipContent>
                          </Tooltip>
                          {term.reason && (
                            <span className="text-[11px] text-muted-foreground/80 block truncate mt-2 font-semibold uppercase tracking-wider">
                               • {truncate(term.reason, 60)}
                            </span>
                          )}
                        </td>
                        <td className="p-6 max-w-[220px]">
                          <span className="text-sm font-bold text-foreground truncate block">{truncate(term.campaign || "—", 32)}</span>
                          <span className="text-[11px] text-muted-foreground/70 truncate block mt-1 font-semibold italic" title={term.ad_group || term.ad_group_name || "—"}>
                            {truncate(term.ad_group || term.ad_group_name || "—", 32)}
                          </span>
                        </td>
                        <td className="p-6">
                          <Badge variant="secondary" className="text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-600 px-3 py-1 rounded-md border-none shadow-none">
                            {term.match_type || "—"}
                          </Badge>
                        </td>
                        <td className="p-6">
                          {(() => {
                            const t = termText.toLowerCase();
                            let intent = "LOW";
                            let cls = "bg-slate-500/10 text-slate-500 border-slate-500/20 shadow-slate-500/5";
                            
                            if (t.includes("rent") || t.includes("pg") || t.includes("job") || t.includes("resale") || t.includes("free") || t.includes("cheap")) {
                              intent = "JUNK";
                              cls = "bg-red-500/10 text-red-500 border-red-500/20 shadow-red-500/10";
                            } else if (t.includes("sale") || t.includes("price") || t.includes("bhk") || t.includes("buy") || t.includes("cost") || t.includes("visit") || t.includes("near me")) {
                              intent = "HIGH";
                              cls = "bg-emerald-500/10 text-emerald-400 border-emerald-500/20 shadow-emerald-500/10";
                            } else if (t.includes(" in ") || t.includes(" near ") || t.includes(" area") || t.includes(" city")) {
                              intent = "MEDIUM";
                              cls = "bg-blue-500/10 text-blue-400 border-blue-500/20 shadow-blue-500/10";
                            }
                            
                            return (
                              <Badge variant="outline" className={cn("text-[10px] font-bold px-3 py-1 border-none uppercase tracking-wider rounded-md shadow-none", cls)}>
                                {intent}
                              </Badge>
                            );
                          })()}
                        </td>
                        <td className="p-6 text-right tabular-nums text-foreground font-bold text-sm">{term.impressions.toLocaleString()}</td>
                        <td className="p-6 text-right tabular-nums text-foreground font-bold text-sm">{term.clicks.toLocaleString()}</td>
                        <td className="p-6 text-right tabular-nums text-foreground font-bold text-sm opacity-80">
                          {term.ctr != null ? `${term.ctr.toFixed(1)}%` : term.clicks && term.impressions ? `${((term.clicks / term.impressions) * 100).toFixed(1)}%` : "—"}
                        </td>
                        <td className="p-6 text-right tabular-nums text-foreground font-bold text-sm">{formatINR(term.cost, 0)}</td>
                        <td className="p-6 text-right tabular-nums">
                          <span className={cn("text-sm font-bold px-3 py-1 rounded-md", term.conversions > 0 ? "bg-emerald-500/10 text-emerald-500" : "text-muted-foreground/40")}>
                            {term.conversions}
                          </span>
                        </td>
                        <td className="p-6 text-right tabular-nums text-foreground font-bold text-sm">
                          {term.cpl != null && term.cpl > 0
                            ? formatINR(term.cpl, 0)
                            : term.conversions > 0
                              ? formatINR(term.cost / term.conversions, 0)
                              : "—"}
                        </td>
                        <td className="p-6">
                          {isExecuted ? (
                            <Badge variant="outline" className="text-[10px] font-black uppercase tracking-[0.25em] px-4 py-2 bg-emerald-500/10 text-emerald-500 border-emerald-500/20 shadow-xl shadow-emerald-500/5 rounded-xl">
                              <CheckCircle className="w-3.5 h-3.5 mr-2" />
                              Executed
                            </Badge>
                          ) : (
                            <div className="flex items-center gap-3">
                              <button
                                className="inline-flex items-center gap-2 text-[10px] font-black uppercase tracking-widest px-5 py-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-500 hover:bg-red-500 hover:text-white transition-all active:scale-95 shadow-xl shadow-red-500/5 group-hover:shadow-red-500/20 duration-300"
                                onClick={() => openBlockDialog(term)}
                                data-testid={`btn-block-${idx}`}
                              >
                                <XCircle className="w-4 h-4" />
                                Block
                              </button>
                              
                              {term.conversions > 0 && (
                                <button
                                  className="inline-flex items-center gap-2 text-[10px] font-black uppercase tracking-widest px-5 py-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 hover:bg-emerald-500 hover:text-white transition-all active:scale-95 shadow-xl shadow-emerald-500/5 group-hover:shadow-emerald-500/20 duration-300"
                                  onClick={() => {
                                    navigator.clipboard.writeText(getTermText(term));
                                    toast({ 
                                        title: "SUCCESS", 
                                        description: `"${getTermText(term)}" COPIED TO CLIPBOARD`, 
                                        variant: "default",
                                    });
                                  }}
                                >
                                  <PlusCircle className="w-4 h-4" />
                                  Promote
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {filteredTerms.length === 0 && (
                    <tr>
                      <td colSpan={12} className="py-24 text-center">
                         <div className="flex flex-col items-center gap-4 animate-in fade-in duration-700">
                            <div className="p-4 bg-muted/30 rounded-full border border-border/40">
                                <Search className="w-8 h-8 text-muted-foreground opacity-30" />
                            </div>
                            <div className="space-y-1">
                                <p className="text-lg font-bold text-foreground uppercase tracking-wider">No Results Found</p>
                                <p className="text-xs text-muted-foreground font-medium">No search terms match your refined filters.</p>
                            </div>
                            <button className="text-[10px] font-bold uppercase tracking-widest px-6 py-2 bg-muted hover:bg-foreground hover:text-background transition-all rounded-lg" onClick={() => { setSearchFilter(""); setSelectedCampaign("all"); }}>Reset Filters</button>
                         </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
      {activeTab === "ngrams" && (
        <div className="space-y-4 animate-in fade-in duration-500">
          <div className="flex items-center gap-1 bg-muted/20 p-1.5 rounded-xl border border-border/40 w-fit">
            {(["1", "2", "3"] as const).map((n) => (
              <button
                key={n}
                className={cn(
                  "px-6 py-2 text-[10px] font-bold uppercase tracking-widest rounded-lg transition-all",
                  ngramType === n
                    ? "bg-primary text-primary-foreground shadow-md"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
                )}
                onClick={() => setNgramType(n)}
              >
                {n}-Word Semantic Patterns
              </button>
            ))}
          </div>

          <Card className="bg-card shadow-lg border-border/40">
            <CardContent className="p-0">
              <div className="overflow-x-auto custom-scrollbar">
                <table className="t-table w-full text-left">
                  <thead>
                    <tr className="bg-muted/30 border-b border-border/60">
                      {[
                        { key: "ngram", label: "Semantic Core", align: "left" },
                        { key: "count", label: "Volume", align: "right" },
                        { key: "impressions", label: "Visibility", align: "right" },
                        { key: "cost", label: "Spend", align: "right" },
                        { key: "conversions", label: "Leads", align: "right" },
                        { key: "cvr", label: "CVR", align: "right" },
                      ].map((col) => (
                        <th
                          key={col.key}
                          className={cn(
                            "px-6 py-4 text-xs font-bold uppercase tracking-widest text-muted-foreground cursor-pointer hover:text-foreground transition-colors group",
                            col.align === "right" ? "text-right" : "text-left"
                          )}
                          onClick={() => toggleSort(col.key)}
                        >
                          <span className="inline-flex items-center gap-2">
                            {col.label}
                            <SortIcon col={col.key} />
                          </span>
                        </th>
                      ))}
                      <th className="px-6 py-4 text-xs font-bold uppercase tracking-widest text-muted-foreground">Strategic Analysis</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40">
                    {activeNgrams.map((ng, idx) => (
                      <tr key={`${ng.ngram}-${idx}`} className="hover:bg-muted/10 transition-colors">
                        <td className="px-6 py-5 text-base font-semibold text-foreground tracking-tight">"{ng.ngram}"</td>
                        <td className="px-6 py-5 text-right tabular-nums font-medium text-muted-foreground text-sm">{ng.count ?? ng.frequency ?? "—"}</td>
                        <td className="px-6 py-5 text-right tabular-nums font-medium text-muted-foreground text-sm">{ng.impressions?.toLocaleString() ?? "—"}</td>
                        <td className="px-6 py-5 text-right tabular-nums font-bold text-foreground">{ng.cost != null ? formatINR(ng.cost, 0) : "—"}</td>
                        <td className="px-6 py-5 text-right tabular-nums">
                          <span className={cn("font-bold", (ng.conversions ?? 0) > 0 ? "text-emerald-500" : "text-muted-foreground/30")}>
                            {ng.conversions ?? "—"}
                          </span>
                        </td>
                        <td className="px-6 py-5 text-right tabular-nums font-medium text-muted-foreground">
                          {ng.cvr != null ? `${ng.cvr.toFixed(1)}%` : ng.avg_cvr != null ? `${ng.avg_cvr.toFixed(1)}%` : "—"}
                        </td>
                        <td className="px-6 py-5">
                          <div className="flex justify-end">
                            {ng.recommendation ? (
                              <Badge variant="outline" className={cn(
                                "text-[10px] font-bold uppercase tracking-wider px-2.5 py-0.5 border shadow-sm rounded",
                                ng.recommendation.toLowerCase().includes("negative") ? "bg-red-500/10 text-red-500 border-red-500/20" :
                                  ng.recommendation.toLowerCase().includes("keep") || ng.recommendation.toLowerCase().includes("expand") ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" :
                                    "bg-amber-500/10 text-amber-600 border-amber-500/20"
                              )}>
                                {truncate(ng.recommendation, 30)}
                              </Badge>
                            ) : (ng.conversions ?? 0) === 0 && (ng.cost ?? 0) > 0 ? (
                              <Badge variant="outline" className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-0.5 bg-red-600/10 text-red-600 border-red-600/20 shadow-sm rounded">
                                DRAIN DETECTED
                              </Badge>
                            ) : (ng.conversions ?? 0) > 0 ? (
                              <Badge variant="outline" className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-0.5 bg-emerald-600/10 text-emerald-600 border-emerald-600/20 shadow-sm rounded">
                                ALPHA PATTERN
                              </Badge>
                            ) : (
                              <span className="text-[11px] font-bold text-muted-foreground/30 uppercase tracking-widest">Observing...</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {activeTab === "existing_negatives" && (
        <div className="space-y-4 animate-in fade-in duration-500">
          <div className="flex items-center gap-3 bg-muted/20 p-4 rounded-xl border border-border/40">
             <div className="flex items-center gap-3">
                <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Campaign Repository:</label>
                <Select value={negativesCampaignId} onValueChange={(val) => setNegativesCampaignId(val)}>
                  <SelectTrigger className="w-[360px] h-10 text-sm bg-card border-border/60 rounded-lg shadow-sm">
                    <SelectValue placeholder="Identify campaign for inspection" />
                  </SelectTrigger>
                  <SelectContent className="rounded-xl border-border shadow-2xl">
                    {campaigns.map((c) => (
                      <SelectItem key={c.id} value={c.id} className="text-sm">
                        {truncate(c.name, 75)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
             </div>
            <button
              className="h-10 px-4 text-[10px] font-bold uppercase tracking-widest text-primary hover:text-primary-foreground transition-all bg-primary/5 hover:bg-primary rounded-lg flex items-center gap-2 shadow-sm disabled:opacity-30"
              onClick={() => negativesCampaignId && fetchExistingNegatives(negativesCampaignId)}
              disabled={negativesLoading}
            >
              {negativesLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldBan className="w-4 h-4" />}
              {negativesLoading ? "Synchronizing..." : "Sync Repository"}
            </button>
          </div>

          <Card className="bg-card shadow-lg border-border/40">
            <CardContent className="p-0">
              {negativesLoading ? (
                <div className="flex flex-col items-center justify-center py-32 gap-4">
                  <Loader2 className="w-8 h-8 animate-spin text-primary opacity-50" />
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Downloading existing exclusions...</p>
                </div>
              ) : existingNegatives.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-32 text-center gap-6">
                  <ShieldBan className="w-12 h-12 text-muted-foreground/20" />
                  <div className="space-y-1">
                    <p className="text-lg font-bold text-foreground uppercase tracking-wider">Vault is Empty</p>
                    <p className="text-xs text-muted-foreground max-w-sm leading-relaxed font-medium mx-auto opacity-60">
                      {negativesCampaignId ? "No negative keyword criteria found for the selected campaign." : "Select a campaign to inspect active negative exclusions."}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="overflow-x-auto custom-scrollbar">
                  <table className="t-table w-full text-left">
                    <thead>
                      <tr className="bg-muted/30 border-b border-border/60">
                        <th className="px-6 py-4 text-xs font-bold uppercase tracking-widest text-muted-foreground">Exclusion Keyword</th>
                        <th className="px-6 py-4 text-xs font-bold uppercase tracking-widest text-muted-foreground">Matching Logic</th>
                        <th className="px-6 py-4 text-xs font-bold uppercase tracking-widest text-muted-foreground">Campaign</th>
                        <th className="px-6 py-4 text-xs font-bold uppercase tracking-widest text-muted-foreground">Criterion Identity</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/40">
                      {existingNegatives.map((neg, idx) => (
                        <tr key={`${neg.criterionId}-${idx}`} className="hover:bg-muted/10 transition-colors">
                          <td className="px-6 py-5 text-base font-semibold text-foreground italic">"{neg.keyword}"</td>
                          <td className="px-6 py-5">
                            <Badge variant="outline" className={cn(
                              "text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 border shadow-sm rounded",
                              neg.matchType === "EXACT" ? "bg-blue-600/10 text-blue-500 border-blue-500/20" :
                                neg.matchType === "PHRASE" ? "bg-purple-600/10 text-purple-500 border-purple-500/20" :
                                  "bg-slate-600/10 text-slate-500 border-slate-500/20"
                            )}>
                              {neg.matchType}
                            </Badge>
                          </td>
                          <td className="px-6 py-5 text-sm font-medium text-muted-foreground">{truncate(neg.campaignName, 60)}</td>
                          <td className="px-6 py-5 text-muted-foreground/30 font-mono text-[10px] tabular-nums tracking-widest">{neg.criterionId}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="px-6 py-4 bg-muted/20 border-t border-border/60 flex justify-between items-center">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Repository Scan Complete</span>
                    <span className="text-xs font-bold uppercase tracking-wider text-foreground">
                      {existingNegatives.length} ACTIVE EXCLUSIONS
                    </span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Block Single Term Dialog */}
      <Dialog open={blockDialogOpen} onOpenChange={setBlockDialogOpen}>
        <DialogContent className="bg-card border-border/80 max-w-lg rounded-xl shadow-2xl p-0 overflow-hidden">
          <div className="bg-red-500/10 p-6 border-b border-red-500/20">
            <DialogTitle className="text-xl font-bold flex items-center gap-2 text-foreground">
              <ShieldAlert className="w-6 h-6 text-red-500" />
              Exclude Term
            </DialogTitle>
            <DialogDescription className="text-sm font-medium mt-2 text-muted-foreground">
              Add "{blockTerm ? getTermText(blockTerm) : ""}" as a negative keyword to prevent future ad spend.
            </DialogDescription>
          </div>

          <div className="p-6 space-y-6">
            <div className="grid grid-cols-1 gap-6">
               <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Match Type</label>
                  <Select value={blockMatchType} onValueChange={(val) => setBlockMatchType(val as any)}>
                    <SelectTrigger className="text-sm bg-card border border-border/60 rounded-lg h-10 shadow-sm focus:ring-2 focus:ring-primary/20">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="rounded-lg shadow-xl border-border/60">
                      <SelectItem value="EXACT" className="text-sm font-semibold">[EXACT]</SelectItem>
                      <SelectItem value="PHRASE" className="text-sm font-semibold">"PHRASE"</SelectItem>
                      <SelectItem value="BROAD" className="text-sm font-semibold">BROAD</SelectItem>
                    </SelectContent>
                  </Select>
               </div>

               <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Target Campaign</label>
                  <Select value={blockCampaignId} onValueChange={setBlockCampaignId}>
                    <SelectTrigger className="text-sm bg-card border border-border/60 rounded-lg h-10 shadow-sm focus:ring-2 focus:ring-primary/20">
                      <SelectValue placeholder="Select campaign" />
                    </SelectTrigger>
                    <SelectContent className="rounded-lg shadow-xl border-border/60">
                      {campaigns.map((c) => (
                        <SelectItem key={c.id} value={c.id} className="text-sm font-medium">
                          {truncate(c.name, 50)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
               </div>
            </div>
          </div>

          <DialogFooter className="p-6 bg-muted/20 border-t border-border/60 gap-3 sm:gap-0">
            <button
              className="px-4 py-2 text-xs font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground transition-all rounded-lg border border-transparent hover:bg-muted"
              onClick={() => setBlockDialogOpen(false)}
              disabled={blockSubmitting}
            >
              Cancel
            </button>
            <button
              className={cn(
                "inline-flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-widest px-6 py-2 rounded-lg transition-all active:scale-95",
                blockSubmitting
                  ? "bg-muted text-muted-foreground cursor-not-allowed"
                  : "bg-red-600 text-white hover:bg-red-700 shadow-sm"
              )}
              onClick={handleBlockConfirm}
              disabled={blockSubmitting || !blockCampaignId}
            >
              {blockSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Ban className="w-4 h-4" />}
              {blockSubmitting ? "Processing..." : "Exclude Term"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Add Dialog */}
      <Dialog open={bulkDialogOpen} onOpenChange={setBulkDialogOpen}>
        <DialogContent className="bg-card border-border/80 max-w-lg rounded-xl shadow-2xl p-0 overflow-hidden">
          <div className="bg-primary/5 p-6 border-b border-primary/10">
            <DialogTitle className="text-xl font-bold flex items-center gap-2 text-foreground">
              <Ban className="w-6 h-6 text-primary" />
              Bulk Add Negatives
            </DialogTitle>
            <DialogDescription className="text-sm font-medium mt-2 text-muted-foreground">
              Adding {selectedTermKeys.size} selected terms to campaign negatives.
            </DialogDescription>
          </div>

          <div className="p-6 space-y-6">
            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Preview ({selectedTermKeys.size} terms)</label>
              <div className="bg-muted/30 border border-border/60 rounded-lg p-4 max-h-40 overflow-y-auto custom-scrollbar space-y-2">
                {Array.from(selectedTermKeys).map((key) => (
                  <div key={key} className="text-xs font-semibold text-foreground italic flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-red-500" />
                    {key.split("__")[0]}
                  </div>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
               <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Match Type</label>
                  <Select value={bulkMatchType} onValueChange={(val) => setBulkMatchType(val as any)}>
                    <SelectTrigger className="text-sm bg-card border border-border/60 rounded-lg h-10 shadow-sm focus:ring-2 focus:ring-primary/20">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="rounded-lg shadow-xl border-border/60">
                      <SelectItem value="EXACT" className="text-sm font-semibold">[EXACT]</SelectItem>
                      <SelectItem value="PHRASE" className="text-sm font-semibold">"PHRASE"</SelectItem>
                      <SelectItem value="BROAD" className="text-sm font-semibold">BROAD</SelectItem>
                    </SelectContent>
                  </Select>
               </div>
               <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Target Campaign</label>
                  <Select value={bulkCampaignId} onValueChange={setBulkCampaignId}>
                    <SelectTrigger className="text-sm bg-card border border-border/60 rounded-lg h-10 shadow-sm focus:ring-2 focus:ring-primary/20">
                      <SelectValue placeholder="Select campaign" />
                    </SelectTrigger>
                    <SelectContent className="rounded-lg shadow-xl border-border/60">
                      {campaigns.map((c) => (
                        <SelectItem key={c.id} value={c.id} className="text-sm font-medium">
                          {truncate(c.name, 35)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
               </div>
            </div>
          </div>

          <DialogFooter className="p-6 bg-muted/20 border-t border-border/60 gap-3 sm:gap-0">
            <button
              className="px-4 py-2 text-xs font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground transition-all rounded-lg border border-transparent hover:bg-muted"
              onClick={() => setBulkDialogOpen(false)}
              disabled={bulkSubmitting}
            >
              Cancel
            </button>
            <button
              className={cn(
                "inline-flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-widest px-6 py-2 rounded-lg transition-all active:scale-95",
                bulkSubmitting
                  ? "bg-muted text-muted-foreground cursor-not-allowed"
                  : "bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm"
              )}
              onClick={handleBulkConfirm}
              disabled={bulkSubmitting || !bulkCampaignId}
            >
              {bulkSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Ban className="w-4 h-4" />}
              {bulkSubmitting ? "Adding..." : `Add Negatives (${selectedTermKeys.size})`}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
