ALTER TABLE `businesses` ADD `lead_score` integer;--> statement-breakpoint
ALTER TABLE `businesses` ADD `kind` text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE `businesses` ADD `website_source` text;--> statement-breakpoint
ALTER TABLE `opportunities` ADD `source` text DEFAULT 'ai' NOT NULL;