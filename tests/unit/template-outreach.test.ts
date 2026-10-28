import { describe, expect, it } from "vitest";
import { draftFromTemplate } from "@/lib/outreach/template";
import { validateOutreach } from "@/lib/ai/outreach";

const facts = [
  { key: "booking_method", status: "verified", value: "phone_only" },
  { key: "estimate_policy", status: "verified", value: "free_estimates" },
  { key: "booking_tool", status: "not_found", value: null },
  { key: "customer_updates", status: "not_found", value: null },
  { key: "years_in_business", status: "verified", value: "Since 1998" },
  { key: "phone", status: "verified", value: "5125550100" },
];
const opp = { title: "Customers can only book by phone", category: "online_booking", problemHypothesis: "The site asks customers to call; after-hours requests may be lost.", proposedSolution: "Add online appointment requests that land in the existing calendar", supportingFactKeys: ["booking_method", "booking_tool", "years_in_business"], validationQuestions: ["How do most customers book today?"] };

describe("template outreach", () => {
  it("writes a grounded email whose claims are verbatim and mapped to known fact keys", () => {
    for (const style of ["concise", "consultative", "casual"] as const) {
      const d = draftFromTemplate({ name: "Barton Auto Care (Demo)" }, opp, facts, style, style === "casual" ? "Ivan" : null);
      expect(d.body).toContain("your site asks customers to call to schedule");
      expect(d.body).toContain("I didn't see a way to book online");
      expect(d.body).toContain("How do most customers book today?");
      expect(d.body).not.toMatch(/\[[^\]]+\]/);
      expect(d.claims.length).toBeGreaterThanOrEqual(2);
      const { warnings } = validateOutreach({ subject: d.subject, body: d.body, claims: d.claims }, facts);
      expect(warnings.filter((w) => /Unsupported claim|not found verbatim|placeholder/.test(w))).toEqual([]);
      expect(d.body.endsWith(style === "casual" ? "Ivan" : "The Opportunity Radar team")).toBe(true);
      expect(d.body).not.toContain("(Demo)");
    }
  });
  it("still produces a specific email when the opportunity cites no phrasable fact", () => {
    const d = draftFromTemplate({ name: "X" }, { ...opp, supportingFactKeys: ["phone"] }, facts, "concise");
    expect(d.claims.some((c) => c.fact_keys.includes("booking_method") || c.fact_keys.includes("estimate_policy") || c.fact_keys.includes("years_in_business"))).toBe(true);
  });
});
