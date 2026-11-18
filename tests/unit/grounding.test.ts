import { describe, expect, it } from "vitest";
import { quoteAppearsIn, validateInvestigation } from "@/lib/ai/investigate";
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
  role: "primary" as const,
  scope: "existing",
  category: "online_booking",
  title: "Online booking",
  why_relevant: "They ask customers to call.",
  components: [] as { name: string; description: string; evidence: string[] }[],
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
  ratings: { value: 4, feasibility: 4, evidence_strength: 4 },
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
        observations: [],
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
    expect(out.warnings.length).toBeGreaterThan(0);
  });

  it("keeps an observation only when its quote is verbatim on the cited page, and lets opportunities cite it", () => {
    const out = validateInvestigation(
      {
        facts: [],
        observations: [
          { ref: "o1", kind: "offering", statement: "They run a commercial fleet maintenance program.", evidence_quote: "Ask about our commercial fleet maintenance program", source_url: "https://shop.example/fleet" },
          { ref: "o2", kind: "limitation", statement: "Quotes are faxed.", evidence_quote: "Print the form and fax it to us", source_url: "https://shop.example" }, // not on the page
          { ref: "o1", kind: "process", statement: "Duplicate ref.", evidence_quote: "Fleet accounts welcome", source_url: "https://shop.example/fleet" },
        ],
        opportunities: [{ ...opp, supporting_fact_keys: ["o1", "o2"] }],
        verdict: "opportunity",
        verdict_reason: "ok",
      },
      pages,
      detected,
    );
    expect(out.observations.map((o) => o.ref)).toEqual(["o1"]);
    expect(out.rejected.map((r) => r.key)).toEqual(["observation o2", "observation o1"]);
    expect(out.opportunities[0].supporting_fact_keys).toEqual(["o1"]);
  });

  it("consolidates: one primary with its supported components, at most two secondary, unsupported parts dropped", () => {
    const facts = [{ key: "booking_method", status: "verified" as const, value: "phone only", evidence_quote: "Call us today to schedule your appointment", source_url: "https://shop.example" }];
    const primary = {
      ...opp,
      role: "secondary" as const, // the model forgot to mark one: the first becomes primary
      title: "Request-to-booking flow",
      supporting_fact_keys: [],
      components: [
        { name: "Online requests", description: "A request form.", evidence: ["booking_method", "booking_tool"] },
        { name: "Loyalty app", description: "Points.", evidence: ["made_up"] },
      ],
    };
    const extra = (n: number, keys = ["email", "booking_method"]) => ({ ...opp, role: "secondary" as const, scope: "internal", title: `Extra ${n}`, supporting_fact_keys: keys });
    // "Thin" rests on one verified fact and one thing not found: an alternative the operator could send needs two verified facts of its own.
    const out = validateInvestigation({ facts, observations: [], opportunities: [primary, extra(1), { ...extra(2, ["email", "booking_tool"]), title: "Thin" }, { ...opp, role: "secondary" as const, title: "Unsupported", supporting_fact_keys: ["nope"] }], verdict: "opportunity", verdict_reason: "ok" }, pages, detected);
    expect(out.opportunities.map((o) => [o.role, o.title, o.scope])).toEqual([["primary", "Request-to-booking flow", "existing"], ["secondary", "Extra 1", "internal"]]);
    expect(out.warnings.join(" ")).toMatch(/Dropped 1 alternative idea/);
    expect(out.opportunities[0].components.map((c) => c.name)).toEqual(["Online requests"]);
    expect(out.opportunities[0].supporting_fact_keys).toEqual(["booking_method", "booking_tool"]);
    expect(out.warnings.join(" ")).toMatch(/dropped 1 component/);
    expect(out.warnings.join(" ")).toMatch(/"Unsupported"\): dropped/);
  });

  it("caps evidence strength when only gaps support the opportunity; the model's no is final; nothing supported means no opportunity", () => {
    const gapOnly = validateInvestigation({ facts: [], observations: [], opportunities: [{ ...opp, supporting_fact_keys: ["booking_tool"] }], verdict: "opportunity", verdict_reason: "" }, pages, detected);
    expect(gapOnly.opportunities[0].ratings.evidence_strength).toBe(2);
    const saidNo = validateInvestigation({ facts: [], observations: [], opportunities: [{ ...opp, supporting_fact_keys: ["booking_tool"] }], verdict: "no_opportunity", verdict_reason: "Mature stack." }, pages, detected);
    expect(saidNo.verdict).toBe("no_opportunity");
    expect(saidNo.opportunities).toEqual([]);
    const none = validateInvestigation({ facts: [], observations: [], opportunities: [], verdict: "opportunity", verdict_reason: "" }, pages, detected);
    expect(none.verdict).toBe("no_opportunity");
    const unsupported = validateInvestigation({ facts: [], observations: [], opportunities: [{ ...opp, supporting_fact_keys: ["nonsense"] }], verdict: "opportunity", verdict_reason: "Looks good." }, pages, detected);
    expect(unsupported.verdict).toBe("no_opportunity");
    expect(unsupported.verdictReason).toMatch(/cited no established evidence/);
  });
});

describe("what the model reads", () => {
  const page = (kind: string, text: string) => ({ url: `https://x.example/${kind}`, kind, title: kind, text });
  it("reads the pages that explain the business first and the contact page last and short", async () => {
    const { buildInvestigationInput, orderForModel } = await import("@/lib/ai/investigate");
    const crawled = [page("home", "HOME"), page("contact", "C".repeat(6000)), page("careers", "JOBS"), page("services", "SERVICES"), page("booking", "QUOTE")];
    expect(orderForModel(crawled).map((p) => p.kind)).toEqual(["home", "services", "booking", "careers", "contact"]);
    const input = buildInvestigationInput({ name: "X" }, crawled, []);
    expect(input.indexOf("SERVICES")).toBeLessThan(input.indexOf("JOBS"));
    expect(input.indexOf("JOBS")).toBeLessThan(input.indexOf("CCCC"));
    expect(input.match(/C{2500,}/)![0]).toHaveLength(2500); // the contact page was already mined for the address
  });
  it("never lets a long contact page crowd out the services page", async () => {
    const { buildInvestigationInput } = await import("@/lib/ai/investigate");
    const input = buildInvestigationInput({ name: "X" }, [page("home", "H".repeat(9000)), page("contact", "C".repeat(9000)), page("about", "A".repeat(9000)), page("pricing", "P".repeat(9000)), page("services", "SERVICES-PAGE " + "S".repeat(9000)), page("booking", "B".repeat(9000))], []);
    expect(input).toContain("SERVICES-PAGE");
    expect(input).toContain("BBBB");
  });
});

describe("what the research may propose", () => {
  it("shows the model the whole catalogue with signals, the three kinds of idea, and asks for different alternatives", async () => {
    const { investigateSystem } = await import("@/lib/ai/prompts");
    const { getPlaybook, OPPORTUNITY_CATEGORY_KEYS, SOLUTION_GUIDE } = await import("@/lib/industries");
    const system = investigateSystem(getPlaybook("generic"));
    for (const key of OPPORTUNITY_CATEGORY_KEYS) expect(system).toContain(`- ${key}`);
    expect(Object.keys(SOLUTION_GUIDE).sort()).toEqual(OPPORTUNITY_CATEGORY_KEYS.filter((k) => k !== "other").sort());
    expect(system).toContain("job_tracking (Job and production tracking)");
    expect(system).toMatch(/internal: a tool for the people who work there/);
    expect(system).toMatch(/Do not default to improving the enquiry form/);
    expect(system).toMatch(/up to two secondary opportunities that are genuinely different/);
  });
});
