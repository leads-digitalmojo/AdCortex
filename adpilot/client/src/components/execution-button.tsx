import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useExecution } from "@/hooks/use-execution";
import { useClient } from "@/lib/client-context";
import { StrategicCallDialog } from "@/components/strategic-call-dialog";
import { Loader2 } from "lucide-react";

interface ExecutionButtonProps {
  action: string;
  entityId: string;
  entityName: string;
  entityType: "campaign" | "adset" | "ad" | "ad_group";
  label?: string;
  variant?: "default" | "destructive" | "outline" | "ghost" | "secondary";
  size?: "sm" | "default" | "icon";
  params?: Record<string, any>;
  confirmMessage?: string;
  disabled?: boolean;
  onSuccess?: (result: any) => void;
  className?: string;
  icon?: React.ReactNode;
  skipDialog?: boolean;
  currentMetrics?: {
    spend?: number;
    leads?: number;
    cpl?: number;
    ctr?: number;
    impressions?: number;
    cpc?: number;
    cvr?: number;
  };
  "data-testid"?: string;
}

export function ExecutionButton({
  action,
  entityId,
  entityName,
  entityType,
  label,
  variant = "default",
  size = "sm",
  params,
  confirmMessage,
  disabled,
  onSuccess,
  className,
  icon,
  skipDialog,
  currentMetrics,
  "data-testid": testId,
}: ExecutionButtonProps) {
  const { execute, isExecuting } = useExecution();
  const { activePlatform } = useClient();
  const [dialogOpen, setDialogOpen] = useState(false);

  // Determine platform-aware action labels
  const platformLabel = activePlatform === "google" ? "Google Ads" : "Meta Ads";

  const handleExecute = async (strategicCall?: string) => {
    const result = await execute({
      action,
      entityId,
      entityName,
      entityType,
      params,
      strategicCall: strategicCall || "Immediate execution from UI control",
    });
    if (result.success && onSuccess) {
      onSuccess(result);
    }
    setDialogOpen(false);
  };

  return (
    <>
      <Button
        variant={variant}
        size={size}
        disabled={disabled || isExecuting}
        onClick={() => {
          if (skipDialog) {
            handleExecute();
          } else {
            setDialogOpen(true);
          }
        }}
        className={className}
        data-testid={testId}
      >
        {isExecuting ? (
          <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
        ) : icon ? (
          <span className="mr-1">{icon}</span>
        ) : null}
        {label}
      </Button>

      <StrategicCallDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        actionType={action}
        entityName={entityName}
        entityType={entityType}
        platform={activePlatform}
        currentMetrics={currentMetrics}
        onConfirm={handleExecute}
        isExecuting={isExecuting}
      />
    </>
  );
}
