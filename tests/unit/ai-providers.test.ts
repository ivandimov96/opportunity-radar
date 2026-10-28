import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { useTempDb, resetEnv } from "../helpers";
import { activeProvider, callStructured, modelFor, AiRefusalError, AiUnavailableError } from "@/lib/ai/client";
import { strictSchema, _setOpenAiFetch } from "@/lib/ai/providers/openai";
import { _setAnthropicClient } from "@/lib/ai/providers/anthropic";
import { totalSpendUsd } from "@/lib/ai/usage";

const Schema = z.object({ title: z.string(), tags: z.array(z.string()), nested: z.object({ ok: z.boolean() }) });

describe("model providers", () => {
  beforeEach(async () => {
    resetEnv({});
    await useTempDb();
    _setOpenAiFetch(null);
    _setAnthropicClient(null);
  });
  it("selects the provider from keys and AI_PROVIDER, with per-provider default models", () => {
    expect(activeProvider()).toBeNull();
    resetEnv({ OPENAI_API_KEY: "sk-test" });
    expect(activeProvider()?.key).toBe("openai");
    expect(modelFor("investigate")).toBe("gpt-5");
    resetEnv({ OPENAI_API_KEY: "sk-test", ANTHROPIC_API_KEY: "sk-ant" });
    expect(activeProvider()?.key).toBe("anthropic");
    resetEnv({ OPENAI_API_KEY: "sk-test", ANTHROPIC_API_KEY: "sk-ant", AI_PROVIDER: "openai", AI_INVESTIGATE_MODEL: "gpt-5-mini" });
    expect(activeProvider()?.key).toBe("openai");
    expect(modelFor("investigate")).toBe("gpt-5-mini");
    expect(modelFor("outreach")).toBe("gpt-5-mini");
  });
  it("derives a strict JSON schema OpenAI accepts from the Zod schema", () => {
    const js = strictSchema(Schema) as { additionalProperties: boolean; required: string[]; properties: Record<string, { additionalProperties?: boolean; required?: string[] }> };
    expect(js.additionalProperties).toBe(false);
    expect(js.required).toEqual(["title", "tags", "nested"]);
    expect(js.properties.nested.additionalProperties).toBe(false);
    expect(js.properties.nested.required).toEqual(["ok"]);
  });
  it("calls OpenAI with a strict schema, validates the output and records provider-tagged cost", async () => {
    resetEnv({ OPENAI_API_KEY: "sk-test" });
    let sent: Record<string, unknown> | null = null;
    _setOpenAiFetch(async (_url, init) => {
      sent = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ model: "gpt-5-2026-01-01", status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ title: "T", tags: ["a"], nested: { ok: true } }) }] }], usage: { input_tokens: 1200, output_tokens: 300, input_tokens_details: { cached_tokens: 200 } } }), { status: 200 });
    });
    const r = await callStructured({ stage: "investigate", effort: "high", system: "sys", user: "usr", schema: Schema });
    expect(r.provider).toBe("openai");
    expect(r.data).toEqual({ title: "T", tags: ["a"], nested: { ok: true } });
    expect(r.usage).toMatchObject({ input: 1000, cacheRead: 200, output: 300 });
    expect(r.usage.costUsd).toBeGreaterThan(0);
    expect((sent as unknown as { text: { format: { strict: boolean; name: string } }; reasoning: { effort: string } }).text.format.strict).toBe(true);
    expect((sent as unknown as { reasoning: { effort: string } }).reasoning.effort).toBe("high");
    expect(await totalSpendUsd()).toBeCloseTo(r.usage.costUsd, 8);
  });
  it("surfaces refusals, schema mismatches and HTTP failures explicitly", async () => {
    resetEnv({ OPENAI_API_KEY: "sk-test" });
    _setOpenAiFetch(async () => new Response(JSON.stringify({ model: "gpt-5", status: "completed", output: [{ type: "message", content: [{ type: "refusal", refusal: "no" }] }], usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200 }));
    await expect(callStructured({ stage: "outreach", effort: "low", system: "s", user: "u", schema: Schema })).rejects.toBeInstanceOf(AiRefusalError);
    _setOpenAiFetch(async () => new Response(JSON.stringify({ model: "gpt-5", status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ title: 1 }) }] }], usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200 }));
    await expect(callStructured({ stage: "outreach", effort: "low", system: "s", user: "u", schema: Schema })).rejects.toThrow(/did not match/);
    _setOpenAiFetch(async () => new Response("rate limited", { status: 429 }));
    await expect(callStructured({ stage: "outreach", effort: "low", system: "s", user: "u", schema: Schema })).rejects.toThrow(/HTTP 429/);
  });
  it("runs the Anthropic path through the same contract", async () => {
    resetEnv({ ANTHROPIC_API_KEY: "sk-ant" });
    _setAnthropicClient({ messages: { parse: async () => ({ model: "claude-opus-5-5", parsed_output: { title: "A", tags: [], nested: { ok: false } }, usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, stop_reason: "end_turn", stop_details: null }) } } as never);
    const r = await callStructured({ stage: "investigate", effort: "medium", system: "s", user: "u", schema: Schema });
    expect(r.provider).toBe("anthropic");
    expect(r.data.title).toBe("A");
  });
  it("is unavailable without any key", async () => {
    await expect(callStructured({ stage: "investigate", effort: "medium", system: "s", user: "u", schema: Schema })).rejects.toBeInstanceOf(AiUnavailableError);
  });
});
