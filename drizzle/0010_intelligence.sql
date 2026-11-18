CREATE TABLE `observations` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`investigation_id` text,
	`ref` text NOT NULL,
	`kind` text NOT NULL,
	`statement` text NOT NULL,
	`evidence_quote` text NOT NULL,
	`source_url` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`investigation_id`) REFERENCES `investigations`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `observations_business_ref` ON `observations` (`business_id`,`ref`);--> statement-breakpoint
ALTER TABLE `businesses` ADD `verdict_reasons` text;--> statement-breakpoint
ALTER TABLE `businesses` ADD `email_source` text;--> statement-breakpoint
ALTER TABLE `businesses` ADD `email_source_url` text;--> statement-breakpoint
ALTER TABLE `businesses` ADD `email_status` text;--> statement-breakpoint
ALTER TABLE `businesses` ADD `contact_name` text;--> statement-breakpoint
ALTER TABLE `businesses` ADD `rating` real;--> statement-breakpoint
ALTER TABLE `businesses` ADD `review_count` integer;--> statement-breakpoint
ALTER TABLE `investigations` ADD `prompt_version` text;--> statement-breakpoint
ALTER TABLE `opportunities` ADD `role` text DEFAULT 'secondary' NOT NULL;--> statement-breakpoint
ALTER TABLE `opportunities` ADD `components` text;--> statement-breakpoint
ALTER TABLE `opportunities` ADD `why_relevant` text;--> statement-breakpoint
ALTER TABLE `opportunities` ADD `prompt_version` text;--> statement-breakpoint
UPDATE `opportunities` SET `role` = 'primary' WHERE `rank` = 1;--> statement-breakpoint
UPDATE `businesses` SET `verdict` = 'not_a_fit', `verdict_reasons` = json_array('The model found no compelling opportunity; only fixed rule patterns had matched.') WHERE `verdict` = 'opportunity' AND `id` IN (SELECT i.`business_id` FROM `investigations` i WHERE i.`status` = 'done' AND i.`verdict_reason` LIKE 'Model found no compelling opportunity%' AND i.`started_at` = (SELECT max(j.`started_at`) FROM `investigations` j WHERE j.`business_id` = i.`business_id` AND j.`status` = 'done'));--> statement-breakpoint
UPDATE `businesses` SET `verdict` = 'needs_review', `verdict_reasons` = json_array('Researched before opportunities were consolidated into one; re-analyze to confirm.') WHERE `verdict` IN ('opportunity', 'needs_ai');--> statement-breakpoint
UPDATE `businesses` SET `verdict` = 'not_a_fit' WHERE `verdict` = 'no_opportunity';--> statement-breakpoint
UPDATE `prospects` SET `stage` = 'lead' WHERE `stage` = 'qualified' AND `business_id` IN (SELECT `id` FROM `businesses` WHERE `verdict` IS NULL OR `verdict` <> 'qualified');--> statement-breakpoint
UPDATE `businesses` SET `email_source` = 'site', `email_source_url` = (SELECT f.`source_url` FROM `facts` f WHERE f.`business_id` = `businesses`.`id` AND f.`key` = 'email' AND f.`status` = 'verified' AND f.`value` = `businesses`.`email`) WHERE `email` IS NOT NULL AND EXISTS (SELECT 1 FROM `facts` f WHERE f.`business_id` = `businesses`.`id` AND f.`key` = 'email' AND f.`status` = 'verified' AND f.`value` = `businesses`.`email`);--> statement-breakpoint
UPDATE `businesses` SET `email_source` = 'listing' WHERE `email` IS NOT NULL AND `email_source` IS NULL;--> statement-breakpoint
UPDATE `businesses` SET `email_status` = 'unchecked' WHERE `email` IS NOT NULL;--> statement-breakpoint
UPDATE `businesses` SET `review_count` = (SELECT max(json_extract(s.`raw`, '$.ratingCount')) FROM `business_sources` s WHERE s.`business_id` = `businesses`.`id`), `rating` = (SELECT json_extract(s.`raw`, '$.rating') FROM `business_sources` s WHERE s.`business_id` = `businesses`.`id` AND json_extract(s.`raw`, '$.ratingCount') IS NOT NULL ORDER BY json_extract(s.`raw`, '$.ratingCount') DESC LIMIT 1);
