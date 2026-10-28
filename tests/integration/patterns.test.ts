import { beforeEach, describe, expect, it } from "vitest";
import { useTempDb, resetEnv } from "../helpers";
import { businesses, investigations, opportunities } from "@/db/schema";
import { patternSummary } from "@/lib/queries";

describe("patterns", () => {
  beforeEach(async () => {
    resetEnv({});
    await useTempDb();
  });
  it("counts recurring hypotheses under one normalized title", async () => {
    const db = await (await import("@/db/client")).getDb();
    const titles = ["Tekmetric in use, but booking or updates not connected", "Shop-Ware in use, but booking or updates not connected", "Website looks unmaintained (latest year 2019)"];
    for (const [i, title] of titles.entries()) {
      const bid = `b${i}`;
      await db.insert(businesses).values({ id: bid, name: `Shop ${i}`, nameNormalized: `shop ${i}`, industry: "auto_repair", firstProvider: "csv" }).run();
      await db.insert(investigations).values({ id: `inv${i}`, businessId: bid }).run();
      await db
        .insert(opportunities)
        .values({ id: `o${i}`, investigationId: `inv${i}`, businessId: bid, category: "online_booking", title, problemHypothesis: "p", proposedSolution: "s", supportingFactKeys: [], assumptions: [], validationQuestions: [], implementationEffort: "low", reusability: "high", risks: [], attractivenessScore: 50, confidenceScore: 40, scoreBreakdown: {} as never, source: "rules" })
        .run();
    }
    const g = (await patternSummary()).find((x) => x.category === "online_booking")!;
    expect(g.hypotheses).toContainEqual(["Shop system in use, but booking or updates not connected", 2]);
    expect(g.hypotheses).toContainEqual(["Website looks unmaintained", 1]);
  });
});
