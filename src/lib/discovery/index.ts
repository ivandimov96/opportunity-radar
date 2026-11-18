/**
 * Provider registry. The engine orchestrates whatever is registered here; a
 * provider is active (offered, runs) or future (shown, never executed). Adding
 * a source means one module implementing `DiscoveryProvider` and one line below.
 * (Overture Maps and OpenStreetMap were removed in 2026-11; businesses they once
 * found keep their source labels.)
 */
import { googleMapsProvider } from "./google-maps";
import { foursquareProvider, linkedinProvider, webSearchProvider } from "./future";
import type { DiscoveryProvider, DiscoveryProviderKey, ProviderStatus } from "./types";

export const PROVIDERS: Record<Exclude<DiscoveryProviderKey, "csv" | "overture" | "osm">, DiscoveryProvider> = {
  google_maps: googleMapsProvider,
  foursquare: foursquareProvider,
  web_search: webSearchProvider,
  linkedin: linkedinProvider,
};

/** Order the interface shows sources in: active first, then planned. */
export const PROVIDER_ORDER: Exclude<DiscoveryProviderKey, "csv" | "overture" | "osm">[] = ["google_maps", "foursquare", "web_search", "linkedin"];

export interface ProviderInfo {
  key: DiscoveryProviderKey;
  label: string;
  status: ProviderStatus;
  description: string;
  futurePurpose?: string;
  attribution: string;
  available: boolean;
  reason?: string;
}

export function listProviders(): ProviderInfo[] {
  return PROVIDER_ORDER.map((k) => {
    const p = PROVIDERS[k];
    return { key: p.key, label: p.label, status: p.status, description: p.description, futurePurpose: p.futurePurpose, attribution: p.attribution, ...p.isAvailable() };
  });
}

/** Keys the backend will execute; everything else is refused before any call. */
export function runnableProviderKeys(): DiscoveryProviderKey[] {
  return PROVIDER_ORDER.filter((k) => PROVIDERS[k].status !== "future");
}

export const PROVIDER_LABEL: Record<string, string> = Object.fromEntries([...PROVIDER_ORDER.map((k) => [k, PROVIDERS[k].label]), ["csv", "CSV import"], ["overture", "Overture Maps"], ["osm", "OpenStreetMap"]]);

export * from "./types";
export * from "./normalize";
export { upsertCandidate } from "./dedupe";
export { csvToCandidates, parseCsv } from "./csv";
