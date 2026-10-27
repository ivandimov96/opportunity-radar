/**
 * Google Places API (New) Text Search adapter.
 *
 * Status: implemented from the official REST reference, NOT exercised live in
 * this repository (no key configured). Policy notes:
 *  - Google permits storing place IDs indefinitely; other Places content must
 *    not be cached beyond allowed exceptions. We therefore store the place ID
 *    and treat other fields as refreshable. The operator is responsible for
 *    reviewing Google Maps Platform terms before enabling this provider.
 */
import { getConfig } from "@/lib/config";
import { getPlaybook } from "@/lib/industries";
import type { BusinessCandidate, DiscoveryProvider, ProviderResult } from "./types";
import { ProviderError } from "./types";

const ATTRIBUTION = "Place data from Google Places API";

type Place = {
  id: string;
  displayName?: { text: string };
  formattedAddress?: string;
  websiteUri?: string;
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  location?: { latitude: number; longitude: number };
  primaryType?: string;
  addressComponents?: { longText: string; shortText: string; types: string[] }[];
  googleMapsUri?: string;
};

function component(p: Place, type: string) {
  return p.addressComponents?.find((c) => c.types.includes(type));
}

export function placeToCandidate(p: Place, fallbackCountry: string): BusinessCandidate | null {
  const name = p.displayName?.text;
  if (!name) return null;
  const streetNo = component(p, "street_number")?.longText;
  const route = component(p, "route")?.longText;
  return {
    provider: "google_places",
    providerId: p.id,
    name,
    category: p.primaryType ?? null,
    website: p.websiteUri ?? null,
    phone: p.nationalPhoneNumber ?? p.internationalPhoneNumber ?? null,
    street: [streetNo, route].filter(Boolean).join(" ") || null,
    city: component(p, "locality")?.longText ?? null,
    region: component(p, "administrative_area_level_1")?.shortText ?? null,
    postalCode: component(p, "postal_code")?.longText ?? null,
    country: component(p, "country")?.shortText ?? fallbackCountry,
    lat: p.location?.latitude ?? null,
    lng: p.location?.longitude ?? null,
    sourceUrl: p.googleMapsUri ?? null,
    attribution: ATTRIBUTION,
    raw: { placeId: p.id, primaryType: p.primaryType },
  };
}

export const googlePlacesProvider: DiscoveryProvider = {
  key: "google_places",
  label: "Google Places API (New)",
  isAvailable: () => {
    const c = getConfig();
    return c.googlePlaces.enabled ? { available: true } : { available: false, reason: "GOOGLE_PLACES_API_KEY not set" };
  },
  async discover(q, opts): Promise<ProviderResult> {
    const cfg = getConfig();
    if (!cfg.googlePlaces.enabled) throw new ProviderError("Google Places not configured", "google_places");
    const playbook = getPlaybook(q.industry);
    const textQuery = [q.categoryQuery || playbook.googleTextQuery, q.keywords, q.city, q.region, q.country]
      .filter(Boolean)
      .join(" ");
    const candidates: BusinessCandidate[] = [];
    const notes: string[] = [];
    let pageToken: string | undefined;
    let pagesFetched = 0;
    do {
      opts?.onProgress?.(`Google Places text search page ${pagesFetched + 1}`);
      const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": cfg.GOOGLE_PLACES_API_KEY!,
          "X-Goog-FieldMask":
            "places.id,places.displayName,places.formattedAddress,places.websiteUri,places.nationalPhoneNumber,places.internationalPhoneNumber,places.location,places.primaryType,places.addressComponents,places.googleMapsUri,nextPageToken",
        },
        body: JSON.stringify({ textQuery, pageSize: 20, pageToken }),
        signal: opts?.signal ?? AbortSignal.timeout(30_000),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new ProviderError(`Google Places HTTP ${res.status}: ${text.slice(0, 300)}`, "google_places", res.status === 429 || res.status >= 500);
      }
      const data = (await res.json()) as { places?: Place[]; nextPageToken?: string };
      for (const p of data.places ?? []) {
        const c = placeToCandidate(p, q.country);
        if (c) candidates.push(c);
      }
      pageToken = data.nextPageToken;
      pagesFetched++;
    } while (pageToken && candidates.length < q.maxResults && pagesFetched < 5);
    notes.push(`Google Places returned ${candidates.length} places over ${pagesFetched} page(s)`);
    return { provider: "google_places", candidates, attribution: ATTRIBUTION, notes };
  },
};
