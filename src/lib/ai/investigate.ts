/**
 * One model call per business: profile facts (quote-grounded) + opportunity
 * hypotheses (fact-cited) + verdict. Everything is validated in code:
 * quotes must appear verbatim in the cited page, cited fact keys must exist.
 */
import { getConfig } from "@/lib/config";
import { getPlaybook, OPPORTUNITY_CATEGORY_KEYS, type OpportunityCategory } from "@/lib/industries";
import { FACT_BY_KEY, type FactKey } from "@/lib/profile/fields";
import type { DetectedFact } from "@/lib/research/detect";
import { callStructured } from "./client";
import { investigateSystem } from "./prompts";
import { InvestigationSchema, type Investigation } from "./schemas";

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
const MAX_TOTAL_CHARS = 32_000;

export function buildInvestigationInput(business: { name: string; city?: string | null; region?: string | null; category?: string | null }, pages: PageForModel[], detected: DetectedFact[]): string {
  let budget = MAX_TOTAL_CHARS;
  const blocks: string[] = [];
  for (const p of pages) {
    if (budget <= 0) break;
    const text = p.text.slice(0, Math.min(MAX_CHARS_PER_PAGE, budget));
    budget -= text.length;
    blocks.push(`<page url="${p.url}" kind="${p.kind}" title="${(p.title ?? "").replace(/"/g, "'")}">\n${text}\n</page>`);
  }
  const det = detected.map((d) => `- ${d.key}: ${d.status}${d.value ? ` = ${d.value}` : ""}${d.evidenceQuote ? ` (${d.evidenceQuote})` : ""}`).join("\n");
  return `Business: ${business.name}${business.category ? ` (${business.category})` : ""}
Location: ${[business.city, business.region].filter(Boolean).join(", ") || "unknown"}

Already detected from page resources (treat as given):
${det || "(none)"}

<website_content>
${blocks.join("\n\n")}
</website_content>

Produce the profile facts, workflows, opportunities and verdict.`;
}

export interface ValidatedFact {
  key: FactKey;
  status: "verified" | "not_found";
  value: string | null;
  evidenceQuote: string | null;
  sourceUrl: string | null;
}

export interface InvestigationOutcome {
  facts: ValidatedFact[];
  rejected: { key: string; reason: string }[];
  workflows: { name: string; factKeys: string[] }[];
  opportunities: Investigation["opportunities"];
  verdict: "opportunity" | "no_opportunity";
  verdictReason: string;
  warnings: string[];
  model: string;
  costUsd: number;
}

export async function investigateWithModel(business: { id: string; name: string; industry: string; city?: string | null; region?: string | null; category?: string | null }, pages: PageForModel[], detected: DetectedFact[]): Promise<InvestigationOutcome> {
  const cfg = getConfig();
  const result = await callStructured({
    stage: "investigate",
    effort: cfg.AI_INVESTIGATE_EFFORT,
    system: investigateSystem(getPlaybook(business.industry)),
    user: buildInvestigationInput(business, pages, detected),
    schema: InvestigationSchema,
    businessId: business.id,
  });
  return { ...validateInvestigation(result.data, pages, detected), model: result.model, costUsd: result.usage.costUsd };
}

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

  const known = new Set([...facts.keys()]);
  const verifiedKeys = new Set([...facts.values()].filter((f) => f.status === "verified").map((f) => f.key));
  const filterKeys = (keys: string[], ctx: string) => {
    const ok = keys.filter((k) => known.has(k as FactKey));
    if (ok.length !== keys.length) warnings.push(`${ctx}: dropped ${keys.length - ok.length} citation(s) to fact keys that were not established`);
    return [...new Set(ok)];
  };
  const opportunities = data.opportunities.map((o, i) => {
    const category = (OPPORTUNITY_CATEGORY_KEYS as string[]).includes(o.category) ? (o.category as OpportunityCategory) : "other";
    if (category !== o.category) warnings.push(`Opportunity ${i + 1}: unknown category "${o.category}" mapped to "other"`);
    const supporting = filterKeys(o.supporting_fact_keys, `Opportunity ${i + 1}`);
    let ratings = o.ratings;
    if (!supporting.some((k) => verifiedKeys.has(k as FactKey)) && ratings.evidence_strength > 2) {
      warnings.push(`Opportunity ${i + 1}: evidence_strength lowered to 2 because no verified fact supports it`);
      ratings = { ...ratings, evidence_strength: 2 };
    }
    return { ...o, category, supporting_fact_keys: supporting, ratings };
  });
  const workflows = data.workflows.map((w) => ({ name: w.name, factKeys: filterKeys(w.fact_keys, `Workflow "${w.name}"`) }));
  let verdict = data.verdict;
  if (!opportunities.length && verdict !== "no_opportunity") {
    verdict = "no_opportunity";
    warnings.push("Model returned no opportunities; verdict set to no_opportunity");
  }
  if (opportunities.length && verdict === "no_opportunity") {
    warnings.push("Model returned opportunities with a no_opportunity verdict; opportunities kept, verdict set to opportunity");
    verdict = "opportunity";
  }
  return { facts: [...facts.values()], rejected, workflows, opportunities, verdict, verdictReason: data.verdict_reason, warnings };
}
