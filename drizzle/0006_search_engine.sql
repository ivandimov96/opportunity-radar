CREATE TABLE `search_candidates` (
	`id` text PRIMARY KEY NOT NULL,
	`search_id` text NOT NULL,
	`rank` integer NOT NULL,
	`name` text NOT NULL,
	`name_normalized` text NOT NULL,
	`category` text,
	`matched_by` text,
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
	`lon` real,
	`operating_status` text,
	`brand` text,
	`kind` text DEFAULT 'independent' NOT NULL,
	`lead_score` integer DEFAULT 0 NOT NULL,
	`lead_reasons` text,
	`completeness` integer DEFAULT 0 NOT NULL,
	`sources` text NOT NULL,
	`merge_rule` text,
	`merge_confidence` real,
	`possible_duplicate_of` text,
	`business_id` text,
	`saved_via` text,
	`skipped_reason` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`search_id`) REFERENCES `searches`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `search_candidates_search_idx` ON `search_candidates` (`search_id`,`rank`);--> statement-breakpoint
CREATE INDEX `search_candidates_business_idx` ON `search_candidates` (`business_id`);--> statement-breakpoint
CREATE TABLE `source_cells` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`scope` text NOT NULL,
	`cell` text NOT NULL,
	`release` text NOT NULL,
	`row_count` integer DEFAULT 0 NOT NULL,
	`duration_ms` integer,
	`fetched_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `source_cells_key` ON `source_cells` (`provider`,`scope`,`cell`);--> statement-breakpoint
CREATE TABLE `source_places` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`provider_id` text NOT NULL,
	`release` text NOT NULL,
	`cell` text NOT NULL,
	`name` text NOT NULL,
	`name_normalized` text NOT NULL,
	`category` text,
	`category_path` text,
	`website` text,
	`website_domain` text,
	`phone` text,
	`email` text,
	`street` text,
	`city` text,
	`region` text,
	`postal_code` text,
	`country` text,
	`lat` real NOT NULL,
	`lon` real NOT NULL,
	`operating_status` text,
	`brand` text,
	`confidence` real,
	`source_url` text,
	`raw` text,
	`fetched_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `source_places_provider_pid` ON `source_places` (`provider`,`provider_id`);--> statement-breakpoint
CREATE INDEX `source_places_cell_idx` ON `source_places` (`provider`,`cell`);--> statement-breakpoint
CREATE INDEX `source_places_latlon_idx` ON `source_places` (`lat`,`lon`);--> statement-breakpoint
CREATE INDEX `source_places_domain_idx` ON `source_places` (`website_domain`);--> statement-breakpoint
CREATE INDEX `source_places_name_idx` ON `source_places` (`name_normalized`);