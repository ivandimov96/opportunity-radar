import { describe, expect, it } from "vitest";
import { contradictionsFor, qualify, type QualifyInput } from "@/lib/scoring/qualify";
import { consolidatePatterns, type RulePattern } from "@/lib/scoring/rules";
import { leadScore } from "@/lib/scoring/lead";
import { checkEmailAddress, _setMxResolver, isFreemail } from "@/lib/email/address";

const primary = { source: "ai" as const, title: "Customer portal", verifiedEvidence: 3, gapEvidence: 1, confidence: 78, attractiveness: 80, contradictions: [] as string[] };
const base: QualifyInput = { kind: "independent", thin: false, modelRan: true, modelVerdict: "opportunity", modelReason: "Fits.", aiSkipped: null, primary };

describe("qualify", () => {
  it("qualifies a model opportunity backed by verified evidence", () => {
    const q = qualify(base);
    expect(q.verdict).toBe("qualified");
    expect(q.reasons[0]).toContain("3 verified observation(s)");
  });
  it("treats the model's no as final, whatever else exists", () => {
    expect(qualify({ ...base, modelVerdict: "no_opportunity", modelReason: "Mature stack." })).toEqual({ verdict: "not_a_fit", reasons: ["Mature stack."] });
    expect(qualify({ ...base, primary: null }).verdict).toBe("not_a_fit");
  });
  it("sends uncertain cases to review with the reason spelled out", () => {
    expect(qualify({ ...base, primary: { ...primary, verifiedEvidence: 1 } }).verdict).toBe("needs_review");
    expect(qualify({ ...base, primary: { ...primary, confidence: 55 } }).reasons.join(" ")).toMatch(/55 of 100/);
    expect(qualify({ ...base, kind: "chain" }).reasons.join(" ")).toMatch(/chain/);
    expect(qualify({ ...base, primary: { ...primary, contradictions: ["The idea is about online booking, but an online booking tool is already in use (Calendly)."] } }).verdict).toBe("needs_review");
    const rulesOnly = qualify({ ...base, modelRan: false, modelVerdict: null, aiSkipped: "AI is not configured", primary: { ...primary, source: "rules" } });
    expect(rulesOnly.verdict).toBe("needs_review");
    expect(rulesOnly.reasons[0]).toMatch(/Only fixed rule patterns/);
  });
  it("says insufficient evidence when little was verified and no model idea exists", () => {
    expect(qualify({ ...base, thin: true, thinReason: "Only 1 page.", modelRan: false, modelVerdict: null, primary: null })).toEqual({ verdict: "insufficient_evidence", reasons: ["Only 1 page."] });
    expect(qualify({ ...base, modelRan: false, modelVerdict: null, aiSkipped: "AI is not configured", primary: null }).verdict).toBe("needs_review");
  });
  it("flags a recommendation that a verified fact already answers", () => {
    expect(contradictionsFor("online_booking", [{ key: "booking_tool", status: "verified", value: "Calendly" }])[0]).toMatch(/already in use \(Calendly\)/);
    expect(contradictionsFor("online_booking", [{ key: "booking_tool", status: "not_found", value: null }])).toEqual([]);
    expect(contradictionsFor("customer_portal", [{ key: "customer_portal", status: "verified", value: "yes" }])).toHaveLength(1);
  });
});

describe("consolidatePatterns (rules only)", () => {
  const p = (ruleId: string, category: string, weak = false): RulePattern => ({ ruleId, weak, category, title: `T ${ruleId}`, problem_hypothesis: `H ${ruleId}.`, proposed_solution: `S ${ruleId}`, why_not_existing_tool: "w", expected_value: `V ${ruleId}.`, supporting_fact_keys: [`k_${ruleId}`], assumptions: [`a_${ruleId}`], validation_questions: [`q_${ruleId}`], implementation_effort: ruleId === "b" ? "medium" : "small", reusability: "high", risks: [], sales_angle: "angle", ratings: { value: ruleId === "a" ? 4 : 3, feasibility: 4, evidence_strength: 3 } });
  it("groups related patterns into one primary with components and keeps independent ones as secondary", () => {
    const out = consolidatePatterns([p("a", "online_booking"), p("b", "estimate_quote_followup"), p("c", "fleet_b2b"), p("d", "review_reputation", true)]);
    expect(out.map((o) => o.role)).toEqual(["primary", "secondary", "secondary"]);
    expect(out[0].title).toBe("Lead intake, booking and quote follow-up in one flow");
    expect(out[0].components.map((c) => c.name)).toEqual(["T a", "T b"]);
    expect(out[0].supporting_fact_keys).toEqual(["k_a", "k_b"]);
    expect(out[0].implementation_effort).toBe("medium");
    expect(out[0].ratings.value).toBe(4);
    expect(out[1].category).toBe("fleet_b2b");
  });
  it("keeps a single pattern as it is and returns nothing for nothing", () => {
    const one = consolidatePatterns([p("a", "online_booking")]);
    expect(one).toHaveLength(1);
    expect(one[0]).toMatchObject({ role: "primary", title: "T a", components: [] });
    expect(consolidatePatterns([])).toEqual([]);
  });
});

describe("lead score listing signals and email checks", () => {
  const biz = { name: "Acme Plumbing", industry: "home_services", website: "https://acme.example", phone: "5125550100", street: "1 Main St", city: "Austin" };
  it("uses the listing's review count so scores discriminate", () => {
    const established = leadScore(biz, { reviewCount: 240, rating: 4.8 });
    const huge = leadScore(biz, { reviewCount: 20234, rating: 4.7 });
    const none = leadScore(biz, {});
    expect(established.score).toBeGreaterThan(none.score);
    expect(huge.score).toBeLessThan(none.score);
    expect(huge.reasons.join(" ")).toMatch(/very large operator \(20,234 reviews\)/);
  });
  it("checks syntax and mail servers without contacting the mailbox", async () => {
    _setMxResolver(async (d) => {
      if (d === "nomail.example") throw Object.assign(new Error("nodata"), { code: "ENODATA" });
      if (d === "slow.example") throw Object.assign(new Error("servfail"), { code: "ESERVFAIL" });
      return [{ exchange: "mx", priority: 1 }];
    });
    expect(await checkEmailAddress("Owner@Acme.example")).toEqual({ status: "valid", reason: null });
    expect((await checkEmailAddress("owner@nomail.example")).status).toBe("invalid");
    expect((await checkEmailAddress("owner@slow.example")).status).toBe("unchecked");
    expect((await checkEmailAddress("not-an-email")).status).toBe("invalid");
    expect((await checkEmailAddress("a@acme.example", { mx: false })).status).toBe("unchecked");
    expect((await checkEmailAddress(null)).status).toBe("invalid");
    _setMxResolver(null);
    expect(isFreemail("shop@gmail.com")).toBe(true);
    expect(isFreemail("office@acme.example")).toBe(false);
  });
});
