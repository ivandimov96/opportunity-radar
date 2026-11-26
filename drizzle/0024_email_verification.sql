CREATE TABLE `email_verifications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`used_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `email_verifications_user_idx` ON `email_verifications` (`user_id`);--> statement-breakpoint
ALTER TABLE `users` ADD `email_verified_at` text;--> statement-breakpoint
-- Every account that existed before addresses were confirmed counts as confirmed: nobody is locked out by this change.
UPDATE `users` SET `email_verified_at` = `created_at` WHERE `email_verified_at` IS NULL;
