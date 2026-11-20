CREATE TABLE `workspace_usage` (
	`workspace_id` text NOT NULL,
	`period` text NOT NULL,
	`metric` text NOT NULL,
	`used` integer DEFAULT 0 NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	PRIMARY KEY(`workspace_id`, `period`, `metric`)
);
--> statement-breakpoint
ALTER TABLE `workspaces` ADD `plan` text DEFAULT 'trial' NOT NULL;--> statement-breakpoint
UPDATE `workspaces` SET `plan` = 'owner' WHERE `id` = 'ws-first';