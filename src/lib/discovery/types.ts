/**
 * Provider-agnostic discovery contracts. Every provider returns the same
 * candidate shape; the engine normalizes, merges and persists downstream.
 * A provider is active (offered on the form, runs), internal (runs only for
 * seeded or test searches, never offered on the form), disabled (kept in the
 * code, never offered, refused by the engine) or future (visible in the
 * interface, never executed, no credentials requested yet).
 */
import type { BBox } from "./cells";

export type DiscoveryProviderKey = "google_maps" | "overture" | "osm" | "foursquare" | "web_search" | "linkedin" | "csv" | "demo";
export type ProviderStatus = "active" | "internal" | "disabled" | "future";

export interface ResolvedArea {
  bbox: BBox;
  center: { lat: number; lon: number } | null;
  /** Radius in km when the search is a radius around the center. */
  radiusKm: number | null;
  label: string;
  /** How the area was resolved: the form's typeahead center, the geocoder's boundary, or a bundled place with a default radius. */
  source: "typeahead" | "geocoder" | "bundled";
}

export interface DiscoveryQuery {
  industry: string;
  /** Free-text category for the generic industry. */
  customCategory?: string | null;
  keywords?: string | null;
  country: string;
  region?: string | null;
  city?: string | null;
  maxResults: number;
  requireWebsite: boolean;
  /** Playbook segment keys; empty = all. */
  segments?: string[];
  areaMode?: "area" | "radius";
  radiusKm?: number;
  lat?: number | null;
  lng?: number | null;
  /** Resolved by the engine once and shared by every provider. */
  area?: ResolvedArea;
  /** Legacy Google text query override. */
  categoryQuery?: string | null;
}

export interface BusinessCandidate {
  provider: DiscoveryProviderKey;
  providerId: string;
  name: string;
  category?: string | null;
  /** Which mapping produced this record (category, hierarchy node, tag selector, name pattern). */
  matchedBy?: string | null;
  website?: string | null;
  phone?: string | null;
  email?: string | null;
  street?: string | null;
  city?: string | null;
  region?: string | null;
  postalCode?: string | null;
  country?: string | null;
  lat?: number | null;
  lng?: number | null;
  sourceUrl?: string | null;
  attribution: string;
  raw?: Record<string, unknown>;
  /** open | closed | unknown when the source knows. */
  operatingStatus?: string | null;
  /** Brand the source attaches to the place (chains). */
  brand?: string | null;
  /** Social profile URLs the source lists. */
  socials?: string[];
  /** When the source record was fetched into the local cache. */
  fetchedAt?: string | null;
}

export interface ProviderResult {
  provider: DiscoveryProviderKey;
  candidates: BusinessCandidate[];
  attribution: string;
  notes: string[];
  /** Resolved area description, when the provider resolved one itself. */
  area?: string | null;
  /** How the area was served: every cell from the local cache, some, or none. */
  cached?: "all" | "some" | "none";
  /** Source release or snapshot used. */
  release?: string | null;
}

export interface DiscoveryProvider {
  key: DiscoveryProviderKey;
  label: string;
  status: ProviderStatus;
  /** One line for the interface. */
  description: string;
  /** Future providers: what they will be for. */
  futurePurpose?: string;
  attribution: string;
  isAvailable(): { available: boolean; reason?: string };
  discover(query: DiscoveryQuery, opts?: { signal?: AbortSignal; onProgress?: (msg: string) => void }): Promise<ProviderResult>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly provider: DiscoveryProviderKey,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
