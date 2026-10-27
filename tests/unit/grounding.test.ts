import { describe, expect, it } from "vitest";
import { quoteAppearsIn, validateInvestigation } from "@/lib/ai/investigate";
import { validateOutreach } from "@/lib/ai/outreach";
import type { DetectedFact } from "@/lib/research/detect";

const pages = [
  { url: "https://shop.example", kind: "home", title: "Shop", text: "Welcome to Barton Auto. Call us today to schedule your appointment. We offer free estimates on all brake work." },
  { url: "https://shop.example/fleet", kind: "fleet", title: "Fleet", text: "Fleet accounts welcome. Ask about our commercial fleet maintenance program." },
];
const detected: DetectedFact[] = [
  { key: "email", status: "verified", value: "a@shop.example", evidenceQuote: "a@shop.example", sourceUrl: "https://shop.example" },
  { key: "booking_tool", status: "not_found", value: null, evidenceQuote: "Not detected", sourceUrl: null },
];
const opp = {
  category: "online_booking",
  title: "Online booking",
  problem_hypothesis: "h",
  proposed_solution: "s",
  why_not_existing_tool: "w",
  expected_value: "v",
  supporting_fact_keys: ["booking_method", "booking_tool", "nonsense_key"],
  assumptions: ["a"],
  validation_questions: ["q"],
  implementation_effort: "small" as const,
  reusability: "high" as const,
  risks: [],
  sales_angle: "angle",
  ratings: { value: 4, feasibility: 4, evidence_strength: 4, buying_readiness: 3 },
};

describe("quoteAppearsIn", () => {
  it("matches normalized whitespace, case and curly quotes", () => {
    expect(quoteAppearsIn("call us   TODAY to schedule", pages[0].text)).toBe(true);
    expect(quoteAppearsIn("short", pages[0].text)).toBe(false);
    expect(quoteAppearsIn("We use Tekmetric for scheduling", pages[0].text)).toBe(false);
  });
});

describe("validateInvestigation", () => {
  it("accepts grounded facts, rejects ungrounded ones, keeps detected facts authoritative, validates citations", () => {
    const out = validateInvestigation(
      {
        facts: [
          { key: "booking_method", status: "verified", value: "phone only", evidence_quote: "Call us today to schedule your appointment", source_url: "https://shop.example" },
          { key: "shop_management_tool", status: "verified", value: "Tekmetric", evidence_quote: "powered by Tekmetric", source_url: "https://shop.example" },
          { key: "fleet_program", status: "verified", value: "Fleet accounts", evidence_quote: "Fleet accounts welcome", source_url: "https://shop.example" }, // wrong page
          { key: "estimate_policy", status: "verified", value: "free estimates", evidence_quote: "free estimates on all brake work", source_url: "https://shop.example" },
          { key: "email", status: "verified", value: "other@x.example", evidence_quote: "other@x.example", source_url: "https://shop.example" }, // must not override detected
          { key: "maintenance_plans", status: "not_found", value: "", evidence_quote: "", source_url: "" },
        ],
        workflows: [{ name: "Scheduling", fact_keys: ["booking_method", "bogus"] }],
        opportunities: [opp],
        verdict: "opportunity",
        verdict_reason: "ok",
      },
      pages,
      detected,
    );
    const byKey = Object.fromEntries(out.facts.map((f) => [f.key, f]));
    expect(byKey.booking_method.status).toBe("verified");
    expect(byKey.booking_method.value).toBe("phone_only"); // mapped to option
    expect(byKey.estimate_policy.value).toBe("free_estimates");
    expect(byKey.email.value).toBe("a@shop.example");
    expect(byKey.maintenance_plans.status).toBe("not_found");
    expect(byKey.shop_management_tool).toBeUndefined();
    expect(byKey.fleet_program).toBeUndefined();
    expect(out.rejected.map((r) => r.key).sort()).toEqual(["fleet_program", "shop_management_tool"]);
    expect(out.opportunities[0].supporting_fact_keys).toEqual(["booking_method", "booking_tool"]);
    expect(out.workflows[0].factKeys).toEqual(["booking_method"]);
    expect(out.warnings.length).toBeGreaterThan(0);
  });

  it("caps evidence strength when only gaps support the opportunity and fixes inconsistent verdicts", () => {
    const out = validateInvestigation({ facts: [], workflows: [], opportunities: [{ ...opp, supporting_fact_keys: ["booking_tool"] }], verdict: "no_opportunity", verdict_reason: "" }, pages, detected);
    expect(out.opportunities[0].ratings.evidence_strength).toBe(2);
    expect(out.verdict).toBe("opportunity");
    const none = validateInvestigation({ facts: [], workflows: [], opportunities: [], verdict: "opportunity", verdict_reason: "" }, pages, detected);
    expect(none.verdict).toBe("no_opportunity");
  });
});

describe("validateOutreach", () => {
  const factsList = [
    { key: "booking_method", status: "verified", value: "phone_only" },
    { key: "booking_tool", status: "not_found", value: null },
  ];
  it("flags unsupported claims, missing claim text, placeholders and statistics", () => {
    const { draft, warnings } = validateOutreach(
      {
        subject: "Hi",
        body: "Hi [Name], I noticed your site asks customers to call to schedule. Shops like yours save 30% with online booking.",
        claims: [
          { text: "asks customers to call to schedule", fact_keys: ["booking_method"] },
          { text: "save 30% with online booking", fact_keys: [] },
          { text: "this phrase is not in the body", fact_keys: ["booking_method"] },
        ],
      },
      factsList,
    );
    expect(draft.claims[0].factKeys).toEqual(["booking_method"]);
    expect(warnings.some((w) => w.startsWith("Unsupported claim"))).toBe(true);
    expect(warnings.some((w) => w.includes("not found verbatim"))).toBe(true);
    expect(warnings.some((w) => w.includes("placeholder"))).toBe(true);
    expect(warnings.some((w) => w.includes("percentage"))).toBe(true);
  });
  it("passes a clean draft and accepts gap citations", () => {
    const { warnings } = validateOutreach({ subject: "s", body: "Your site asks customers to call to schedule and I didn't see online booking. Worth a chat?", claims: [{ text: "asks customers to call to schedule", fact_keys: ["booking_method"] }, { text: "didn't see online booking", fact_keys: ["booking_tool"] }] }, factsList);
    expect(warnings).toEqual([]);
  });
});
