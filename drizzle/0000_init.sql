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
	`status` text DEFAULT 'new' NOT NULL,
	`status_message` text,
	`verdict` text,
	`summary` text,
	`best_attractiveness` integer,
	`best_confidence` integer,
	`priority` integer,
	`investigated_at` text,
	`is_demo` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `businesses_domain_idx` ON `businesses` (`website_domain`);--> statement-breakpoint
CREATE INDEX `businesses_name_city_idx` ON `businesses` (`name_normalized`,`city`);--> statement-breakpoint
CREATE INDEX `businesses_status_idx` ON `businesses` (`status`);--> statement-breakpoint
CREATE INDEX `businesses_priority_idx` ON `businesses` (`priority`);--> statement-breakpoint
CREATE TABLE `facts` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`investigation_id` text,
	`key` text NOT NULL,
	`status` text NOT NULL,
	`value` text,
	`evidence_quote` text,
	`source_url` text,
	`method` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`investigation_id`) REFERENCES `investigations`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `facts_business_key` ON `facts` (`business_id`,`key`);--> statement-breakpoint
CREATE TABLE `geocode_cache` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `investigations` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`started_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`finished_at` text,
	`duration_ms` integer,
	`error` text,
	`pages_fetched` integer DEFAULT 0 NOT NULL,
	`pages_failed` integer DEFAULT 0 NOT NULL,
	`facts_verified` integer DEFAULT 0 NOT NULL,
	`facts_rejected` integer DEFAULT 0 NOT NULL,
	`model` text,
	`cost_usd` real DEFAULT 0 NOT NULL,
	`workflows` text,
	`verdict` text,
	`verdict_reason` text,
	`warnings` text,
	`notes` text,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `investigations_business_idx` ON `investigations` (`business_id`);--> statement-breakpoint
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
CREATE TABLE `opportunities` (
	`id` text PRIMARY KEY NOT NULL,
	`investigation_id` text NOT NULL,
	`business_id` text NOT NULL,
	`category` text NOT NULL,
	`title` text NOT NULL,
	`problem_hypothesis` text NOT NULL,
	`proposed_solution` text NOT NULL,
	`why_not_existing_tool` text,
	`expected_value` text,
	`supporting_fact_keys` text NOT NULL,
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
	FOREIGN KEY (`investigation_id`) REFERENCES `investigations`(`id`) ON UPDATE no action ON DELETE cascade,
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
	`investigation_id` text NOT NULL,
	`business_id` text NOT NULL,
	`url` text NOT NULL,
	`final_url` text,
	`kind` text DEFAULT 'other' NOT NULL,
	`status_code` integer,
	`title` text,
	`text` text,
	`bytes` integer,
	`error` text,
	`fetched_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`investigation_id`) REFERENCES `investigations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `pages_business_idx` ON `pages` (`business_id`);--> statement-breakpoint
CREATE TABLE `prospects` (
	`business_id` text PRIMARY KEY NOT NULL,
	`stage` text DEFAULT 'lead' NOT NULL,
	`priority` text DEFAULT 'normal' NOT NULL,
	`next_action` text,
	`next_action_at` text,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
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
	`require_website` integer DEFAULT true NOT NULL,
	`providers` text NOT NULL,
	`auto_investigate` integer DEFAULT true NOT NULL,
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