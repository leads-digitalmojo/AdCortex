import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Brain,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  Activity,
  ShieldCheck,
  RefreshCw,
  Cpu,
  Sparkles,
} from "lucide-react";
import { useClient } from "@/lib/client-context";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

import { ExecutionButton } from "@/components/execution-button";
import { RootCauseChain } from "@/components/root-cause-chain";

type SeverityTier = "CRITICAL" | "MEDIUM" | "LOW";
type ExecutionClassification = "AUTO-EXECUTE" | "MANUAL" | "REJECT";
type PlatformFilter = "all" | "meta" | "google";

interface SolutionOption {
  classification: ExecutionClassification;
  title: string;
  rationale: string;
  steps: string[];
  risk: "Low" | "Medium" | "High";
  confidence: number;
  expectedOutcome: string;
  actionPayload?: {
    action?: { type: string; parameters?: any };
    strategic_rationale?: string;
  };
}

interface TieredSolutions {
  primary: SolutionOption;
  secondary: SolutionOption[];
  rejection: SolutionOption[];
}

interface RecommendationCardData {
  id: string;
  severity: SeverityTier;
  platform: "meta" | "google";
  entity: {
    id?: string;
    name: string;
    type: string;
    score: number;
    classification: string;
  };
  diagnosis: {
    symptom: string;
    problem: string;
    data: string[];
    rootCauseChain: string[];
  };
  layerAnalysis: {
    l1: { action: string; confidence: number; reasoning: string };
    l2: { action: string; confidence: number; reasoning: string };
    l3: { action: string; confidence: number; reasoning: string };
    l4: { action: string; confidence: number; reasoning: string };
    conflicts: string[];
  };
  solutions: SolutionOption[];
  tieredSolutions: TieredSolutions;
  expectedOutcome: string;
  modelUsed?: "opus" | "sonnet";
}

interface RecommendationsResponse {
  recommendation_tiers: Record<SeverityTier, RecommendationCardData[]>;
  conflicts: string[];
  layer_contributions?: Record<string, number | string>;
}

// ─── Style Maps ───────────────────────────────────────────────────

const SECTION_STYLE: Record<SeverityTier, {
  tone: string;
  bg: string;
  border: string;
  leftBar: string;
}> = {
  CRITICAL: {
    tone: "text-red-700 dark:text-red-300",
    bg: "bg-red-500/6",
    border: "border-red-500/25",
    leftBar: "border-l-red-500",
  },
  MEDIUM: {
    tone: "text-amber-700 dark:text-amber-300",
    bg: "bg-amber-500/6",
    border: "border-amber-500/25",
    leftBar: "border-l-amber-500",
  },
  LOW: {
    tone: "text-emerald-700 dark:text-emerald-300",
    bg: "bg-emerald-500/6",
    border: "border-emerald-500/25",
    leftBar: "border-l-emerald-500",
  },
};

const EXECUTION_STYLE: Record<ExecutionClassification, string> = {
  "AUTO-EXECUTE": "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  MANUAL: "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  REJECT: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400",
};

const CLASSIFICATION_STYLE: Record<string, string> = {
  WINNER: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  WATCH: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  UNDERPERFORMER: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400",
};

// ─── Model Badge ──────────────────────────────────────────────────

function ModelBadge({ model }: { model?: "opus" | "sonnet" }) {
  if (!model) return null;
  const isOpus = model === "opus";
  return (
    <Badge
      variant="outline"
      className={cn(
        "text-xs font-bold uppercase tracking-[0.14em] gap-1 px-2 py-0.5",
        isOpus
          ? "border-violet-500/40 bg-violet-500/10 text-violet-600 dark:text-violet-300 shadow-[0_0_6px_rgba(139,92,246,0.2)]"
          : "border-blue-500/30 bg-blue-500/8 text-blue-600 dark:text-blue-300"
      )}
    >
      {isOpus ? <Sparkles className="w-2.5 h-2.5" /> : <Cpu className="w-2.5 h-2.5" />}
      {isOpus ? "Opus" : "Sonnet"}
    </Badge>
  );
}

// ─── Data Point Chips ─────────────────────────────────────────────

function DataChips({ dataPoints }: { dataPoints: string[] }) {
  if (!dataPoints.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {dataPoints.map((point, index) => (
        <span
          key={index}
          className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border border-border/50 bg-muted/60 text-foreground/80"
        >
          {point}
        </span>
      ))}
    </div>
  );
}

// ─── Layer Analysis Summary Line ──────────────────────────────────

function LayerSummaryLine({ card }: { card: RecommendationCardData }) {
  const hasConflicts = card.layerAnalysis.conflicts.length > 0;
  // Use L2 position to determine the correct summary (passed via reasoning keywords)
  // We determine alignment state based on actual conflicts, not raw action comparison
  const l2Reasoning = card.layerAnalysis.l2.reasoning?.toLowerCase() || "";
  const l2Agrees = l2Reasoning.includes("agree") || l2Reasoning.includes("validates") || l2Reasoning.includes("confirms");

  if (hasConflicts) {
    return (
      <span className="text-amber-600 dark:text-amber-400 font-medium">
        Layer conflict detected — review before executing
      </span>
    );
  }
  if (l2Agrees) {
    return (
      <span className="text-emerald-600 dark:text-emerald-400 font-medium">
        L2 validates L1 — all layers aligned
      </span>
    );
  }
  return (
    <span className="text-blue-600 dark:text-blue-400 font-medium">
      L2 refined the SOP recommendation — {card.layerAnalysis.l2.action}
    </span>
  );
}

// ─── Layer Status Pills ───────────────────────────────────────────

function LayerStatusPills({ card }: { card: RecommendationCardData }) {
  // L1/L2 conflict only when backend explicitly flagged it (real OVERRIDE, not extension)
  const hasL1L2Conflict = card.layerAnalysis.conflicts.some((c) =>
    c.toLowerCase().includes("layer 1") || c.toLowerCase().includes("sop")
  );
  // L3 caution: meaningful confidence reduction (backend only emits this when delta > 15)
  const hasHistoryCaution = card.layerAnalysis.conflicts.some((c) =>
    c.toLowerCase().includes("history") || c.toLowerCase().includes("caution")
  );
  // Lower threshold for yellow pill: show caution when L3 confidence is genuinely low
  const hasHistoryWarning = card.layerAnalysis.l3.confidence < 65;
  // L4 strategic veto
  const hasStrategyConflict = card.layerAnalysis.conflicts.some((c) =>
    c.toLowerCase().includes("strategic") || c.toLowerCase().includes("veto") || c.toLowerCase().includes("constraint")
  );

  const layers = [
    { label: "L1", status: hasL1L2Conflict ? "conflict" : "ok" },
    { label: "L2", status: hasL1L2Conflict ? "conflict" : "ok" },
    { label: "L3", status: (hasHistoryCaution || hasHistoryWarning) ? "caution" : "ok" },
    { label: "L4", status: hasStrategyConflict ? "conflict" : "ok" },
  ] as const;

  const statusClass = {
    ok: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
    caution: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
    conflict: "bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30",
  };

  return (
    <div className="flex items-center gap-1.5">
      {layers.map(({ label, status }) => (
        <span
          key={label}
          className={cn(
            "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold border",
            statusClass[status]
          )}
        >
          {label}
          {status === "ok" ? "✓" : status === "caution" ? "⚠" : "✗"}
        </span>
      ))}
    </div>
  );
}

// ─── Solution Tier Display ────────────────────────────────────────

function SolutionTierDisplay({
  solution,
  entityId,
  entityName,
  entityType,
}: {
  solution: SolutionOption;
  entityId?: string;
  entityName: string;
  entityType: string;
}) {
  return (
    <div className={cn("rounded-lg border p-3", EXECUTION_STYLE[solution.classification])}>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <Badge
          variant="outline"
          className={cn("text-xs font-black uppercase tracking-[0.14em]", EXECUTION_STYLE[solution.classification])}
        >
          {solution.classification}
        </Badge>
        <span className="text-xs text-muted-foreground">{solution.confidence}% confidence</span>
        <span className="text-xs text-muted-foreground">Risk: {solution.risk}</span>
      </div>
      <h4 className="text-sm font-semibold text-foreground">{solution.title}</h4>
      <p className="mt-2 text-sm leading-relaxed text-foreground/85">{solution.rationale}</p>
      {solution.steps.length > 0 && (
        <div className="mt-3 space-y-1.5">
          <p className="text-xs font-black uppercase tracking-[0.14em] text-muted-foreground">Steps</p>
          {solution.steps.map((step, index) => (
            <p key={index} className="text-sm leading-relaxed text-foreground/80">
              {index + 1}. {step}
            </p>
          ))}
        </div>
      )}
      <p className="mt-3 text-sm text-foreground/85">
        <span className="font-semibold">Expected Outcome:</span> {solution.expectedOutcome}
      </p>
      {solution.classification === "AUTO-EXECUTE" && solution.actionPayload?.action?.type && (
        <div className="mt-4">
          <ExecutionButton
            action={solution.actionPayload.action.type}
            entityId={entityId || ""}
            entityName={entityName}
            entityType={entityType as any}
            params={solution.actionPayload.action.parameters}
            label="Execute Now"
            className="w-full text-xs font-black uppercase tracking-[0.16em]"
            size="sm"
          />
        </div>
      )}
    </div>
  );
}

// ─── Main Recommendation Card ─────────────────────────────────────

function SectionCard({ severity, card }: { severity: SeverityTier; card: RecommendationCardData }) {
  const [showSecondary, setShowSecondary] = useState(false);
  const [showRejection, setShowRejection] = useState(false);
  const [showLayerAnalysis, setShowLayerAnalysis] = useState(false);
  const primary = card.tieredSolutions.primary;
  const secondary = card.tieredSolutions.secondary;
  const rejection = card.tieredSolutions.rejection;
  const style = SECTION_STYLE[severity];
  const hasConflicts = card.layerAnalysis.conflicts.length > 0;

  const classificationStyle =
    CLASSIFICATION_STYLE[card.entity.classification.toUpperCase()] ||
    "border-border/50 bg-background/30 text-muted-foreground";

  return (
    <Card
      className={cn(
        "border shadow-sm border-l-[3px] transition-all duration-200",
        style.border,
        style.bg,
        style.leftBar
      )}
    >
      <CardContent className="p-5 space-y-4">
        {/* ── Header Row ─────────────────────────────────────────── */}
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {/* Severity badge */}
            <Badge
              variant="outline"
              className={cn("text-xs font-black uppercase tracking-[0.16em]", style.border, style.tone)}
            >
              {severity}
            </Badge>
            {/* Platform badge */}
            <Badge
              variant="outline"
              className="text-xs font-black uppercase tracking-[0.16em] border-border/50 text-foreground/70"
            >
              {card.platform === "meta" ? "Meta" : "Google"}
            </Badge>
            {/* Entity classification badge */}
            <Badge variant="outline" className={cn("text-xs font-black uppercase tracking-[0.14em]", classificationStyle)}>
              {card.entity.classification}
            </Badge>
            {/* Model indicator */}
            <ModelBadge model={card.modelUsed} />
          </div>

          <div>
            <h3 className="text-base font-semibold text-foreground">{card.entity.name}</h3>
            <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
              {card.entity.type} · Score {card.entity.score.toFixed(1)}/100
            </p>
          </div>
        </div>

        {/* ── Diagnosis Block (always visible) ───────────────────── */}
        <div className="space-y-3">
          <p className="text-sm leading-relaxed text-foreground/90">{card.diagnosis.problem}</p>

          {/* Data point chips */}
          {card.diagnosis.data.length > 0 && (
            <DataChips dataPoints={card.diagnosis.data} />
          )}

          {/* Root cause chain — prominent */}
          {card.diagnosis.rootCauseChain.length > 0 && (
            <div className="rounded-lg border border-border/40 bg-background/50 px-3 py-2.5">
              <p className="text-xs font-black uppercase tracking-[0.16em] text-muted-foreground mb-2">
                Root Cause Chain
              </p>
              <RootCauseChain steps={card.diagnosis.rootCauseChain} className="flex-wrap" />
            </div>
          )}
        </div>

        {/* ── Primary Solution Block ──────────────────────────────── */}
        <div className="space-y-3">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-muted-foreground">
            Primary Recommendation
          </p>
          <SolutionTierDisplay
            solution={primary}
            entityId={card.entity.id}
            entityName={card.entity.name}
            entityType={card.entity.type}
          />
        </div>

        {/* ── Secondary Solutions ─────────────────────────────────── */}
        {secondary.length > 0 && (
          <div className="space-y-3 rounded-lg border border-blue-500/20 bg-blue-500/5 p-4">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-0 text-xs font-black uppercase tracking-[0.14em] text-blue-700 dark:text-blue-300 justify-start"
              onClick={() => setShowSecondary(!showSecondary)}
            >
              {showSecondary ? (
                <ChevronUp className="mr-2 h-3 w-3" />
              ) : (
                <ChevronDown className="mr-2 h-3 w-3" />
              )}
              Alternative Approaches ({secondary.length})
            </Button>
            {showSecondary && (
              <div className="mt-3 grid gap-3 lg:grid-cols-2">
                {secondary.map((solution, index) => (
                  <SolutionTierDisplay
                    key={`secondary-${index}`}
                    solution={solution}
                    entityId={card.entity.id}
                    entityName={card.entity.name}
                    entityType={card.entity.type}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Rejection Explanations ──────────────────────────────── */}
        {rejection.length > 0 && (
          <div className="space-y-3 rounded-lg border border-red-500/20 bg-red-500/5 p-4">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-0 text-xs font-black uppercase tracking-[0.14em] text-red-700 dark:text-red-300 justify-start"
              onClick={() => setShowRejection(!showRejection)}
            >
              {showRejection ? (
                <ChevronUp className="mr-2 h-3 w-3" />
              ) : (
                <ChevronDown className="mr-2 h-3 w-3" />
              )}
              Why Not… ({rejection.length})
            </Button>
            {showRejection && (
              <div className="mt-3 grid gap-3">
                {rejection.map((solution, index) => (
                  <div
                    key={`rejection-${index}`}
                    className="rounded-lg border border-red-500/30 bg-red-500/10 p-3"
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <Badge
                        variant="outline"
                        className={cn("text-xs font-black uppercase tracking-[0.14em]", EXECUTION_STYLE[solution.classification])}
                      >
                        {solution.classification}
                      </Badge>
                      <span className="text-xs text-red-700 dark:text-red-300">
                        {solution.confidence}% certain this won't work
                      </span>
                    </div>
                    <h4 className="text-sm font-semibold text-foreground">{solution.title}</h4>
                    <p className="mt-2 text-sm leading-relaxed text-foreground/85">{solution.rationale}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Layer Analysis ──────────────────────────────────────── */}
        <div className="rounded-xl border border-border/40 bg-background/40 p-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-2">
            <div className="flex items-center gap-2">
              <p className="text-xs font-black uppercase tracking-[0.16em] text-muted-foreground">
                Layer Analysis
              </p>
              <LayerStatusPills card={card} />
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs font-black uppercase tracking-[0.14em] text-muted-foreground self-start sm:self-auto"
              onClick={() => setShowLayerAnalysis(!showLayerAnalysis)}
            >
              {showLayerAnalysis ? <ChevronUp className="mr-1 h-3 w-3" /> : <ChevronDown className="mr-1 h-3 w-3" />}
              {showLayerAnalysis ? "Hide" : "Show"}
            </Button>
          </div>

          {/* Summary line — always visible */}
          <p className="text-xs text-muted-foreground leading-relaxed">
            <LayerSummaryLine card={card} />
          </p>

          {/* Conflict warning — always visible when conflicts exist */}
          {hasConflicts && (
            <div className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2">
              <div className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                <AlertTriangle className="h-3 w-3 shrink-0" />
                <p className="text-xs font-bold uppercase tracking-[0.12em]">Layer Conflict</p>
              </div>
              <div className="mt-1 space-y-1">
                {card.layerAnalysis.conflicts.map((conflict, index) => (
                  <p key={index} className="text-xs leading-relaxed text-foreground/90">
                    {conflict}
                  </p>
                ))}
              </div>
            </div>
          )}

          {/* Full layer detail — expandable */}
          {showLayerAnalysis && (
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {[
                { label: "L1 SOP", layer: card.layerAnalysis.l1 },
                { label: "L2 AI", layer: card.layerAnalysis.l2, model: card.modelUsed },
                { label: "L3 History", layer: card.layerAnalysis.l3 },
                { label: "L4 Strategy", layer: card.layerAnalysis.l4 },
              ].map(({ label, layer, model }) => (
                <div
                  key={label}
                  className="rounded-lg border border-border/30 bg-background/50 p-2.5"
                >
                  <div className="flex items-center gap-1.5 mb-1">
                    <p className="text-xs font-black uppercase tracking-[0.14em] text-violet-700 dark:text-violet-300">
                      {label}
                    </p>
                    {model && label === "L2 AI" && <ModelBadge model={model} />}
                  </div>
                  <p className="text-xs font-semibold text-foreground">{layer.action}</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{layer.reasoning}</p>
                  <p className="mt-1 text-xs text-muted-foreground/70">{layer.confidence}% confidence</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Platform Column ──────────────────────────────────────────────

function PlatformColumn({
  platform,
  cards,
  severity,
}: {
  platform: "meta" | "google";
  cards: RecommendationCardData[];
  severity: SeverityTier;
}) {
  if (!cards.length) return null;

  const platformLabel = platform === "meta" ? "Meta" : "Google";
  const platformColor =
    platform === "meta"
      ? "text-blue-600 dark:text-blue-400 border-blue-500/30 bg-blue-500/8"
      : "text-green-600 dark:text-green-400 border-green-500/30 bg-green-500/8";

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Badge variant="outline" className={cn("text-xs font-black uppercase tracking-[0.14em]", platformColor)}>
          {platformLabel}
        </Badge>
        <span className="text-xs text-muted-foreground">
          {cards.length} item{cards.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className="space-y-4">
        {cards.map((card) => (
          <SectionCard key={card.id} severity={severity} card={card} />
        ))}
      </div>
    </div>
  );
}

// ─── Conflict Summary Banner ──────────────────────────────────────

function ConflictBanner({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <div className="flex items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/8 px-4 py-3">
      <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
      <p className="text-sm text-amber-700 dark:text-amber-300">
        <span className="font-bold">{count} recommendation{count === 1 ? "" : "s"}</span>{" "}
        {count === 1 ? "has" : "have"} layer conflicts — review before executing
      </p>
    </div>
  );
}

// ─── Page Component ───────────────────────────────────────────────

export default function RecommendationsPage() {
  const { activeClient, activePlatform, activePlatformInfo } = useClient();
  const [showContributions, setShowContributions] = useState(false);
  const [platformFilter, setPlatformFilter] = useState<PlatformFilter>("all");

  const { data, isLoading, refetch, isFetching } = useQuery<RecommendationsResponse>({
    queryKey: ["/api/intelligence", activeClient?.id, activePlatform, "insights"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/intelligence/${activeClient?.id}/${activePlatform}/insights`);
      return res.json();
    },
    enabled: !!activeClient?.id && !!activePlatform,
  });

  const tiers = data?.recommendation_tiers || { CRITICAL: [], MEDIUM: [], LOW: [] };
  const allCards = useMemo(
    () => [...tiers.CRITICAL, ...tiers.MEDIUM, ...tiers.LOW],
    [tiers],
  );
  const availablePlatforms = useMemo<PlatformFilter[]>(
    () => ["all", ...Array.from(new Set(allCards.map((card) => card.platform)))],
    [allCards],
  );
  const totalCards = allCards.filter(
    (card) => platformFilter === "all" || card.platform === platformFilter,
  ).length;

  // Count cards with conflicts for the banner
  const conflictCount = useMemo(
    () =>
      allCards.filter(
        (card) =>
          (platformFilter === "all" || card.platform === platformFilter) &&
          card.layerAnalysis.conflicts.length > 0,
      ).length,
    [allCards, platformFilter],
  );

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-12 rounded-xl" />
        <Skeleton className="h-24 rounded-xl" />
        <Skeleton className="h-48 rounded-xl" />
        <Skeleton className="h-48 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-[1400px]">
      {/* ── Page Header ─────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="t-page-title text-foreground flex items-center gap-2">
            Mojo AdCortex Recommendations
            <Badge
              variant="outline"
              className="border-violet-500/30 text-violet-700 dark:text-violet-300 bg-violet-500/10 gap-1.5 py-1"
            >
              <Brain className="w-3 h-3" /> Score-Driven Pipeline
            </Badge>
          </h1>
          <p className="t-label text-muted-foreground mt-1">
            {activeClient?.name} · {activePlatformInfo?.label} · {totalCards}{" "}
            document-qualified recommendation{totalCards === 1 ? "" : "s"}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="w-fit border-border/50 text-xs font-black uppercase tracking-[0.16em]"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <RefreshCw className={cn("mr-2 h-3.5 w-3.5", isFetching && "animate-spin")} />
            {isFetching ? "Refreshing…" : "Refresh"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="w-fit border-border/50 text-xs font-black uppercase tracking-[0.16em]"
            onClick={() => setShowContributions((value) => !value)}
          >
            <Activity className="mr-2 h-3.5 w-3.5" />
            {showContributions ? "Hide Layer Counts" : "Show Layer Counts"}
          </Button>
        </div>
      </div>

      {/* ── Platform Filter Tabs ─────────────────────────────────── */}
      {availablePlatforms.length > 2 && (
        <Tabs
          value={platformFilter}
          onValueChange={(value) => setPlatformFilter(value as PlatformFilter)}
        >
          <TabsList className="grid w-full max-w-sm grid-cols-3">
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="meta">Meta</TabsTrigger>
            <TabsTrigger value="google">Google</TabsTrigger>
          </TabsList>
        </Tabs>
      )}

      {/* ── Layer Contributions ──────────────────────────────────── */}
      {showContributions && data?.layer_contributions && (
        <Card className="border-border/50 bg-card/50">
          <CardContent className="grid gap-3 p-4 md:grid-cols-5">
            {Object.entries(data.layer_contributions).map(([key, value]) => (
              <div key={key} className="rounded-lg border border-border/40 bg-background/50 px-3 py-2">
                <p className="text-xs font-black uppercase tracking-[0.16em] text-muted-foreground">
                  {key.replace(/_/g, " ")}
                </p>
                <p className="mt-1 text-sm font-semibold text-foreground">{String(value)}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* ── Conflict Summary Banner (replaces old conflict dump) ─── */}
      <ConflictBanner count={conflictCount} />

      {/* ── 3-Tier Accordion with Platform Columns ───────────────── */}
      <Accordion type="multiple" defaultValue={["CRITICAL"]} className="space-y-4">
        {(["CRITICAL", "MEDIUM", "LOW"] as SeverityTier[]).map((severity) => {
          const filteredCards = tiers[severity].filter(
            (card) => platformFilter === "all" || card.platform === platformFilter,
          );
          if (!filteredCards.length) return null;
          const style = SECTION_STYLE[severity];

          // Split by platform within this tier
          const metaCards = filteredCards.filter((c) => c.platform === "meta");
          const googleCards = filteredCards.filter((c) => c.platform === "google");
          const hasBothPlatforms = metaCards.length > 0 && googleCards.length > 0;

          return (
            <AccordionItem
              key={severity}
              value={severity}
              className={cn("rounded-xl border px-4", style.border, style.bg)}
            >
              <AccordionTrigger className="py-4 hover:no-underline">
                <div className="flex w-full items-center gap-3 text-left">
                  <div
                    className={cn(
                      "h-2 w-2 rounded-full",
                      severity === "CRITICAL"
                        ? "bg-red-400"
                        : severity === "MEDIUM"
                        ? "bg-amber-400"
                        : "bg-emerald-400",
                    )}
                  />
                  <h2 className={cn("text-sm font-black uppercase tracking-[0.18em]", style.tone)}>
                    {severity} · {filteredCards.length} item{filteredCards.length === 1 ? "" : "s"}
                  </h2>
                  {/* Per-platform counts in header */}
                  {hasBothPlatforms && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-blue-600 dark:text-blue-400 font-semibold">
                        Meta {metaCards.length}
                      </span>
                      <span className="text-xs text-muted-foreground">·</span>
                      <span className="text-xs text-green-600 dark:text-green-400 font-semibold">
                        Google {googleCards.length}
                      </span>
                    </div>
                  )}
                  <div className="h-px flex-1 bg-border/40" />
                </div>
              </AccordionTrigger>

              <AccordionContent className="pt-2 pb-4">
                {hasBothPlatforms ? (
                  /* Two-column platform layout */
                  <div className="grid gap-6 lg:grid-cols-2">
                    <PlatformColumn platform="meta" cards={metaCards} severity={severity} />
                    <PlatformColumn platform="google" cards={googleCards} severity={severity} />
                  </div>
                ) : (
                  /* Single platform — full width */
                  <div className="space-y-4">
                    {filteredCards.map((card) => (
                      <SectionCard key={card.id} severity={severity} card={card} />
                    ))}
                  </div>
                )}
              </AccordionContent>
            </AccordionItem>
          );
        })}
      </Accordion>

      {/* ── Empty State ──────────────────────────────────────────── */}
      {totalCards === 0 && (
        <div className="py-24 text-center space-y-4">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-emerald-500/25 bg-emerald-500/10">
            <ShieldCheck className="h-8 w-8 text-emerald-700 dark:text-emerald-400" />
          </div>
          <div className="space-y-1">
            <h3 className="text-lg font-semibold text-foreground">No Document-Qualified Problems</h3>
            <p className="text-sm text-muted-foreground">
              No entity currently meets the score-driven detection rules from the overhaul document.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
