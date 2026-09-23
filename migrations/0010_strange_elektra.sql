CREATE TABLE `daily_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`local_date` text NOT NULL,
	`time_zone` text NOT NULL,
	`page_id` text NOT NULL,
	`template_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`page_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`template_id`) REFERENCES `templates`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "daily_notes_local_date_format" CHECK("daily_notes"."local_date" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `daily_notes_local_date_unique` ON `daily_notes` (`local_date`);--> statement-breakpoint
CREATE UNIQUE INDEX `daily_notes_page_id_unique` ON `daily_notes` (`page_id`);--> statement-breakpoint
CREATE INDEX `daily_notes_page` ON `daily_notes` (`page_id`);--> statement-breakpoint
CREATE INDEX `daily_notes_template` ON `daily_notes` (`template_id`);--> statement-breakpoint
CREATE TABLE `templates` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`content_json` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`is_daily_note` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "templates_title_length" CHECK(length("templates"."title") BETWEEN 1 AND 200),
	CONSTRAINT "templates_revision_positive" CHECK("templates"."revision" > 0),
	CONSTRAINT "templates_is_daily_note_boolean" CHECK("templates"."is_daily_note" IN (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `templates_title_unique` ON `templates` ("title" COLLATE NOCASE);--> statement-breakpoint
CREATE UNIQUE INDEX `templates_daily_note_unique` ON `templates` (`is_daily_note`) WHERE "templates"."is_daily_note" = 1;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_restore_session_records` (
	`session_id` text NOT NULL,
	`record_type` text NOT NULL,
	`record_id` text NOT NULL,
	`payload_json` text NOT NULL,
	`sha256` text NOT NULL,
	`uploaded_at` text NOT NULL,
	PRIMARY KEY(`session_id`, `record_type`, `record_id`),
	FOREIGN KEY (`session_id`) REFERENCES `restore_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "restore_session_records_type_allowed" CHECK("__new_restore_session_records"."record_type" IN ('page', 'revision', 'publication', 'tag', 'template', 'dailyNote'))
);
--> statement-breakpoint
INSERT INTO `__new_restore_session_records`("session_id", "record_type", "record_id", "payload_json", "sha256", "uploaded_at") SELECT "session_id", "record_type", "record_id", "payload_json", "sha256", "uploaded_at" FROM `restore_session_records`;--> statement-breakpoint
DROP TABLE `restore_session_records`;--> statement-breakpoint
ALTER TABLE `__new_restore_session_records` RENAME TO `restore_session_records`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `restore_session_records_session` ON `restore_session_records` (`session_id`,`record_type`);--> statement-breakpoint
CREATE TABLE `__new_restore_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_identity` text NOT NULL,
	`status` text NOT NULL,
	`backup_version` integer NOT NULL,
	`expected_pages` integer NOT NULL,
	`expected_revisions` integer NOT NULL,
	`expected_assets` integer NOT NULL,
	`expected_tags` integer DEFAULT 0 NOT NULL,
	`expected_publications` integer DEFAULT 0 NOT NULL,
	`expected_templates` integer DEFAULT 0 NOT NULL,
	`expected_daily_notes` integer DEFAULT 0 NOT NULL,
	`expected_bytes` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`expires_at` text NOT NULL,
	CONSTRAINT "restore_sessions_status_allowed" CHECK("__new_restore_sessions"."status" IN ('uploading', 'finalizing', 'failed')),
	CONSTRAINT "restore_sessions_backup_version_supported" CHECK("__new_restore_sessions"."backup_version" IN (1, 2)),
	CONSTRAINT "restore_sessions_expected_pages_nonnegative" CHECK("__new_restore_sessions"."expected_pages" >= 0),
	CONSTRAINT "restore_sessions_expected_revisions_nonnegative" CHECK("__new_restore_sessions"."expected_revisions" >= 0),
	CONSTRAINT "restore_sessions_expected_assets_nonnegative" CHECK("__new_restore_sessions"."expected_assets" >= 0),
	CONSTRAINT "restore_sessions_expected_tags_nonnegative" CHECK("__new_restore_sessions"."expected_tags" >= 0),
	CONSTRAINT "restore_sessions_expected_publications_nonnegative" CHECK("__new_restore_sessions"."expected_publications" >= 0),
	CONSTRAINT "restore_sessions_expected_templates_nonnegative" CHECK("__new_restore_sessions"."expected_templates" >= 0),
	CONSTRAINT "restore_sessions_expected_daily_notes_nonnegative" CHECK("__new_restore_sessions"."expected_daily_notes" >= 0),
	CONSTRAINT "restore_sessions_expected_bytes_nonnegative" CHECK("__new_restore_sessions"."expected_bytes" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_restore_sessions`("id", "owner_identity", "status", "backup_version", "expected_pages", "expected_revisions", "expected_assets", "expected_tags", "expected_publications", "expected_templates", "expected_daily_notes", "expected_bytes", "created_at", "updated_at", "expires_at") SELECT "id", "owner_identity", "status", "backup_version", "expected_pages", "expected_revisions", "expected_assets", "expected_tags", "expected_publications", 0, 0, "expected_bytes", "created_at", "updated_at", "expires_at" FROM `restore_sessions`;--> statement-breakpoint
DROP TABLE `restore_sessions`;--> statement-breakpoint
ALTER TABLE `__new_restore_sessions` RENAME TO `restore_sessions`;--> statement-breakpoint
CREATE INDEX `restore_sessions_owner_updated` ON `restore_sessions` (`owner_identity`,"updated_at" DESC);--> statement-breakpoint
CREATE INDEX `restore_sessions_status` ON `restore_sessions` (`status`);
