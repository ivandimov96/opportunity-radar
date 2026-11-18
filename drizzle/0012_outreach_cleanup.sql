-- Data fixes for emails written before the outreach rebuild (no schema change).
-- 1. An unsent email for a business that research set aside is withdrawn.
UPDATE `outreach_drafts` SET `status` = 'archived' WHERE `status` IN ('needs_review', 'ready', 'approved', 'excluded') AND `business_id` IN (SELECT `id` FROM `businesses` WHERE `verdict` = 'not_a_fit');--> statement-breakpoint
-- 2. One live email per business and step: older unsent duplicates are archived, the newest stays.
UPDATE `outreach_drafts` SET `status` = 'archived' WHERE `status` IN ('needs_review', 'ready', 'approved', 'excluded') AND `id` NOT IN (SELECT `id` FROM (SELECT `id`, row_number() OVER (PARTITION BY `business_id`, `step` ORDER BY `created_at` DESC) AS `rn` FROM `outreach_drafts` WHERE `status` <> 'archived') WHERE `rn` = 1);
