/**
 * Provider-agnostic discovery contracts. Every provider returns the same
 * candidate shape; normalization and deduplication happen downstream.
 */
export type DiscoveryProviderKey = "osm" | "google_places" | "csv" | "demo";

export interface DiscoveryQuery {
  industry: string; // playbook key
  categoryQuery?: string | null;
  keywords?: string | null;
  country: string;
  region?: string | null;
  city?: string | null;
  maxResults: number;
  requireWebsite: boolean;
}

export interface BusinessCandidate {
  provider: DiscoveryProviderKey;
  providerId: string;
  name: string;
  category?: string | null;
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
}

export interface ProviderResult {
  provider: DiscoveryProviderKey;
  candidates: BusinessCandidate[];
  attribution: string;
  notes: string[];
}

export interface DiscoveryProvider {
  key: DiscoveryProviderKey;
  label: string;
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
