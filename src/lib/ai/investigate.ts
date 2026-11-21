/**
 * One model call per business: profile facts (quote-grounded), observations
 * (quote-grounded), and ONE consolidated opportunity with its components (plus
 * at most two independent secondary ideas), or an explicit "no opportunity".
 * Everything is validated in code: quotes must appear verbatim in the cited
 * page, cited evidence must exist, unsupported parts are dropped, and the
 * model's "no" is final.
 */
import { getConfig } from "@/lib/config";
import { getPlaybook, OPPORTUNITY_CATEGORY_KEYS, SOLUTION_SCOPE_KEYS, type OpportunityCategory } from "@/lib/industries";
import { FACT_BY_KEY, type FactKey } from "@/lib/profile/fields";
import type { DetectedFact } from "@/lib/research/detect";
import { MODEL_CHARS_BY_KIND, MODEL_READ_ORDER, type PageKind } from "@/lib/research/html";
import { callStructured } from "./client";
import type { SellerProfile } from "@/lib/seller";
import { investigateSystem } from "./prompts";
import { InvestigationSchema, type Investigation, type ObservationKind, type OpportunityOutput } from "./schemas";

export interface PageForModel {
  url: string;
  kind: string;
  title: string | null;
  text: string;
}

const norm = (s: string) => s.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();

/** Exported for tests: is `quote` (normalized) contained in `text` (normalized)? Tolerates trimmed ends. */
export function quoteAppearsIn(quote: string, text: string): boolean {
  const q = norm(quote);
  const t = norm(text);
  if (!q || q.length < 6) return false;
  if (t.includes(q)) return true;
  if (q.length > 60) return t.includes(q.slice(10, q.length - 10));
  return false;
}

const MAX_CHARS_PER_PAGE = 9_000;
const MAX_TOTAL_CHARS = 40_000;

/** Pages in the order the model should read them (see MODEL_READ_ORDER); crawl order is kept within a kind. */
export function orderForModel<T extends { kind: string }>(pages: T[]): T[] {
  const rank = (k: string) => {
    const i = MODEL_READ_ORDER.indexOf(k as PageKind);
    return i === -1 ? MODEL_READ_ORDER.indexOf("other") : i;
  };
  return pages.map((p, i) => ({ p, i })).sort((a, b) => rank(a.p.kind) - rank(b.p.kind) || a.i - b.i).map((x) => x.p);
}

export interface InvestigationContext {
  /** What the listing says about activity and size (rating, review count), when known. */
  listing?: string | null;
  /** Fixed rule patterns that fired on the detected facts: candidates for the model to weigh, not conclusions. */
  patterns?: { category: string; title: string; keys: string[] }[];
  /** Who the research is for. Without one, the built-in software consultancy. */
  seller?: SellerProfile;
}

export function buildInvestigationInput(business: { name: string; city?: string | null; region?: string | null; category?: string | null }, pages: PageForModel[], detected: DetectedFact[], ctx: InvestigationContext = {}): string {
  let budget = MAX_TOTAL_CHARS;
  const blocks: string[] = [];
  for (const p of orderForModel(pages)) {
    if (budget <= 0) break;
    const text = p.text.slice(0, Math.min(MODEL_CHARS_BY_KIND[p.kind as PageKind] ?? MAX_CHARS_PER_PAGE, budget));
    budget -= text.length;
    blocks.push(`<page url="${p.url}" kind="${p.kind}" title="${(p.title ?? "").replace(/"/g, "'")}">\n${text}\n</page>`);
  }
  const det = detected.map((d) => `- ${d.key}: ${d.status}${d.value ? ` = ${d.value}` : ""}${d.evidenceQuote ? ` (${d.evidenceQuote})` : ""}`).join("\n");
  const patterns = (ctx.patterns ?? []).map((p) => `- [${p.category}] ${p.title} (rests on: ${p.keys.join(", ") || "nothing"})`).join("\n");
  return `Business: ${business.name}${business.category ? ` (${business.category})` : ""}
Location: ${[business.city, business.region].filter(Boolean).join(", ") || "unknown"}${ctx.listing ? `\nListing: ${ctx.listing}` : ""}

Already detected from page resources (treat as given):
${det || "(none)"}

Patterns a fixed rule set matched on those facts (candidates to weigh, not conclusions; ignore any that do not hold up):
${patterns || "(none)"}

<website_content>
${blocks.join("\n\n")}
</website_content>

Produce the profile facts, the observations, and the consolidated opportunity or a no_opportunity verdict.`;
}

export interface ValidatedFact {
  key: FactKey;
  status: "verified" | "not_found";
  value: string | null;
  evidenceQuote: string | null;
  sourceUrl: string | null;
}

export interface ValidatedObservation {
  ref: string;
  kind: ObservationKind;
  statement: string;
  evidenceQuote: string;
  sourceUrl: string;
}

export interface InvestigationOutcome {
  facts: ValidatedFact[];
  observations: ValidatedObservation[];
  rejected: { key: string; reason: string }[];
  /** Primary first (at most one), then at most two secondary. */
  opportunities: OpportunityOutput[];
  verdict: "opportunity" | "no_opportunity";
  verdictReason: string;
  warnings: string[];
  model: string;
  costUsd: number;
}

export async function investigateWithModel(business: { id: string; name: string; industry: string; city?: string | null; region?: string | null; category?: string | null }, pages: PageForModel[], detected: DetectedFact[], ctx: InvestigationContext = {}): Promise<InvestigationOutcome> {
  const cfg = getConfig();
  const result = await callStructured({
    stage: "investigate",
    effort: cfg.AI_INVESTIGATE_EFFORT,
    system: investigateSystem(getPlaybook(business.industry), ctx.seller),
    user: buildInvestigationInput(business, pages, detected, ctx),
    schema: InvestigationSchema,
    businessId: business.id,
  });
  return { ...validateInvestigation(result.data, pages, detected), model: result.model, costUsd: result.usage.costUsd };
}

export const MAX_OBSERVATIONS = 10;
export const MAX_SECONDARY = 2;
export const MIN_VERIFIED_FOR_ALTERNATIVE = 2;
export const MAX_COMPONENTS = 5;

export function validateInvestigation(data: Investigation, pages: PageForModel[], detected: DetectedFact[]): Omit<InvestigationOutcome, "model" | "costUsd"> {
  const byUrl = new Map(pages.map((p) => [norm(p.url), p]));
  const warnings: string[] = [];
  const rejected: { key: string; reason: string }[] = [];
  const facts = new Map<FactKey, ValidatedFact>();
  // Detected facts are authoritative for their keys.
  for (const d of detected) facts.set(d.key, { key: d.key, status: d.status === "unknown" ? "not_found" : d.status, value: d.value, evidenceQuote: d.evidenceQuote, sourceUrl: d.sourceUrl });
  const detectedVerified = new Set(detected.filter((d) => d.status === "verified" && d.key !== "summary").map((d) => d.key));

  for (const f of data.facts) {
    if (!FACT_BY_KEY[f.key]) {
      rejected.push({ key: f.key, reason: "unknown field" });
      continue;
    }
    const key = f.key as FactKey;
    if (detectedVerified.has(key)) continue; // never override a detected verified fact
    if (f.status === "not_found") {
      if (!facts.has(key)) facts.set(key, { key, status: "not_found", value: null, evidenceQuote: null, sourceUrl: null });
      continue;
    }
    const page = byUrl.get(norm(f.source_url));
    if (!page) {
      rejected.push({ key, reason: `source_url not among fetched pages (${f.source_url})` });
      continue;
    }
    if (!quoteAppearsIn(f.evidence_quote, page.text)) {
      rejected.push({ key, reason: "evidence quote not found verbatim in the cited page" });
      continue;
    }
    const field = FACT_BY_KEY[key];
    let value = f.value.trim();
    if ("options" in field && field.options && !(field.options as readonly string[]).includes(value)) {
      const m = (field.options as readonly string[]).find((o) => value.toLowerCase().includes(o.replace(/_/g, " ")) || value.toLowerCase().includes(o));
      if (m) value = m;
      else {
        warnings.push(`${key}: value "${value}" is not one of the allowed options; kept as free text`);
      }
    }
    facts.set(key, { key, status: "verified", value: value || null, evidenceQuote: f.evidence_quote.trim().slice(0, 400), sourceUrl: page.url });
  }

  // Observations: same rule as facts. No verbatim quote on the cited page, no observation.
  const observations: ValidatedObservation[] = [];
  const refs = new Set<string>();
  for (const o of data.observations ?? []) {
    const ref = o.ref.trim().toLowerCase();
    const label = `observation ${ref || "?"}`;
    if (!/^o\d{1,2}$/.test(ref) || refs.has(ref)) {
      rejected.push({ key: label, reason: "missing or duplicate ref" });
      continue;
    }
    const page = byUrl.get(norm(o.source_url));
    if (!page) {
      rejected.push({ key: label, reason: `source_url not among fetched pages (${o.source_url})` });
      continue;
    }
    if (!quoteAppearsIn(o.evidence_quote, page.text)) {
      rejected.push({ key: label, reason: "evidence quote not found verbatim in the cited page" });
      continue;
    }
    if (!o.statement.trim()) continue;
    if (observations.length >= MAX_OBSERVATIONS) break;
    refs.add(ref);
    observations.push({ ref, kind: o.kind, statement: o.statement.trim().slice(0, 300), evidenceQuote: o.evidence_quote.trim().slice(0, 400), sourceUrl: page.url });
  }

  const known = new Set<string>([...facts.keys(), ...refs]);
  const verified = new Set<string>([...[...facts.values()].filter((f) => f.status === "verified").map((f) => f.key as string), ...refs]);
  const keep = (keys: string[]) => [...new Set(keys.map((k) => k.trim()).filter((k) => known.has(k)))];

  let opportunities: OpportunityOutput[] = [];
  data.opportunities.forEach((o, i) => {
    const n = i + 1;
    const category = (OPPORTUNITY_CATEGORY_KEYS as string[]).includes(o.category) ? (o.category as OpportunityCategory) : "other";
    if (category !== o.category) warnings.push(`Opportunity ${n}: unknown category "${o.category}" mapped to "other"`);
    // A component stays only when it cites something that was actually established.
    const components = (o.components ?? []).map((c) => ({ name: c.name.trim(), description: c.description.trim(), evidence: keep(c.evidence) })).filter((c) => c.name && c.evidence.length).slice(0, MAX_COMPONENTS);
    const droppedComponents = (o.components ?? []).length - components.length;
    if (droppedComponents) warnings.push(`Opportunity ${n}: dropped ${droppedComponents} component(s) that cited no established evidence`);
    const own = keep(o.supporting_fact_keys);
    if (own.length !== new Set(o.supporting_fact_keys).size) warnings.push(`Opportunity ${n}: dropped ${new Set(o.supporting_fact_keys).size - own.length} citation(s) to evidence that was not established`);
    const supporting = [...new Set([...own, ...components.flatMap((c) => c.evidence)])];
    if (!supporting.length) {
      warnings.push(`Opportunity ${n} ("${o.title}"): dropped, no established evidence supports it`);
      return;
    }
    const clamp = (n: number) => Math.max(1, Math.min(5, Math.round(Number.isFinite(n) ? n : 3)));
    let ratings = { value: clamp(o.ratings.value), feasibility: clamp(o.ratings.feasibility), evidence_strength: clamp(o.ratings.evidence_strength) };
    if (!supporting.some((k) => verified.has(k)) && ratings.evidence_strength > 2) {
      warnings.push(`Opportunity ${n}: evidence_strength lowered to 2 because nothing verified supports it`);
      ratings = { ...ratings, evidence_strength: 2 };
    }
    const scope = (SOLUTION_SCOPE_KEYS as string[]).includes(o.scope) ? o.scope : "existing";
    opportunities.push({ ...o, category, scope, components, supporting_fact_keys: supporting, ratings });
  });

  // Exactly one primary: the first one marked so, or simply the first; the rest are secondary (at most two).
  if (opportunities.length) {
    const primaryIndex = Math.max(0, opportunities.findIndex((o) => o.role === "primary"));
    const primary = { ...opportunities[primaryIndex], role: "primary" as const };
    const verifiedCount = (o: OpportunityOutput) => o.supporting_fact_keys.filter((k) => verified.has(k)).length;
    const others = opportunities.filter((_, i) => i !== primaryIndex);
    // An alternative can be chosen for the email, so it needs verified ground of its own; the primary is judged by qualification.
    const rest = others.filter((o) => verifiedCount(o) >= MIN_VERIFIED_FOR_ALTERNATIVE).map((o) => ({ ...o, role: "secondary" as const }));
    if (rest.length < others.length) warnings.push(`Dropped ${others.length - rest.length} alternative idea(s) that rested on fewer than ${MIN_VERIFIED_FOR_ALTERNATIVE} verified facts`);
    if (rest.length > MAX_SECONDARY) warnings.push(`Kept ${MAX_SECONDARY} of ${rest.length} secondary opportunities`);
    opportunities = [primary, ...rest.slice(0, MAX_SECONDARY)];
  }

  let verdict = data.verdict;
  let verdictReason = data.verdict_reason;
  if (verdict === "no_opportunity" && opportunities.length) {
    // The model's "no" is final: leftovers it returned alongside it are not kept.
    warnings.push(`Model returned ${opportunities.length} opportunity(ies) with a no_opportunity verdict; they were dropped`);
    opportunities = [];
  }
  if (!opportunities.length && verdict !== "no_opportunity") {
    verdict = "no_opportunity";
    if (data.opportunities.length) {
      verdictReason = `The model's hypotheses cited no established evidence and were dropped. ${data.verdict_reason}`.trim();
      warnings.push("Every model opportunity was dropped for lack of established evidence; verdict set to no_opportunity");
    } else warnings.push("Model returned no opportunities; verdict set to no_opportunity");
  }
  return { facts: [...facts.values()], observations, rejected, opportunities, verdict, verdictReason, warnings };
}
