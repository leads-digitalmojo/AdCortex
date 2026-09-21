import { assembleContext, type QueryType } from "./context-assembler";
import { detectProblemsFromScores } from "./problem-detector";
import { callClaude, isClaudeAvailable } from "./claude-provider";
import { buildRecommendationPrompt, type AdCortexRecommendation } from "./prompt-templates";
import { deduplicateProblems } from "./problem-deduplicator";
import {
  cardsToRecommendations,
  runSolutionPipeline,
  type RecommendationCard,
  type SolutionOption,
} from "./solution-pipeline";

export interface IntelligenceQuery {
  type: QueryType;
  clientId: string;
  platform: "meta" | "google" | "all";
  message?: string;
  analysisData?: any;
  conversationHistory?: string[];
  alertContext?: {
    problem: string;
    metric?: string;
    metrics?: Record<string, string | number>;
  };
}

export interface StandardizedInsight {
  issue: string;
  impact: string;
  recommendation: string;
  reasoning?: string;
  execution_plan?: string[];
  execution_type?: string;
  action_type?: string;
  priority: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  entityId?: string;
  entityName?: string;
  entityType?: string;
  confidence: number;
  source: "SOP" | "AI" | "MIXED";
}

export interface StructuredTerminalResponse {
  diagnosis: string[];
  layerAnalysis: string[];
  solutions: string[];
  expectedOutcome: string[];
  text: string;
}

export interface IntelligenceResult {
  insights: StandardizedInsight[];
  recommendations: ReturnType<typeof cardsToRecommendations>;
  recommendation_tiers: {
    CRITICAL: RecommendationCard[];
    MEDIUM: RecommendationCard[];
    LOW: RecommendationCard[];
  };
  layer_contributions: Record<string, any>;
  conflicts: string[];
  humanResponse: string;
  modelUsed: string;
  terminalResponse: StructuredTerminalResponse;
  trace: {
    layer1: any;
    layer2: any;
    layer3: any;
    layer4: any;
  };
}

function splitBySeverity(cards: RecommendationCard[]) {
  return {
    CRITICAL: cards.filter((card) => card.severity === "CRITICAL"),
    MEDIUM: cards.filter((card) => card.severity === "MEDIUM"),
    LOW: cards.filter((card) => card.severity === "LOW"),
  };
}

function toCompatibilityPriority(severity: RecommendationCard["severity"]): StandardizedInsight["priority"] {
  if (severity === "CRITICAL") return "CRITICAL";
  if (severity === "MEDIUM") return "HIGH";
  return "LOW";
}

function primarySolution(card: RecommendationCard): SolutionOption {
  return card.solutions[0];
}

function cardToInsight(card: RecommendationCard): StandardizedInsight {
  const solution = primarySolution(card);
  return {
    issue: card.diagnosis.problem,
    impact: solution.expectedOutcome,
    recommendation: solution.title,
    reasoning: solution.rationale,
    execution_plan: solution.steps,
    execution_type: solution.classification === "AUTO-EXECUTE" ? "auto" : solution.classification === "MANUAL" ? "manual" : "confirm",
    action_type: solution.actionPayload?.action?.type,
    priority: toCompatibilityPriority(card.severity),
    entityId: card.entity.id,
    entityName: card.entity.name,
    entityType: card.entity.type,
    confidence: Number((solution.confidence / 100).toFixed(2)),
    source: card.layerAnalysis.conflicts.length > 0 ? "MIXED" : "AI",
    // Pass through model information for downstream consumers
    ...(card.modelUsed ? { modelUsed: card.modelUsed } : {}),
  };
}

function formatSolutionLine(solution: SolutionOption): string {
  const tag = solution.classification === "REJECT" ? "REJECT-SUGGESTED" : solution.classification;
  return `[${tag}] ${solution.title}\n  Rationale: ${solution.rationale}\n  Risk: ${solution.risk} | Confidence: ${solution.confidence}%`;
}

function isDiagnosticQuery(message?: string): boolean {
  if (!message) return false;
  const text = message.toLowerCase();
  return (
    text.includes("what's wrong") ||
    text.includes("whats wrong") ||
    text.includes("what is wrong") ||
    text.includes("problems") ||
    text.includes("issues") ||
    text.includes("diagnos") ||
    text.includes("analyze") ||
    text.includes("analyse") ||
    text.includes("overview") ||
    text.includes("summary") ||
    text.includes("check") ||
    (text.includes("my") && text.includes("account"))
  );
}

function filterCardsByEntityQuery(cards: RecommendationCard[], message?: string): RecommendationCard[] {
  if (!message) return cards;
  const text = message.toLowerCase();

  // Try to match specific entity names mentioned in the query
  const entityMatches = cards.filter((card) => {
    const entityText = card.entity.name.toLowerCase();
    const entityTokens = entityText.split(/\s+/).filter((t) => t.length > 3);
    return entityTokens.some((token) => text.includes(token));
  });

  return entityMatches.length > 0 ? entityMatches : cards;
}

function buildTerminalResponse(cards: RecommendationCard[], query: IntelligenceQuery): StructuredTerminalResponse {
  if (cards.length === 0) {
    const emptyText = [
      "1. DIAGNOSIS",
      "   - No score-driven problems are currently active.",
      "",
      "2. LAYER ANALYSIS",
      "   - L1 (SOP): No rule-triggered issue.",
      "   - L2 (AI Expert): No root-cause escalation needed.",
      "   - L3 (History): No active action pattern to validate.",
      "   - L4 (Strategy): No strategic conflict detected.",
      "",
      "3. SOLUTIONS",
      "   [MANUAL] Continue monitoring current winners and watch-zone entities",
      "     Rationale: No document-qualified issue requires intervention right now.",
      "     Risk: Low | Confidence: 90%",
      "",
      "4. EXPECTED OUTCOME",
      "   - If actions are taken: Stable performance should continue.",
      "   - If no action: No immediate deterioration is expected from score data.",
    ].join("\n");

    return {
      diagnosis: ["No score-driven problems are currently active."],
      layerAnalysis: ["L1-L4 remain clear because no document-qualified issue was detected."],
      solutions: ["[MANUAL] Continue monitoring current winners and watch-zone entities"],
      expectedOutcome: ["Stable performance should continue."],
      text: emptyText,
    };
  }

  // For diagnostic/overview queries, show top 3-5 problems
  const isDiagnostic = isDiagnosticQuery(query.message);
  const entityFiltered = filterCardsByEntityQuery(cards, query.message);

  // Select which cards to show in the terminal response
  let focusCards: RecommendationCard[];
  if (isDiagnostic) {
    // Show top 3-5 problems for account-wide diagnostic questions
    focusCards = entityFiltered.slice(0, Math.min(5, entityFiltered.length));
  } else {
    // For specific commands, show the most relevant card(s)
    focusCards = entityFiltered.slice(0, Math.min(3, entityFiltered.length));
  }

  const primaryCard = focusCards[0];
  const additionalCards = focusCards.slice(1);

  // Diagnosis section: primary card details + summary of additional issues
  const diagnosis: string[] = [
    `Entity: ${primaryCard.entity.name} | Score: ${primaryCard.entity.score.toFixed(1)}/100 | Classification: ${primaryCard.entity.classification}`,
    `Problem: ${primaryCard.diagnosis.problem}`,
    `Data: ${primaryCard.diagnosis.data.join(" | ")}`,
  ];

  if (additionalCards.length > 0) {
    diagnosis.push(`Additional issues detected (${additionalCards.length} more):`);
    additionalCards.forEach((card, idx) => {
      diagnosis.push(`  ${idx + 2}. [${card.severity}] ${card.entity.name} — ${card.diagnosis.problem.substring(0, 100)}`);
    });
  }

  // Layer Analysis: focus on primary card
  const layerAnalysis = [
    `L1 (SOP): ${primaryCard.layerAnalysis.l1.action} — ${primaryCard.layerAnalysis.l1.reasoning}`,
    `L2 (AI Expert): ${primaryCard.layerAnalysis.l2.action} — ${primaryCard.layerAnalysis.l2.reasoning} [${primaryCard.modelUsed || "sonnet"}]`,
    `L3 (History): ${primaryCard.layerAnalysis.l3.reasoning}`,
    `L4 (Strategy): ${primaryCard.layerAnalysis.l4.reasoning}`,
  ];
  if (primaryCard.layerAnalysis.conflicts.length > 0) {
    layerAnalysis.push(`CONFLICTS: ${primaryCard.layerAnalysis.conflicts.join(" | ")}`);
  }

  // Solutions: show solution for each focus card
  const solutions: string[] = [];
  focusCards.forEach((card, idx) => {
    if (idx > 0) solutions.push(`--- Issue ${idx + 1}: ${card.entity.name} ---`);
    card.solutions.slice(0, 1).forEach((sol) => solutions.push(formatSolutionLine(sol)));
  });

  const expectedOutcome = [
    `If actions are taken: ${primarySolution(primaryCard).expectedOutcome}`,
    `If no action: ${primaryCard.expectedOutcome}`,
  ];

  if (additionalCards.length > 0) {
    additionalCards.forEach((card) => {
      expectedOutcome.push(`${card.entity.name}: ${primarySolution(card).expectedOutcome}`);
    });
  }

  const text = [
    "1. DIAGNOSIS",
    ...diagnosis.map((line) => `   - ${line}`),
    "",
    "2. LAYER ANALYSIS",
    ...layerAnalysis.map((line) => `   - ${line}`),
    "",
    "3. SOLUTIONS",
    ...solutions.map((line) => `   ${line}`),
    "",
    "4. EXPECTED OUTCOME",
    ...expectedOutcome.map((line) => `   - ${line}`),
  ].join("\n");

  return { diagnosis, layerAnalysis, solutions, expectedOutcome, text };
}

// Words that appear in almost every alert and almost every diagnosis, so matching on
// them tells you nothing about whether a card belongs to an alert.
const ALERT_MATCH_STOPWORDS = new Set([
  "account", "health", "dragging", "down", "performance", "target", "above", "below",
  "campaign", "campaigns", "adset", "adsets", "this", "that", "with", "from", "have",
  "where", "which", "cost", "spend", "critical", "warning", "alert", "issue", "lagging",
  "engagement", "efficiency", "overall",
]);

/** Map a dashboard alert's metric label onto the metric keys the detector emits. */
const ALERT_METRIC_ALIASES: Record<string, string[]> = {
  cpl: ["cpl"],
  cpsv: ["cpsv"],
  cpql: ["cpql"],
  creative: ["creative", "creative_age", "rsa", "ctr"],
  budget: ["budget"],
  leads: ["leads", "cvr"],
  frequency: ["freq"],
  ctr: ["ctr"],
  cpm: ["cpm"],
  qs: ["qs"],
  "quality score": ["qs"],
};

function alertMetricKeys(metric?: string): string[] {
  const key = (metric || "").trim().toLowerCase();
  if (!key) return [];
  return ALERT_METRIC_ALIASES[key] || [key];
}

function filterCardsForAlert(cards: RecommendationCard[], alertContext?: IntelligenceQuery["alertContext"]) {
  if (!alertContext?.problem) return cards;
  const problemText = alertContext.problem.toLowerCase();
  const metricKeys = alertMetricKeys(alertContext.metric);
  const campaignText = Object.values(alertContext.metrics || {})
    .map((value) => String(value).toLowerCase())
    .join(" ");
  const tokens = problemText
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4 && !ALERT_MATCH_STOPWORDS.has(token));

  // The metric is the strongest signal available and it is exact — a CPL alert wants
  // the CPL cards. Text matching only ever ran as a fallback because cards did not
  // used to carry their metric.
  if (metricKeys.length > 0) {
    const byMetric = cards.filter((card) => metricKeys.includes((card.symptomMetric || "").toLowerCase()));
    if (byMetric.length > 0) return byMetric;
  }

  const filtered = cards.filter((card) => {
    const haystack = `${card.entity.name} ${card.entity.type} ${card.diagnosis.problem} ${card.diagnosis.data.join(" ")} ${card.diagnosis.rootCauseChain.join(" ")}`
      .toLowerCase();

    if (haystack.includes(problemText)) return true;
    if (campaignText && (haystack.includes(campaignText) || campaignText.includes(card.entity.name.toLowerCase()))) return true;

    // Two distinct, non-generic tokens. The old threshold counted words like
    // "account", "health" and "cost", which every card matched — so a CPL alert, a
    // CPSV alert and a Creative alert all kept the full card list and then all
    // rendered whichever card happened to rank first.
    if (tokens.filter((token) => haystack.includes(token)).length >= 2) return true;

    return problemText.includes(card.entity.name.toLowerCase());
  });

  // Deliberately returns an empty list when nothing matches. Falling back to every
  // card is what made three different alerts open the same suggestion; the modal
  // says it has no specific recommendation instead.
  return filtered;
}

/**
 * Direct-AI fallback for an alert the SOP-driven pipeline produced no card for.
 * Instead of showing an empty "no suggestion" state, ask Claude to diagnose the alert
 * itself using the same live context the pipeline assembled. Returns [] on any failure
 * so the caller degrades to the empty state rather than erroring the request.
 */
/**
 * Pull recommendation objects out of a model reply. Tries a strict parse first; if the
 * reply is malformed (unescaped quote, trailing text, truncation) it scans the
 * "recommendations" array for balanced { } objects and keeps every one that parses.
 */
function extractRecommendations(text: string): any[] {
  const cleaned = text.replace(/```(?:json)?/gi, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      const parsed = JSON.parse(cleaned.slice(start, end + 1));
      if (Array.isArray(parsed.recommendations)) return parsed.recommendations;
    } catch { /* fall through to salvage */ }
  }

  const arrayAt = cleaned.search(/"recommendations"\s*:\s*\[/);
  if (arrayAt === -1) return [];
  const found: any[] = [];
  let depth = 0, inString = false, escaped = false, objStart = -1;
  for (let i = cleaned.indexOf("[", arrayAt) + 1; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") { if (depth++ === 0) objStart = i; }
    else if (ch === "}" && --depth === 0 && objStart !== -1) {
      try { found.push(JSON.parse(cleaned.slice(objStart, i + 1))); } catch { /* skip bad object */ }
      objStart = -1;
    } else if (ch === "]" && depth === 0) break;
  }
  return found;
}

/**
 * Direct-AI fallback for an alert the SOP-driven pipeline produced no card for.
 * Instead of showing an empty "no suggestion" state, ask Claude to diagnose the alert
 * itself using the same live context the pipeline assembled. Returns null when the AI
 * could not produce anything, so the caller can avoid caching the failure.
 */
async function aiRecommendationsForAlert(
  ctx: any,
  alertContext: NonNullable<IntelligenceQuery["alertContext"]>,
): Promise<AdCortexRecommendation[] | null> {
  if (!isClaudeAvailable()) return null;
  const { system, user } = buildRecommendationPrompt(ctx, alertContext);

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await callClaude({
        systemPrompt: system,
        userMessage: attempt === 1
          ? user
          : `${user}\n\nIMPORTANT: respond with strictly valid JSON only. Escape every double quote inside string values and keep reasoning concise.`,
        modelTier: "sonnet",
        maxTokens: 6000,
        temperature: attempt === 1 ? 0.3 : 0,
      });
      const recs = extractRecommendations(response.content)
        .filter((rec) => rec && typeof rec.action === "string" && rec.action.trim())
        .slice(0, 3)
        .map((rec, index) => ({ ...rec, rank: index + 1 }));
      if (recs.length > 0) return recs;
      console.error(`[Intelligence] AI alert fallback attempt ${attempt}: no usable recommendations in reply`);
    } catch (err: any) {
      console.error(`[Intelligence] AI alert fallback attempt ${attempt} failed:`, err?.message || err);
    }
  }
  return null;
}

function severityWeight(severity: RecommendationCard["severity"]): number {
  return severity === "CRITICAL" ? 3 : severity === "MEDIUM" ? 2 : 1;
}

function sortCards(cards: RecommendationCard[], query: IntelligenceQuery): RecommendationCard[] {
  const message = query.message?.toLowerCase() || "";
  return [...cards].sort((left, right) => {
    const leftBase = severityWeight(left.severity) * 100 + primarySolution(left).confidence;
    const rightBase = severityWeight(right.severity) * 100 + primarySolution(right).confidence;

    const leftCommandBoost = message && `${left.entity.name} ${primarySolution(left).title}`.toLowerCase().includes(message) ? 120 : 0;
    const rightCommandBoost = message && `${right.entity.name} ${primarySolution(right).title}`.toLowerCase().includes(message) ? 120 : 0;

    return rightBase + rightCommandBoost - (leftBase + leftCommandBoost);
  });
}

async function analyzeSinglePlatform(ctx: any, query: IntelligenceQuery, platform: "meta" | "google", analysisData: any) {
  const allProblems = detectProblemsFromScores(analysisData, platform, ctx);

  // Deduplicate problems: eliminate same issue at multiple hierarchy levels
  // Keep only the most specific/actionable version of each problem
  const dedupedProblems = deduplicateProblems(allProblems);

  // Generate recommendation cards for deduplicated problems (async — L2/L3 make real Claude calls)
  // We limit concurrency to 5 to avoid 429 Rate Limits from Anthropic in production
  const cards: any[] = [];
  const CONCURRENCY_LIMIT = 5;
  for (let i = 0; i < dedupedProblems.length; i += CONCURRENCY_LIMIT) {
    const batch = dedupedProblems.slice(i, i + CONCURRENCY_LIMIT);
    const batchResults = await Promise.all(batch.map(problem => runSolutionPipeline(problem, ctx)));
    cards.push(...batchResults);
  }

  return { problems: allProblems, dedupedProblems, cards };
}

function analysisDataForPlatform(query: IntelligenceQuery, platform: "meta" | "google") {
  const analysisData = query.analysisData || {};
  if (query.platform !== "all") return analysisData;

  const campaigns = (analysisData.campaign_audit || []).filter((item: any) => item._sourcePlatform === platform);
  return {
    campaign_audit: campaigns,
    account_pulse: analysisData.account_pulse || {},
  };
}

export async function insightsEngine(query: IntelligenceQuery): Promise<IntelligenceResult> {
  if (query.platform === "all") {
    const platformResults = await Promise.all(
      (["meta", "google"] as const).map(async (platform) => {
        const ctx = await assembleContext(query.clientId, platform, query.type, analysisDataForPlatform(query, platform));
        return { ...(await analyzeSinglePlatform(ctx, query, platform, ctx.layer2.analysisData)), ctx };
      }),
    );

    const mergedCards = sortCards(
      filterCardsForAlert(platformResults.flatMap((result) => result.cards), query.alertContext),
      query,
    );
    const tiers = splitBySeverity(mergedCards);
    const terminalResponse = buildTerminalResponse(mergedCards, query);
    let aiFallbackFailed = false;
    let recommendations = cardsToRecommendations(mergedCards, query.message);
    if (query.alertContext && mergedCards.length === 0) {
      const aiRecs = await aiRecommendationsForAlert(platformResults[0].ctx, query.alertContext);
      if (aiRecs) recommendations = aiRecs; else aiFallbackFailed = true;
    }

    return {
      insights: mergedCards.map(cardToInsight),
      recommendations,
      recommendation_tiers: tiers,
      layer_contributions: {
        problems_detected: platformResults.reduce((sum, result) => sum + result.problems.length, 0),
        l1_rules: mergedCards.filter((card) => card.layerAnalysis.l1.confidence > 0).length,
        l2_overrides: mergedCards.filter((card) => card.layerAnalysis.l1.action !== card.layerAnalysis.l2.action).length,
        l3_history_checks: mergedCards.length,
        l4_strategy_checks: mergedCards.length,
      },
      conflicts: mergedCards.flatMap((card) => card.layerAnalysis.conflicts),
      humanResponse: terminalResponse.text,
      modelUsed: "document-driven",
      ...(aiFallbackFailed ? { aiFallbackFailed } : {}),
      terminalResponse,
      trace: {
        layer1: mergedCards.map((card) => ({ id: card.id, action: card.layerAnalysis.l1.action })),
        layer2: mergedCards.map((card) => ({ id: card.id, action: card.layerAnalysis.l2.action })),
        layer3: mergedCards.map((card) => ({ id: card.id, action: card.layerAnalysis.l3.action })),
        layer4: mergedCards.map((card) => ({ id: card.id, action: card.layerAnalysis.l4.action })),
      },
    };
  }

  const ctx = await assembleContext(query.clientId, query.platform, query.type || "recommendation", query.analysisData);
  const analysisData = ctx.layer2.analysisData;
  const { problems, cards } = await analyzeSinglePlatform(ctx, query, query.platform, analysisData);
  const filteredCards = sortCards(filterCardsForAlert(cards, query.alertContext), query);
  const tiers = splitBySeverity(filteredCards);
  const terminalResponse = buildTerminalResponse(filteredCards, query);
  let aiFallbackFailed = false;
  let recommendations = cardsToRecommendations(filteredCards, query.message);
  if (query.alertContext && filteredCards.length === 0) {
    const aiRecs = await aiRecommendationsForAlert(ctx, query.alertContext);
    if (aiRecs) recommendations = aiRecs; else aiFallbackFailed = true;
  }

  return {
    insights: filteredCards.map(cardToInsight),
    recommendations,
    recommendation_tiers: tiers,
    layer_contributions: {
      problems_detected: problems.length,
      l1_rules: filteredCards.filter((card) => card.layerAnalysis.l1.confidence > 0).length,
      l2_overrides: filteredCards.filter((card) => card.layerAnalysis.l1.action !== card.layerAnalysis.l2.action).length,
      l3_history_checks: filteredCards.length,
      l4_strategy_checks: filteredCards.length,
    },
    conflicts: filteredCards.flatMap((card) => card.layerAnalysis.conflicts),
    humanResponse: terminalResponse.text,
    modelUsed: "document-driven",
    ...(aiFallbackFailed ? { aiFallbackFailed } : {}),
    terminalResponse,
    trace: {
      layer1: filteredCards.map((card) => ({ id: card.id, action: card.layerAnalysis.l1.action })),
      layer2: filteredCards.map((card) => ({ id: card.id, action: card.layerAnalysis.l2.action })),
      layer3: filteredCards.map((card) => ({ id: card.id, action: card.layerAnalysis.l3.action })),
      layer4: filteredCards.map((card) => ({ id: card.id, action: card.layerAnalysis.l4.action })),
    },
  };
}

export async function processQuery(query: IntelligenceQuery): Promise<IntelligenceResult> {
  return insightsEngine(query);
}
