export type IntelligencePlatform = "meta" | "google";

export interface EntityMetricScore {
  key: string;
  label: string;
  score: number;
  value?: number | null;
  weight?: number;
  category: "kpi" | "supporting" | "strategic";
}

export interface RootCauseStep {
  metric: string;
  label: string;
  score: number;
  value?: number | null;
  status: "WEAK" | "HEALTHY" | "SYMPTOM";
  diagnosis: string;
}

export interface RootCauseTrace {
  chain: RootCauseStep[];
  primaryMetric: string;
  primaryLabel: string;
  summary: string;
  brokenMetricCount: number;
}

const META_COST_CHAIN = ["cpm", "ctr", "cpc", "cvr", "cpl"] as const;
const GOOGLE_COST_CHAIN = ["cpc", "ctr", "cvr", "cpl"] as const;

const DIAGNOSIS_BY_METRIC: Record<string, string> = {
  cpm: "Supply cost problem: audience is too competitive, placements are expensive, or bidding is too aggressive.",
  ctr: "Creative relevance problem: the ad is not resonating with the audience or the audience is mismatched.",
  cpc: "Click cost problem: expensive reach plus weak engagement is inflating click costs.",
  cvr: "Conversion problem: landing page friction, form friction, or intent mismatch is blocking conversions.",
  cpl: "CPL is the symptom, not the root cause. An upstream break in the cost stack is driving inefficient leads.",
  leads: "Lead volume problem: the entity is not producing enough outcome even if traffic is arriving.",
  budget: "Budget pacing problem: spend is materially off plan and delivery pressure is building.",
  cpsv: "Traffic acquisition problem: site visits are too expensive against target efficiency.",
  cpql: "Qualified-lead cost problem: efficiency on qualified outcomes has broken down.",
  freq: "Audience fatigue problem: the audience is seeing the same creative too often.",
  frequency: "Audience fatigue problem: the audience is seeing the same creative too often.",
  qs: "Quality Score problem: keyword, ad, and landing page relevance are dragging search efficiency.",
  quality_score: "Quality Score problem: keyword, ad, and landing page relevance are dragging search efficiency.",
  is: "Impression share problem: budget limits are preventing the campaign from capturing demand.",
  creative_age: "Creative fatigue problem: an aged creative is carrying too much spend and likely losing resonance.",
};

function normalizeMetricKey(metric: string): string {
  const key = metric.toLowerCase();
  if (key === "frequency") return "freq";
  if (key === "quality_score") return "qs";
  return key;
}

function getMetric(entityMetrics: EntityMetricScore[], metric: string): EntityMetricScore | undefined {
  const normalized = normalizeMetricKey(metric);
  return entityMetrics.find((item) => normalizeMetricKey(item.key) === normalized);
}

function chainFor(platform: IntelligencePlatform): readonly string[] {
  return platform === "google" ? GOOGLE_COST_CHAIN : META_COST_CHAIN;
}

export function traceRootCause(
  entityMetrics: EntityMetricScore[],
  platform: IntelligencePlatform,
  kpiMetric: string,
): RootCauseTrace {
  const normalizedKpi = normalizeMetricKey(kpiMetric);

  if (!["cpl", "cpsv", "cpql"].includes(normalizedKpi)) {
    const metric = getMetric(entityMetrics, normalizedKpi);
    const label = metric?.label || normalizedKpi.toUpperCase();
    return {
      chain: [
        {
          metric: normalizedKpi,
          label,
          score: metric?.score ?? 0,
          value: metric?.value,
          status: "SYMPTOM",
          diagnosis: DIAGNOSIS_BY_METRIC[normalizedKpi] || `${label} is the primary weak KPI.`,
        },
      ],
      primaryMetric: normalizedKpi,
      primaryLabel: label,
      summary: DIAGNOSIS_BY_METRIC[normalizedKpi] || `${label} is the primary weak KPI.`,
      brokenMetricCount: metric && metric.score < 60 ? 1 : 0,
    };
  }

  const chainKeys = chainFor(platform);
  const steps: RootCauseStep[] = chainKeys.map((metricKey) => {
    const metric = getMetric(entityMetrics, metricKey);
    const isSymptom = metricKey === "cpl";
    const score = metric?.score ?? (isSymptom ? 0 : 100);
    return {
      metric: metricKey,
      label: metric?.label || metricKey.toUpperCase(),
      score,
      value: metric?.value,
      status: isSymptom ? "SYMPTOM" : score < 60 ? "WEAK" : "HEALTHY",
      diagnosis: DIAGNOSIS_BY_METRIC[metricKey],
    };
  });

  const brokenUpstream = steps.filter((step) => step.metric !== "cpl" && step.score < 60);
  const primary = brokenUpstream[0] || steps.find((step) => step.metric === "cpl") || steps[steps.length - 1];

  return {
    chain: steps,
    primaryMetric: primary.metric,
    primaryLabel: primary.label,
    summary: primary.diagnosis,
    brokenMetricCount: brokenUpstream.length,
  };
}
