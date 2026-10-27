import { osmProvider } from "./osm";
import { googlePlacesProvider } from "./google-places";
import { demoProvider } from "./demo";
import type { DiscoveryProvider, DiscoveryProviderKey } from "./types";

export const PROVIDERS: Record<Exclude<DiscoveryProviderKey, "csv">, DiscoveryProvider> = {
  osm: osmProvider,
  google_places: googlePlacesProvider,
  demo: demoProvider,
};

export function listProviders() {
  return Object.values(PROVIDERS).map((p) => ({ key: p.key, label: p.label, ...p.isAvailable() }));
}

export * from "./types";
export * from "./normalize";
export { upsertCandidate } from "./dedupe";
export { csvToCandidates, parseCsv } from "./csv";
