import { useMemo } from "react";
import { useClient } from "@/lib/client-context";

export interface MetaBenchmarks {
  // Primary targets
  cplTarget: number;
  cpmTarget: number;
  ctrTarget: number;
  cvrTarget: number;
  
  // Thresholds for color coding
  cplAlert: number;
  cplCritical: number;
  cpmAlert: number;
  cpmCritical: number;
  ctrAlert: number;
  ctrCritical: number;
  cvrAlert: number;
  cvrCritical: number;
  
  // Frequency thresholds
  frequencyWarn: number;
  frequencySevere: number;

  // New primary targets
  cpsvTarget: number;
  cpqlTarget: number;
  budgetTarget: number;
  leadsTarget: number;

  // Raw benchmark data
  raw: Record<string, any>;
  isLoading: boolean;
}

/**
 * Hook to get centralized Meta benchmarks
 * Ensures all components use the same live benchmark values
 */
export function useMetaBenchmarks(): MetaBenchmarks {
  const { benchmarks, isLoadingBenchmarks, activePlatform } = useClient();

  return useMemo(() => {
    // Benchmarks are returned as a flat object from the API for the current platform.
    // DO NOT try to access benchmarks["meta"] or benchmarks["google"] — they don't exist.
    const b = (benchmarks as any) || {};

    // CPL thresholds
    const cplTarget = b.cpl_target ?? b.cpl ?? (activePlatform === "google" ? 1500 : 800);
    const cplAlert = b.cpl_alert ?? cplTarget * 1.25;
    const cplCritical = b.cpl_critical ?? b.cpl_max ?? cplTarget * 1.5;

    // CPM thresholds
    const cpmTarget = b.cpm_target ?? b.cpm_max ?? (activePlatform === "google" ? 400 : 300);
    const cpmAlert = b.cpm_alert ?? cpmTarget * 1.3;
    const cpmCritical = b.cpm_critical ?? cpmTarget * 1.8;

    // CTR thresholds (as percentages)
    const ctrTarget = b.ctr_min ?? b.ctr_target ?? b.ctr ?? (activePlatform === "google" ? 0.8 : 1.0);
    const ctrAlert = b.ctr_alert ?? ctrTarget * 0.7;
    const ctrCritical = b.ctr_critical ?? ctrTarget * 0.4;

    // CVR thresholds (as percentages)
    const cvrTarget = b.cvr_min ?? b.cvr_target ?? b.cvr ?? (activePlatform === "google" ? 1.5 : 2.0);
    const cvrAlert = b.cvr_alert ?? cvrTarget * 0.6;
    const cvrCritical = b.cvr_critical ?? cvrTarget * 0.3;

    // Frequency thresholds
    const frequencyWarn = b.frequency_max ?? b.frequency_warn ?? b.freq_warn ?? 1.8;
    const frequencySevere = b.frequency_severe ?? b.freq_severe ?? frequencyWarn * 1.5;

    // Cost-per-visit & quality lead targets
    const cpsvTarget = b.cpsv_low ?? b.cpsv_target_low ?? 0;
    const cpqlTarget = b.cpql_target ?? b.cpql ?? 1500;

    // Budget & lead volume targets
    const budgetTarget = b.budget ?? 0;
    const leadsTarget = b.leads ?? 0;

    return {
      cplTarget,
      cpmTarget,
      ctrTarget,
      cvrTarget,
      cplAlert,
      cplCritical,
      cpmAlert,
      cpmCritical,
      ctrAlert,
      ctrCritical,
      cvrAlert,
      cvrCritical,
      frequencyWarn,
      frequencySevere,
      cpsvTarget,
      cpqlTarget,
      budgetTarget,
      leadsTarget,
      raw: b,
      isLoading: isLoadingBenchmarks,
    };
  }, [benchmarks, isLoadingBenchmarks, activePlatform]);
}

/**
 * Get dynamic thresholds in the format expected by getCplColor
 */
export function useDynamicThresholds() {
  const benchmarks = useMetaBenchmarks();
  
  return useMemo(() => ({
    cpl_target: benchmarks.cplTarget,
    cpl_alert: benchmarks.cplAlert,
    cpl_critical: benchmarks.cplCritical,
  }), [benchmarks.cplTarget, benchmarks.cplAlert, benchmarks.cplCritical]);
}
