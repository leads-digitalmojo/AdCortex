import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

export interface PausedEntityInfo {
  entityName: string;
  entityType: string;
  pausedAt: string;
  reason?: string;
}

/**
 * Returns a map of entityId → PausedEntityInfo for all entities
 * that have been paused via the execution engine.
 * Refreshes on every query invalidation (e.g. after a new execution).
 */
export function usePausedEntities() {
  const { data: pausedMap = {}, isLoading } = useQuery<Record<string, PausedEntityInfo>>({
    queryKey: ["/api/paused-entities"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/paused-entities");
      return res.json();
    },
    refetchInterval: 30_000, // Refresh every 30s
  });

  function isPaused(entityId: string): boolean {
    return entityId in pausedMap;
  }

  function getPausedInfo(entityId: string): PausedEntityInfo | undefined {
    return pausedMap[entityId];
  }

  return { pausedMap, isPaused, getPausedInfo, isLoading };
}
