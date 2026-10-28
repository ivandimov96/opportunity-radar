ALTER TABLE `investigations` ADD `credits_used` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `pages` ADD `markdown` text;--> statement-breakpoint
ALTER TABLE `pages` ADD `html` text;--> statement-breakpoint
ALTER TABLE `pages` ADD `content_hash` text;--> statement-breakpoint
ALTER TABLE `pages` ADD `credits` integer DEFAULT 0 NOT NULL;