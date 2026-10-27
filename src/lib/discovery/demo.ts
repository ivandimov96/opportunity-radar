/**
 * Demo provider: clearly labeled synthetic businesses so the full workflow can
 * be exercised without credentials or network. Every record is marked isDemo
 * and uses the reserved .example domain, which can never resolve to a real
 * company website.
 */
import type { BusinessCandidate, DiscoveryProvider, ProviderResult } from "./types";

export const DEMO_ATTRIBUTION = "Synthetic demo data (not a real business)";

export const DEMO_BUSINESSES: Record<string, BusinessCandidate[]> = {
  auto_repair: [
    {
      provider: "demo",
      providerId: "demo-auto-1",
      name: "Barton Creek Auto Care (Demo)",
      category: "car_repair",
      website: "https://barton-creek-auto-care.example",
      phone: "512-555-0101",
      street: "4100 Demo Lane",
      city: "Austin",
      region: "TX",
      postalCode: "78704",
      country: "US",
      attribution: DEMO_ATTRIBUTION,
    },
    {
      provider: "demo",
      providerId: "demo-auto-2",
      name: "Northside Transmission & Brake (Demo)",
      category: "car_repair",
      website: "https://northside-transmission.example",
      phone: "512-555-0102",
      street: "9020 Sample Blvd",
      city: "Austin",
      region: "TX",
      postalCode: "78758",
      country: "US",
      attribution: DEMO_ATTRIBUTION,
    },
    {
      provider: "demo",
      providerId: "demo-auto-3",
      name: "Lone Star Euro Specialists (Demo)",
      category: "car_repair",
      website: "https://lonestar-euro.example",
      phone: "512-555-0103",
      city: "Austin",
      region: "TX",
      country: "US",
      attribution: DEMO_ATTRIBUTION,
    },
    {
      provider: "demo",
      providerId: "demo-auto-4",
      name: "Quick Lube Corner (Demo)",
      category: "car_repair",
      website: null,
      phone: "512-555-0104",
      city: "Austin",
      region: "TX",
      country: "US",
      attribution: DEMO_ATTRIBUTION,
    },
  ],
  home_services: [
    {
      provider: "demo",
      providerId: "demo-hvac-1",
      name: "Hill Country Comfort HVAC (Demo)",
      category: "hvac",
      website: "https://hillcountry-comfort.example",
      phone: "512-555-0201",
      city: "Austin",
      region: "TX",
      country: "US",
      attribution: DEMO_ATTRIBUTION,
    },
    {
      provider: "demo",
      providerId: "demo-plumb-1",
      name: "Bluebonnet Plumbing Co. (Demo)",
      category: "plumber",
      website: "https://bluebonnet-plumbing.example",
      phone: "512-555-0202",
      city: "Austin",
      region: "TX",
      country: "US",
      attribution: DEMO_ATTRIBUTION,
    },
  ],
};

export const demoProvider: DiscoveryProvider = {
  key: "demo",
  label: "Demo (synthetic)",
  isAvailable: () => ({ available: true }),
  async discover(q): Promise<ProviderResult> {
    const list = DEMO_BUSINESSES[q.industry] ?? DEMO_BUSINESSES.auto_repair;
    return {
      provider: "demo",
      candidates: list.slice(0, q.maxResults),
      attribution: DEMO_ATTRIBUTION,
      notes: ["Demo provider returned synthetic businesses. These are not real companies."],
    };
  },
};
