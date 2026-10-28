/**
 * Provider registry. The engine orchestrates whatever is registered here; a
 * provider is active (offered, runs), internal (demo data: runs for seeded or
 * test searches only, never offered), disabled (Overture, OpenStreetMap: kept,
 * never offered, refused) or future (shown, never executed). Adding a source means one module implementing
 * `DiscoveryProvider` and one line below.
 */
import { osmProvider } from "./osm";
import { googleMapsProvider } from "./google-maps";
import { demoProvider } from "./demo";
import { overtureProvider } from "./overture";
import { foursquareProvider, linkedinProvider, webSearchProvider } from "./future";
import type { DiscoveryProvider, DiscoveryProviderKey, ProviderStatus } from "./types";

export const PROVIDERS: Record<Exclude<DiscoveryProviderKey, "csv">, DiscoveryProvider> = {
  google_maps: googleMapsProvider,
  overture: overtureProvider,
  osm: osmProvider,
  foursquare: foursquareProvider,
  web_search: webSearchProvider,
  linkedin: linkedinProvider,
  demo: demoProvider,
};

/** Order the interface shows sources in: active first, then planned. Internal (demo) and disabled (Overture, OpenStreetMap) providers are never listed. */
export const PROVIDER_ORDER: Exclude<DiscoveryProviderKey, "csv" | "demo" | "overture" | "osm">[] = ["google_maps", "foursquare", "web_search", "linkedin"];

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

export const PROVIDER_LABEL: Record<string, string> = Object.fromEntries([...PROVIDER_ORDER.map((k) => [k, PROVIDERS[k].label]), ["csv", "CSV import"], ["demo", "Demo data"], ["overture", "Overture Maps"], ["osm", "OpenStreetMap"]]);

export * from "./types";
export * from "./normalize";
export { upsertCandidate } from "./dedupe";
export { csvToCandidates, parseCsv } from "./csv";
