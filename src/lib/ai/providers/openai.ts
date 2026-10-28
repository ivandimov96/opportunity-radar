/**
 * OpenAI Responses API with JSON-schema structured outputs, over plain fetch
 * (no SDK dependency). Strict schemas are derived from the same Zod schema the
 * Anthropic path uses. Reasoning effort maps to the API's low/medium/high.
 */
import type { z } from "zod";
import { toJSONSchema } from "zod";
import { getConfig } from "@/lib/config";
import type { ModelProvider, ProviderCall, ProviderResponse } from "./types";

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;
let fetchImpl: FetchLike = (url, init) => fetch(url, init);
/** Test hook: inject a fake transport. */
export function _setOpenAiFetch(f: FetchLike | null) {
  fetchImpl = f ?? ((url, init) => fetch(url, init));
}

/** OpenAI strict mode requires every object property to be required and additionalProperties=false. */
export function strictSchema(schema: z.ZodType): Record<string, unknown> {
  const json = toJSONSchema(schema, { target: "draft-7" }) as Record<string, unknown>;
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const o = node as Record<string, unknown>;
    if (o.type === "object" && o.properties && typeof o.properties === "object") {
      o.additionalProperties = false;
      o.required = Object.keys(o.properties as object);
      for (const v of Object.values(o.properties as object)) walk(v);
    }
    if (o.items) walk(o.items);
    for (const k of ["anyOf", "oneOf", "allOf"]) if (Array.isArray(o[k])) for (const v of o[k] as unknown[]) walk(v);
    if (o.$defs && typeof o.$defs === "object") for (const v of Object.values(o.$defs as object)) walk(v);
  };
  walk(json);
  delete json.$schema;
  return json;
}

const EFFORT: Record<string, "low" | "medium" | "high"> = { low: "low", medium: "medium", high: "high", xhigh: "high", max: "high" };

export const openaiProvider: ModelProvider = {
  key: "openai",
  label: "OpenAI",
  defaults: { investigate: "gpt-5", outreach: "gpt-5-mini" },
  isConfigured: () => Boolean(getConfig().OPENAI_API_KEY?.trim()),
  async call<S extends z.ZodType>(call: ProviderCall<S>): Promise<ProviderResponse> {
    const cfg = getConfig();
    const res = await fetchImpl("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: call.model,
        instructions: call.system,
        input: call.user,
        max_output_tokens: call.maxTokens,
        reasoning: { effort: EFFORT[call.effort] ?? "medium" },
        text: { format: { type: "json_schema", name: call.schemaName, strict: true, schema: strictSchema(call.schema) } },
      }),
      signal: AbortSignal.timeout(10 * 60 * 1000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`OpenAI HTTP ${res.status}: ${body.slice(0, 300)}`);
    }
    const data = (await res.json()) as {
      model?: string;
      status?: string;
      incomplete_details?: { reason?: string };
      output?: { type: string; content?: { type: string; text?: string; refusal?: string }[] }[];
      usage?: { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number } };
    };
    const message = data.output?.find((o) => o.type === "message");
    const refusal = message?.content?.find((c) => c.type === "refusal");
    const text = message?.content?.find((c) => c.type === "output_text")?.text ?? null;
    let output: unknown = null;
    if (text) {
      try {
        output = JSON.parse(text);
      } catch {
        output = null;
      }
    }
    const cached = data.usage?.input_tokens_details?.cached_tokens ?? 0;
    return {
      output,
      model: data.model ?? call.model,
      usage: { input: Math.max(0, (data.usage?.input_tokens ?? 0) - cached), output: data.usage?.output_tokens ?? 0, cacheRead: cached, cacheWrite: 0 },
      stopReason: refusal ? "refusal" : data.status === "incomplete" && data.incomplete_details?.reason === "max_output_tokens" ? "max_tokens" : "end",
      refusalExplanation: refusal?.refusal ?? null,
    };
  },
};
