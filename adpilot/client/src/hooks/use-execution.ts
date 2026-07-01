import { useState } from "react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { useClient } from "@/lib/client-context";

interface ExecuteParams {
  action: string;
  entityId: string;
  entityName: string;
  entityType: "campaign" | "adset" | "ad" | "ad_group";
  params?: Record<string, any>;
  strategicCall?: string;
}

interface ExecutionResult {
  success: boolean;
  action: string;
  entityId: string;
  entityName: string;
  entityType: string;
  previousValue?: string;
  newValue?: string;
  error?: string;
  timestamp: string;
  requestedBy: string;
  reason?: string;
}

interface BatchResult {
  results: ExecutionResult[];
  total: number;
  succeeded: number;
}

export function useExecution() {
  const [isExecuting, setIsExecuting] = useState(false);
  const [lastResult, setLastResult] = useState<ExecutionResult | null>(null);
  const { toast } = useToast();
  const { activePlatform, activeClientId } = useClient();

  async function execute(params: ExecuteParams): Promise<ExecutionResult> {
    setIsExecuting(true);
    try {
      // Route to platform-specific execution endpoint
      const endpoint = activePlatform === "google"
        ? `/api/clients/${activeClientId}/google/execute-action`
        : `/api/clients/${activeClientId}/${activePlatform}/execute-action`;
      const res = await apiRequest("POST", endpoint, {
        action: params.action,
        entityId: params.entityId,
        entityName: params.entityName,
        entityType: params.entityType,
        params: params.params,
        strategicCall: params.strategicCall,
        requestedBy: "user",
      });
      const result: ExecutionResult = await res.json();
      setLastResult(result);

      if (result.success) {
        toast({
          title: "Action Executed",
          description: `${params.action} on ${params.entityName}: ${result.previousValue} → ${result.newValue}`,
        });
        // Narrow invalidation: only refresh data for the affected client+platform, not all clients
        queryClient.invalidateQueries({ queryKey: ["/api/clients", activeClientId, activePlatform] });
        queryClient.invalidateQueries({ queryKey: ["/api/audit-log"] });
      } else {
        toast({
          title: "Execution Failed",
          description: result.error || "Unknown error",
          variant: "destructive",
        });
      }
      return result;
    } catch (err: any) {
      const errorResult: ExecutionResult = {
        success: false,
        action: params.action,
        entityId: params.entityId,
        entityName: params.entityName,
        entityType: params.entityType,
        error: err.message || "Failed to execute action",
        timestamp: new Date().toISOString(),
        requestedBy: "user",
      };
      toast({
        title: "Error",
        description: err.message || "Failed to execute action",
        variant: "destructive",
      });
      return errorResult;
    } finally {
      setIsExecuting(false);
    }
  }

  async function executeBatch(
    actions: ExecuteParams[]
  ): Promise<BatchResult> {
    setIsExecuting(true);
    try {
      const batchEndpoint = activePlatform === "google"
        ? `/api/clients/${activeClientId}/google/execute-batch`
        : `/api/clients/${activeClientId}/${activePlatform}/execute-batch`;
      const res = await apiRequest("POST", batchEndpoint, {
        actions: actions.map((a) => ({
          action: a.action,
          entityId: a.entityId,
          entityName: a.entityName,
          entityType: a.entityType,
          params: a.params,
          strategicCall: a.strategicCall,
          requestedBy: "user",
        })),
      });
      const result: BatchResult = await res.json();

      if (result.succeeded === result.total) {
        toast({
          title: "Batch Executed",
          description: `All ${result.total} actions completed successfully.`,
        });
      } else if (result.succeeded === 0) {
        toast({
          title: "Batch Failed",
          description: `All ${result.total} actions failed. Check execution log for details.`,
          variant: "destructive",
        });
      } else {
        // Partial success — use warning tone, not destructive
        const failed = result.total - result.succeeded;
        const hardFailures = result.results.filter(
          (r) => !r.success && r.error && !r.error.toLowerCase().includes("already")
        );
        toast({
          title: "Batch Partially Complete",
          description: hardFailures.length > 0
            ? `${result.succeeded}/${result.total} succeeded. ${hardFailures.length} hard failure(s) — check execution log.`
            : `${result.succeeded}/${result.total} succeeded. ${failed} already in target state.`,
          variant: hardFailures.length > 0 ? "destructive" : "default",
        });
      }

      // Narrow invalidation: only refresh affected client+platform
      queryClient.invalidateQueries({ queryKey: ["/api/clients", activeClientId, activePlatform] });
      queryClient.invalidateQueries({ queryKey: ["/api/audit-log"] });
      return result;
    } catch (err: any) {
      toast({
        title: "Batch Error",
        description: err.message || "Failed to execute batch",
        variant: "destructive",
      });
      return { results: [], total: actions.length, succeeded: 0 };
    } finally {
      setIsExecuting(false);
    }
  }

  return { execute, executeBatch, isExecuting, lastResult };
}
