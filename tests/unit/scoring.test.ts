import { describe, expect, it } from "vitest";
import { scoreOpportunity, type ScoreInput } from "@/lib/scoring/score";

const base: ScoreInput = {
  category: "estimate_quote_followup",
  aiRatings: { value: 4, feasibility: 4, evidenceStrength: 4, buyingReadiness: 3 },
  implementationEffort: "medium",
  reusability: "high",
  supportingVerifiedCount: 3,
  supportingGapCount: 0,
  totalVerifiedFacts: 10,
  pagesResearched: 4,
  assumptionCount: 2,
  contact: { email: true, phone: true, contactForm: true },
};

describe("scoreOpportunity", () => {
  it("is deterministic and bounded", () => {
    const a = scoreOpportunity(base);
    expect(a).toEqual(scoreOpportunity(base));
    expect(a.attractiveness).toBeGreaterThanOrEqual(0);
    expect(a.attractiveness).toBeLessThanOrEqual(100);
    expect(a.confidence).toBeLessThanOrEqual(100);
    expect(a.breakdown.attractiveness.reduce((s, f) => s + f.weight, 0)).toBeCloseTo(1);
    expect(a.breakdown.confidence.reduce((s, f) => s + f.weight, 0)).toBeCloseTo(1);
  });
  it("separates confidence from attractiveness: missing evidence lowers confidence only", () => {
    const strong = scoreOpportunity(base);
    const weak = scoreOpportunity({ ...base, supportingVerifiedCount: 0, pagesResearched: 1, aiRatings: { ...base.aiRatings, evidenceStrength: 1 } });
    expect(weak.confidence).toBeLessThan(strong.confidence);
    expect(weak.confidence).toBeLessThanOrEqual(35);
    expect(weak.attractiveness).toBe(strong.attractiveness);
    expect(weak.breakdown.notes.join(" ")).toMatch(/hypothesis only/);
  });
  it("gap-only support counts as weaker evidence than verified facts", () => {
    const gaps = scoreOpportunity({ ...base, supportingVerifiedCount: 0, supportingGapCount: 2 });
    expect(gaps.confidence).toBeLessThanOrEqual(45);
    expect(gaps.confidence).toBeGreaterThan(scoreOpportunity({ ...base, supportingVerifiedCount: 0, supportingGapCount: 0 }).confidence);
  });
  it("rewards reachability and reusability", () => {
    expect(scoreOpportunity({ ...base, contact: { email: false, phone: false, contactForm: false } }).attractiveness).toBeLessThan(scoreOpportunity(base).attractiveness);
    expect(scoreOpportunity({ ...base, reusability: "low" }).attractiveness).toBeLessThan(scoreOpportunity(base).attractiveness);
  });
});
