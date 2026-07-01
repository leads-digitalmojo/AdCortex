/**
 * Command Terminal — GPT-style natural language command interface
 *
 * A right-side slide-in panel that lets users type natural language commands
 * like "pause bad campaigns" and see structured AI responses + execution results.
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { useClient } from "@/lib/client-context";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Terminal,
  X,
  Send,
  Bot,
  User,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronRight,
  Zap,
  Play,
  ClipboardCheck,
  Ban,
  Layers,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────

interface ExecutionOutcome {
  campaignId: string;
  campaignName: string;
  action: string;
  success: boolean;
  message: string;
  previousValue?: any;
  newValue?: any;
}

interface ActionPlan {
  intent: string;
  platform: string;
  filters: any[];
  action: { type: string; parameters: Record<string, any> };
  execution_plan: string[];
  strategic_rationale: string;
  risk_checks: string[];
}

interface AICommandResponse {
  humanResponse: string;
  actionJson: ActionPlan | null;
  executionResults: ExecutionOutcome[];
  safetyWarnings: string[];
  requiresConfirmation: boolean;
  terminalResponse?: {
    diagnosis: string[];
    layerAnalysis: string[];
    solutions: string[];
    expectedOutcome: string[];
    text: string;
  };
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  response?: AICommandResponse;
  loading?: boolean;
}

// ─── Execution Results Card ───────────────────────────────────────

function ExecutionResultCard({
  results,
  warnings,
}: {
  results: ExecutionOutcome[];
  warnings: string[];
}) {
  const [expanded, setExpanded] = useState(false);
  const succeeded = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  if (results.length === 0 && warnings.length === 0) return null;

  return (
    <div className="mt-2 rounded-lg border border-border/40 bg-background/50 text-xs overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-muted/30 transition-colors"
      >
        <div className="flex items-center gap-2">
          {succeeded > 0 && (
            <span className="flex items-center gap-1 text-emerald-500">
              <CheckCircle2 className="w-3 h-3" /> {succeeded} succeeded
            </span>
          )}
          {failed > 0 && (
            <span className="flex items-center gap-1 text-red-400">
              <XCircle className="w-3 h-3" /> {failed} failed
            </span>
          )}
          {warnings.length > 0 && (
            <span className="flex items-center gap-1 text-amber-400">
              <AlertTriangle className="w-3 h-3" /> {warnings.length} warnings
            </span>
          )}
        </div>
        {expanded ? (
          <ChevronDown className="w-3 h-3 text-muted-foreground" />
        ) : (
          <ChevronRight className="w-3 h-3 text-muted-foreground" />
        )}
      </button>

      {expanded && (
        <div className="border-t border-border/30 px-3 py-2 space-y-1.5">
          {results.map((r, i) => (
            <div key={i} className="flex items-start gap-2">
              {r.success ? (
                <CheckCircle2 className="w-3 h-3 text-emerald-500 mt-0.5 shrink-0" />
              ) : (
                <XCircle className="w-3 h-3 text-red-400 mt-0.5 shrink-0" />
              )}
              <div>
                <span className="font-medium text-foreground/80">{r.campaignName}</span>
                <span className="text-muted-foreground ml-1">— {r.message}</span>
                {r.previousValue !== undefined && r.newValue !== undefined && (
                  <div className="text-muted-foreground mt-0.5">
                    {JSON.stringify(r.previousValue)} → {JSON.stringify(r.newValue)}
                  </div>
                )}
              </div>
            </div>
          ))}
          {warnings.map((w, i) => (
            <div key={`w-${i}`} className="flex items-start gap-2 text-amber-400/80">
              <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
              <span>{w}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Action Plan Chip ─────────────────────────────────────────────

function ActionPlanChip({ actionJson }: { actionJson: ActionPlan }) {
  const typeColor: Record<string, string> = {
    pause: "bg-red-500/15 text-red-400 border-red-500/25",
    scale: "bg-emerald-500/15 text-emerald-400 border-emerald-500/25",
    adjust_budget: "bg-blue-500/15 text-blue-400 border-blue-500/25",
    unpause: "bg-emerald-500/15 text-emerald-400 border-emerald-500/25",
    clarify: "bg-amber-500/15 text-amber-400 border-amber-500/25",
  };
  const color =
    typeColor[actionJson.action.type] || "bg-muted text-muted-foreground border-border";

  return (
    <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
      <Badge
        variant="outline"
        className={cn("text-xs px-1.5 py-0 border font-mono uppercase tracking-wide", color)}
      >
        {actionJson.action.type}
      </Badge>
    </div>
  );
}

// ─── Diagnosis Mini-Card ──────────────────────────────────────────

function DiagnosisCard({ lines }: { lines: string[] }) {
  if (!lines.length) return null;

  // Parse entity line and data points from diagnosis lines
  const entityLine = lines.find((l) => l.startsWith("Entity:"));
  const problemLine = lines.find((l) => l.startsWith("Problem:"));
  const dataLine = lines.find((l) => l.startsWith("Data:"));
  const additionalLines = lines.filter(
    (l) =>
      !l.startsWith("Entity:") &&
      !l.startsWith("Problem:") &&
      !l.startsWith("Data:"),
  );

  // Parse score from entity line: "Entity: X | Score: Y/100 | Classification: Z"
  let entityName = "";
  let score: number | null = null;
  let classification = "";
  if (entityLine) {
    const parts = entityLine.replace("Entity: ", "").split(" | ");
    entityName = parts[0] || "";
    const scorePart = parts.find((p) => p.startsWith("Score:"));
    if (scorePart) score = parseFloat(scorePart.replace("Score: ", "").split("/")[0]);
    const classPart = parts.find((p) => p.startsWith("Classification:"));
    if (classPart) classification = classPart.replace("Classification: ", "");
  }

  const classificationColor =
    classification.toUpperCase() === "WINNER"
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300"
      : classification.toUpperCase() === "UNDERPERFORMER"
      ? "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-300"
      : "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-300";

  const scoreColor =
    score !== null
      ? score >= 70
        ? "text-emerald-500"
        : score >= 40
        ? "text-amber-500"
        : "text-red-500"
      : "text-muted-foreground";

  return (
    <div className="rounded-lg border border-border/30 bg-background/40 p-2.5 space-y-2">
      {entityLine && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[12px] font-semibold text-foreground">{entityName}</span>
          {score !== null && (
            <span className={cn("text-[11px] font-bold", scoreColor)}>
              {score.toFixed(1)}/100
            </span>
          )}
          {classification && (
            <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0 font-bold uppercase", classificationColor)}>
              {classification}
            </Badge>
          )}
        </div>
      )}
      {problemLine && (
        <p className="text-[12px] leading-relaxed text-foreground/90">
          {problemLine.replace("Problem: ", "")}
        </p>
      )}
      {dataLine && (
        <p className="text-[11px] text-muted-foreground">
          {dataLine.replace("Data: ", "")}
        </p>
      )}
      {additionalLines.map((line, i) => (
        <p key={i} className="text-[11px] leading-relaxed text-foreground/75">
          {line}
        </p>
      ))}
    </div>
  );
}

// ─── Layer Analysis Pills ─────────────────────────────────────────

function LayerAnalysisPills({ lines }: { lines: string[] }) {
  if (!lines.length) return null;

  const layerStatus = (line: string): "ok" | "caution" | "conflict" => {
    const lower = line.toLowerCase();
    if (lower.includes("conflict") || lower.includes("override") || lower.includes("block")) {
      return "conflict";
    }
    if (lower.includes("caution") || lower.includes("warning") || lower.includes("cooldown")) {
      return "caution";
    }
    return "ok";
  };

  const layerLines = lines.filter((l) => /^L[1-4]/.test(l));
  const conflictLines = lines.filter((l) => l.toUpperCase().startsWith("CONFLICTS:"));
  const otherLines = lines.filter((l) => !/^L[1-4]/.test(l) && !l.toUpperCase().startsWith("CONFLICTS:"));

  const statusClass = {
    ok: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border-emerald-500/30",
    caution: "bg-amber-500/15 text-amber-600 dark:text-amber-300 border-amber-500/30",
    conflict: "bg-red-500/15 text-red-600 dark:text-red-300 border-red-500/30",
  };

  return (
    <div className="space-y-2">
      {/* Layer status pills */}
      {layerLines.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {layerLines.map((line, i) => {
            const status = layerStatus(line);
            const label = line.match(/^(L[1-4][^:]*)/)?.[1] || `L${i + 1}`;
            return (
              <span
                key={i}
                title={line}
                className={cn(
                  "inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border cursor-help",
                  statusClass[status],
                )}
              >
                {label.split(" ")[0]}
                {status === "ok" ? "✓" : status === "caution" ? "⚠" : "✗"}
              </span>
            );
          })}
        </div>
      )}

      {/* Full layer lines */}
      {layerLines.map((line, i) => (
        <p key={i} className="text-[12px] leading-relaxed text-foreground/90 whitespace-pre-wrap">
          {line}
        </p>
      ))}

      {/* Conflicts — highlighted */}
      {conflictLines.map((line, i) => (
        <div key={`conflict-${i}`} className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5">
          <div className="flex items-center gap-1.5 mb-1">
            <AlertTriangle className="w-3 h-3 text-amber-500 shrink-0" />
            <span className="text-[10px] font-bold uppercase tracking-wide text-amber-600 dark:text-amber-400">
              Conflict
            </span>
          </div>
          <p className="text-[12px] leading-relaxed text-foreground/90">
            {line.replace(/^CONFLICTS:\s*/i, "")}
          </p>
        </div>
      ))}

      {/* Other lines */}
      {otherLines.map((line, i) => (
        <p key={`other-${i}`} className="text-[12px] leading-relaxed text-foreground/75">
          {line}
        </p>
      ))}
    </div>
  );
}

// ─── Solution Mini-Card ───────────────────────────────────────────

function SolutionMiniCard({ line }: { line: string }) {
  const isAutoExecute = line.includes("[AUTO-EXECUTE]");
  const isManual = line.includes("[MANUAL]");
  const isReject = line.includes("[REJECT") || line.includes("[REJECT-SUGGESTED]");

  const classification = isAutoExecute ? "AUTO-EXECUTE" : isManual ? "MANUAL" : isReject ? "REJECT" : null;

  const classStyle = {
    "AUTO-EXECUTE": {
      badge: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
      card: "border-emerald-500/20 bg-emerald-500/5",
      btn: "bg-emerald-600 hover:bg-emerald-700 text-white",
      icon: <Play className="w-2.5 h-2.5" />,
      btnLabel: "Execute Now",
    },
    MANUAL: {
      badge: "border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-300",
      card: "border-blue-500/20 bg-blue-500/5",
      btn: "bg-blue-600 hover:bg-blue-700 text-white",
      icon: <ClipboardCheck className="w-2.5 h-2.5" />,
      btnLabel: "Mark as Done",
    },
    REJECT: {
      badge: "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-300",
      card: "border-red-500/20 bg-red-500/5",
      btn: "bg-red-600 hover:bg-red-700 text-white",
      icon: <Ban className="w-2.5 h-2.5" />,
      btnLabel: "Confirm Reject",
    },
  } as const;

  const style = classification ? classStyle[classification] : null;

  // Parse lines within this solution block
  const rawLines = line.split("\n");
  const titleLine = rawLines[0];
  const subLines = rawLines.slice(1);

  const [rationaleExpanded, setRationaleExpanded] = useState(false);
  const [actionTriggered, setActionTriggered] = useState(false);
  const [showRationale, setShowRationale] = useState(false);

  const handleAction = () => {
    setActionTriggered(true);
    setShowRationale(true);
  };

  return (
    <div
      className={cn(
        "rounded-lg border p-2.5 space-y-1.5",
        style?.card || "border-border/30 bg-background/30",
      )}
    >
      <div className="flex items-center gap-2 flex-wrap">
        {classification && style && (
          <Badge variant="outline" className={cn("text-[10px] font-black uppercase tracking-wide px-1.5 py-0", style.badge)}>
            {classification}
          </Badge>
        )}
        <span className="text-[12px] font-semibold text-foreground leading-tight">
          {titleLine
            .replace(/\[AUTO-EXECUTE\]/g, "")
            .replace(/\[MANUAL\]/g, "")
            .replace(/\[REJECT-SUGGESTED\]/g, "")
            .replace(/\[REJECT\]/g, "")
            .trim()}
        </span>
      </div>

      {subLines.map((sub, i) => {
        if (!sub.trim()) return null;
        const isRationale = sub.trim().startsWith("Rationale:");
        const isRisk = sub.trim().startsWith("Risk:");
        const isSteps = sub.trim().match(/^\d+\)/);
        return (
          <p
            key={i}
            className={cn(
              "text-[11px] leading-relaxed whitespace-pre-wrap",
              isRationale ? "text-foreground/80" : isRisk ? "text-muted-foreground font-medium" : isSteps ? "text-foreground/75 pl-2" : "text-foreground/75",
            )}
          >
            {sub}
          </p>
        );
      })}

      {/* Tri-state execution button */}
      {classification && style && !actionTriggered && (
        <button
          onClick={handleAction}
          className={cn(
            "mt-1.5 flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-bold uppercase tracking-wide transition-colors",
            style.btn,
          )}
        >
          {style.icon}
          {style.btnLabel}
        </button>
      )}

      {/* Strategic rationale prompt */}
      {showRationale && (
        <div className="mt-2 rounded-md border border-border/40 bg-muted/30 p-2">
          <p className="text-[11px] text-muted-foreground mb-1.5 font-medium">
            {classification === "REJECT" ? "Why are you rejecting this?" : "Add strategic rationale (optional):"}
          </p>
          <textarea
            className="w-full text-[11px] bg-background/60 border border-border/40 rounded p-1.5 text-foreground placeholder:text-muted-foreground outline-none resize-none"
            rows={2}
            placeholder={
              classification === "REJECT"
                ? "e.g. This campaign is needed for brand presence during launch…"
                : "e.g. Scaling ahead of festive season to capture demand…"
            }
          />
          <button
            onClick={() => { setActionTriggered(true); setShowRationale(false); }}
            className="mt-1.5 text-[11px] font-bold text-violet-600 dark:text-violet-400 hover:underline"
          >
            Confirm
          </button>
        </div>
      )}

      {actionTriggered && !showRationale && (
        <p className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
          ✓ Logged
        </p>
      )}
    </div>
  );
}

// ─── Enhanced Terminal Section ────────────────────────────────────

function TerminalSection({
  title,
  lines,
  sectionIndex,
}: {
  title: string;
  lines: string[];
  sectionIndex: number;
}) {
  if (!lines.length) return null;

  const sectionColors = [
    "text-violet-500 dark:text-violet-400",  // 1. Diagnosis
    "text-blue-500 dark:text-blue-400",       // 2. Layer Analysis
    "text-emerald-500 dark:text-emerald-400", // 3. Solutions
    "text-amber-500 dark:text-amber-400",     // 4. Expected Outcome
  ];
  const color = sectionColors[sectionIndex] || "text-violet-400";

  // Solutions section gets special rendering
  if (sectionIndex === 2) {
    // Group lines into solution blocks
    const solutionBlocks: string[][] = [];
    let currentBlock: string[] = [];
    for (const line of lines) {
      if (line.startsWith("---") && currentBlock.length > 0) {
        solutionBlocks.push(currentBlock);
        currentBlock = [line];
      } else if (/^\[(?:AUTO-EXECUTE|MANUAL|REJECT)/.test(line) && currentBlock.length > 0) {
        solutionBlocks.push(currentBlock);
        currentBlock = [line];
      } else {
        currentBlock.push(line);
      }
    }
    if (currentBlock.length) solutionBlocks.push(currentBlock);

    return (
      <div className="rounded-xl border border-border/30 bg-background/40 px-3 py-2">
        <p className={cn("text-[11px] font-black uppercase tracking-[0.16em] mb-2", color)}>
          {title}
        </p>
        <div className="space-y-2">
          {solutionBlocks.map((block, i) => {
            const blockText = block.join("\n");
            if (blockText.startsWith("---")) {
              return (
                <p key={i} className="text-[11px] font-bold text-muted-foreground pt-1">
                  {blockText.replace(/^---\s*/, "")}
                </p>
              );
            }
            return <SolutionMiniCard key={i} line={blockText} />;
          })}
        </div>
      </div>
    );
  }

  // Diagnosis section gets mini-card rendering
  if (sectionIndex === 0) {
    return (
      <div className="rounded-xl border border-border/30 bg-background/40 px-3 py-2">
        <p className={cn("text-[11px] font-black uppercase tracking-[0.16em] mb-2", color)}>
          {title}
        </p>
        <DiagnosisCard lines={lines} />
      </div>
    );
  }

  // Layer Analysis section gets pill rendering
  if (sectionIndex === 1) {
    return (
      <div className="rounded-xl border border-border/30 bg-background/40 px-3 py-2">
        <p className={cn("text-[11px] font-black uppercase tracking-[0.16em] mb-2", color)}>
          {title}
        </p>
        <LayerAnalysisPills lines={lines} />
      </div>
    );
  }

  // Default (Expected Outcome)
  return (
    <div className="rounded-xl border border-border/30 bg-background/40 px-3 py-2">
      <p className={cn("text-[11px] font-black uppercase tracking-[0.16em] mb-2", color)}>
        {title}
      </p>
      <div className="space-y-1.5">
        {lines.map((line, index) => {
          const isIfAction = line.toLowerCase().startsWith("if actions");
          const isIfNoAction = line.toLowerCase().startsWith("if no action");
          return (
            <p
              key={`${title}-${index}`}
              className={cn(
                "text-[12px] leading-relaxed whitespace-pre-wrap",
                isIfAction
                  ? "text-emerald-600 dark:text-emerald-400 font-medium"
                  : isIfNoAction
                  ? "text-amber-600 dark:text-amber-400 font-medium"
                  : "text-foreground/90",
              )}
            >
              {line}
            </p>
          );
        })}
      </div>
    </div>
  );
}

function formatHumanResponse(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

// ─── Message Bubble ───────────────────────────────────────────────

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";
  const terminalResponse = message.response?.terminalResponse;
  const hasStructuredResponse =
    terminalResponse &&
    (terminalResponse.diagnosis.length > 0 ||
      terminalResponse.layerAnalysis.length > 0 ||
      terminalResponse.solutions.length > 0);

  return (
    <div className={cn("flex gap-2.5", isUser ? "flex-row-reverse" : "flex-row")}>
      {/* Avatar */}
      <div
        className={cn(
          "flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center mt-0.5",
          isUser ? "bg-primary/20 text-primary" : "bg-violet-500/20 text-violet-400",
        )}
      >
        {isUser ? <User className="w-3.5 h-3.5" /> : <Bot className="w-3.5 h-3.5" />}
      </div>

      {/* Content */}
      <div className={cn("flex-1 min-w-0", isUser ? "items-end" : "items-start", "flex flex-col")}>
        {message.loading ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm px-3 py-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-violet-400" />
            <span className="text-xs">
              Running 4-layer analysis pipeline
              <span className="inline-flex gap-0.5 ml-1">
                <span className="animate-bounce [animation-delay:0ms]">.</span>
                <span className="animate-bounce [animation-delay:150ms]">.</span>
                <span className="animate-bounce [animation-delay:300ms]">.</span>
              </span>
            </span>
          </div>
        ) : (
          <div
            className={cn(
              "rounded-2xl px-3.5 py-2.5 max-w-[90%] text-sm leading-relaxed",
              isUser
                ? "bg-primary text-primary-foreground rounded-tr-sm"
                : "bg-muted/60 text-foreground rounded-tl-sm border border-border/30",
            )}
          >
            {!isUser && hasStructuredResponse ? (
              <div className="space-y-3">
                <TerminalSection
                  title="1. Diagnosis"
                  lines={terminalResponse!.diagnosis}
                  sectionIndex={0}
                />
                <TerminalSection
                  title="2. Layer Analysis"
                  lines={terminalResponse!.layerAnalysis}
                  sectionIndex={1}
                />
                <TerminalSection
                  title="3. Solutions"
                  lines={terminalResponse!.solutions}
                  sectionIndex={2}
                />
                <TerminalSection
                  title="4. Expected Outcome"
                  lines={terminalResponse!.expectedOutcome}
                  sectionIndex={3}
                />
              </div>
            ) : !isUser && message.content ? (
              <div className="space-y-1.5">
                {formatHumanResponse(message.content).map((line, idx) => (
                  <p
                    key={idx}
                    className={cn(
                      "text-[13px] leading-relaxed whitespace-pre-wrap",
                      line.startsWith("1.") ||
                        line.startsWith("2.") ||
                        line.startsWith("3.") ||
                        line.startsWith("4.")
                        ? "font-semibold text-violet-400 mt-2"
                        : line.startsWith("-") || line.startsWith("   -")
                        ? "text-foreground/85 pl-2"
                        : "text-foreground/90",
                    )}
                  >
                    {line}
                  </p>
                ))}
              </div>
            ) : (
              <p className="whitespace-pre-wrap text-[13px]">{message.content}</p>
            )}

            {/* Action plan chip */}
            {!isUser &&
              message.response?.actionJson &&
              message.response.actionJson.action.type !== "clarify" && (
                <ActionPlanChip actionJson={message.response.actionJson} />
              )}
          </div>
        )}

        {/* Execution results */}
        {!isUser && message.response && (
          <div className="w-full max-w-[90%]">
            <ExecutionResultCard
              results={message.response.executionResults}
              warnings={message.response.safetyWarnings}
            />
          </div>
        )}

        {/* Timestamp */}
        {!message.loading && (
          <span className="text-xs text-muted-foreground mt-1 px-1">
            {message.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Suggested Commands ───────────────────────────────────────────

const SUGGESTED_COMMANDS = [
  "what's wrong with my account?",
  "show critical problems",
  "analyze campaigns with high CPL",
  "find creative fatigue issues",
  "check budget pacing",
  "which campaigns should I pause?",
  "scale my winners",
  "show account health summary",
];

// ─── Main Terminal Component ──────────────────────────────────────

interface CommandTerminalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function CommandTerminal({ isOpen, onClose }: CommandTerminalProps) {
  const { activeClientId, activePlatform } = useClient();
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "assistant",
      content:
        "Welcome to Mojo Terminal — your strategic co-pilot.\nI analyze your campaigns through a 4-layer intelligence pipeline (SOP → AI Expert → History → Strategy) and provide solutions with execution classifications.\n\nAsk me anything about your account, or try a quick command below.",
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (isOpen) setTimeout(() => inputRef.current?.focus(), 100);
  }, [isOpen]);

  const sendCommand = useCallback(
    async (cmd: string) => {
      const trimmed = cmd.trim();
      if (!trimmed || isLoading) return;

      const userMsgId = `user-${Date.now()}`;
      const assistantMsgId = `ai-${Date.now()}`;

      setMessages((prev) => [
        ...prev,
        {
          id: userMsgId,
          role: "user",
          content: trimmed,
          timestamp: new Date(),
        },
        {
          id: assistantMsgId,
          role: "assistant",
          content: "",
          timestamp: new Date(),
          loading: true,
        },
      ]);
      setInput("");
      setIsLoading(true);

      try {
        const res = await apiRequest("POST", "/api/ai/command", {
          command: trimmed,
          clientId: activeClientId || "amara",
          platform: (activePlatform || "meta") as "meta" | "google",
          provider: "auto",
        });

        const data: AICommandResponse = await res.json();

        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId
              ? {
                  ...m,
                  content: data.humanResponse || "Done.",
                  loading: false,
                  response: data,
                }
              : m,
          ),
        );
      } catch (err: any) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId
              ? {
                  ...m,
                  content: `Error: ${err.message || "Something went wrong. Please try again."}`,
                  loading: false,
                }
              : m,
          ),
        );
      } finally {
        setIsLoading(false);
      }
    },
    [activeClientId, activePlatform, isLoading],
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendCommand(input);
    }
  };

  return (
    <>
      {/* Backdrop (mobile) */}
      {isOpen && (
        <div className="fixed inset-0 bg-black/40 z-40 md:hidden" onClick={onClose} />
      )}

      {/* Terminal Panel */}
      <div
        className={cn(
          "fixed top-0 right-0 h-screen z-50 flex flex-col",
          "w-full sm:w-[440px] max-w-full",
          "bg-background border-l border-border/50 shadow-2xl",
          "transition-transform duration-300 ease-in-out",
          isOpen ? "translate-x-0" : "translate-x-full",
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/50 bg-background/95 backdrop-blur-sm shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-violet-500/20 flex items-center justify-center">
              <Zap className="w-3.5 h-3.5 text-violet-400" />
            </div>
            <div>
              <h2 className="text-sm font-semibold leading-none">Mojo Terminal</h2>
              <p className="text-xs text-muted-foreground mt-0.5 leading-none flex items-center gap-1">
                <Layers className="w-3 h-3" />
                4-Layer Intelligence Pipeline
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <Badge
              variant="outline"
              className="text-xs px-1.5 py-0 border-violet-500/30 text-violet-400 bg-violet-500/10"
            >
              AI
            </Badge>
            <Button
              size="icon"
              variant="ghost"
              onClick={onClose}
              aria-label="Close terminal"
              className="h-7 w-7"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Messages */}
        <ScrollArea className="flex-1 px-4">
          <div className="py-4 space-y-4">
            {messages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} />
            ))}
            <div ref={bottomRef} />
          </div>
        </ScrollArea>

        {/* Suggested commands — shown only when empty-ish history */}
        {messages.length <= 1 && (
          <div className="px-4 pb-2 shrink-0">
            <p className="text-xs text-muted-foreground mb-2 uppercase tracking-wide font-medium">
              Quick commands
            </p>
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTED_COMMANDS.map((cmd) => (
                <button
                  key={cmd}
                  onClick={() => sendCommand(cmd)}
                  disabled={isLoading}
                  className="text-xs px-2.5 py-1 rounded-full border border-border/60 bg-muted/30 hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                >
                  {cmd}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Input */}
        <div className="px-4 pb-4 pt-2 shrink-0 border-t border-border/30">
          <div className="flex items-center gap-2 bg-muted/40 rounded-xl border border-border/50 px-3 py-2 focus-within:border-violet-500/50 focus-within:bg-muted/60 transition-colors">
            <Terminal className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type a command… (e.g. what's wrong with my account?)"
              disabled={isLoading}
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground text-foreground min-w-0"
            />
            <Button
              size="icon"
              onClick={() => sendCommand(input)}
              disabled={!input.trim() || isLoading}
              aria-label={isLoading ? "Sending command" : "Send command"}
              className="h-6 w-6 rounded-lg bg-violet-500 hover:bg-violet-600 text-white shrink-0 disabled:opacity-40"
            >
              {isLoading ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Send className="w-3 h-3" />
              )}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-1.5 text-center">
            Powered by Mojo AdCortex · 4-Layer Intelligence
          </p>
        </div>
      </div>
    </>
  );
}

// ─── Toggle Button (for use in App header) ───────────────────────

interface CommandTerminalToggleProps {
  onClick: () => void;
  isOpen: boolean;
}

export function CommandTerminalToggle({ onClick, isOpen }: CommandTerminalToggleProps) {
  return (
    <Button
      size="sm"
      variant={isOpen ? "default" : "outline"}
      onClick={onClick}
      aria-label={isOpen ? "Close Mojo Terminal" : "Open Mojo Terminal"}
      className={cn(
        "gap-1.5 h-8 px-3 text-xs font-bold",
        isOpen
          ? "bg-primary hover:bg-[#f5c723] border-primary text-primary-foreground shadow-lg shadow-primary/20"
          : "bg-black hover:bg-white hover:text-black hover:border-black border-black text-white transition-all duration-200",
      )}
    >
      <Terminal className="w-3.5 h-3.5" />
      <span className="hidden sm:inline uppercase tracking-wider">Mojo Terminal</span>
    </Button>
  );
}
