/**
 * Planned providers: visible in the interface with a "New" badge, never
 * executed, no credentials requested. Each is a real registry entry so turning
 * one on later means implementing `discover` and flipping its status, nothing
 * else. The engine refuses to run any provider whose status is "future".
 */
import type { DiscoveryProvider, DiscoveryProviderKey, ProviderResult } from "./types";
import { ProviderError } from "./types";

function future(key: DiscoveryProviderKey, label: string, description: string, futurePurpose: string, attribution: string): DiscoveryProvider {
  return {
    key,
    label,
    status: "future",
    description,
    futurePurpose,
    attribution,
    isAvailable: () => ({ available: false, reason: "Planned integration; not available yet" }),
    async discover(): Promise<ProviderResult> {
      throw new ProviderError(`${label} is a planned integration and is not available yet`, key);
    },
  };
}

export const foursquareProvider = future("foursquare", "Foursquare Places API", "Alternative business discovery and enrichment.", "Alternative business discovery and enrichment from Foursquare's places database, for coverage checks and richer attributes.", "Foursquare Places");

export const webSearchProvider = future("web_search", "Web Search APIs", "Discovering official business websites and additional publicly available business information.", "Locate official websites for businesses the map sources list without one, and gather additional publicly available business information.", "Web search results");

export const linkedinProvider = future("linkedin", "LinkedIn Sales Navigator", "Future B2B company discovery, account research and sales prospecting.", "B2B company discovery, account research and sales prospecting through LinkedIn's official partner integrations only; no scraping or browser automation.", "LinkedIn");
