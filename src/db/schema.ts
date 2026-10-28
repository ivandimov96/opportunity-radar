import { sql } from "drizzle-orm";
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const now = () => sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;
const json = <T>(name: string) => text(name, { mode: "json" }).$type<T>();

// ---------------------------------------------------------------- searches
export const searches = sqliteTable("searches", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  industry: text("industry").notNull(),
  categoryQuery: text("category_query"),
  country: text("country").notNull().default("US"),
  region: text("region"),
  city: text("city"),
  keywords: text("keywords"),
  maxResults: integer("max_results").notNull().default(50),
  requireWebsite: integer("require_website", { mode: "boolean" }).notNull().default(true),
  providers: json<string[]>("providers").notNull(),
  autoInvestigate: integer("auto_investigate", { mode: "boolean" }).notNull().default(true),
  /** Discovery filters and automation settings (see src/lib/search-input.ts). Null = defaults. */
  filters: json<SearchFilters>("filters"),
  status: text("status").notNull().default("queued"), // queued|running|done|failed
  stats: json<SearchStats>("stats"),
  error: text("error"),
  isDemo: integer("is_demo", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
});

export type SearchStats = {
  providerResults: Record<string, { found: number; error?: string; durationMs?: number; cached?: "all" | "some" | "none"; release?: string }>;
  /** Everything the sources and the ranking step reported, in order (geocoded area, counts, drops, merges). */
  notes?: string[];
  durationMs?: number;
  /** Candidates collected from all sources before filters, and after filters/ranking. */
  candidates?: number;
  ranked?: number;
  created: number;
  merged: number;
  skippedNoWebsite: number;
  skippedNoPhone?: number;
  skippedChains?: number;
  skippedKnown?: number;
  skippedClosed?: number;
  queuedForInvestigation?: number;
  area?: string | null;
  /** Resolved search area for the map and the summary. */
  bbox?: { south: number; west: number; north: number; east: number } | null;
  /** Some selected sources failed while others answered. */
  partial?: boolean;
  /** How the area was served: all cells from the local cache, some, or none (fresh pulls). */
  cached?: "all" | "some" | "none";
  /** Source release versions used (Overture release tag, OSM snapshot date). */
  releases?: Record<string, string>;
  /** Candidates saved as businesses by this run (auto-save) or later by the operator. */
  saved?: number;
  total: number;
  attribution: string[];
};

export type SearchFilters = {
  /** Playbook segment keys (sub-types of the industry). Empty = all segments. */
  segments: string[];
  /** Whole geocoded city/region area, or a radius around its center. */
  areaMode: "area" | "radius";
  radiusKm: number;
  requirePhone: boolean;
  excludeChains: boolean;
  /** Skip businesses already known from earlier searches (they are still merged, just not listed as results). */
  skipKnown: boolean;
  /** Only auto-investigate candidates with at least this lead score. */
  minLeadScore: number;
  /** Auto-investigate at most this many (best leads first); null = all. */
  autoInvestigateLimit: number | null;
  /** City center picked from the typeahead (GeoNames); lets radius searches skip geocoding. */
  centerLat?: number | null;
  centerLon?: number | null;
  /** Free-text category for the generic industry (matched against the source taxonomies). */
  customCategory?: string | null;
  /** Save every listed candidate as a business automatically (otherwise the operator picks). */
  autoSave?: boolean;
};

// --------------------------------------------------------------- businesses
/**
 * status: the single investigation state.
 *   new | queued | investigating | profiled | failed | no_website
 * verdict (set when profiled): opportunity | no_opportunity | needs_ai
 */
export const businesses = sqliteTable(
  "businesses",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    nameNormalized: text("name_normalized").notNull(),
    industry: text("industry").notNull(),
    category: text("category"),
    website: text("website"),
    websiteDomain: text("website_domain"),
    phone: text("phone"),
    email: text("email"),
    street: text("street"),
    city: text("city"),
    region: text("region"),
    postalCode: text("postal_code"),
    country: text("country"),
    lat: real("lat"),
    lng: real("lng"),
    firstProvider: text("first_provider").notNull(),
    status: text("status").notNull().default("new"),
    statusMessage: text("status_message"),
    verdict: text("verdict"),
    summary: text("summary"),
    bestAttractiveness: integer("best_attractiveness"),
    bestConfidence: integer("best_confidence"),
    priority: integer("priority"),
    investigatedAt: text("investigated_at"),
    /** Pre-investigation ranking (0-100): how worth researching this candidate looks from discovery data alone. */
    leadScore: integer("lead_score"),
    /** independent | chain | unknown — chains/franchises are deprioritized, never hidden. */
    kind: text("kind").notNull().default("unknown"),
    /** Where the website URL came from: provider key, found_search, found_guess, found_email, manual. */
    websiteSource: text("website_source"),
    /** Why this candidate ranked where it did at discovery (lead score reasons), for the "Found by" panel. */
    leadReasons: json<string[]>("lead_reasons"),
    /** open | closed | unknown, from the discovery source (Overture operating_status). */
    operatingStatus: text("operating_status"),
    /** Brand name when the source marks the place as part of a brand (chains). */
    brand: text("brand"),
    isDemo: integer("is_demo", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull().default(now()),
    updatedAt: text("updated_at").notNull().default(now()),
  },
  (t) => [index("businesses_domain_idx").on(t.websiteDomain), index("businesses_name_city_idx").on(t.nameNormalized, t.city), index("businesses_status_idx").on(t.status), index("businesses_priority_idx").on(t.priority)],
);

export const businessSources = sqliteTable(
  "business_sources",
  {
    id: text("id").primaryKey(),
    businessId: text("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    providerId: text("provider_id"),
    sourceUrl: text("source_url"),
    attribution: text("attribution"),
    searchId: text("search_id").references(() => searches.id, { onDelete: "set null" }),
    raw: json<Record<string, unknown>>("raw"),
    discoveredAt: text("discovered_at").notNull().default(now()),
  },
  (t) => [uniqueIndex("business_sources_provider_pid").on(t.provider, t.providerId), index("business_sources_business_idx").on(t.businessId)],
);

export const searchResults = sqliteTable(
  "search_results",
  {
    searchId: text("search_id")
      .notNull()
      .references(() => searches.id, { onDelete: "cascade" }),
    businessId: text("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    rank: integer("rank").notNull(),
    wasNew: integer("was_new", { mode: "boolean" }).notNull().default(true),
  },
  (t) => [uniqueIndex("search_results_pk").on(t.searchId, t.businessId)],
);

// ------------------------------------------------------------ investigation
export const investigations = sqliteTable(
  "investigations",
  {
    id: text("id").primaryKey(),
    businessId: text("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("running"), // running|done|failed
    startedAt: text("started_at").notNull().default(now()),
    finishedAt: text("finished_at"),
    durationMs: integer("duration_ms"),
    error: text("error"),
    pagesFetched: integer("pages_fetched").notNull().default(0),
    pagesFailed: integer("pages_failed").notNull().default(0),
    factsVerified: integer("facts_verified").notNull().default(0),
    factsRejected: integer("facts_rejected").notNull().default(0),
    model: text("model"),
    costUsd: real("cost_usd").notNull().default(0),
    /** Firecrawl credits spent (pages scraped, site maps, finder checks); 0 when stored pages were reused. */
    creditsUsed: integer("credits_used").notNull().default(0),
    workflows: json<{ name: string; factKeys: string[] }[]>("workflows"),
    verdict: text("verdict"),
    verdictReason: text("verdict_reason"),
    warnings: json<string[]>("warnings"),
    notes: json<string[]>("notes"),
  },
  (t) => [index("investigations_business_idx").on(t.businessId)],
);

export const pages = sqliteTable(
  "pages",
  {
    id: text("id").primaryKey(),
    investigationId: text("investigation_id")
      .notNull()
      .references(() => investigations.id, { onDelete: "cascade" }),
    businessId: text("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    finalUrl: text("final_url"),
    kind: text("kind").notNull().default("other"),
    statusCode: integer("status_code"),
    title: text("title"),
    text: text("text"),
    /** Firecrawl's main-content markdown (headings, lists and tables kept): what the model and the UI read. */
    markdown: text("markdown"),
    /** The page as delivered, kept so detectors can run again without a new crawl. */
    html: text("html"),
    contentHash: text("content_hash"),
    /** Firecrawl credits this page cost (0 when reused from storage). */
    credits: integer("credits").notNull().default(0),
    bytes: integer("bytes"),
    error: text("error"),
    /** firecrawl (fetched through Firecrawl) | stored (reused from an earlier investigation); older rows: static | browser. */
    renderer: text("renderer").notNull().default("static"),
    fetchedAt: text("fetched_at").notNull().default(now()),
  },
  (t) => [index("pages_business_idx").on(t.businessId)],
);

/** One row per profile field per business (latest investigation wins). */
export const facts = sqliteTable(
  "facts",
  {
    id: text("id").primaryKey(),
    businessId: text("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    investigationId: text("investigation_id").references(() => investigations.id, { onDelete: "set null" }),
    key: text("key").notNull(),
    status: text("status").notNull(), // verified | not_found | unknown
    value: text("value"),
    evidenceQuote: text("evidence_quote"),
    sourceUrl: text("source_url"),
    method: text("method").notNull(), // detected | ai | manual | demo
    createdAt: text("created_at").notNull().default(now()),
  },
  (t) => [uniqueIndex("facts_business_key").on(t.businessId, t.key)],
);

export const opportunities = sqliteTable(
  "opportunities",
  {
    id: text("id").primaryKey(),
    investigationId: text("investigation_id")
      .notNull()
      .references(() => investigations.id, { onDelete: "cascade" }),
    businessId: text("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    category: text("category").notNull(),
    title: text("title").notNull(),
    problemHypothesis: text("problem_hypothesis").notNull(),
    proposedSolution: text("proposed_solution").notNull(),
    whyNotExistingTool: text("why_not_existing_tool"),
    expectedValue: text("expected_value"),
    supportingFactKeys: json<string[]>("supporting_fact_keys").notNull(),
    assumptions: json<string[]>("assumptions").notNull(),
    validationQuestions: json<string[]>("validation_questions").notNull(),
    implementationEffort: text("implementation_effort").notNull(),
    reusability: text("reusability").notNull(),
    risks: json<string[]>("risks").notNull(),
    salesAngle: text("sales_angle"),
    aiRatings: json<{ value: number; feasibility: number; evidenceStrength: number; buyingReadiness: number }>("ai_ratings"),
    attractivenessScore: integer("attractiveness_score").notNull(),
    confidenceScore: integer("confidence_score").notNull(),
    scoreBreakdown: json<ScoreBreakdown>("score_breakdown").notNull(),
    rank: integer("rank").notNull().default(1),
    /** rules = deterministic pattern from verified facts/gaps; ai = model hypothesis (fact-cited); demo. */
    source: text("source").notNull().default("ai"),
    createdAt: text("created_at").notNull().default(now()),
  },
  (t) => [index("opportunities_business_idx").on(t.businessId), index("opportunities_category_idx").on(t.category)],
);

export type ScoreBreakdown = {
  attractiveness: { factor: string; weight: number; score: number; explanation: string }[];
  confidence: { factor: string; weight: number; score: number; explanation: string }[];
  notes: string[];
};

// ----------------------------------------------------------------- outreach
export const outreachDrafts = sqliteTable(
  "outreach_drafts",
  {
    id: text("id").primaryKey(),
    businessId: text("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    opportunityId: text("opportunity_id").references(() => opportunities.id, { onDelete: "set null" }),
    style: text("style").notNull(),
    channel: text("channel").notNull().default("email"),
    toEmail: text("to_email"),
    subject: text("subject"),
    body: text("body").notNull(),
    claims: json<{ text: string; factKeys: string[] }[]>("claims").notNull(),
    warnings: json<string[]>("warnings").notNull(),
    status: text("status").notNull().default("draft"),
    editedByUser: integer("edited_by_user", { mode: "boolean" }).notNull().default(false),
    model: text("model"),
    createdAt: text("created_at").notNull().default(now()),
    updatedAt: text("updated_at").notNull().default(now()),
  },
  (t) => [index("outreach_business_idx").on(t.businessId)],
);

// ----------------------------------------------------------------- pipeline
export const prospects = sqliteTable("prospects", {
  businessId: text("business_id")
    .primaryKey()
    .references(() => businesses.id, { onDelete: "cascade" }),
  stage: text("stage").notNull().default("lead"),
  priority: text("priority").notNull().default("normal"),
  nextAction: text("next_action"),
  nextActionAt: text("next_action_at"),
  updatedAt: text("updated_at").notNull().default(now()),
});

export const activities = sqliteTable(
  "activities",
  {
    id: text("id").primaryKey(),
    businessId: text("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    content: text("content").notNull(),
    metadata: json<Record<string, unknown>>("metadata"),
    createdAt: text("created_at").notNull().default(now()),
  },
  (t) => [index("activities_business_idx").on(t.businessId)],
);

export const validationSignals = sqliteTable(
  "validation_signals",
  {
    id: text("id").primaryKey(),
    businessId: text("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    opportunityCategory: text("opportunity_category").notNull(),
    signalType: text("signal_type").notNull(),
    notes: text("notes"),
    createdAt: text("created_at").notNull().default(now()),
  },
  (t) => [index("validation_category_idx").on(t.opportunityCategory)],
);

// --------------------------------------------------------------------- jobs
export const jobs = sqliteTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    type: text("type").notNull(),
    payload: json<Record<string, unknown>>("payload").notNull(),
    idempotencyKey: text("idempotency_key"),
    status: text("status").notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    error: text("error"),
    progress: json<{ message?: string; done?: number; total?: number }>("progress"),
    scheduledAt: text("scheduled_at").notNull().default(now()),
    startedAt: text("started_at"),
    finishedAt: text("finished_at"),
    lockedBy: text("locked_by"),
    createdAt: text("created_at").notNull().default(now()),
  },
  (t) => [uniqueIndex("jobs_idempotency_idx").on(t.idempotencyKey), index("jobs_status_idx").on(t.status, t.scheduledAt)],
);

export const aiUsage = sqliteTable("ai_usage", {
  id: text("id").primaryKey(),
  stage: text("stage").notNull(),
  model: text("model").notNull(),
  businessId: text("business_id"),
  inputTokens: integer("input_tokens").notNull(),
  outputTokens: integer("output_tokens").notNull(),
  cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
  cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
  estimatedCostUsd: real("estimated_cost_usd").notNull(),
  createdAt: text("created_at").notNull().default(now()),
});

/** Cached discovery pulls from bulk open data (Overture): one row per release × area × category set, 30-day TTL. */
/**
 * Every place ever fetched from a discovery source, one row per source record,
 * keyed by grid cell so searches answer locally once an area is cached.
 * Raw provider data is kept verbatim (provenance); normalized columns serve
 * search and deduplication.
 */
export const sourcePlaces = sqliteTable(
  "source_places",
  {
    id: text("id").primaryKey(),
    provider: text("provider").notNull(),
    providerId: text("provider_id").notNull(),
    /** Source release or snapshot the row came from (Overture release tag; OSM fetch date). */
    release: text("release").notNull(),
    cell: text("cell").notNull(),
    name: text("name").notNull(),
    nameNormalized: text("name_normalized").notNull(),
    /** Primary category as the source names it. */
    category: text("category"),
    /** Overture taxonomy path "root|…|primary" (pipe-delimited for LIKE matching); OSM: "key=value". */
    categoryPath: text("category_path"),
    website: text("website"),
    websiteDomain: text("website_domain"),
    phone: text("phone"),
    email: text("email"),
    street: text("street"),
    city: text("city"),
    region: text("region"),
    postalCode: text("postal_code"),
    country: text("country"),
    lat: real("lat").notNull(),
    lon: real("lon").notNull(),
    operatingStatus: text("operating_status"),
    brand: text("brand"),
    confidence: real("confidence"),
    sourceUrl: text("source_url"),
    raw: json<Record<string, unknown>>("raw"),
    fetchedAt: text("fetched_at").notNull().default(now()),
  },
  (t) => [uniqueIndex("source_places_provider_pid").on(t.provider, t.providerId), index("source_places_cell_idx").on(t.provider, t.cell), index("source_places_latlon_idx").on(t.lat, t.lon), index("source_places_domain_idx").on(t.websiteDomain), index("source_places_name_idx").on(t.nameNormalized)],
);

/** Which (provider, industry, cell) combinations are cached, from which release, when, and how many rows. */
export const sourceCells = sqliteTable(
  "source_cells",
  {
    id: text("id").primaryKey(),
    provider: text("provider").notNull(),
    /** Industry key the cell was fetched for (its full category set), or "custom:<token>". */
    scope: text("scope").notNull(),
    cell: text("cell").notNull(),
    release: text("release").notNull(),
    rowCount: integer("row_count").notNull().default(0),
    durationMs: integer("duration_ms"),
    fetchedAt: text("fetched_at").notNull().default(now()),
  },
  (t) => [uniqueIndex("source_cells_key").on(t.provider, t.scope, t.cell)],
);

/**
 * What a search found, after normalization and cross-source deduplication,
 * before anything is saved as a business. Keeps every contributing source,
 * the match reason and confidence, and the saved business when one exists.
 */
export const searchCandidates = sqliteTable(
  "search_candidates",
  {
    id: text("id").primaryKey(),
    searchId: text("search_id")
      .notNull()
      .references(() => searches.id, { onDelete: "cascade" }),
    rank: integer("rank").notNull(),
    name: text("name").notNull(),
    nameNormalized: text("name_normalized").notNull(),
    category: text("category"),
    /** Which mapping matched (e.g. "category tire_shop", "tags [shop=car_repair]"), per source. */
    matchedBy: json<string[]>("matched_by"),
    website: text("website"),
    websiteDomain: text("website_domain"),
    phone: text("phone"),
    email: text("email"),
    street: text("street"),
    city: text("city"),
    region: text("region"),
    postalCode: text("postal_code"),
    country: text("country"),
    lat: real("lat"),
    lon: real("lon"),
    operatingStatus: text("operating_status"),
    brand: text("brand"),
    kind: text("kind").notNull().default("independent"),
    leadScore: integer("lead_score").notNull().default(0),
    leadReasons: json<string[]>("lead_reasons"),
    /** 0–100: how many of name, address, phone, website, email, coordinates are present. */
    completeness: integer("completeness").notNull().default(0),
    /** Contributing source records. */
    sources: json<{ provider: string; providerId: string; sourceUrl: string | null; attribution: string; fetchedAt: string | null; matchedBy: string | null }[]>("sources").notNull(),
    /** How the sources were merged: provider_id | domain | phone | name_proximity, with confidence 0–1. */
    mergeRule: text("merge_rule"),
    mergeConfidence: real("merge_confidence"),
    /** A similar record that stayed separate (uncertain match), for review. */
    possibleDuplicateOf: text("possible_duplicate_of"),
    /** Saved business, when this candidate was saved or matched one already in the database. */
    businessId: text("business_id").references(() => businesses.id, { onDelete: "set null" }),
    /** How the saved business was matched: new | provider_id | domain | phone | name_city. */
    savedVia: text("saved_via"),
    /** Why the candidate was set aside by the search filters (closed, chain, no phone…); null = listed. */
    skippedReason: text("skipped_reason"),
    createdAt: text("created_at").notNull().default(now()),
  },
  (t) => [index("search_candidates_search_idx").on(t.searchId, t.rank), index("search_candidates_business_idx").on(t.businessId)],
);

export const placeCache = sqliteTable("place_cache", {
  key: text("key").primaryKey(),
  release: text("release").notNull(),
  rows: json<Record<string, unknown>[]>("rows").notNull(),
  rowCount: integer("row_count").notNull().default(0),
  durationMs: integer("duration_ms"),
  createdAt: text("created_at").notNull().default(now()),
});

/** Cached responses of metered providers (SerpApi pages), keyed by the exact request. */
export const providerCache = sqliteTable("provider_cache", {
  key: text("key").primaryKey(),
  provider: text("provider").notNull(),
  value: json<Record<string, unknown>>("value").notNull(),
  fetchedAt: text("fetched_at").notNull().default(now()),
});

/** Metered calls per provider and UTC month (budget guard). */
export const providerUsage = sqliteTable(
  "provider_usage",
  {
    provider: text("provider").notNull(),
    period: text("period").notNull(),
    used: integer("used").notNull().default(0),
    updatedAt: text("updated_at").notNull().default(now()),
  },
  (t) => [primaryKey({ columns: [t.provider, t.period] })],
);

export const geocodeCache = sqliteTable("geocode_cache", {
  key: text("key").primaryKey(),
  value: json<Record<string, unknown>>("value").notNull(),
  createdAt: text("created_at").notNull().default(now()),
});
