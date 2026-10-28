import { describe, expect, it } from "vitest";
import { classifyKind, leadScore } from "@/lib/scoring/lead";
import { ruleOpportunities } from "@/lib/scoring/rules";
import { getPlaybook } from "@/lib/industries";

describe("lead score & kind", () => {
  it("flags chains by name and by store-locator URLs", () => {
    expect(classifyKind({ name: "Firestone Complete Auto Care", industry: "auto_repair" }).kind).toBe("chain");
    expect(classifyKind({ name: "Caliber Collision", industry: "auto_repair", website: "https://calibercollision.com/locate-a-caliber-collision-center/austin" }).kind).toBe("chain");
    expect(classifyKind({ name: "Local Tire Co", industry: "auto_repair", website: "https://local.firestonecompleteautocare.com/texas/austin/2500-w-parmer-ln/" }).kind).toBe("chain");
    expect(classifyKind({ name: "Toyota of Austin", industry: "auto_repair" }).kind).toBe("chain");
    expect(classifyKind({ name: "Mercedes-Benz", industry: "auto_repair", website: "https://www.mercedesbenzofaustin.com" })).toMatchObject({ kind: "chain" });
    expect(classifyKind({ name: "Capitol Motors", industry: "auto_repair", website: "https://austintoyota.com" }).kind).toBe("chain");
    // Ordinary words that are also national brands elsewhere must not flag an independent shop.
    for (const name of ["Budget Auto Repair", "Enterprise Transmission", "Target Collision Center"]) expect(classifyKind({ name, industry: "auto_repair" }).kind).not.toBe("chain");
    expect(classifyKind({ name: "Enterprise Rent-A-Car", industry: "auto_repair" }).kind).toBe("chain");
    expect(classifyKind({ name: "Mercedes Specialists of Austin", industry: "auto_repair", website: "https://mercspecialists.com" }).kind).toBe("independent");
    expect(classifyKind({ name: "Swedish Auto Repair", industry: "auto_repair", website: "https://swedishautoservice.com" }).kind).toBe("independent");
    expect(classifyKind({ name: "Nameless", industry: "auto_repair" }).kind).toBe("unknown");
  });
  it("ranks independents with a site, phone and address above chains and listing-only records", () => {
    const strong = leadScore({ name: "Swedish Auto Repair", industry: "auto_repair", website: "https://swedishautoservice.com", phone: "5128360022", street: "11008 N Lamar", city: "Austin", category: "car_repair" });
    const noSite = leadScore({ name: "Joe's Garage", industry: "auto_repair", phone: "5125550100", city: "Austin", category: "car_repair" });
    const chain = leadScore({ name: "Firestone Complete Auto Care", industry: "auto_repair", website: "https://local.firestonecompleteautocare.com/texas/austin/x/", phone: "1", street: "s", city: "Austin", category: "car_repair" });
    const social = leadScore({ name: "FB Shop", industry: "auto_repair", website: "https://facebook.com/fbshop", city: "Austin" });
    expect(strong.score).toBeGreaterThan(noSite.score);
    expect(noSite.score).toBeGreaterThan(social.score);
    expect(strong.score).toBeGreaterThan(chain.score);
    expect(strong.reasons).toContain("category matches the playbook");
    expect(chain.kind).toBe("chain");
  });
});

describe("lead hints", () => {
  it("rewards maintained listings and established businesses, flags multi-outlet owners", () => {
    const base = { name: "Colvin Automotive", industry: "auto_repair", street: "2715 Hancock Dr", city: "Austin" };
    const plain = leadScore(base).score;
    expect(leadScore(base, { openingHours: true }).score).toBe(plain + 6);
    expect(leadScore(base, { yearsActive: 12 }).score).toBe(plain + 6);
    expect(leadScore(base, { yearsActive: 0.3 }).score).toBe(plain - 5);
    expect(leadScore(base, { outletCount: 2 }).score).toBe(plain - 5);
    const chainish = leadScore(base, { outletCount: 4 });
    expect(chainish.kind).toBe("chain");
    expect(chainish.reasons).toContain("4 outlets under the same owner");
  });
});

describe("rule engine", () => {
  const pb = getPlaybook("auto_repair");
  it("fires booking, updates, reminders, fleet and estimate rules on the matching fact pattern", () => {
    const facts = [
      { key: "booking_method", status: "verified", value: "phone_only" },
      { key: "booking_tool", status: "not_found", value: null },
      { key: "customer_updates", status: "not_found", value: null },
      { key: "chat_tool", status: "not_found", value: null },
      { key: "maintenance_plans", status: "not_found", value: null },
      { key: "marketing_tool", status: "not_found", value: null },
      { key: "fleet_program", status: "verified", value: "yes" },
      { key: "estimate_policy", status: "verified", value: "free_estimates" },
      { key: "shop_management_tool", status: "not_found", value: null },
      { key: "contact_form", status: "verified", value: "yes" },
      { key: "review_tool", status: "verified", value: "Podium" },
    ];
    const opps = ruleOpportunities(facts, pb);
    const ids = opps.map((o) => o.ruleId);
    // Three strong patterns fire; weak gap-only patterns (updates, reminders) stay out so the list stays focused.
    expect(ids).toEqual(["no_online_booking", "fleet_without_portal", "estimates_without_followup"]);
    expect(ids).not.toContain("no_review_program");
    expect(ids).not.toContain("website_lead_capture");
    // With fewer strong patterns, weak ones are added up to three hypotheses.
    const fewer = ruleOpportunities(facts.filter((f) => !["fleet_program", "estimate_policy"].includes(f.key)), pb).map((o) => o.ruleId);
    expect(fewer).toEqual(["no_online_booking", "no_status_updates_channel", "no_reminder_program"]);
    for (const o of opps) {
      expect(o.supporting_fact_keys.length).toBeGreaterThan(0);
      for (const k of o.supporting_fact_keys) expect(facts.map((f) => f.key)).toContain(k);
      expect(o.problem_hypothesis).toMatch(/may|if|usually|likely/i);
    }
  });
  it("stays quiet when the site shows a modern stack", () => {
    const facts = [
      { key: "booking_method", status: "verified", value: "online_booking" },
      { key: "booking_tool", status: "verified", value: "Shopgenie" },
      { key: "customer_updates", status: "verified", value: "text/SMS updates" },
      { key: "chat_tool", status: "verified", value: "Podium" },
      { key: "maintenance_plans", status: "verified", value: "yes" },
      { key: "review_tool", status: "verified", value: "Podium" },
      { key: "contact_form", status: "verified", value: "yes" },
      { key: "website_health", status: "verified", value: "HTTPS; mobile viewport; homepage 100 KB in 0.5 s" },
      { key: "website_updated", status: "verified", value: String(new Date().getFullYear()) },
    ];
    expect(ruleOpportunities(facts, pb)).toEqual([]);
  });
  it("flags unmaintained or non-mobile websites", () => {
    const old = ruleOpportunities([{ key: "website_updated", status: "verified", value: "2017" }, { key: "contact_form", status: "verified", value: "yes" }], pb);
    expect(old.map((o) => o.ruleId)).toContain("website_lead_capture");
    expect(old[0].title).toContain("2017");
  });
});
