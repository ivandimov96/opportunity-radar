/**
 * The search engine: one place that turns a stored search into validated,
 * deduplicated candidates and, when asked, saved businesses.
 *
 *   resolve area once → run each selected provider (isolated; future ones are
 *   refused before any call) → merge records across sources with explicit
 *   rules and confidence → apply the filters with skip counts → rank by lead
 *   score → store candidates (every source kept) → match or save businesses.
 *
 * Nothing here knows how a provider fetches; providers never know about each
 * other, businesses, or the interface.
 */
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { businesses, businessSources, searchCandidates, searchResults, type SearchFilters, type SearchStats, searches } from "@/db/schema";
import { getConfig } from "@/lib/config";
import { newId, nowIso } from "@/lib/ids";
import { ensureProspect } from "@/lib/pipeline/prospects";
import { leadScore, type LeadHints } from "@/lib/scoring/lead";
import { filtersOf } from "@/lib/search-input";
import { resolveSearchArea } from "./area";
import { haversineKm } from "./cells";
import { upsertCandidate } from "./dedupe";
import { PROVIDERS } from "./index";
import { normalizeCity, normalizeName, normalizePhone, normalizeWebsite, websiteDomain } from "./normalize";
import { ProviderError, type BusinessCandidate, type DiscoveryProvider, type DiscoveryProviderKey, type DiscoveryQuery, type ResolvedArea } from "./types";

export type SearchRow = typeof searches.$inferSelect;

export interface MergedCandidate {
  name: string;
  nameNormalized: string;
  category: string | null;
  matchedBy: string[];
  website: string | null;
  websiteDomain: string | null;
  phone: string | null;
  email: string | null;
  street: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  country: string | null;
  lat: number | null;
  lon: number | null;
  operatingStatus: string | null;
  brand: string | null;
  openingHours: boolean;
  sources: { provider: DiscoveryProviderKey; providerId: string; sourceUrl: string | null; attribution: string; fetchedAt: string | null; matchedBy: string | null; raw?: Record<string, unknown> }[];
  mergeRule: "provider_id" | "domain" | "phone" | "name_proximity" | null;
  mergeConfidence: number | null;
  /** Index of a similar record kept separate (uncertain match). */
  possibleDuplicateOf: number | null;
  /** The record the merged values started from (highest-trust source). */
  primary: BusinessCandidate;
}

const PROVIDER_TRUST: Record<string, number> = { google_maps: 0, overture: 1, osm: 2, csv: 3, demo: 4 };

function tokens(nameNormalized: string): Set<string> {
  return new Set(nameNormalized.split(" ").filter((t) => t.length > 2));
}
function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}
function dist(a: { lat: number | null; lon: number | null }, b: { lat: number | null; lon: number | null }): number | null {
  if (a.lat == null || a.lon == null || b.lat == null || b.lon == null) return null;
  return haversineKm(a.lat, a.lon, b.lat, b.lon);
}

/**
 * Merge candidates from every source. Rules, in order of trust, each with a confidence:
 *  provider id (1.0, same source record), website domain + within 1 km or similar name (0.95),
 *  phone + within 2 km or similar name (0.9), same normalized name within 250 m (0.85).
 * A similar name within 150 m without any of the above is an uncertain match (0.6): both
 * records stay separate and point at each other for review. Nothing else merges, so two
 * branches of one company with their own addresses stay two businesses.
 */
export function mergeCandidates(input: BusinessCandidate[]): MergedCandidate[] {
  const sorted = [...input].sort((a, b) => (PROVIDER_TRUST[a.provider] ?? 9) - (PROVIDER_TRUST[b.provider] ?? 9));
  const out: MergedCandidate[] = [];
  const byProviderId = new Map<string, number>();
  const byDomain = new Map<string, number[]>();
  const byPhone = new Map<string, number[]>();
  const byGeo = new Map<string, number[]>();
  const geoKey = (lat: number, lon: number) => `${Math.floor(lat / 0.005)}:${Math.floor(lon / 0.005)}`;
  const neighbours = (lat: number | null, lon: number | null): number[] => {
    if (lat == null || lon == null) return [];
    const a = Math.floor(lat / 0.005);
    const b = Math.floor(lon / 0.005);
    const ids: number[] = [];
    for (let da = -1; da <= 1; da++) for (let db = -1; db <= 1; db++) ids.push(...(byGeo.get(`${a + da}:${b + db}`) ?? []));
    return ids;
  };

  for (const c of sorted) {
    const website = normalizeWebsite(c.website);
    const domain = websiteDomain(website);
    const phone = normalizePhone(c.phone);
    const nameNormalized = normalizeName(c.name);
    const toks = tokens(nameNormalized);
    const pid = `${c.provider}:${c.providerId}`;
    const pos = { lat: c.lat ?? null, lon: c.lng ?? null };
    const similar = (m: MergedCandidate) => m.nameNormalized === nameNormalized || jaccard(toks, tokens(m.nameNormalized)) >= 0.5;

    let target: number | null = null;
    let rule: MergedCandidate["mergeRule"] = null;
    let confidence: number | null = null;
    if (byProviderId.has(pid)) {
      target = byProviderId.get(pid)!;
      rule = "provider_id";
      confidence = 1;
    }
    if (target == null && domain) {
      for (const i of byDomain.get(domain) ?? []) {
        const d = dist(pos, out[i]);
        if ((d != null && d <= 1) || (d == null && similar(out[i]))) {
          target = i;
          rule = "domain";
          confidence = 0.95;
          break;
        }
      }
    }
    if (target == null && phone) {
      for (const i of byPhone.get(phone) ?? []) {
        const d = dist(pos, out[i]);
        if ((d != null && d <= 2) || (d == null && similar(out[i]))) {
          target = i;
          rule = "phone";
          confidence = 0.9;
          break;
        }
      }
    }
    let possibleDuplicateOf: number | null = null;
    if (target == null) {
      for (const i of neighbours(pos.lat, pos.lon)) {
        const d = dist(pos, out[i]);
        if (d == null) continue;
        if (out[i].nameNormalized === nameNormalized && d <= 0.25) {
          target = i;
          rule = "name_proximity";
          confidence = 0.85;
          break;
        }
        if (possibleDuplicateOf == null && d <= 0.15 && jaccard(toks, tokens(out[i].nameNormalized)) >= 0.6) possibleDuplicateOf = i;
      }
    }

    const src = { provider: c.provider, providerId: c.providerId, sourceUrl: c.sourceUrl ?? null, attribution: c.attribution, fetchedAt: c.fetchedAt ?? null, matchedBy: c.matchedBy ?? null, raw: c.raw };
    if (target != null) {
      const m = out[target];
      if (!m.sources.some((s) => s.provider === c.provider && s.providerId === c.providerId)) m.sources.push(src);
      if (c.matchedBy && !m.matchedBy.includes(c.matchedBy)) m.matchedBy.push(c.matchedBy);
      m.website = m.website ?? website;
      m.websiteDomain = m.websiteDomain ?? domain;
      m.phone = m.phone ?? phone;
      m.email = m.email ?? c.email?.toLowerCase() ?? null;
      m.street = m.street ?? c.street ?? null;
      m.city = m.city ?? c.city ?? null;
      m.region = m.region ?? c.region ?? null;
      m.postalCode = m.postalCode ?? c.postalCode ?? null;
      m.country = m.country ?? c.country ?? null;
      m.lat = m.lat ?? pos.lat;
      m.lon = m.lon ?? pos.lon;
      m.category = m.category ?? c.category ?? null;
      m.brand = m.brand ?? c.brand ?? null;
      if (c.operatingStatus === "closed") m.operatingStatus = "closed";
      else if (!m.operatingStatus || m.operatingStatus === "unknown") m.operatingStatus = c.operatingStatus ?? m.operatingStatus ?? null;
      m.openingHours = m.openingHours || Boolean((c.raw as { opening_hours?: unknown } | undefined)?.opening_hours);
      if (m.mergeRule == null || (confidence ?? 0) < (m.mergeConfidence ?? 1)) {
        m.mergeRule = rule;
        m.mergeConfidence = confidence;
      }
      if (domain) byDomain.set(domain, [...(byDomain.get(domain) ?? []), target]);
      if (phone) byPhone.set(phone, [...(byPhone.get(phone) ?? []), target]);
      continue;
    }
    const idx = out.length;
    out.push({
      name: c.name.trim(),
      nameNormalized,
      category: c.category ?? null,
      matchedBy: c.matchedBy ? [c.matchedBy] : [],
      website,
      websiteDomain: domain,
      phone,
      email: c.email?.toLowerCase() ?? null,
      street: c.street ?? null,
      city: c.city ?? null,
      region: c.region ?? null,
      postalCode: c.postalCode ?? null,
      country: c.country ?? null,
      lat: pos.lat,
      lon: pos.lon,
      operatingStatus: c.operatingStatus ?? null,
      brand: c.brand ?? null,
      openingHours: Boolean((c.raw as { opening_hours?: unknown } | undefined)?.opening_hours),
      sources: [src],
      mergeRule: null,
      mergeConfidence: null,
      possibleDuplicateOf,
      primary: c,
    });
    byProviderId.set(pid, idx);
    if (domain) byDomain.set(domain, [...(byDomain.get(domain) ?? []), idx]);
    if (phone) byPhone.set(phone, [...(byPhone.get(phone) ?? []), idx]);
    if (pos.lat != null && pos.lon != null) {
      const k = geoKey(pos.lat, pos.lon);
      byGeo.set(k, [...(byGeo.get(k) ?? []), idx]);
    }
  }
  return out;
}

/** 0–100: name, coordinates, street, city, phone, website, email. */
export function completenessOf(m: { street: string | null; city: string | null; phone: string | null; website: string | null; email: string | null; lat: number | null }): number {
  const parts = [true, m.lat != null, Boolean(m.street), Boolean(m.city), Boolean(m.phone), Boolean(m.website), Boolean(m.email)];
  return Math.round((parts.filter(Boolean).length / parts.length) * 100);
}

/** A saved business this merged record corresponds to, by the same rules the saver uses. */
export async function findExistingBusiness(db: Db, m: MergedCandidate): Promise<{ id: string; via: "provider_id" | "domain" | "phone" | "name_city" } | null> {
  for (const s of m.sources) {
    const row = await db.select({ businessId: businessSources.businessId }).from(businessSources).where(and(eq(businessSources.provider, s.provider), eq(businessSources.providerId, s.providerId))).get();
    if (row) return { id: row.businessId, via: "provider_id" };
  }
  if (m.websiteDomain) {
    const row = await db.select({ id: businesses.id }).from(businesses).where(eq(businesses.websiteDomain, m.websiteDomain)).get();
    if (row) return { id: row.id, via: "domain" };
  }
  if (m.phone) {
    const row = await db.select({ id: businesses.id }).from(businesses).where(eq(businesses.phone, m.phone)).get();
    if (row) return { id: row.id, via: "phone" };
  }
  const cityNorm = normalizeCity(m.city);
  if (m.nameNormalized && cityNorm) {
    const rows = await db.select({ id: businesses.id, city: businesses.city }).from(businesses).where(eq(businesses.nameNormalized, m.nameNormalized)).all();
    const hit = rows.find((r) => normalizeCity(r.city) === cityNorm);
    if (hit) return { id: hit.id, via: "name_city" };
  }
  return null;
}

export interface RunOptions {
  signal?: AbortSignal;
  onProgress?: (m: string) => void;
  /** Test seam: replaces the registry. */
  providers?: Partial<Record<DiscoveryProviderKey, DiscoveryProvider>>;
}

export interface RunOutcome {
  stats: SearchStats;
  errors: string[];
  /** Saved businesses that qualify for automatic investigation, best lead first. */
  investigable: { id: string; leadScore: number }[];
  /** A retryable provider failure when nothing else answered. */
  retryable: ProviderError | null;
}

const PROVIDER_RANK: Record<string, number> = PROVIDER_TRUST;

export async function runDiscovery(db: Db, search: SearchRow, opts: RunOptions = {}): Promise<RunOutcome> {
  const filters = filtersOf(search);
  const registry = { ...PROVIDERS, ...(opts.providers ?? {}) } as Record<string, DiscoveryProvider | undefined>;
  const stats: SearchStats = { providerResults: {}, notes: [], durationMs: 0, candidates: 0, ranked: 0, created: 0, merged: 0, skippedNoWebsite: 0, skippedNoPhone: 0, skippedChains: 0, skippedKnown: 0, skippedClosed: 0, queuedForInvestigation: 0, area: null, bbox: null, partial: false, cached: "none", releases: {}, saved: 0, total: 0, attribution: [] };
  const errors: string[] = [];
  const startedAt = Date.now();
  const note = (m: string) => stats.notes!.push(m);
  const query: DiscoveryQuery = { industry: search.industry, customCategory: filters.customCategory ?? search.categoryQuery ?? null, categoryQuery: search.categoryQuery, keywords: search.keywords, country: search.country, region: search.region, city: search.city, maxResults: search.maxResults, requireWebsite: search.requireWebsite, segments: filters.segments, areaMode: filters.areaMode, radiusKm: filters.radiusKm, lat: filters.centerLat ?? null, lng: filters.centerLon ?? null };

  // ---- 0. Providers to run: future ones are refused here, before any call.
  const selected = (search.providers as DiscoveryProviderKey[]).filter((k) => k !== "csv");
  const runnable: DiscoveryProvider[] = [];
  for (const key of selected) {
    const p = registry[key];
    if (!p) {
      stats.providerResults[key] = { found: 0, error: "Unknown source" };
      continue;
    }
    if (p.status === "future") {
      stats.providerResults[key] = { found: 0, error: "Planned integration, not available yet; not executed" };
      note(`${p.label}: planned integration, skipped`);
      continue;
    }
    if (p.status === "disabled") {
      stats.providerResults[key] = { found: 0, error: "Source disabled; not executed" };
      note(`${p.label}: disabled, skipped`);
      continue;
    }
    const avail = p.isAvailable();
    if (!avail.available) {
      stats.providerResults[key] = { found: 0, error: avail.reason };
      note(`${p.label}: unavailable (${avail.reason})`);
      continue;
    }
    runnable.push(p);
  }

  // ---- 1. Area, once.
  const needsArea = runnable.some((p) => p.key === "overture" || p.key === "osm");
  let area: ResolvedArea | null = null;
  let areaError: Error | null = null;
  if (needsArea) {
    try {
      area = await resolveSearchArea(query, opts.signal);
      query.area = area;
      stats.area = area.label;
      stats.bbox = area.bbox;
      note(`Area: ${area.label} (${area.source === "typeahead" ? "center from the city list" : area.source === "geocoder" ? "boundary from the geocoder" : "bundled place center"})`);
    } catch (err) {
      areaError = err instanceof Error ? err : new Error(String(err));
      note(`Area could not be resolved: ${areaError.message}`);
    }
  }

  // ---- 2. Collect, each source on its own.
  const collected: BusinessCandidate[] = [];
  let retryable: ProviderError | null = null;
  const cachedStates: ("all" | "some" | "none")[] = [];
  for (const p of runnable) {
    opts.signal?.throwIfAborted();
    const t0 = Date.now();
    if (areaError && (p.key === "overture" || p.key === "osm")) {
      stats.providerResults[p.key] = { found: 0, error: areaError.message, durationMs: 0 };
      errors.push(`${p.label}: ${areaError.message}`);
      continue;
    }
    opts.onProgress?.(`Discovering via ${p.label}`);
    try {
      const result = await p.discover(query, { signal: opts.signal, onProgress: (m) => opts.onProgress?.(`${p.label}: ${m}`) });
      stats.providerResults[p.key] = { found: result.candidates.length, durationMs: Date.now() - t0, cached: result.cached, release: result.release ?? undefined };
      if (result.release) stats.releases![p.key] = result.release;
      if (result.cached) cachedStates.push(result.cached);
      if (!stats.area && result.area) stats.area = result.area;
      if (!stats.attribution.includes(result.attribution)) stats.attribution.push(result.attribution);
      for (const n of result.notes) note(`${p.label}: ${n}`);
      note(`${p.label}: ${result.candidates.length} candidate(s) in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
      collected.push(...result.candidates);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      stats.providerResults[p.key] = { found: 0, error: msg, durationMs: Date.now() - t0 };
      note(`${p.label}: failed after ${((Date.now() - t0) / 1000).toFixed(1)} s: ${msg}`);
      errors.push(`${p.label}: ${msg}`);
      if (err instanceof ProviderError && err.retryable && !retryable) retryable = err;
    }
  }
  const okProviders = Object.values(stats.providerResults).filter((r) => !r.error).length;
  stats.partial = errors.length > 0 && okProviders > 0;
  stats.cached = cachedStates.length && cachedStates.every((c) => c === "all") ? "all" : cachedStates.some((c) => c !== "none") ? "some" : "none";

  // ---- 3. Merge across sources.
  opts.onProgress?.(`Merging ${collected.length} records`);
  const merged = mergeCandidates(collected);
  const mergedAway = collected.length - merged.length;
  stats.candidates = collected.length;
  if (mergedAway) note(`Merged ${mergedAway} duplicate record(s) across sources (${merged.filter((m) => m.sources.length > 1).length} businesses backed by more than one record)`);
  const uncertain = merged.filter((m) => m.possibleDuplicateOf != null).length;
  if (uncertain) note(`${uncertain} possible duplicate(s) kept separate for review`);

  // ---- 4. Filters with skip counts, lead score, rank.
  type Ranked = { m: MergedCandidate; lead: ReturnType<typeof leadScore>; existing: { id: string; via: string } | null };
  const ranked: Ranked[] = [];
  for (const m of merged) {
    if (m.operatingStatus === "closed") {
      stats.skippedClosed!++;
      continue;
    }
    if (search.requireWebsite && !m.website) {
      stats.skippedNoWebsite++;
      continue;
    }
    if (filters.requirePhone && !m.phone) {
      stats.skippedNoPhone!++;
      continue;
    }
    const hints: LeadHints = { openingHours: m.openingHours, brand: m.brand };
    const lead = leadScore({ name: m.name, industry: search.industry, website: m.website, phone: m.phone, email: m.email, street: m.street, city: m.city, category: m.category }, hints);
    if (filters.excludeChains && lead.kind === "chain") {
      stats.skippedChains!++;
      continue;
    }
    const existing = await findExistingBusiness(db, m);
    if (filters.skipKnown && existing) {
      stats.skippedKnown!++;
      continue;
    }
    ranked.push({ m, lead, existing });
  }
  ranked.sort((a, b) => b.lead.score - a.lead.score || (PROVIDER_RANK[a.m.primary.provider] ?? 9) - (PROVIDER_RANK[b.m.primary.provider] ?? 9));
  stats.ranked = ranked.length;
  note(`Ranking: ${merged.length} unique business(es); ${stats.skippedClosed} closed, ${stats.skippedNoWebsite} without website, ${stats.skippedNoPhone} without phone, ${stats.skippedChains} chain(s), ${stats.skippedKnown} already known skipped; ${ranked.length} ranked by lead score; cap ${search.maxResults}`);

  // ---- 5. Store candidates (every source kept), replacing the previous run's.
  const listed = ranked.slice(0, search.maxResults);
  await db.delete(searchCandidates).where(eq(searchCandidates.searchId, search.id)).run();
  const ids = listed.map(() => newId());
  const indexOf = new Map(listed.map((r, i) => [r.m, i]));
  const ts = nowIso();
  const rows = listed.map((r, i) => {
    const dup = r.m.possibleDuplicateOf != null ? indexOf.get(merged[r.m.possibleDuplicateOf]) : undefined;
    return {
      id: ids[i],
      searchId: search.id,
      rank: i + 1,
      name: r.m.name,
      nameNormalized: r.m.nameNormalized,
      category: r.m.category,
      matchedBy: r.m.matchedBy,
      website: r.m.website,
      websiteDomain: r.m.websiteDomain,
      phone: r.m.phone,
      email: r.m.email,
      street: r.m.street,
      city: r.m.city,
      region: r.m.region,
      postalCode: r.m.postalCode,
      country: r.m.country,
      lat: r.m.lat,
      lon: r.m.lon,
      operatingStatus: r.m.operatingStatus,
      brand: r.m.brand,
      kind: r.lead.kind,
      leadScore: r.lead.score,
      leadReasons: r.lead.reasons,
      completeness: completenessOf(r.m),
      sources: r.m.sources.map(({ raw: _raw, ...s }) => s),
      mergeRule: r.m.mergeRule,
      mergeConfidence: r.m.mergeConfidence,
      possibleDuplicateOf: dup != null ? ids[dup] : null,
      businessId: r.existing?.id ?? null,
      savedVia: r.existing ? r.existing.via : null,
      skippedReason: null,
      createdAt: ts,
    };
  });
  const CHUNK = 100;
  for (let i = 0; i < rows.length; i += CHUNK) await db.batch(rows.slice(i, i + CHUNK).map((r) => db.insert(searchCandidates).values(r)) as unknown as Parameters<typeof db.batch>[0]);
  const alreadySaved = rows.filter((r) => r.businessId).length;
  if (alreadySaved) note(`${alreadySaved} listed business(es) already in the database (matched by source id, domain, phone or name + city)`);
  stats.total = rows.length;
  if (ranked.length > rows.length) note(`${ranked.length - rows.length} candidate(s) beyond the cap not listed`);

  // ---- 6. Save (automatically when asked), then hand back what qualifies for investigation.
  const investigable: { id: string; leadScore: number }[] = [];
  if (filters.autoSave !== false && rows.length) {
    opts.onProgress?.(`Saving ${rows.length} businesses`);
    const saved = await saveCandidates(db, search, ids, { listed, candidateIds: ids });
    stats.created = saved.created;
    stats.merged = saved.merged;
    stats.saved = saved.created + saved.merged;
    investigable.push(...saved.investigable);
  }
  stats.durationMs = Date.now() - startedAt;
  return { stats, errors, investigable, retryable };
}

export interface SaveOutcome {
  created: number;
  merged: number;
  investigable: { id: string; leadScore: number }[];
}

/**
 * Save candidates as businesses (dedupe rules apply; every contributing source is
 * recorded), link them to the search, and report which ones qualify for automatic
 * investigation. `ids` = candidate ids; undefined = every listed candidate of the search.
 */
export async function saveCandidates(db: Db, search: SearchRow, ids?: string[], prepared?: { listed: { m: MergedCandidate; lead: ReturnType<typeof leadScore>; existing: { id: string; via: string } | null }[]; candidateIds: string[] }): Promise<SaveOutcome> {
  const filters = filtersOf(search);
  const cfg = getConfig();
  const out: SaveOutcome = { created: 0, merged: 0, investigable: [] };
  const rows = ids ? await db.select().from(searchCandidates).where(and(eq(searchCandidates.searchId, search.id), inArray(searchCandidates.id, ids))).all() : await db.select().from(searchCandidates).where(eq(searchCandidates.searchId, search.id)).all();
  rows.sort((a, b) => a.rank - b.rank);
  const preparedById = new Map<string, MergedCandidate>();
  if (prepared) prepared.candidateIds.forEach((id, i) => preparedById.set(id, prepared.listed[i].m));
  for (const r of rows) {
    const m = preparedById.get(r.id);
    const primarySource = m?.primary ?? null;
    const sources = r.sources;
    const first = sources[0];
    const candidate: BusinessCandidate = primarySource ?? {
      provider: first.provider as DiscoveryProviderKey,
      providerId: first.providerId,
      name: r.name,
      category: r.category,
      website: r.website,
      phone: r.phone,
      email: r.email,
      street: r.street,
      city: r.city,
      region: r.region,
      postalCode: r.postalCode,
      country: r.country,
      lat: r.lat,
      lng: r.lon,
      sourceUrl: first.sourceUrl,
      attribution: first.attribution,
      operatingStatus: r.operatingStatus,
      brand: r.brand,
    };
    // Merged values (filled from every source) win over the primary record's own gaps.
    const full: BusinessCandidate = { ...candidate, website: r.website ?? candidate.website, phone: r.phone ?? candidate.phone, email: r.email ?? candidate.email, street: r.street ?? candidate.street, city: r.city ?? candidate.city, region: r.region ?? candidate.region, postalCode: r.postalCode ?? candidate.postalCode, country: r.country ?? candidate.country, lat: r.lat ?? candidate.lat, lng: r.lon ?? candidate.lng, category: r.category ?? candidate.category, brand: r.brand ?? candidate.brand, operatingStatus: r.operatingStatus ?? candidate.operatingStatus };
    const extraSources = sources.slice(1).map((s) => ({ provider: s.provider as DiscoveryProviderKey, providerId: s.providerId, sourceUrl: s.sourceUrl, attribution: s.attribution, raw: m?.sources.find((x) => x.provider === s.provider && x.providerId === s.providerId)?.raw ?? null }));
    const outcome = await upsertCandidate(db, full, { industry: search.industry, searchId: search.id, isDemo: first.provider === "demo", leadReasons: r.leadReasons ?? undefined, extraSources });
    if (outcome.wasNew) out.created++;
    else out.merged++;
    await db.insert(searchResults).values({ searchId: search.id, businessId: outcome.businessId, rank: r.rank, wasNew: outcome.wasNew }).onConflictDoNothing().run();
    await ensureProspect(outcome.businessId);
    await db.update(searchCandidates).set({ businessId: outcome.businessId, savedVia: outcome.wasNew ? "new" : (outcome.matchedBy ?? "existing") }).where(eq(searchCandidates.id, r.id)).run();
    const biz = await db.select().from(businesses).where(eq(businesses.id, outcome.businessId)).get();
    if (biz && first.provider !== "demo") {
      const stored = leadScore(biz, { brand: biz.brand });
      if (biz.leadScore !== stored.score || biz.kind !== stored.kind) await db.update(businesses).set({ leadScore: stored.score, kind: stored.kind, leadReasons: stored.reasons }).where(eq(businesses.id, biz.id)).run();
      if (search.autoInvestigate && stored.kind !== "chain" && stored.score >= filters.minLeadScore && ["new", "no_website", "failed"].includes(biz.status) && (biz.website || cfg.RESEARCH_FIND_WEBSITE)) out.investigable.push({ id: biz.id, leadScore: stored.score });
    }
  }
  out.investigable.sort((a, b) => b.leadScore - a.leadScore);
  return out;
}
