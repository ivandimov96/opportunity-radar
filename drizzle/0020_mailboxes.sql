CREATE TABLE `mailboxes` (
	`workspace_id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`address` text NOT NULL,
	`user` text NOT NULL,
	`password_enc` text NOT NULL,
	`smtp_host` text NOT NULL,
	`smtp_port` integer NOT NULL,
	`imap_host` text NOT NULL,
	`imap_port` integer NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_settings` (
	`workspace_id` text DEFAULT 'ws-first' NOT NULL,
	`key` text NOT NULL,
	`value` text,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	PRIMARY KEY(`workspace_id`, `key`)
);
--> statement-breakpoint
INSERT INTO `__new_settings`("workspace_id", "key", "value", "updated_at") SELECT 'ws-first', "key", "value", "updated_at" FROM `settings`;--> statement-breakpoint
DROP TABLE `settings`;--> statement-breakpoint
ALTER TABLE `__new_settings` RENAME TO `settings`;--> statement-breakpoint
PRAGMA foreign_keys=ON;