/**
 * AI extraction stage: turns fetched page text into observations, then
 * VALIDATES every observation by checking the evidence quote actually appears
 * in the cited page. Unverifiable observations are rejected and counted.
 */
import { getConfig } from "@/lib/config";
import { callStructured } from "./client";
import { EXTRACTION_SYSTEM } from "./prompts";
import { ExtractionSchema } from "./schemas";

export interface PageForExtraction {
  url: string;
  kind: string;
  title: string | null;
  text: string;
}

export interface ValidatedObservation {
  category: string;
  statement: string;
  evidenceQuote: string;
  sourceUrl: string;
}

export interface ExtractionOutcome {
  accepted: ValidatedObservation[];
  rejected: { statement: string; reason: string }[];
  unknowns: { topic: string; note: string }[];
  model: string;
  costUsd: number;
}

const norm = (s: string) => s.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();

/** Exported for tests: is `quote` (normalized) contained in `text` (normalized)? Allows minor truncation. */
export function quoteAppearsIn(quote: string, text: string): boolean {
  const q = norm(quote);
  const t = norm(text);
  if (!q || q.length < 8) return false;
  if (t.includes(q)) return true;
  // Tolerate trailing ellipsis / small edits at the ends by checking a core window.
  if (q.length > 60) {
    const core = q.slice(10, q.length - 10);
    return t.includes(core);
  }
  return false;
}

const MAX_CHARS_PER_PAGE = 12_000;
const MAX_TOTAL_CHARS = 45_000;

export function buildExtractionInput(businessName: string, pages: PageForExtraction[]): string {
  let budget = MAX_TOTAL_CHARS;
  const blocks: string[] = [];
  for (const p of pages) {
    if (budget <= 0) break;
    const text = p.text.slice(0, Math.min(MAX_CHARS_PER_PAGE, budget));
    budget -= text.length;
    blocks.push(`<page url="${p.url}" kind="${p.kind}" title="${(p.title ?? "").replace(/"/g, "'")}">\n${text}\n</page>`);
  }
  return `Business name: ${businessName}\n\n<website_content>\n${blocks.join("\n\n")}\n</website_content>\n\nExtract verified observations and unknowns for this business.`;
}

export async function extractObservations(businessId: string, businessName: string, pages: PageForExtraction[]): Promise<ExtractionOutcome> {
  const cfg = getConfig();
  const usable = pages.filter((p) => p.text && p.text.trim().length > 50);
  if (!usable.length) return { accepted: [], rejected: [], unknowns: [], model: cfg.AI_EXTRACTION_MODEL, costUsd: 0 };
  const result = await callStructured({
    stage: "extraction",
    model: cfg.AI_EXTRACTION_MODEL,
    effort: cfg.AI_EXTRACTION_EFFORT,
    system: EXTRACTION_SYSTEM,
    user: buildExtractionInput(businessName, usable),
    schema: ExtractionSchema,
    businessId,
  });
  return { ...validateExtraction(result.data, usable), model: result.model, costUsd: result.usage.costUsd };
}

export function validateExtraction(data: { observations: { category: string; statement: string; evidence_quote: string; source_url: string }[]; unknowns: { topic: string; note: string }[] }, pages: PageForExtraction[]) {
  const byUrl = new Map(pages.map((p) => [p.url, p]));
  const accepted: ValidatedObservation[] = [];
  const rejected: { statement: string; reason: string }[] = [];
  const seen = new Set<string>();
  for (const o of data.observations) {
    const page = byUrl.get(o.source_url) ?? pages.find((p) => norm(p.url) === norm(o.source_url));
    if (!page) {
      rejected.push({ statement: o.statement, reason: `source_url not among fetched pages (${o.source_url})` });
      continue;
    }
    if (!quoteAppearsIn(o.evidence_quote, page.text)) {
      rejected.push({ statement: o.statement, reason: "evidence quote not found verbatim in the cited page" });
      continue;
    }
    const key = norm(o.statement);
    if (seen.has(key)) continue;
    seen.add(key);
    accepted.push({ category: o.category, statement: o.statement.trim(), evidenceQuote: o.evidence_quote.trim().slice(0, 400), sourceUrl: page.url });
  }
  return { accepted, rejected, unknowns: data.unknowns.slice(0, 15) };
}
