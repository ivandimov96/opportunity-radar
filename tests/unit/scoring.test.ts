import { describe, expect, it } from "vitest";
import { scoreOpportunity, type ScoreInput } from "@/lib/scoring/score";

const base: ScoreInput = {
  category: "estimate_quote_followup",
  aiRatings: { value: 4, feasibility: 4, evidenceStrength: 4, buyingReadiness: 3 },
  implementationEffort: "medium",
  reusability: "high",
  supportingObservationCount: 3,
  totalVerifiedObservations: 10,
  pagesResearched: 4,
  assumptionCount: 2,
  contact: { email: true, phone: true, contactForm: true },
};

describe("scoreOpportunity", () => {
  it("is deterministic and bounded", () => {
    const a = scoreOpportunity(base);
    const b = scoreOpportunity(base);
    expect(a).toEqual(b);
    expect(a.attractiveness).toBeGreaterThanOrEqual(0);
    expect(a.attractiveness).toBeLessThanOrEqual(100);
    expect(a.confidence).toBeGreaterThanOrEqual(0);
    expect(a.confidence).toBeLessThanOrEqual(100);
    expect(a.breakdown.attractiveness.reduce((s, f) => s + f.weight, 0)).toBeCloseTo(1);
    expect(a.breakdown.confidence.reduce((s, f) => s + f.weight, 0)).toBeCloseTo(1);
  });

  it("separates confidence from attractiveness: missing evidence lowers confidence only", () => {
    const strong = scoreOpportunity(base);
    const weak = scoreOpportunity({ ...base, supportingObservationCount: 0, pagesResearched: 1, aiRatings: { ...base.aiRatings, evidenceStrength: 1 } });
    expect(weak.confidence).toBeLessThan(strong.confidence);
    expect(weak.confidence).toBeLessThanOrEqual(35);
    expect(weak.attractiveness).toBe(strong.attractiveness);
    expect(weak.breakdown.notes.join(" ")).toMatch(/hypothesis only/);
  });

  it("rewards reachability and reusability", () => {
    const unreachable = scoreOpportunity({ ...base, contact: { email: false, phone: false, contactForm: false } });
    expect(unreachable.attractiveness).toBeLessThan(scoreOpportunity(base).attractiveness);
    const lowReuse = scoreOpportunity({ ...base, reusability: "low" });
    expect(lowReuse.attractiveness).toBeLessThan(scoreOpportunity(base).attractiveness);
  });

  it("explains every factor", () => {
    const { breakdown } = scoreOpportunity(base);
    for (const f of [...breakdown.attractiveness, ...breakdown.confidence]) expect(f.explanation.length).toBeGreaterThan(10);
  });
});
