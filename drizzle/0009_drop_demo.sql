DELETE FROM `businesses` WHERE `is_demo` = 1;--> statement-breakpoint
DELETE FROM `searches` WHERE `is_demo` = 1;--> statement-breakpoint
ALTER TABLE `businesses` DROP COLUMN `is_demo`;--> statement-breakpoint
ALTER TABLE `searches` DROP COLUMN `is_demo`;