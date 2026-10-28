CREATE TABLE `place_cache` (
	`key` text PRIMARY KEY NOT NULL,
	`release` text NOT NULL,
	`rows` text NOT NULL,
	`row_count` integer DEFAULT 0 NOT NULL,
	`duration_ms` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
ALTER TABLE `businesses` ADD `lead_reasons` text;--> statement-breakpoint
ALTER TABLE `businesses` ADD `operating_status` text;--> statement-breakpoint
ALTER TABLE `businesses` ADD `brand` text;