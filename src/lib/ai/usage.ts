import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { aiUsage } from "@/db/schema";
import { newId } from "@/lib/ids";

/** USD per million tokens. Source: Anthropic pricing as cached in the claude-api skill (2026-10). */
const PRICING: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  "claude-fable-5-1": { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 },
};

export function estimateCostUsd(model: string, u: { input: number; output: number; cacheRead: number; cacheWrite: number }) {
  const p = PRICING[model] ?? { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 };
  return (u.input * p.input + u.output * p.output + u.cacheRead * p.cacheRead + u.cacheWrite * p.cacheWrite) / 1_000_000;
}

export function recordUsage(args: { stage: string; model: string; businessId?: string | null; input: number; output: number; cacheRead: number; cacheWrite: number }) {
  const cost = estimateCostUsd(args.model, args);
  getDb()
    .insert(aiUsage)
    .values({ id: newId(), stage: args.stage, model: args.model, businessId: args.businessId ?? null, inputTokens: args.input, outputTokens: args.output, cacheReadTokens: args.cacheRead, cacheWriteTokens: args.cacheWrite, estimatedCostUsd: cost })
    .run();
  return cost;
}

export function totalSpendUsd(): number {
  const row = getDb().select({ total: sql<number>`coalesce(sum(${aiUsage.estimatedCostUsd}), 0)` }).from(aiUsage).get();
  return row?.total ?? 0;
}

export function usageSummary() {
  const db = getDb();
  const byStage = db
    .select({ stage: aiUsage.stage, calls: sql<number>`count(*)`, cost: sql<number>`sum(${aiUsage.estimatedCostUsd})`, input: sql<number>`sum(${aiUsage.inputTokens})`, output: sql<number>`sum(${aiUsage.outputTokens})` })
    .from(aiUsage)
    .groupBy(aiUsage.stage)
    .all();
  return { total: totalSpendUsd(), byStage };
}
