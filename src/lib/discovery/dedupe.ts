import { and, eq, or } from "drizzle-orm";
import type { Db } from "@/db/client";
import { businesses, businessSources } from "@/db/schema";
import { newId, nowIso } from "@/lib/ids";
import type { BusinessCandidate } from "./types";
import { normalizeCity, normalizeEmail, normalizeName, normalizePhone, normalizeWebsite, websiteDomain } from "./normalize";
import { leadScore } from "@/lib/scoring/lead";

export type UpsertOutcome = { businessId: string; wasNew: boolean; matchedBy?: "provider_id" | "domain" | "name_city" | "phone" };

/**
 * Match rules, in order of trust:
 *  1. Same provider + provider id (exact identity).
 *  2. Same website domain (not an aggregator domain).
 *  3. Same normalized phone.
 *  4. Same normalized name + city.
 * A match merges missing fields only; it never overwrites values already present.
 */
export async function upsertCandidate(
  db: Db,
  c: BusinessCandidate,
  ctx: { industry: string; searchId?: string | null; isDemo?: boolean; fixedId?: string; leadReasons?: string[]; extraSources?: { provider: BusinessCandidate["provider"]; providerId: string; sourceUrl: string | null; attribution: string; raw: Record<string, unknown> | null }[] },
): Promise<UpsertOutcome> {
  const website = normalizeWebsite(c.website);
  const domain = websiteDomain(website);
  const phone = normalizePhone(c.phone);
  const email = normalizeEmail(c.email);
  const nameNormalized = normalizeName(c.name);
  const city = c.city?.trim() || null;
  const cityNorm = normalizeCity(city);

  let existingId: string | null = null;
  let matchedBy: UpsertOutcome["matchedBy"];

  const bySource = await db
    .select({ businessId: businessSources.businessId })
    .from(businessSources)
    .where(and(eq(businessSources.provider, c.provider), eq(businessSources.providerId, c.providerId)))
    .get();
  if (bySource) {
    existingId = bySource.businessId;
    matchedBy = "provider_id";
  }
  if (!existingId && domain) {
    const row = await db.select({ id: businesses.id }).from(businesses).where(eq(businesses.websiteDomain, domain)).get();
    if (row) {
      existingId = row.id;
      matchedBy = "domain";
    }
  }
  if (!existingId && phone) {
    const row = await db.select({ id: businesses.id }).from(businesses).where(eq(businesses.phone, phone)).get();
    if (row) {
      existingId = row.id;
      matchedBy = "phone";
    }
  }
  if (!existingId && nameNormalized && cityNorm) {
    const rows = await db
      .select({ id: businesses.id, city: businesses.city })
      .from(businesses)
      .where(or(eq(businesses.nameNormalized, nameNormalized)))
      .all();
    const hit = rows.find((r) => normalizeCity(r.city) === cityNorm);
    if (hit) {
      existingId = hit.id;
      matchedBy = "name_city";
    }
  }

  const ts = nowIso();
  if (existingId) {
    const cur = (await db.select().from(businesses).where(eq(businesses.id, existingId)).get())!;
    await db.update(businesses)
      .set({
        website: cur.website ?? website,
        websiteDomain: cur.websiteDomain ?? domain,
        websiteSource: cur.website ? cur.websiteSource : website ? c.provider : null,
        phone: cur.phone ?? phone,
        email: cur.email ?? email,
        street: cur.street ?? c.street ?? null,
        city: cur.city ?? city,
        region: cur.region ?? c.region ?? null,
        postalCode: cur.postalCode ?? c.postalCode ?? null,
        country: cur.country ?? c.country ?? null,
        lat: cur.lat ?? c.lat ?? null,
        lng: cur.lng ?? c.lng ?? null,
        category: cur.category ?? c.category ?? null,
        operatingStatus: c.operatingStatus && c.operatingStatus !== "unknown" ? c.operatingStatus : cur.operatingStatus,
        brand: cur.brand ?? c.brand ?? null,
        leadReasons: ctx.leadReasons ?? cur.leadReasons,
        updatedAt: ts,
      })
      .where(eq(businesses.id, existingId))
      .run();
    if (matchedBy !== "provider_id") {
      await db.insert(businessSources)
        .values({
          id: newId(),
          businessId: existingId,
          provider: c.provider,
          providerId: c.providerId,
          sourceUrl: c.sourceUrl ?? null,
          attribution: c.attribution,
          searchId: ctx.searchId ?? null,
          raw: c.raw ?? null,
        })
        .onConflictDoNothing()
        .run();
    }
    await addSources(db, existingId, ctx);
    return { businessId: existingId, wasNew: false, matchedBy };
  }

  const id = ctx.fixedId ?? newId();
  const lead = leadScore({ name: c.name, industry: ctx.industry, website, phone, email, street: c.street, city, category: c.category });
  await db.insert(businesses)
    .values({
      id,
      leadScore: lead.score,
      kind: lead.kind,
      websiteSource: website ? c.provider : null,
      leadReasons: ctx.leadReasons ?? lead.reasons,
      operatingStatus: c.operatingStatus ?? null,
      brand: c.brand ?? null,
      name: c.name.trim(),
      nameNormalized,
      industry: ctx.industry,
      category: c.category ?? null,
      website,
      websiteDomain: domain,
      phone,
      email,
      street: c.street ?? null,
      city,
      region: c.region ?? null,
      postalCode: c.postalCode ?? null,
      country: c.country ?? null,
      lat: c.lat ?? null,
      lng: c.lng ?? null,
      firstProvider: c.provider,
      status: website ? "new" : "no_website",
      statusMessage: website ? null : "No website on record",
      isDemo: Boolean(ctx.isDemo),
      createdAt: ts,
      updatedAt: ts,
    })
    .run();
  await db.insert(businessSources)
    .values({
      id: newId(),
      businessId: id,
      provider: c.provider,
      providerId: c.providerId,
      sourceUrl: c.sourceUrl ?? null,
      attribution: c.attribution,
      searchId: ctx.searchId ?? null,
      raw: c.raw ?? null,
    })
    .run();
  await addSources(db, id, ctx);
  return { businessId: id, wasNew: true };
}

/** Every other source record that contributed to a merged candidate is kept as provenance. */
async function addSources(db: Db, businessId: string, ctx: { searchId?: string | null; extraSources?: { provider: BusinessCandidate["provider"]; providerId: string; sourceUrl: string | null; attribution: string; raw: Record<string, unknown> | null }[] }) {
  for (const s of ctx.extraSources ?? []) {
    await db.insert(businessSources).values({ id: newId(), businessId, provider: s.provider, providerId: s.providerId, sourceUrl: s.sourceUrl, attribution: s.attribution, searchId: ctx.searchId ?? null, raw: s.raw }).onConflictDoNothing().run();
  }
}
