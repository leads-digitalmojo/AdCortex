/**
 * Claude Provider — Mojo AdCortex LLM Layer
 *
 * Thin wrapper around @anthropic-ai/sdk that provides:
 *  - Model routing ("opus" → claude-opus-4-6, "sonnet" → claude-sonnet-4-6)
 *  - Retry-once on transient failures
 *  - Token tracking and cost estimation
 *  - Clean typed response interface
 */

import Anthropic from "@anthropic-ai/sdk";

// ─── Types ────────────────────────────────────────────────────────

export type ClaudeModelTier = "opus" | "sonnet";

export interface ClaudeRequest {
  systemPrompt: string;
  userMessage: string;
  modelTier: ClaudeModelTier;
  maxTokens?: number;
  temperature?: number;
}

export interface ClaudeResponse {
  content: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costEstimate: number;
}

// ─── Model Configuration ──────────────────────────────────────────

const MODEL_MAP: Record<ClaudeModelTier, string> = {
  opus: "claude-opus-4-6",
  sonnet: "claude-sonnet-4-6",
};

const DEFAULT_MAX_TOKENS: Record<ClaudeModelTier, number> = {
  opus: 16000,
  // claude-sonnet-4-6 supports up to 64K output tokens.
  // 8192 was causing JSON truncation mid-response for complex accounts (13+ insights).
  // 16000 gives ~12K of head-room for 5 rich recommendations with full reasoning + execution plans.
  sonnet: 16000,
};

// Pricing per 1M tokens (USD) — as of 2025
const PRICING: Record<string, { input: number; output: number }> = {
  "claude-opus-4-6": { input: 15.0, output: 75.0 },
  "claude-sonnet-4-6": { input: 3.0, output: 15.0 },
  "claude-3-opus-latest": { input: 15.0, output: 75.0 },
  "claude-3-5-sonnet-latest": { input: 3.0, output: 15.0 },
};

const DEFAULT_TEMPERATURE = 0.3;

// ─── Helpers ──────────────────────────────────────────────────────

function getAnthropicApiKey(): string {
  return process.env.ANTHROPIC_API_KEY || "";
}

function isPlaceholderSecret(value?: string): boolean {
  return !value || value.trim() === "" || value.trim().startsWith("YOUR_");
}

function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = PRICING[model];
  if (!pricing) return 0;
  return (inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output;
}

// ─── Main API ─────────────────────────────────────────────────────

/**
 * Call Claude with retry-once on transient failures.
 * Throws if no API key is configured.
 */
export async function callClaude(request: ClaudeRequest): Promise<ClaudeResponse> {
  const apiKey = getAnthropicApiKey().trim();
  if (!apiKey || isPlaceholderSecret(apiKey)) {
    throw new Error(
      "Missing ANTHROPIC_API_KEY. Please set this in your Render Environment Variables or .env file to enable AI-powered insights."
    );
  }

  const model = MODEL_MAP[request.modelTier];
  const maxTokens = request.maxTokens ?? DEFAULT_MAX_TOKENS[request.modelTier];
  const temperature = request.temperature ?? DEFAULT_TEMPERATURE;

  const anthropic = new Anthropic({ apiKey });

  const makeRequest = async () => {
    const msg = await anthropic.messages.create({
      model,
      max_tokens: maxTokens,
      temperature,
      system: request.systemPrompt,
      messages: [{ role: "user", content: request.userMessage }],
    });

    // Extract text content from response blocks
    const content = msg.content
      .filter((block) => block.type === "text")
      .map((block) => (block as any).text)
      .join("\n");

    const inputTokens = msg.usage?.input_tokens ?? 0;
    const outputTokens = msg.usage?.output_tokens ?? 0;

    return {
      content,
      model,
      inputTokens,
      outputTokens,
      costEstimate: estimateCost(model, inputTokens, outputTokens),
    };
  };

  // Attempt with single retry on transient errors
  try {
    return await makeRequest();
  } catch (err: any) {
    const isTransient =
      err?.status === 429 ||
      err?.status === 500 ||
      err?.status === 503 ||
      err?.message?.includes("ECONNRESET") ||
      err?.message?.includes("ETIMEDOUT");

    if (isTransient) {
      console.warn(`[Claude Provider] Transient error (${err?.status || err?.code}), retrying once in 2s...`);
      await new Promise((r) => setTimeout(r, 2000));
      return await makeRequest();
    }

    throw err;
  }
}

/**
 * Quick health check — verifies the API key is valid without making a full call.
 */
export function isClaudeAvailable(): boolean {
  const apiKey = getAnthropicApiKey().trim();
  return !!apiKey && !isPlaceholderSecret(apiKey);
}
