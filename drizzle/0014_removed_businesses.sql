CREATE TABLE `removed_businesses` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`name_normalized` text NOT NULL,
	`city` text,
	`website_domain` text,
	`phone` text,
	`source_ids` text,
	`verdict` text,
	`note` text,
	`removed_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `removed_domain_idx` ON `removed_businesses` (`website_domain`);--> statement-breakpoint
CREATE INDEX `removed_name_idx` ON `removed_businesses` (`name_normalized`);