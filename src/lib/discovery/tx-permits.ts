/**
 * Texas Comptroller "Active Sales Tax Permit Holders" (open data, Socrata SODA API).
 * Every business selling taxable goods/services in Texas holds a permit, so this
 * registry is far more complete than map data for the pilot market: names,
 * outlet addresses, NAICS codes and permit dates. It has no phone or website,
 * which the website finder and the operator fill in later.
 * Dataset: https://data.texas.gov/dataset/Active-Sales-Tax-Permit-Holders/jrea-zgmq
 * Terms: public domain open data; attribution kept. Optional free app token raises rate limits.
 */
import { getConfig } from "@/lib/config";
import { getPlaybook, NAICS_LABELS, selectorsFor } from "@/lib/industries";
import type { BusinessCandidate, DiscoveryProvider, ProviderResult } from "./types";
import { ProviderError } from "./types";

export const TX_PERMITS_ATTRIBUTION = "Texas Comptroller of Public Accounts, Active Sales Tax Permit Holders (open data)";
export const TX_PERMITS_DATASET = "https://data.texas.gov/dataset/Active-Sales-Tax-Permit-Holders/jrea-zgmq";
const ENDPOINT = "https://data.texas.gov/resource/jrea-zgmq.json";
const PAGE = 1000;
const MAX_ROWS = 3000;

export interface PermitRow {
  taxpayer_number: string;
  taxpayer_name?: string;
  outlet_number?: string;
  outlet_name?: string;
  outlet_address?: string;
  outlet_city?: string;
  outlet_state?: string;
  outlet_zip_code?: string;
  outlet_naics_code?: string | number;
  outlet_permit_issue_date?: string;
  outlet_first_sales_date?: string;
  taxpayer_organization_type?: string;
}

const SMALL = new Set(["of", "and", "the", "at", "in", "on", "for", "de", "y"]);
const KEEP_UPPER = /^(llc|inc|ii|iii|iv|atx|tx|usa|us|dba|bmw|vw|hvac|ac|a\/c|dfw|lp|llp|pc|pllc)$/i;

/** "GERMAN AUTO CENTER" → "German Auto Center"; keeps common initialisms upper-case. */
export function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((w, i) => {
      if (KEEP_UPPER.test(w)) return w.toUpperCase();
      if (i > 0 && SMALL.has(w)) return w;
      // Capitalize word starts and after - or /; after an apostrophe only when a real word follows (O'Reilly, not Ava's).
      return w.replace(/(^|[-/])([a-z])/g, (_, p, c) => p + c.toUpperCase()).replace(/'([a-z])(?=[a-z])/g, (_, c) => `'${c.toUpperCase()}`);
    })
    .join(" ");
}

export function permitToCandidate(r: PermitRow): BusinessCandidate | null {
  const rawName = (r.outlet_name || r.taxpayer_name || "").trim();
  if (!rawName) return null;
  const naics = r.outlet_naics_code != null ? String(r.outlet_naics_code) : null;
  const firstSales = r.outlet_first_sales_date?.slice(0, 10) ?? null;
  return {
    provider: "tx_permits",
    providerId: `${r.taxpayer_number}-${r.outlet_number ?? "1"}`,
    name: titleCase(rawName),
    category: naics ? (NAICS_LABELS[naics] ?? `NAICS ${naics}`) : null,
    website: null,
    phone: null,
    email: null,
    street: r.outlet_address ? titleCase(r.outlet_address) : null,
    city: r.outlet_city ? titleCase(r.outlet_city) : null,
    region: r.outlet_state ?? "TX",
    postalCode: r.outlet_zip_code ?? null,
    country: "US",
    lat: null,
    lng: null,
    sourceUrl: TX_PERMITS_DATASET,
    attribution: TX_PERMITS_ATTRIBUTION,
    raw: { taxpayerName: r.taxpayer_name ?? null, naics, permitIssued: r.outlet_permit_issue_date?.slice(0, 10) ?? null, firstSalesDate: firstSales, organizationType: r.taxpayer_organization_type ?? null },
  };
}

export function buildSoql(city: string, naics: string[], keywords?: string | null): string {
  const esc = (v: string) => v.replace(/'/g, "''");
  const parts = [`upper(outlet_city)='${esc(city.trim().toUpperCase())}'`, `outlet_naics_code in (${naics.map((n) => `'${esc(n)}'`).join(",")})`];
  if (keywords?.trim()) parts.push(`upper(outlet_name) like '%${esc(keywords.trim().toUpperCase())}%'`);
  return parts.join(" AND ");
}

export type PermitFetch = (url: string) => Promise<PermitRow[]>;

async function defaultFetch(url: string): Promise<PermitRow[]> {
  const cfg = getConfig();
  const res = await fetch(url, { headers: { Accept: "application/json", ...(cfg.SOCRATA_APP_TOKEN ? { "X-App-Token": cfg.SOCRATA_APP_TOKEN } : {}) }, signal: AbortSignal.timeout(30_000) });
  if (res.status === 429) throw new ProviderError("Texas open data rate limit (HTTP 429); set SOCRATA_APP_TOKEN or retry later", "tx_permits", true);
  if (!res.ok) throw new ProviderError(`Texas open data HTTP ${res.status}`, "tx_permits", res.status >= 500);
  return (await res.json()) as PermitRow[];
}

export async function fetchPermits(city: string, naics: string[], keywords: string | null | undefined, opts: { fetchRows?: PermitFetch; onProgress?: (m: string) => void; max?: number } = {}): Promise<PermitRow[]> {
  const fetchRows = opts.fetchRows ?? defaultFetch;
  const max = opts.max ?? MAX_ROWS;
  const rows: PermitRow[] = [];
  for (let offset = 0; offset < max; offset += PAGE) {
    const url = new URL(ENDPOINT);
    url.searchParams.set("$where", buildSoql(city, naics, keywords));
    // Established businesses first: they are likelier to have a website and budget.
    url.searchParams.set("$order", "outlet_first_sales_date ASC");
    url.searchParams.set("$limit", String(Math.min(PAGE, max - offset)));
    url.searchParams.set("$offset", String(offset));
    opts.onProgress?.(`Texas registry rows ${offset + 1}–${offset + PAGE}`);
    const page = await fetchRows(url.toString());
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  return rows;
}

export const txPermitsProvider: DiscoveryProvider = {
  key: "tx_permits",
  label: "Texas sales tax permits (open data)",
  isAvailable: () => ({ available: true }),
  async discover(q, opts): Promise<ProviderResult> {
    if (!/^(tx|texas)$/i.test(q.region ?? "")) throw new ProviderError("The Texas permit registry only covers Texas (set State / region = TX)", "tx_permits");
    if (!q.city) throw new ProviderError("The Texas permit registry needs a city", "tx_permits");
    const playbook = getPlaybook(q.industry);
    const sel = selectorsFor(playbook, q.segments ?? []);
    if (!sel.naics.length) throw new ProviderError(`No NAICS codes configured for ${playbook.label}`, "tx_permits");
    const notes: string[] = [];
    if (sel.unsupportedByRegistry.length) notes.push(`Registry cannot target: ${sel.unsupportedByRegistry.join(", ")} (no NAICS code; name-based sub-types need the map source)`);
    if (q.areaMode === "radius") notes.push("Registry has no coordinates; the whole city was searched instead of a radius");
    const rows = await fetchPermits(q.city, sel.naics, q.keywords, { onProgress: opts?.onProgress });
    const candidates = rows.map(permitToCandidate).filter((c): c is BusinessCandidate => !!c);
    notes.push(`Texas registry returned ${candidates.length} outlet(s) for NAICS ${sel.naics.join(", ")} in ${q.city}`);
    return { provider: "tx_permits", candidates, attribution: TX_PERMITS_ATTRIBUTION, notes, area: `${titleCase(q.city)}, TX (registry city field)` };
  },
};
