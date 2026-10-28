import { osmProvider } from "./osm";
import { googlePlacesProvider } from "./google-places";
import { demoProvider } from "./demo";
import { txPermitsProvider } from "./tx-permits";
import { overtureProvider } from "./overture";
import type { DiscoveryProvider, DiscoveryProviderKey } from "./types";

export const PROVIDERS: Record<Exclude<DiscoveryProviderKey, "csv">, DiscoveryProvider> = {
  overture: overtureProvider,
  osm: osmProvider,
  google_places: googlePlacesProvider,
  tx_permits: txPermitsProvider,
  demo: demoProvider,
};

export function listProviders() {
  return Object.values(PROVIDERS).map((p) => ({ key: p.key, label: p.label, ...p.isAvailable() }));
}

export * from "./types";
export * from "./normalize";
export { upsertCandidate } from "./dedupe";
export { csvToCandidates, parseCsv } from "./csv";
