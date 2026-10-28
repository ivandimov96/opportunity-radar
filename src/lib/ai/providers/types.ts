/**
 * One contract for every model provider: a system prompt, a user message and a
 * Zod schema in; validated structured data, usage and the model name out.
 * Provider modules own transport, retries and refusal detection; cost, spend
 * guards and schema validation live in the shared client so they are identical
 * for every provider.
 */
import type { z } from "zod";

export type ProviderKey = "anthropic" | "openai";
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface ProviderCall<S extends z.ZodType> {
  model: string;
  effort: Effort;
  system: string;
  user: string;
  schema: S;
  schemaName: string;
  maxTokens: number;
}

export interface ProviderResponse {
  /** Raw JSON text (or already-parsed object) the model produced. */
  output: unknown;
  model: string;
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number };
  stopReason: "end" | "max_tokens" | "refusal";
  refusalExplanation?: string | null;
}

export interface ModelProvider {
  key: ProviderKey;
  label: string;
  /** Default models per stage for this provider. */
  defaults: { investigate: string; outreach: string };
  isConfigured(): boolean;
  call<S extends z.ZodType>(call: ProviderCall<S>): Promise<ProviderResponse>;
}
