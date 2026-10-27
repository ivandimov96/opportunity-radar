CREATE TABLE `activities` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`type` text NOT NULL,
	`content` text NOT NULL,
	`metadata` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `activities_business_idx` ON `activities` (`business_id`);--> statement-breakpoint
CREATE TABLE `ai_usage` (
	`id` text PRIMARY KEY NOT NULL,
	`stage` text NOT NULL,
	`model` text NOT NULL,
	`business_id` text,
	`input_tokens` integer NOT NULL,
	`output_tokens` integer NOT NULL,
	`cache_read_tokens` integer DEFAULT 0 NOT NULL,
	`cache_write_tokens` integer DEFAULT 0 NOT NULL,
	`estimated_cost_usd` real NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `analyses` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`research_run_id` text,
	`status` text DEFAULT 'done' NOT NULL,
	`model` text,
	`company_summary` text,
	`documented_workflows` text,
	`industry_workflows` text,
	`existing_tools` text,
	`no_compelling_opportunity` integer DEFAULT false NOT NULL,
	`no_opportunity_reason` text,
	`validation_warnings` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`research_run_id`) REFERENCES `research_runs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `analyses_business_idx` ON `analyses` (`business_id`);--> statement-breakpoint
CREATE TABLE `business_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`provider` text NOT NULL,
	`provider_id` text,
	`source_url` text,
	`attribution` text,
	`search_id` text,
	`raw` text,
	`discovered_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`search_id`) REFERENCES `searches`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `business_sources_provider_pid` ON `business_sources` (`provider`,`provider_id`);--> statement-breakpoint
CREATE INDEX `business_sources_business_idx` ON `business_sources` (`business_id`);--> statement-breakpoint
CREATE TABLE `businesses` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`name_normalized` text NOT NULL,
	`industry` text NOT NULL,
	`category` text,
	`website` text,
	`website_domain` text,
	`phone` text,
	`email` text,
	`street` text,
	`city` text,
	`region` text,
	`postal_code` text,
	`country` text,
	`lat` real,
	`lng` real,
	`first_provider` text NOT NULL,
	`research_status` text DEFAULT 'not_started' NOT NULL,
	`analysis_status` text DEFAULT 'not_started' NOT NULL,
	`last_researched_at` text,
	`is_demo` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `businesses_domain_idx` ON `businesses` (`website_domain`);--> statement-breakpoint
CREATE INDEX `businesses_name_city_idx` ON `businesses` (`name_normalized`,`city`);--> statement-breakpoint
CREATE INDEX `businesses_industry_idx` ON `businesses` (`industry`);--> statement-breakpoint
CREATE TABLE `geocode_cache` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`payload` text NOT NULL,
	`idempotency_key` text,
	`status` text DEFAULT 'queued' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 3 NOT NULL,
	`error` text,
	`progress` text,
	`scheduled_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`started_at` text,
	`finished_at` text,
	`locked_by` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_idempotency_idx` ON `jobs` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `jobs_status_idx` ON `jobs` (`status`,`scheduled_at`);--> statement-breakpoint
CREATE TABLE `observations` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`research_run_id` text,
	`kind` text NOT NULL,
	`category` text NOT NULL,
	`statement` text NOT NULL,
	`evidence_quote` text,
	`source_url` text,
	`page_id` text,
	`method` text NOT NULL,
	`confidence` real DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`research_run_id`) REFERENCES `research_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`page_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `observations_business_idx` ON `observations` (`business_id`);--> statement-breakpoint
CREATE TABLE `opportunities` (
	`id` text PRIMARY KEY NOT NULL,
	`analysis_id` text NOT NULL,
	`business_id` text NOT NULL,
	`category` text NOT NULL,
	`title` text NOT NULL,
	`problem_hypothesis` text NOT NULL,
	`proposed_solution` text NOT NULL,
	`why_not_existing_tool` text,
	`expected_value` text,
	`supporting_observation_ids` text NOT NULL,
	`assumptions` text NOT NULL,
	`validation_questions` text NOT NULL,
	`implementation_effort` text NOT NULL,
	`reusability` text NOT NULL,
	`risks` text NOT NULL,
	`sales_angle` text,
	`ai_ratings` text,
	`attractiveness_score` integer NOT NULL,
	`confidence_score` integer NOT NULL,
	`score_breakdown` text NOT NULL,
	`rank` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`analysis_id`) REFERENCES `analyses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `opportunities_business_idx` ON `opportunities` (`business_id`);--> statement-breakpoint
CREATE INDEX `opportunities_category_idx` ON `opportunities` (`category`);--> statement-breakpoint
CREATE TABLE `outreach_drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`opportunity_id` text,
	`style` text NOT NULL,
	`channel` text DEFAULT 'email' NOT NULL,
	`to_email` text,
	`subject` text,
	`body` text NOT NULL,
	`claims` text NOT NULL,
	`warnings` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`edited_by_user` integer DEFAULT false NOT NULL,
	`model` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`opportunity_id`) REFERENCES `opportunities`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `outreach_business_idx` ON `outreach_drafts` (`business_id`);--> statement-breakpoint
CREATE TABLE `pages` (
	`id` text PRIMARY KEY NOT NULL,
	`research_run_id` text NOT NULL,
	`business_id` text NOT NULL,
	`url` text NOT NULL,
	`final_url` text,
	`kind` text DEFAULT 'other' NOT NULL,
	`status_code` integer,
	`title` text,
	`text` text,
	`text_hash` text,
	`bytes` integer,
	`error` text,
	`fetched_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`research_run_id`) REFERENCES `research_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `pages_business_idx` ON `pages` (`business_id`);--> statement-breakpoint
CREATE TABLE `prospects` (
	`business_id` text PRIMARY KEY NOT NULL,
	`stage` text DEFAULT 'discovered' NOT NULL,
	`priority` text DEFAULT 'normal' NOT NULL,
	`next_action` text,
	`next_action_at` text,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `research_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`started_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`finished_at` text,
	`error` text,
	`pages_fetched` integer DEFAULT 0 NOT NULL,
	`pages_failed` integer DEFAULT 0 NOT NULL,
	`ai_observations_accepted` integer DEFAULT 0 NOT NULL,
	`ai_observations_rejected` integer DEFAULT 0 NOT NULL,
	`notes` text,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `research_runs_business_idx` ON `research_runs` (`business_id`);--> statement-breakpoint
CREATE TABLE `search_results` (
	`search_id` text NOT NULL,
	`business_id` text NOT NULL,
	`rank` integer NOT NULL,
	`was_new` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`search_id`) REFERENCES `searches`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `search_results_pk` ON `search_results` (`search_id`,`business_id`);--> statement-breakpoint
CREATE TABLE `searches` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`industry` text NOT NULL,
	`category_query` text,
	`country` text DEFAULT 'US' NOT NULL,
	`region` text,
	`city` text,
	`keywords` text,
	`max_results` integer DEFAULT 50 NOT NULL,
	`require_website` integer DEFAULT false NOT NULL,
	`providers` text NOT NULL,
	`auto_research` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`stats` text,
	`error` text,
	`is_demo` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `validation_signals` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`opportunity_category` text NOT NULL,
	`signal_type` text NOT NULL,
	`notes` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `validation_category_idx` ON `validation_signals` (`opportunity_category`);