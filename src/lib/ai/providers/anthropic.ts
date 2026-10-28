import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import { getConfig } from "@/lib/config";
import type { ModelProvider, ProviderCall, ProviderResponse } from "./types";

let client: Anthropic | null = null;
function sdk(): Anthropic {
  const cfg = getConfig();
  if (!client) client = new Anthropic({ apiKey: cfg.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 10 * 60 * 1000 });
  return client;
}
/** Test hook: inject a fake SDK. */
export function _setAnthropicClient(c: Anthropic | null) {
  client = c;
}

export const anthropicProvider: ModelProvider = {
  key: "anthropic",
  label: "Anthropic Claude",
  defaults: { investigate: "claude-opus-5-5", outreach: "claude-opus-5-5" },
  isConfigured: () => Boolean(getConfig().ANTHROPIC_API_KEY?.trim()),
  async call<S extends z.ZodType>(call: ProviderCall<S>): Promise<ProviderResponse> {
    const response = await sdk().messages.parse({
      model: call.model,
      max_tokens: call.maxTokens,
      output_config: { effort: call.effort, format: zodOutputFormat(call.schema) },
      system: [{ type: "text", text: call.system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: call.user }],
    });
    return {
      output: response.parsed_output ?? null,
      model: response.model,
      usage: { input: response.usage.input_tokens, output: response.usage.output_tokens, cacheRead: response.usage.cache_read_input_tokens ?? 0, cacheWrite: response.usage.cache_creation_input_tokens ?? 0 },
      stopReason: response.stop_reason === "refusal" ? "refusal" : response.stop_reason === "max_tokens" ? "max_tokens" : "end",
      refusalExplanation: response.stop_details?.explanation ?? null,
    };
  },
};
