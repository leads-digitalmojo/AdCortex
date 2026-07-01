import { Classification } from "./classification";

export function calculateCPL(spend: number, leads: number): number | null {
  return leads > 0 ? spend / leads : null;
}

export function calculateCPC(spend: number, clicks: number): number {
  return clicks > 0 ? spend / clicks : 0;
}

export function calculateCVR(leads: number, clicks: number): number {
  return clicks > 0 ? (leads / clicks) * 100 : 0;
}

export function calculateCTR(clicks: number, impressions: number): number {
  return impressions > 0 ? (clicks / impressions) * 100 : 0;
}

export function calculatePTR(phoneCalls: number, phoneImpressions: number): number {
  return phoneImpressions > 0 ? (phoneCalls / phoneImpressions) * 100 : 0;
}

export function calculateTSR(p25: number, impressions: number): number {
  return impressions > 0 ? (p25 / impressions) * 100 : 0;
}

export function calculateVHR(p50: number, impressions: number): number {
  return impressions > 0 ? (p50 / impressions) * 100 : 0;
}

export type IntentSignal = "HIGH" | "MEDIUM" | "LOW" | "JUNK";

export function calculateIntentSignal(term: string): IntentSignal {
  const t = term.toLowerCase();
  
  if (t.includes("rent") || t.includes("pg") || t.includes("job") || t.includes("resale") || t.includes("free") || t.includes("cheap")) {
    return "JUNK";
  }
  
  if (t.includes("sale") || t.includes("price") || t.includes("bhk") || t.includes("buy") || t.includes("cost") || t.includes("visit") || t.includes("near me")) {
    return "HIGH";
  }
  
  // This is a basic heuristic for general location (if it has more than 2 words, might be specific, but for now we look for common location suffixes)
  if (t.includes(" in ") || t.includes(" near ") || t.includes(" area") || t.includes(" city")) {
    return "MEDIUM";
  }
  
  return "LOW";
}
