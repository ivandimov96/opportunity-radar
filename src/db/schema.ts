import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const now = () => sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;
const json = <T>(name: string) => text(name, { mode: "json" }).$type<T>();

// ---------------------------------------------------------------- searches
export const searches = sqliteTable("searches", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  industry: text("industry").notNull(), // playbook key, e.g. auto_repair
  categoryQuery: text("category_query"), // free-text category/keywords
  country: text("country").notNull().default("US"),
  region: text("region"),
  city: text("city"),
  keywords: text("keywords"),
  maxResults: integer("max_results").notNull().default(50),
  requireWebsite: integer("require_website", { mode: "boolean" }).notNull().default(false),
  providers: json<string[]>("providers").notNull(),
  autoResearch: integer("auto_research", { mode: "boolean" }).notNull().default(false),
  status: text("status").notNull().default("queued"), // queued|running|done|failed
  stats: json<SearchStats>("stats"),
  error: text("error"),
  isDemo: integer("is_demo", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
});

export type SearchStats = {
  providerResults: Record<string, { found: number; error?: string }>;
  created: number;
  merged: number;
  skippedNoWebsite: number;
  total: number;
  attribution: string[];
};

// --------------------------------------------------------------- businesses
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
    researchStatus: text("research_status").notNull().default("not_started"), // not_started|queued|running|done|failed|no_website
    analysisStatus: text("analysis_status").notNull().default("not_started"), // not_started|queued|running|done|failed|insufficient_evidence
    lastResearchedAt: text("last_researched_at"),
    isDemo: integer("is_demo", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull().default(now()),
    updatedAt: text("updated_at").notNull().default(now()),
  },
  (t) => [
    index("businesses_domain_idx").on(t.websiteDomain),
    index("businesses_name_city_idx").on(t.nameNormalized, t.city),
    index("businesses_industry_idx").on(t.industry),
  ],
);

export const businessSources = sqliteTable(
  "business_sources",
  {
    id: text("id").primaryKey(),
    businessId: text("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(), // osm|google_places|csv|demo
    providerId: text("provider_id"),
    sourceUrl: text("source_url"),
    attribution: text("attribution"),
    searchId: text("search_id").references(() => searches.id, { onDelete: "set null" }),
    raw: json<Record<string, unknown>>("raw"),
    discoveredAt: text("discovered_at").notNull().default(now()),
  },
  (t) => [
    uniqueIndex("business_sources_provider_pid").on(t.provider, t.providerId),
    index("business_sources_business_idx").on(t.businessId),
  ],
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

// ----------------------------------------------------------------- research
export const researchRuns = sqliteTable(
  "research_runs",
  {
    id: text("id").primaryKey(),
    businessId: text("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("running"), // running|done|failed
    startedAt: text("started_at").notNull().default(now()),
    finishedAt: text("finished_at"),
    error: text("error"),
    pagesFetched: integer("pages_fetched").notNull().default(0),
    pagesFailed: integer("pages_failed").notNull().default(0),
    aiObservationsAccepted: integer("ai_observations_accepted").notNull().default(0),
    aiObservationsRejected: integer("ai_observations_rejected").notNull().default(0),
    notes: json<string[]>("notes"),
  },
  (t) => [index("research_runs_business_idx").on(t.businessId)],
);

export const pages = sqliteTable(
  "pages",
  {
    id: text("id").primaryKey(),
    researchRunId: text("research_run_id")
      .notNull()
      .references(() => researchRuns.id, { onDelete: "cascade" }),
    businessId: text("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    finalUrl: text("final_url"),
    kind: text("kind").notNull().default("other"), // home|about|services|contact|pricing|booking|faq|other
    statusCode: integer("status_code"),
    title: text("title"),
    text: text("text"),
    textHash: text("text_hash"),
    bytes: integer("bytes"),
    error: text("error"),
    fetchedAt: text("fetched_at").notNull().default(now()),
  },
  (t) => [index("pages_business_idx").on(t.businessId)],
);

export const observations = sqliteTable(
  "observations",
  {
    id: text("id").primaryKey(),
    businessId: text("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    researchRunId: text("research_run_id").references(() => researchRuns.id, {
      onDelete: "cascade",
    }),
    kind: text("kind").notNull(), // verified | unknown
    category: text("category").notNull(), // services|booking|pricing|contact|tools|hours|team|reviews|payments|customers|other
    statement: text("statement").notNull(),
    evidenceQuote: text("evidence_quote"),
    sourceUrl: text("source_url"),
    pageId: text("page_id").references(() => pages.id, { onDelete: "set null" }),
    method: text("method").notNull(), // deterministic | ai | manual | demo
    confidence: real("confidence").notNull().default(1),
    createdAt: text("created_at").notNull().default(now()),
  },
  (t) => [index("observations_business_idx").on(t.businessId)],
);

// ----------------------------------------------------------------- analysis
export const analyses = sqliteTable(
  "analyses",
  {
    id: text("id").primaryKey(),
    businessId: text("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    researchRunId: text("research_run_id").references(() => researchRuns.id, {
      onDelete: "set null",
    }),
    status: text("status").notNull().default("done"),
    model: text("model"),
    companySummary: text("company_summary"),
    documentedWorkflows: json<{ name: string; observationIds: string[] }[]>("documented_workflows"),
    industryWorkflows: json<string[]>("industry_workflows"),
    existingTools: json<string[]>("existing_tools"),
    noCompellingOpportunity: integer("no_compelling_opportunity", { mode: "boolean" })
      .notNull()
      .default(false),
    noOpportunityReason: text("no_opportunity_reason"),
    validationWarnings: json<string[]>("validation_warnings"),
    createdAt: text("created_at").notNull().default(now()),
  },
  (t) => [index("analyses_business_idx").on(t.businessId)],
);

export const opportunities = sqliteTable(
  "opportunities",
  {
    id: text("id").primaryKey(),
    analysisId: text("analysis_id")
      .notNull()
      .references(() => analyses.id, { onDelete: "cascade" }),
    businessId: text("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    category: text("category").notNull(), // taxonomy key
    title: text("title").notNull(),
    problemHypothesis: text("problem_hypothesis").notNull(),
    proposedSolution: text("proposed_solution").notNull(),
    whyNotExistingTool: text("why_not_existing_tool"),
    expectedValue: text("expected_value"),
    supportingObservationIds: json<string[]>("supporting_observation_ids").notNull(),
    assumptions: json<string[]>("assumptions").notNull(),
    validationQuestions: json<string[]>("validation_questions").notNull(),
    implementationEffort: text("implementation_effort").notNull(), // small|medium|large
    reusability: text("reusability").notNull(), // low|medium|high
    risks: json<string[]>("risks").notNull(),
    salesAngle: text("sales_angle"),
    aiRatings: json<{ value: number; feasibility: number; evidenceStrength: number; buyingReadiness: number }>(
      "ai_ratings",
    ),
    attractivenessScore: integer("attractiveness_score").notNull(),
    confidenceScore: integer("confidence_score").notNull(),
    scoreBreakdown: json<ScoreBreakdown>("score_breakdown").notNull(),
    rank: integer("rank").notNull().default(1),
    createdAt: text("created_at").notNull().default(now()),
  },
  (t) => [
    index("opportunities_business_idx").on(t.businessId),
    index("opportunities_category_idx").on(t.category),
  ],
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
    opportunityId: text("opportunity_id").references(() => opportunities.id, {
      onDelete: "set null",
    }),
    style: text("style").notNull(), // concise|consultative|casual
    channel: text("channel").notNull().default("email"),
    toEmail: text("to_email"),
    subject: text("subject"),
    body: text("body").notNull(),
    claims: json<{ text: string; observationIds: string[] }[]>("claims").notNull(),
    warnings: json<string[]>("warnings").notNull(),
    status: text("status").notNull().default("draft"), // draft|approved|archived
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
  stage: text("stage").notNull().default("discovered"),
  priority: text("priority").notNull().default("normal"), // low|normal|high
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
    type: text("type").notNull(), // note|stage_change|system|call|email|meeting|validation
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
    signalType: text("signal_type").notNull(), // conversation|confirmed_problem|rejected|pilot|paying
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
    status: text("status").notNull().default("queued"), // queued|running|done|failed|cancelled
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
  (t) => [
    uniqueIndex("jobs_idempotency_idx").on(t.idempotencyKey),
    index("jobs_status_idx").on(t.status, t.scheduledAt),
  ],
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

export const geocodeCache = sqliteTable("geocode_cache", {
  key: text("key").primaryKey(),
  value: json<Record<string, unknown>>("value").notNull(),
  createdAt: text("created_at").notNull().default(now()),
});
