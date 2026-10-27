import { describe, expect, it } from "vitest";
import { quoteAppearsIn, validateExtraction } from "@/lib/ai/extract";
import { validateAnalysis } from "@/lib/ai/analyze";
import { validateOutreach } from "@/lib/ai/outreach";

const pages = [
  { url: "https://shop.example", kind: "home", title: "Shop", text: "Welcome to Barton Auto. Call us today to schedule your appointment. We offer free estimates on all brake work." },
  { url: "https://shop.example/fleet", kind: "fleet", title: "Fleet", text: "Fleet accounts welcome. Ask about our commercial fleet maintenance program." },
];

describe("quoteAppearsIn", () => {
  it("matches normalized whitespace, case and curly quotes", () => {
    expect(quoteAppearsIn("call us   TODAY to schedule", pages[0].text)).toBe(true);
    expect(quoteAppearsIn("short", pages[0].text)).toBe(false);
    expect(quoteAppearsIn("We use Tekmetric for scheduling", pages[0].text)).toBe(false);
  });
});

describe("validateExtraction", () => {
  it("accepts grounded observations and rejects ungrounded or mis-cited ones", () => {
    const out = validateExtraction(
      {
        observations: [
          { category: "booking", statement: "Customers are asked to call to schedule", evidence_quote: "Call us today to schedule your appointment", source_url: "https://shop.example" },
          { category: "tools", statement: "Uses Tekmetric", evidence_quote: "powered by Tekmetric", source_url: "https://shop.example" },
          { category: "services", statement: "Offers fleet accounts", evidence_quote: "Fleet accounts welcome", source_url: "https://shop.example" }, // wrong page
          { category: "services", statement: "Offers fleet accounts", evidence_quote: "Fleet accounts welcome", source_url: "https://shop.example/fleet" },
          { category: "other", statement: "Made up", evidence_quote: "this never appears", source_url: "https://other.example" },
        ],
        unknowns: [{ topic: "Scheduling software", note: "Not stated" }],
      },
      pages,
    );
    expect(out.accepted.map((a) => a.statement)).toEqual(["Customers are asked to call to schedule", "Offers fleet accounts"]);
    expect(out.rejected).toHaveLength(3);
    expect(out.rejected.map((r) => r.reason)).toContain("evidence quote not found verbatim in the cited page");
    expect(out.unknowns).toHaveLength(1);
  });
});

describe("validateAnalysis", () => {
  const observations = [
    { id: "obs-1", kind: "verified" as const, category: "booking", statement: "Call to schedule" },
    { id: "obs-2", kind: "unknown" as const, category: "other", statement: "Scheduling software unknown" },
  ];
  const opp = {
    category: "online_booking",
    title: "Online booking",
    problem_hypothesis: "h",
    proposed_solution: "s",
    why_not_existing_tool: "w",
    expected_value: "v",
    supporting_observation_ids: ["obs-1", "obs-2", "obs-99"],
    assumptions: ["a"],
    validation_questions: ["q"],
    implementation_effort: "small" as const,
    reusability: "high" as const,
    risks: [],
    sales_angle: "angle",
    ratings: { value: 4, feasibility: 4, evidence_strength: 4, buying_readiness: 3 },
  };
  const base = { company_summary: "s", documented_workflows: [{ name: "Scheduling", observation_ids: ["obs-1", "nope"] }], industry_workflows_considered: [], existing_tools_detected: [], no_compelling_opportunity: false, no_opportunity_reason: "" };

  it("drops citations to unknown or non-verified observation ids", () => {
    const { analysis, warnings } = validateAnalysis({ ...base, opportunities: [opp] }, observations);
    expect(analysis.opportunities[0].supporting_observation_ids).toEqual(["obs-1"]);
    expect(analysis.documented_workflows[0].observation_ids).toEqual(["obs-1"]);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it("caps evidence strength when nothing supports the opportunity", () => {
    const { analysis } = validateAnalysis({ ...base, opportunities: [{ ...opp, supporting_observation_ids: ["obs-99"] }] }, observations);
    expect(analysis.opportunities[0].ratings.evidence_strength).toBe(2);
  });

  it("records insufficient evidence when no opportunities are returned", () => {
    const { analysis } = validateAnalysis({ ...base, opportunities: [] }, observations);
    expect(analysis.no_compelling_opportunity).toBe(true);
  });

  it("maps unknown categories to other", () => {
    const { analysis } = validateAnalysis({ ...base, opportunities: [{ ...opp, category: "blockchain" }] }, observations);
    expect(analysis.opportunities[0].category).toBe("other");
  });
});

describe("validateOutreach", () => {
  const observations = [{ id: "obs-1", kind: "verified" as const, category: "booking", statement: "Call to schedule" }];
  it("flags unsupported claims, missing claim text, placeholders and statistics", () => {
    const { draft, warnings } = validateOutreach(
      {
        subject: "Hi",
        body: "Hi [Name], I noticed your site asks customers to call to schedule. Shops like yours save 30% with online booking.",
        claims: [
          { text: "asks customers to call to schedule", observation_ids: ["obs-1"] },
          { text: "save 30% with online booking", observation_ids: [] },
          { text: "this phrase is not in the body", observation_ids: ["obs-1"] },
        ],
      },
      observations,
    );
    expect(draft.claims[0].observation_ids).toEqual(["obs-1"]);
    expect(warnings.some((w) => w.startsWith("Unsupported claim"))).toBe(true);
    expect(warnings.some((w) => w.includes("not found verbatim"))).toBe(true);
    expect(warnings.some((w) => w.includes("placeholder"))).toBe(true);
    expect(warnings.some((w) => w.includes("percentage"))).toBe(true);
  });
  it("passes a clean draft without warnings", () => {
    const { warnings } = validateOutreach({ subject: "s", body: "Your site asks customers to call to schedule. Would a quick chat be useful?", claims: [{ text: "asks customers to call to schedule", observation_ids: ["obs-1"] }] }, observations);
    expect(warnings).toEqual([]);
  });
});
