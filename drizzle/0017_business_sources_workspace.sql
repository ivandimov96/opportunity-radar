DROP INDEX `business_sources_provider_pid`;--> statement-breakpoint
ALTER TABLE `business_sources` ADD `workspace_id` text DEFAULT 'ws-first' NOT NULL;--> statement-breakpoint
-- A listing link belongs to the workspace of its business.
UPDATE `business_sources` SET `workspace_id` = COALESCE((SELECT `workspace_id` FROM `businesses` WHERE `businesses`.`id` = `business_sources`.`business_id`), 'ws-first');--> statement-breakpoint
CREATE UNIQUE INDEX `business_sources_ws_provider_pid` ON `business_sources` (`workspace_id`,`provider`,`provider_id`);
