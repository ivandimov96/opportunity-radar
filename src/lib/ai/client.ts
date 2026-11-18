/**
 * Provider-agnostic structured calls: pick the configured provider, enforce the
 * spend guard, validate the model's output against the Zod schema, account for
 * cost, and surface refusals/truncation as explicit errors. Stage modules pass
 * prompts and schemas; they never touch a provider directly.
 */
import type { z } from "zod";
import { getConfig } from "@/lib/config";
import { recordUsage, monthSpendUsd } from "./usage";
import { monthlyAiBudgetUsd } from "@/lib/settings";
import { anthropicProvider } from "./providers/anthropic";
import { openaiProvider } from "./providers/openai";
import type { Effort, ModelProvider, ProviderKey } from "./providers/types";

export type { Effort, ProviderKey } from "./providers/types";

export class AiUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiUnavailableError";
  }
}
export class AiRefusalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiRefusalError";
  }
}
export class AiSpendLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiSpendLimitError";
  }
}

const PROVIDERS: Record<ProviderKey, ModelProvider> = { anthropic: anthropicProvider, openai: openaiProvider };

/** The provider in use: AI_PROVIDER when set, otherwise the first one with a key (Anthropic, then OpenAI). */
export function activeProvider(): ModelProvider | null {
  const cfg = getConfig();
  if (cfg.AI_PROVIDER !== "auto") {
    const p = PROVIDERS[cfg.AI_PROVIDER];
    return p.isConfigured() ? p : null;
  }
  return (Object.values(PROVIDERS) as ModelProvider[]).find((p) => p.isConfigured()) ?? null;
}

/** investigate = research one business; outreach = write an email; check = verify an email against its evidence; reply = classify an incoming reply. */
export type AiStage = "investigate" | "outreach" | "check" | "reply";

/** Model for a stage: explicit env override, else the provider's default. Everything except research uses the outreach model. */
export function modelFor(stage: AiStage, provider = activeProvider()): string {
  const cfg = getConfig();
  const override = stage === "investigate" ? cfg.AI_INVESTIGATE_MODEL : cfg.AI_OUTREACH_MODEL;
  if (override) return override;
  return provider?.defaults[stage === "investigate" ? "investigate" : "outreach"] ?? "unconfigured";
}

export interface StructuredCall<S extends z.ZodType> {
  stage: AiStage;
  model?: string;
  effort: Effort;
  system: string;
  user: string;
  schema: S;
  businessId?: string | null;
  maxTokens?: number;
}

export interface StructuredResult<T> {
  data: T;
  model: string;
  provider: ProviderKey;
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number; costUsd: number };
}

/** The limit is per calendar month (UTC): Settings → Limits, or AI_SPEND_LIMIT_USD when that is not set. */
export async function assertSpendWithinLimit() {
  const limit = await monthlyAiBudgetUsd();
  const spent = await monthSpendUsd();
  if (spent >= limit) {
    throw new AiSpendLimitError(`AI spend guard: estimated spend this month $${spent.toFixed(2)} has reached the monthly limit of $${limit}. Raise it in Settings to continue.`);
  }
}

export async function callStructured<S extends z.ZodType>(call: StructuredCall<S>): Promise<StructuredResult<z.infer<S>>> {
  const provider = activeProvider();
  if (!provider) throw new AiUnavailableError("No model provider is configured (set ANTHROPIC_API_KEY or OPENAI_API_KEY); AI stages are unavailable.");
  await assertSpendWithinLimit();
  const model = call.model ?? modelFor(call.stage, provider);
  const response = await provider.call({ model, effort: call.effort, system: call.system, user: call.user, schema: call.schema, schemaName: `${call.stage}_output`, maxTokens: call.maxTokens ?? 16000 });
  const costUsd = await recordUsage({ stage: call.stage, model: response.model, provider: provider.key, businessId: call.businessId, ...response.usage });
  if (response.stopReason === "refusal") throw new AiRefusalError(`Model declined the ${call.stage} request${response.refusalExplanation ? `: ${response.refusalExplanation}` : "."}`);
  if (response.stopReason === "max_tokens") throw new Error(`Model output truncated (max_tokens) during ${call.stage}`);
  const parsed = call.schema.safeParse(response.output);
  if (!parsed.success) throw new Error(`Model returned output that did not match the ${call.stage} schema: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  return { data: parsed.data as z.infer<S>, model: response.model, provider: provider.key, usage: { ...response.usage, costUsd } };
}
