CREATE TABLE `page_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`page_id` text NOT NULL,
	`source_revision` integer NOT NULL,
	`title` text NOT NULL,
	`content_json` text NOT NULL,
	`trigger` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`page_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "page_revisions_source_revision_positive" CHECK("page_revisions"."source_revision" > 0),
	CONSTRAINT "page_revisions_trigger_allowed" CHECK("page_revisions"."trigger" IN ('interval', 'delete', 'restore')),
	CONSTRAINT "page_revisions_title_length" CHECK(length("page_revisions"."title") BETWEEN 1 AND 200)
);
--> statement-breakpoint
CREATE INDEX `page_revisions_page_created` ON `page_revisions` (`page_id`,`created_at` DESC,`id` DESC);
