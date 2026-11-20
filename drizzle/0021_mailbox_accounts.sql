PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_mailboxes` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`provider` text NOT NULL,
	`address` text NOT NULL,
	`user` text NOT NULL,
	`password_enc` text NOT NULL,
	`smtp_host` text NOT NULL,
	`smtp_port` integer NOT NULL,
	`imap_host` text NOT NULL,
	`imap_port` integer NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_mailboxes`("id", "workspace_id", "provider", "address", "user", "password_enc", "smtp_host", "smtp_port", "imap_host", "imap_port", "is_default", "created_at", "updated_at") SELECT "workspace_id", "workspace_id", "provider", "address", "user", "password_enc", "smtp_host", "smtp_port", "imap_host", "imap_port", 1, "created_at", "updated_at" FROM `mailboxes`;--> statement-breakpoint
DROP TABLE `mailboxes`;--> statement-breakpoint
ALTER TABLE `__new_mailboxes` RENAME TO `mailboxes`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `mailboxes_workspace_address_idx` ON `mailboxes` (`workspace_id`,`address`);--> statement-breakpoint
ALTER TABLE `outreach_drafts` ADD `sent_from` text;