import { useEffect, useRef } from "react";
import { queryClient } from "@/lib/queryClient";

/**
 * SSE hook that listens for live server events and invalidates
 * React Query caches when data is refreshed (e.g., after scheduler run).
 * Reconnects automatically on connection loss.
 */
export function useLiveUpdates() {
  const esRef = useRef<EventSource | null>(null);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let disposed = false;

    function connect() {
      if (disposed) return;

      const es = new EventSource("/api/events");
      esRef.current = es;

      const invalidateSyncState = () => {
        queryClient.invalidateQueries({
          predicate: (query) =>
            Array.isArray(query.queryKey) && query.queryKey.includes("sync-state"),
        });
      };

      const invalidateAnalysis = () => {
        queryClient.invalidateQueries({
          predicate: (query) =>
            Array.isArray(query.queryKey) && (query.queryKey.includes("analysis") || query.queryKey.includes("sync-state")),
        });
      };

      es.addEventListener("data-refreshed", () => {
        console.log("[SSE] Data refreshed - invalidating analysis queries");
        invalidateAnalysis();
      });

      es.addEventListener("agent-run-started", () => {
        invalidateSyncState();
        console.log("[SSE] Agent run started");
      });

      es.addEventListener("agent-run-failed", (e) => {
        invalidateSyncState();
        console.warn("[SSE] Agent run failed:", e.data);
      });

      es.onerror = () => {
        es.close();
        esRef.current = null;
        if (!disposed) {
          retryTimeoutRef.current = setTimeout(connect, 3000);
        }
      };
    }

    connect();

    return () => {
      disposed = true;
      esRef.current?.close();
      esRef.current = null;
      if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);
    };
  }, []);
}
