CREATE TABLE `workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `ai_usage` ADD `workspace_id` text DEFAULT 'ws-first' NOT NULL;--> statement-breakpoint
ALTER TABLE `businesses` ADD `workspace_id` text DEFAULT 'ws-first' NOT NULL;--> statement-breakpoint
ALTER TABLE `campaigns` ADD `workspace_id` text DEFAULT 'ws-first' NOT NULL;--> statement-breakpoint
ALTER TABLE `jobs` ADD `workspace_id` text DEFAULT 'ws-first' NOT NULL;--> statement-breakpoint
ALTER TABLE `removed_businesses` ADD `workspace_id` text DEFAULT 'ws-first' NOT NULL;--> statement-breakpoint
ALTER TABLE `searches` ADD `workspace_id` text DEFAULT 'ws-first' NOT NULL;--> statement-breakpoint
ALTER TABLE `suppressions` ADD `workspace_id` text DEFAULT 'ws-first' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `workspace_id` text DEFAULT 'ws-first' NOT NULL;--> statement-breakpoint
-- Everything that existed before accounts belongs to the first workspace.
INSERT OR IGNORE INTO `workspaces` (`id`, `name`, `created_at`) VALUES ('ws-first', 'First workspace', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
