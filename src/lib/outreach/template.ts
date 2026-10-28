/**
 * Template outreach drafts: no model, no invented facts. Every company-specific
 * sentence comes from a verified fact or an explicit gap and is registered as a
 * claim with its fact keys, so the editor highlights it exactly like a model
 * draft. Used when AI is not configured (or over its spend limit).
 */
import type { FactForOutreach, OpportunityForOutreach } from "@/lib/ai/outreach";
import type { OutreachStyle } from "@/lib/ai/prompts";

export interface TemplateDraft {
  subject: string;
  body: string;
  claims: { text: string; fact_keys: string[] }[];
}

type Sentence = { text: string; keys: string[] } | null;

const first = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** One grounded sentence per fact key we know how to phrase; null when the value cannot be phrased safely. */
function phraseFact(f: FactForOutreach): Sentence {
  const v = (f.value ?? "").trim();
  if (f.status === "not_found") {
    const gapText: Record<string, string> = {
      booking_tool: "I didn't see a way to book online",
      customer_updates: "I didn't see any mention of text or email status updates",
      maintenance_plans: "I didn't see a maintenance plan or reminder program",
      review_tool: "I didn't see a review-request tool on the site",
      reviews_on_site: "I didn't see customer reviews on the site",
      contact_form: "I didn't see a request form on the site",
      chat_tool: "I didn't see website chat",
      financing_provider: "I didn't see a financing provider linked on the site",
      shop_management_tool: "I couldn't tell which shop system you run",
      email_senders: "I didn't see any email marketing service set up on your domain",
    };
    return gapText[f.key] ? { text: gapText[f.key], keys: [f.key] } : null;
  }
  if (f.status !== "verified" || !v) return null;
  switch (f.key) {
    case "booking_method":
      return v === "phone_only" ? { text: "your site asks customers to call to schedule", keys: [f.key] } : v === "walk_in" ? { text: "your site invites walk-ins", keys: [f.key] } : v === "online_form" ? { text: "customers can send a request through your form", keys: [f.key] } : v === "online_booking" ? { text: "customers can already book online", keys: [f.key] } : null;
    case "estimate_policy":
      return v === "free_estimates" ? { text: "you offer free estimates", keys: [f.key] } : v === "diagnostic_fee" ? { text: "you charge a diagnostic fee", keys: [f.key] } : null;
    case "fleet_program":
      return { text: "you serve fleet and commercial customers", keys: [f.key] };
    case "financing":
      return { text: "you offer financing", keys: [f.key] };
    case "years_in_business":
      return { text: `you have been around ${/^\d{4}$/.test(v) ? `since ${v}` : v.toLowerCase().startsWith("since") || v.toLowerCase().startsWith("over") || v.toLowerCase().startsWith("more") ? v.toLowerCase() : "for a long time"}`, keys: [f.key] };
    case "shop_management_tool":
      return { text: `you run ${v}`, keys: [f.key] };
    case "booking_tool":
      return { text: `you use ${v} for booking`, keys: [f.key] };
    case "customer_updates":
      return { text: `you already keep customers updated (${v})`, keys: [f.key] };
    case "website_health":
      return /no mobile viewport/.test(v) ? { text: "your site shows the desktop layout on phones", keys: [f.key] } : null;
    case "website_updated":
      return Number(v) <= new Date().getFullYear() - 3 ? { text: `the newest dated content on your site is from ${v}`, keys: [f.key] } : null;
    case "services":
      return { text: `you handle ${v.split(",").slice(0, 3).map((x) => x.trim().toLowerCase()).join(", ")}`, keys: [f.key] };
    default:
      return null;
  }
}

function joinSentences(parts: Sentence[]): { text: string; claims: { text: string; fact_keys: string[] }[] } {
  const kept = parts.filter((p): p is NonNullable<Sentence> => !!p);
  if (!kept.length) return { text: "", claims: [] };
  const list = kept.map((p) => p.text);
  const joined = list.length === 1 ? list[0] : list.length === 2 ? `${list[0]} and ${list[1]}` : `${list.slice(0, -1).join(", ")}, and ${list[list.length - 1]}`;
  return { text: joined, claims: kept.map((p) => ({ text: p.text, fact_keys: p.keys })) };
}

export function draftFromTemplate(business: { name: string; city?: string | null }, opportunity: OpportunityForOutreach, facts: FactForOutreach[], style: OutreachStyle, senderName?: string | null): TemplateDraft {
  const byKey = new Map(facts.map((f) => [f.key, f]));
  const supporting = opportunity.supportingFactKeys.map((k) => byKey.get(k)).filter((f): f is FactForOutreach => !!f);
  const verifiedS = supporting.filter((f) => f.status === "verified").map(phraseFact).filter(Boolean).slice(0, style === "consultative" ? 3 : 2);
  const gapS = supporting.filter((f) => f.status === "not_found").map(phraseFact).filter(Boolean).slice(0, style === "consultative" ? 2 : 1);
  // If the opportunity cites nothing phrasable, fall back to any phrasable verified fact so the email is still specific.
  const extra = verifiedS.length ? [] : facts.filter((f) => f.status === "verified" && !supporting.includes(f)).map(phraseFact).filter(Boolean).slice(0, 1);
  const seen = joinSentences([...verifiedS, ...extra]);
  const gaps = joinSentences(gapS);
  const question = opportunity.validationQuestions[0] ?? "How does that work for you today?";
  const name = business.name.replace(/\s*\(demo\)\s*/i, "");
  const greeting = style === "casual" ? `Hi ${name} team,` : `Hello ${name} team,`;
  const intro = style === "casual" ? "I spent a few minutes on your website" : "I looked through your website";
  const claims: { text: string; fact_keys: string[] }[] = [...seen.claims, ...gaps.claims];

  const lines: string[] = [greeting, ""];
  let observed = `${intro}${seen.text ? ` and noticed that ${seen.text}` : ""}.`;
  if (gaps.text) observed += ` ${first(gaps.text)}.`;
  lines.push(observed);
  lines.push("");
  const idea = style === "consultative" ? `That made me wonder whether this is worth a look: ${lowerFirst(opportunity.problemHypothesis)} ${opportunity.proposedSolution.endsWith(".") ? opportunity.proposedSolution : `${opportunity.proposedSolution}.`}` : `One idea, offered as a question rather than a pitch: ${lowerFirst(opportunity.proposedSolution)}${opportunity.proposedSolution.endsWith(".") ? "" : "."}`;
  lines.push(idea);
  lines.push("");
  lines.push(`${question}${question.endsWith("?") ? "" : "?"} If it is not a problem for you, that is useful to know too.`);
  lines.push("");
  lines.push(style === "casual" ? "Happy to compare notes for 15 minutes whenever suits you." : "If a short call is useful, I am glad to find a time that suits you.");
  lines.push("");
  lines.push(senderName?.trim() ? `${senderName.trim()}` : "The Opportunity Radar team");
  const body = lines.join("\n");
  const subject = style === "casual" ? `A quick thought for ${name}` : `${opportunity.title} — a question for ${name}`;
  return { subject, body, claims };
}

function lowerFirst(s: string) {
  return s.charAt(0).toLowerCase() + s.slice(1);
}
