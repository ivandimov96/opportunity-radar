/**
 * Rule-based opportunity hypotheses: deterministic patterns over verified
 * facts and explicit gaps. They give every investigated business a baseline
 * verdict without a model call, and they are the productizable patterns the
 * Patterns page counts. Each rule names the facts it rests on; the handler
 * scores them with the same code as model hypotheses and labels them "rules".
 * Wording is deliberately hypothetical: a gap on the website is a reason to
 * ask, never proof of how the business operates internally.
 */
import type { Investigation } from "@/lib/ai/schemas";
import type { IndustryPlaybook } from "@/lib/industries";

export type RuleOpportunity = Investigation["opportunities"][number] & { ruleId: string };

export interface FactLike {
  key: string;
  status: string;
  value: string | null;
}

interface Rule {
  id: string;
  /** Weak rules rest on gaps alone and apply to most small sites; they are kept only when few strong patterns fired. */
  weak?: boolean;
  when: (f: FactIndex) => boolean;
  build: (f: FactIndex, playbook: IndustryPlaybook) => Omit<RuleOpportunity, "ruleId">;
}

/** Weak (gap-only) rules are added only while fewer than this many hypotheses exist. */
const MAX_WITH_WEAK = 3;

class FactIndex {
  private map = new Map<string, FactLike>();
  constructor(facts: FactLike[]) {
    for (const f of facts) this.map.set(f.key, f);
  }
  verified(key: string) {
    return this.map.get(key)?.status === "verified";
  }
  gap(key: string) {
    return this.map.get(key)?.status === "not_found";
  }
  value(key: string) {
    return this.map.get(key)?.value ?? null;
  }
  has(key: string) {
    return this.map.has(key);
  }
  is(key: string, ...values: string[]) {
    const v = this.value(key);
    return this.verified(key) && v != null && values.includes(v);
  }
  includes(key: string, re: RegExp) {
    const v = this.value(key);
    return this.verified(key) && v != null && re.test(v);
  }
}

const R = (value: number, feasibility: number, evidence: number, readiness: number) => ({ value, feasibility, evidence_strength: evidence, buying_readiness: readiness });

const RULES: Rule[] = [
  {
    id: "no_online_booking",
    when: (f) => f.is("booking_method", "phone_only", "walk_in") && f.gap("booking_tool"),
    build: (f) => ({
      category: "online_booking",
      title: "Customers can only book by phone or walk-in",
      problem_hypothesis: `The site asks customers to ${f.value("booking_method") === "walk_in" ? "walk in" : "call"} to get service and no scheduling tool is present. If the front desk handles every booking by phone, after-hours requests and peak-time calls may be lost.`,
      proposed_solution: "Add online appointment requests that land in the existing workflow (calendar or shop system), with confirmation and reminder texts.",
      why_not_existing_tool: "Off-the-shelf schedulers exist (Square Appointments, AutoOps, Shopgenie); the opportunity is often integration and setup around the tool they already use rather than new software. Confirm which tools they run before proposing anything custom.",
      expected_value: "Captures requests that arrive outside opening hours and reduces phone time at the counter; value depends on call volume and missed-call rate.",
      supporting_fact_keys: ["booking_method", "booking_tool", ...(f.has("shop_management_tool") ? ["shop_management_tool"] : [])],
      assumptions: ["Bookings are actually handled by phone (not through a third-party listing such as Google Business Profile).", "The owner wants more appointment volume or less counter time."],
      validation_questions: ["How do most customers book today, and how many requests come in after hours?", "Do you lose calls during busy periods?", "Which shop system holds the schedule?"],
      implementation_effort: "small",
      reusability: "high",
      risks: ["They may prefer phone contact deliberately (triage, upsell).", "A listing-based booking (Google) may already exist off-site."],
      sales_angle: "Your site asks customers to call to schedule; many shops like yours add a simple online request that drops into the same calendar.",
      ratings: R(4, 4, 3, 3),
    }),
  },
  {
    id: "request_form_without_scheduling",
    when: (f) => f.is("booking_method", "online_form") && f.gap("booking_tool"),
    build: () => ({
      category: "online_booking",
      title: "Request form without real scheduling",
      problem_hypothesis: "Customers can submit a request form, but there is no scheduling tool: each request may need a manual call-back before an appointment is set.",
      proposed_solution: "Turn the request form into a booking flow with available slots and automatic confirmation, or connect form submissions to the shop calendar.",
      why_not_existing_tool: "A hosted scheduler might replace the form; check whether the form feeds a CRM already.",
      expected_value: "Fewer call-backs and faster time-to-appointment; value scales with form volume.",
      supporting_fact_keys: ["booking_method", "booking_tool", "contact_form"],
      assumptions: ["Form submissions are handled manually.", "Appointment availability is predictable enough to publish."],
      validation_questions: ["What happens after someone submits the form?", "How long until they get an appointment?"],
      implementation_effort: "small",
      reusability: "high",
      risks: ["Some shops prefer to qualify requests by phone first."],
      sales_angle: "Your request form is a good start; the next step most shops take is letting customers pick a slot directly.",
      ratings: R(3, 4, 3, 3),
    }),
  },
  {
    id: "no_status_updates_channel",
    weak: true,
    when: (f) => f.gap("customer_updates") && f.gap("chat_tool"),
    build: (f) => ({
      category: "customer_communication",
      title: "No visible customer update channel (text/chat)",
      problem_hypothesis: "The site does not mention text updates, digital inspections or chat. Customers may be calling for status, and staff may be spending counter time on update calls.",
      proposed_solution: "Two-way SMS status updates and approvals tied to the job (check-in, estimate ready, done), with a shared inbox for the front desk.",
      why_not_existing_tool: f.verified("shop_management_tool") ? `Their shop system (${f.value("shop_management_tool")}) may include texting; the opportunity may be enabling and integrating it rather than building it.` : "Vertical shop systems bundle texting; if they run one, enabling it is the better answer. If they do not, a lightweight standalone flow fits.",
      expected_value: "Fewer inbound status calls and faster approvals; value depends on daily job count.",
      supporting_fact_keys: ["customer_updates", "chat_tool", ...(f.has("shop_management_tool") ? ["shop_management_tool"] : [])],
      assumptions: ["Status updates happen by phone today.", "Customers would accept text updates."],
      validation_questions: ["How do customers find out their vehicle is ready or an estimate needs approval?", "How many status calls per day does the front desk take?"],
      implementation_effort: "medium",
      reusability: "high",
      risks: ["The shop may already text through a system not visible on the website."],
      sales_angle: "Nothing on your site mentions text updates; shops that add them usually cut status calls noticeably.",
      ratings: R(4, 3, 2, 2),
    }),
  },
  {
    id: "no_reminder_program",
    weak: true,
    when: (f) => f.gap("maintenance_plans") && f.gap("customer_updates") && !f.includes("email_senders", /mailchimp|constant contact|kukui|steer|podium|birdeye|hubspot|klaviyo|brevo/i) && f.gap("marketing_tool"),
    build: () => ({
      category: "reminder_automation",
      title: "No maintenance reminder or follow-up program visible",
      problem_hypothesis: "No maintenance plan, reminder service or marketing sender is visible on the site or in the domain's email records. Repeat visits may depend on customers remembering on their own.",
      proposed_solution: "Automated service reminders (mileage/time based) by text or email, driven from the shop system's invoice history.",
      why_not_existing_tool: "Kukui, Steer and shop-system add-ons do this; the opening is often that nothing is set up, so setup plus integration beats custom software.",
      expected_value: "Higher return-visit rate on routine services; even a small lift matters because reminders are cheap.",
      supporting_fact_keys: ["maintenance_plans", "customer_updates", "marketing_tool", "email_senders"],
      assumptions: ["No reminder program runs off-site.", "Service history is in a system that can export it."],
      validation_questions: ["Do you remind customers when the next service is due? How?", "Where does invoice history live?"],
      implementation_effort: "medium",
      reusability: "high",
      risks: ["Reminders may already be sent by a vendor not visible to us."],
      sales_angle: "We could not find any reminder program; a simple due-service reminder usually pays for itself quickly.",
      ratings: R(3, 4, 2, 2),
    }),
  },
  {
    id: "fleet_without_portal",
    when: (f) => f.verified("fleet_program"),
    build: () => ({
      category: "fleet_b2b",
      title: "Fleet accounts offered without a visible account portal",
      problem_hypothesis: "The site advertises fleet/commercial service. Fleet managers usually want vehicle history, approvals and consolidated billing; if that runs on email and phone, it may be a reporting and approval bottleneck.",
      proposed_solution: "A small fleet portal: vehicles, service history, estimate approvals and monthly statements, fed from the shop system.",
      why_not_existing_tool: "Some shop systems have fleet modules; the custom part is usually the customer-facing view and the billing export.",
      expected_value: "Stickier B2B accounts and faster approvals; fleets are the highest-value customers for a shop.",
      supporting_fact_keys: ["fleet_program", ...(["shop_management_tool", "booking_method"] as const)],
      assumptions: ["Fleet customers are a meaningful share of revenue.", "Approvals and reporting happen manually today."],
      validation_questions: ["How many fleet accounts do you serve, and how do they approve work?", "How do you report to them each month?"],
      implementation_effort: "medium",
      reusability: "medium",
      risks: ["Fleet volume may be too small to justify a portal."],
      sales_angle: "You serve fleets; a simple portal for approvals and history is something fleet managers ask for.",
      ratings: R(4, 3, 3, 3),
    }),
  },
  {
    id: "estimates_without_followup",
    when: (f) => f.is("estimate_policy", "free_estimates", "quote_on_request") && f.gap("shop_management_tool"),
    build: () => ({
      category: "estimate_quote_followup",
      title: "Free estimates with no visible follow-up tooling",
      problem_hypothesis: "Free estimates are advertised and no shop management system is detected. Estimates that are not approved on the spot may not be followed up systematically.",
      proposed_solution: "Estimate tracking with automatic follow-up messages and one-click approval links.",
      why_not_existing_tool: "If they adopt a shop system, estimate follow-up comes with it; a lightweight add-on fits shops that will not switch systems.",
      expected_value: "Recovering a share of unapproved estimates is direct revenue.",
      supporting_fact_keys: ["estimate_policy", "shop_management_tool", ...(["contact_form", "booking_method"] as const)],
      assumptions: ["A meaningful share of estimates are not approved immediately.", "Estimates are written in a tool that can be exported, or on paper."],
      validation_questions: ["How many estimates per week are not approved on the spot?", "Who follows up, and how?"],
      implementation_effort: "small",
      reusability: "high",
      risks: ["Estimates may be approved in person for most jobs."],
      sales_angle: "You offer free estimates; following up the ones that leave undecided is where shops recover real revenue.",
      ratings: R(4, 4, 3, 3),
    }),
  },
  {
    id: "website_lead_capture",
    when: (f) => (f.gap("contact_form") && f.gap("booking_tool") && f.gap("chat_tool")) || f.includes("website_health", /no mobile viewport/) || (f.verified("website_updated") && Number(f.value("website_updated")) <= new Date().getFullYear() - 3),
    build: (f) => {
      const stale = f.verified("website_updated") && Number(f.value("website_updated")) <= new Date().getFullYear() - 3;
      const noMobile = f.includes("website_health", /no mobile viewport/);
      return {
        category: "website_conversion",
        title: noMobile ? "Website is not mobile-ready" : stale ? `Website looks unmaintained (latest year ${f.value("website_updated")})` : "Website has no way to capture a lead",
        problem_hypothesis: noMobile ? "The homepage has no mobile viewport, so phone visitors see a desktop layout. Most local searches happen on phones; conversion may suffer." : stale ? "The newest dated content on the site is years old. Visitors may read it as inactive, and the site likely lacks modern lead capture." : "There is no form, booking tool or chat on the pages fetched; the only path is a phone call, which filters out visitors browsing after hours.",
        proposed_solution: noMobile ? "A mobile-first refresh of the key pages with click-to-call and a request form." : stale ? "A light rebuild on a maintained platform with a request form, current hours and reviews." : "A request form or booking widget with instant confirmation, routed to the front desk.",
        why_not_existing_tool: "Website builders cover this; the value we add is the workflow behind the form (routing, follow-up) rather than the page itself.",
        expected_value: "More captured leads from existing traffic; low cost, modest but reliable value.",
        supporting_fact_keys: ["contact_form", "booking_tool", "chat_tool", ...(f.has("website_health") ? ["website_health"] : []), ...(f.has("website_updated") ? ["website_updated"] : []), ...(f.has("website_platform") ? ["website_platform"] : [])],
        assumptions: ["The website receives meaningful local search traffic."],
        validation_questions: ["Where do most new customers come from?", "Has the website brought in requests?"],
        implementation_effort: "small",
        reusability: "high",
        risks: ["Reputation may drive most business, making the site secondary."],
        sales_angle: noMobile ? "Your site shows as a desktop page on phones; a mobile-ready version with click-to-call is a quick win." : stale ? "Your site's newest content is from a few years ago; a light refresh with a request form keeps it working for you." : "Visitors can only call you; a short request form catches the ones browsing at night.",
        ratings: R(3, 5, noMobile || stale ? 3 : 2, 2),
      };
    },
  },
  {
    id: "no_review_program",
    weak: true,
    when: (f) => f.gap("review_tool") && f.gap("reviews_on_site") && !f.includes("email_senders", /podium|birdeye|nicejob/i),
    build: () => ({
      category: "review_reputation",
      title: "No review collection visible",
      problem_hypothesis: "Neither a review tool nor testimonials appear on the site. Reviews may be collected ad hoc, which usually means fewer and older reviews than competitors.",
      proposed_solution: "Automated post-service review requests by text, with a simple page that highlights recent reviews.",
      why_not_existing_tool: "Podium, Birdeye and NiceJob do exactly this; a small shop may prefer a cheaper, simpler flow integrated with its invoicing.",
      expected_value: "Local search ranking and conversion improve with review volume and recency.",
      supporting_fact_keys: ["review_tool", "reviews_on_site"],
      assumptions: ["Reviews matter for their customer acquisition.", "They are not already using a review tool off-site."],
      validation_questions: ["How do you ask customers for reviews today?", "Roughly how many reviews do you get per month?"],
      implementation_effort: "small",
      reusability: "high",
      risks: ["Review counts on Google may already be healthy."],
      sales_angle: "We did not see reviews or a review tool on your site; an automatic request after each job is the cheapest marketing a shop can do.",
      ratings: R(2, 4, 2, 2),
    }),
  },
  {
    id: "shop_system_integration",
    when: (f) => f.verified("shop_management_tool") && (f.gap("booking_tool") || f.gap("customer_updates")),
    build: (f) => ({
      category: "integration_automation",
      title: `${f.value("shop_management_tool")} in use, but booking or updates not connected`,
      problem_hypothesis: `A shop management system (${f.value("shop_management_tool")}) is detected, yet online booking or customer updates are not visible. Features may be unused or disconnected from the website.`,
      proposed_solution: "Connect the website to the shop system: booking requests, status texts and review requests driven by job status.",
      why_not_existing_tool: "The system likely has these features; the work is configuration and integration, which is exactly the kind of small project owners buy.",
      expected_value: "Gets value from software they already pay for; quick wins build trust for larger work.",
      supporting_fact_keys: ["shop_management_tool", ...(f.has("booking_tool") ? ["booking_tool"] : []), ...(f.has("customer_updates") ? ["customer_updates"] : [])],
      assumptions: ["The detected system is the one they actually operate on.", "Its booking/texting features are not configured."],
      validation_questions: ["Which features of your shop system do you use day to day?", "Does your website talk to it?"],
      implementation_effort: "small",
      reusability: "high",
      risks: ["The vendor may lock integrations behind higher plans."],
      sales_angle: "You run a modern shop system; we often help shops switch on the parts that connect to the website and customers.",
      ratings: R(3, 5, 4, 3),
    }),
  },
  {
    id: "financing_without_provider",
    when: (f) => f.verified("financing") && f.gap("financing_provider"),
    build: () => ({
      category: "invoicing_payments",
      title: "Financing advertised without an integrated provider",
      problem_hypothesis: "Financing is advertised but no financing provider widget is detected. Customers may have to ask at the counter, which lowers uptake on large repairs.",
      proposed_solution: "Integrate an existing consumer financing provider (prequalification link on estimates and the website).",
      why_not_existing_tool: "Providers (Wisetack, Sunbit, Synchrony) supply the product; the work is integration into estimates and the site.",
      expected_value: "Higher approval rate on large repairs.",
      supporting_fact_keys: ["financing", "financing_provider"],
      assumptions: ["Large repairs are a meaningful share of revenue."],
      validation_questions: ["How do customers apply for financing today?"],
      implementation_effort: "small",
      reusability: "medium",
      risks: ["A provider may be used in-store without a web widget."],
      sales_angle: "You mention financing; putting a prequalification link on estimates typically raises uptake.",
      ratings: R(2, 4, 3, 2),
    }),
  },
];

export function ruleOpportunities(facts: FactLike[], playbook: IndustryPlaybook): RuleOpportunity[] {
  const idx = new FactIndex(facts);
  const known = new Set(facts.map((f) => f.key));
  const out: RuleOpportunity[] = [];
  const fired = RULES.filter((r) => r.when(idx));
  const strong = fired.filter((r) => !r.weak);
  const weak = fired.filter((r) => r.weak).slice(0, Math.max(0, MAX_WITH_WEAK - strong.length));
  for (const rule of [...strong, ...weak]) {
    const o = rule.build(idx, playbook);
    out.push({ ...o, supporting_fact_keys: [...new Set(o.supporting_fact_keys.filter((k) => known.has(k)))], ruleId: rule.id });
  }
  return out;
}

export const RULE_IDS = RULES.map((r) => r.id);
