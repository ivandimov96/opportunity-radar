/**
 * Thin wrapper around the Anthropic SDK: structured outputs, usage/cost
 * accounting, spend guard, and explicit failure modes. Prompts are passed in
 * by the stage modules so model configuration can evolve independently.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import { getConfig } from "@/lib/config";
import { recordUsage, totalSpendUsd } from "./usage";

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

let client: Anthropic | null = null;
export function getAnthropic(): Anthropic {
  const cfg = getConfig();
  if (!cfg.ai.enabled) throw new AiUnavailableError("ANTHROPIC_API_KEY is not configured; AI stages are unavailable.");
  if (!client) client = new Anthropic({ apiKey: cfg.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 10 * 60 * 1000 });
  return client;
}

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface StructuredCall<S extends z.ZodType> {
  stage: "extraction" | "analysis" | "outreach";
  model: string;
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
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number; costUsd: number };
}

export async function assertSpendWithinLimit() {
  const cfg = getConfig();
  const spent = await totalSpendUsd();
  if (spent >= cfg.AI_SPEND_LIMIT_USD) {
    throw new AiSpendLimitError(`AI spend guard: estimated spend $${spent.toFixed(2)} has reached the limit of $${cfg.AI_SPEND_LIMIT_USD}. Raise AI_SPEND_LIMIT_USD to continue.`);
  }
}

export async function callStructured<S extends z.ZodType>(call: StructuredCall<S>): Promise<StructuredResult<z.infer<S>>> {
  await assertSpendWithinLimit();
  const anthropic = getAnthropic();
  const response = await anthropic.messages.parse({
    model: call.model,
    max_tokens: call.maxTokens ?? 16000,
    output_config: { effort: call.effort, format: zodOutputFormat(call.schema) },
    system: [{ type: "text", text: call.system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: call.user }],
  });
  const usage = {
    input: response.usage.input_tokens,
    output: response.usage.output_tokens,
    cacheRead: response.usage.cache_read_input_tokens ?? 0,
    cacheWrite: response.usage.cache_creation_input_tokens ?? 0,
  };
  const costUsd = await recordUsage({ stage: call.stage, model: call.model, businessId: call.businessId, ...usage });
  if (response.stop_reason === "refusal") {
    throw new AiRefusalError(`Model declined the ${call.stage} request${response.stop_details?.explanation ? `: ${response.stop_details.explanation}` : "."}`);
  }
  if (response.stop_reason === "max_tokens") throw new Error(`Model output truncated (max_tokens) during ${call.stage}`);
  const parsed = response.parsed_output;
  if (!parsed) throw new Error(`Model returned output that did not match the ${call.stage} schema`);
  return { data: parsed as z.infer<S>, model: response.model, usage: { ...usage, costUsd } };
}
