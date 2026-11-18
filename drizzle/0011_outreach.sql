CREATE TABLE `campaigns` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`sent_at` text
);
--> statement-breakpoint
CREATE TABLE `email_events` (
	`id` text PRIMARY KEY NOT NULL,
	`draft_id` text NOT NULL,
	`business_id` text NOT NULL,
	`type` text NOT NULL,
	`detail` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`draft_id`) REFERENCES `outreach_drafts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `email_events_draft_idx` ON `email_events` (`draft_id`);--> statement-breakpoint
CREATE TABLE `inbound_emails` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`draft_id` text,
	`message_id` text NOT NULL,
	`in_reply_to` text,
	`from_email` text,
	`from_name` text,
	`subject` text,
	`body_text` text NOT NULL,
	`received_at` text NOT NULL,
	`kind` text DEFAULT 'reply' NOT NULL,
	`matched_by` text DEFAULT 'thread' NOT NULL,
	`classification` text,
	`classification_confidence` real,
	`classification_summary` text,
	`classified_by` text,
	`suggested_reply` text,
	`handled_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`draft_id`) REFERENCES `outreach_drafts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inbound_message_id_idx` ON `inbound_emails` (`message_id`);--> statement-breakpoint
CREATE INDEX `inbound_business_idx` ON `inbound_emails` (`business_id`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `suppressions` (
	`id` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`kind` text DEFAULT 'email' NOT NULL,
	`reason` text NOT NULL,
	`note` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `suppressions_value_unique` ON `suppressions` (`value`);--> statement-breakpoint
ALTER TABLE `outreach_drafts` ADD `campaign_id` text REFERENCES campaigns(id);--> statement-breakpoint
ALTER TABLE `outreach_drafts` ADD `step` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `outreach_drafts` ADD `validation` text;--> statement-breakpoint
ALTER TABLE `outreach_drafts` ADD `cost_usd` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `outreach_drafts` ADD `prompt_version` text;--> statement-breakpoint
ALTER TABLE `outreach_drafts` ADD `message_id` text;--> statement-breakpoint
ALTER TABLE `outreach_drafts` ADD `in_reply_to` text;--> statement-breakpoint
ALTER TABLE `outreach_drafts` ADD `scheduled_at` text;--> statement-breakpoint
ALTER TABLE `outreach_drafts` ADD `sent_at` text;--> statement-breakpoint
ALTER TABLE `outreach_drafts` ADD `attempts` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `outreach_drafts` ADD `last_error` text;--> statement-breakpoint
CREATE INDEX `outreach_status_idx` ON `outreach_drafts` (`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `outreach_message_id_idx` ON `outreach_drafts` (`message_id`);--> statement-breakpoint
UPDATE `outreach_drafts` SET `status` = 'needs_review' WHERE `status` = 'draft';--> statement-breakpoint
UPDATE `prospects` SET `stage` = 'discovered' WHERE `stage` = 'lead';--> statement-breakpoint
UPDATE `prospects` SET `stage` = 'replied' WHERE `stage` = 'in_conversation';--> statement-breakpoint
UPDATE `prospects` SET `stage` = 'meeting_scheduled' WHERE `stage` = 'validated';--> statement-breakpoint
UPDATE `prospects` SET `stage` = 'lost' WHERE `stage` = 'disqualified';
