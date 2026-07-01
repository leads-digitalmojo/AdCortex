/**
 * Format currency in Indian notation: ₹1,23,456
 */
export function formatINR(amount: number, decimals = 0): string {
  if (amount === 0) return "₹0";
  const isNeg = amount < 0;
  const abs = Math.abs(amount);
  const [intPart, decPart] = abs.toFixed(decimals).split(".");
  
  // Indian grouping: last 3 digits, then groups of 2
  let result = "";
  const len = intPart.length;
  if (len <= 3) {
    result = intPart;
  } else {
    result = intPart.slice(-3);
    let remaining = intPart.slice(0, -3);
    while (remaining.length > 2) {
      result = remaining.slice(-2) + "," + result;
      remaining = remaining.slice(0, -2);
    }
    if (remaining.length > 0) {
      result = remaining + "," + result;
    }
  }
  
  const formatted = decPart ? `${result}.${decPart}` : result;
  return `${isNeg ? "-" : ""}₹${formatted}`;
}

/**
 * Format percentage to 2 decimal places
 */
export function formatPct(value: number): string {
  return `${value.toFixed(2)}%`;
}

/**
 * Format large numbers with Indian notation (no currency symbol)
 */
export function formatNumber(num: number): string {
  if (num === 0) return "0";
  const abs = Math.abs(num);
  const intPart = Math.floor(abs).toString();
  const len = intPart.length;
  
  let result = "";
  if (len <= 3) {
    result = intPart;
  } else {
    result = intPart.slice(-3);
    let remaining = intPart.slice(0, -3);
    while (remaining.length > 2) {
      result = remaining.slice(-2) + "," + result;
      remaining = remaining.slice(0, -2);
    }
    if (remaining.length > 0) {
      result = remaining + "," + result;
    }
  }
  
  return num < 0 ? `-${result}` : result;
}

/**
 * Compact number format (1.2L, 12.5K)
 */
export function formatCompact(num: number): string {
  const abs = Math.abs(num);
  if (abs >= 10000000) return `${(num / 10000000).toFixed(1)}Cr`;
  if (abs >= 100000) return `${(num / 100000).toFixed(1)}L`;
  if (abs >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toFixed(0);
}

/**
 * Get health score color
 */
export function getHealthColor(score: number): string {
  if (score >= 85) return "text-emerald-400";
  if (score >= 70) return "text-emerald-500";
  if (score >= 40) return "text-amber-400";
  return "text-red-400";
}

export function getHealthBgColor(score: number): string {
  if (score >= 85) return "bg-emerald-400";
  if (score >= 70) return "bg-emerald-500";
  if (score >= 40) return "bg-amber-500";
  return "bg-red-500";
}

export function getHealthBarBg(score: number): string {
  if (score >= 85) return "bg-emerald-400/20";
  if (score >= 70) return "bg-emerald-500/20";
  if (score >= 40) return "bg-amber-500/20";
  return "bg-red-500/20";
}

/**
 * Mojo AdCortex status bands for weighted metric points.
 */
export type MetricStatus = "GREEN" | "YELLOW" | "ORANGE" | "RED" | "BLUE";

export function getMetricStatus(score: number, weight?: number): MetricStatus | "CRITICAL" {
  if (weight && weight > 0) {
    const ratio = score / weight;
    if (ratio >= 0.7) return "GREEN";
    if (ratio >= 0.4) return "ORANGE";
    return "CRITICAL";
  }

  if (score >= 75) return "GREEN";
  if (score >= 55) return "YELLOW";
  if (score >= 35) return "ORANGE";
  return "CRITICAL";
}

export function getMetricStatusColor(status: MetricStatus | "CRITICAL"): { bg: string; text: string; border: string } {
  switch (status) {
    case "GREEN": return { bg: "bg-emerald-500/10", text: "text-emerald-400", border: "border-emerald-500/30" };
    case "YELLOW": return { bg: "bg-amber-500/10", text: "text-amber-400", border: "border-amber-500/20" };
    case "ORANGE": return { bg: "bg-orange-500/10", text: "text-orange-400", border: "border-orange-500/20" };
    case "RED": 
    case "CRITICAL": return { bg: "bg-red-500/10", text: "text-red-400", border: "border-red-500/20" };
    case "BLUE": return { bg: "bg-blue-500/10", text: "text-blue-400", border: "border-blue-500/20" };
  }
}

/**
 * Layer badge colors
 */
export function getLayerColor(layer: string): { bg: string; text: string } {
  switch (layer?.toUpperCase()) {
    case "TOFU": return { bg: "bg-blue-500/15", text: "text-blue-400" };
    case "MOFU": return { bg: "bg-purple-500/15", text: "text-purple-400" };
    case "BOFU": return { bg: "bg-orange-500/15", text: "text-orange-400" };
    default: return { bg: "bg-gray-500/15", text: "text-gray-400" };
  }
}

/**
 * Status badge colors
 */
export function getStatusColor(status: string): { bg: string; text: string } {
  switch (status?.toUpperCase()) {
    case "ACTIVE": return { bg: "bg-emerald-500/15", text: "text-emerald-400" };
    case "PAUSED": return { bg: "bg-gray-500/15", text: "text-gray-400" };
    case "ERROR": return { bg: "bg-red-500/15", text: "text-red-400" };
    default: return { bg: "bg-gray-500/15", text: "text-gray-400" };
  }
}

/**
 * Trend arrow with color
 */
export function getTrendInfo(trend: string, isInverse = false): { arrow: string; color: string } {
  const up = trend === "UP";
  const isGood = isInverse ? !up : up;
  return {
    arrow: up ? "↑" : "↓",
    color: isGood ? "text-emerald-400" : "text-red-400",
  };
}

/**
 * Get CPL color using live benchmarks
 */
export function getCplColorWithBenchmarks(
  cpl: number,
  benchmarks?: { cpl_target?: number; cpl_alert?: number; cpl_critical?: number; cpl?: number }
): string {
  if (!benchmarks) return "text-foreground";
  const target = benchmarks.cpl_target ?? benchmarks.cpl ?? 800;
  const alert = benchmarks.cpl_alert ?? target * 1.25;
  const critical = benchmarks.cpl_critical ?? target * 1.5;

  if (cpl <= target) return "text-emerald-400";
  if (cpl <= alert) return "text-amber-400";
  return "text-red-400";
}

/**
 * Legacy wrapper for getCplColorWithBenchmarks
 */
export function getCplColor(cpl: number, thresholds?: any): string {
  return getCplColorWithBenchmarks(cpl, thresholds);
}

/**
 * Get classification badge colors
 */
export function getClassificationColor(classification: string): { bg: string; text: string } {
  switch (classification?.toUpperCase()) {
    case "GREEN": return { bg: "bg-emerald-500/15", text: "text-emerald-600" };
    case "YELLOW": return { bg: "bg-amber-500/15", text: "text-amber-600" };
    case "ORANGE": return { bg: "bg-orange-500/15", text: "text-orange-600" };
    case "RED": 
    case "CRITICAL":
    case "ALERT":
    case "POOR":
    case "UNDERPERFORMER": return { bg: "bg-red-500/10", text: "text-red-700" };
    case "WINNER": return { bg: "bg-emerald-500/15", text: "text-emerald-600" };
    case "WATCH": return { bg: "bg-amber-500/15", text: "text-amber-600" };
    case "NEW": return { bg: "bg-blue-500/15", text: "text-blue-600" };
    default: return { bg: "bg-gray-500/15", text: "text-gray-600" };
  }
}

/**
 * Get learning status badge colors
 */
export function getLearningStatusColor(status: string): { bg: string; text: string } {
  if (status === "LEARNING_LIMITED") return { bg: "bg-red-500/15", text: "text-red-400" };
  return { bg: "bg-emerald-500/15", text: "text-emerald-400" };
}

/**
 * Get video metric color (TSR, VHR, FFR)
 */
export function getVideoMetricColor(metric: "tsr" | "vhr" | "ffr", value: number): string {
  switch (metric) {
    case "tsr": // Thumb Stop Rate
      if (value < 25) return "text-red-400";
      if (value < 35) return "text-amber-400";
      return "text-emerald-400";
    case "vhr": // Video Hold Rate
      if (value < 40) return "text-red-400";
      if (value < 55) return "text-amber-400";
      return "text-emerald-400";
    case "ffr": // First Frame Rate
      if (value < 80) return "text-red-400";
      if (value < 90) return "text-amber-400";
      return "text-emerald-400";
    default:
      return "text-foreground";
  }
}

/**
 * Get CTR color (hardcoded fallback - prefer getCtrColorWithBenchmarks)
 */
export function getCtrColor(ctr: number): string {
  if (ctr < 0.4) return "text-red-400";
  if (ctr < 0.7) return "text-amber-400";
  if (ctr >= 1.0) return "text-emerald-400";
  return "text-foreground";
}

/**
 * Get CTR color using live benchmarks
 */
export function getCtrColorWithBenchmarks(
  ctr: number,
  benchmarks?: { ctr_target?: number; ctr_alert?: number; ctr_critical?: number }
): string {
  if (!benchmarks) return getCtrColor(ctr);
  
  const target = benchmarks.ctr_target ?? 1.0;
  const alert = benchmarks.ctr_alert ?? target * 0.7;
  const critical = benchmarks.ctr_critical ?? target * 0.4;
  
  if (ctr < critical) return "text-red-400";
  if (ctr < alert) return "text-amber-400";
  if (ctr >= target) return "text-emerald-400";
  return "text-foreground";
}

/**
 * Get frequency color (hardcoded fallback - prefer getFrequencyColorWithBenchmarks)
 */
export function getFrequencyColor(freq: number): string {
  if (freq > 2.5) return "text-red-400";
  if (freq > 1.8) return "text-amber-400";
  return "text-emerald-400";
}

/**
 * Get frequency color using live benchmarks
 */
export function getFrequencyColorWithBenchmarks(
  freq: number,
  benchmarks?: { frequency_warn?: number; frequency_severe?: number; freq_warn?: number; freq_severe?: number }
): string {
  if (!benchmarks) return getFrequencyColor(freq);
  
  const warn = benchmarks.frequency_warn ?? benchmarks.freq_warn ?? 1.8;
  const severe = benchmarks.frequency_severe ?? benchmarks.freq_severe ?? 2.5;
  
  if (freq > severe) return "text-red-400";
  if (freq > warn) return "text-amber-400";
  return "text-emerald-400";
}

/**
 * Get CPM color against benchmarks
 */
export function getCpmColor(cpm: number, benchmarks?: { cpm_ideal_high?: number; cpm_alert?: number }): string {
  if (!benchmarks) return "text-foreground";
  if (cpm > (benchmarks.cpm_alert || 500)) return "text-red-400";
  if (cpm > (benchmarks.cpm_ideal_high || 300)) return "text-amber-400";
  return "text-foreground";
}

/**
 * Truncate text
 */
export function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + "…";
}

/**
 * Format relative time
 */
export function timeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  const diffDays = Math.floor(diffHrs / 24);
  return `${diffDays}d ago`;
}
