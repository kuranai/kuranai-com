CREATE TABLE `page_publications` (
	`id` text PRIMARY KEY NOT NULL,
	`page_id` text NOT NULL,
	`public_id` text NOT NULL,
	`source_revision` integer NOT NULL,
	`published_content_json` text NOT NULL,
	`published_title` text NOT NULL,
	`allow_indexing` integer DEFAULT false NOT NULL,
	`published_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`page_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "page_publications_source_revision_positive" CHECK("page_publications"."source_revision" > 0),
	CONSTRAINT "page_publications_title_length" CHECK(length("page_publications"."published_title") BETWEEN 1 AND 200),
	CONSTRAINT "page_publications_allow_indexing_boolean" CHECK("page_publications"."allow_indexing" IN (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `page_publications_page_id_unique` ON `page_publications` (`page_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `page_publications_public_id_unique` ON `page_publications` (`public_id`);--> statement-breakpoint
CREATE INDEX `page_publications_updated` ON `page_publications` (`updated_at` DESC, `public_id` DESC);--> statement-breakpoint
CREATE TABLE `publication_assets` (
	`publication_id` text NOT NULL,
	`asset_id` text NOT NULL,
	PRIMARY KEY(`publication_id`, `asset_id`),
	FOREIGN KEY (`publication_id`) REFERENCES `page_publications`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `publication_assets_asset` ON `publication_assets` (`asset_id`);--> statement-breakpoint
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
	CONSTRAINT "restore_session_records_type_allowed" CHECK("__new_restore_session_records"."record_type" IN ('page', 'revision', 'publication'))
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
	`expected_publications` integer DEFAULT 0 NOT NULL,
	`expected_bytes` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`expires_at` text NOT NULL,
	CONSTRAINT "restore_sessions_status_allowed" CHECK("__new_restore_sessions"."status" IN ('uploading', 'finalizing', 'failed')),
	CONSTRAINT "restore_sessions_backup_version_supported" CHECK("__new_restore_sessions"."backup_version" IN (1, 2)),
	CONSTRAINT "restore_sessions_expected_pages_nonnegative" CHECK("__new_restore_sessions"."expected_pages" >= 0),
	CONSTRAINT "restore_sessions_expected_revisions_nonnegative" CHECK("__new_restore_sessions"."expected_revisions" >= 0),
	CONSTRAINT "restore_sessions_expected_assets_nonnegative" CHECK("__new_restore_sessions"."expected_assets" >= 0),
	CONSTRAINT "restore_sessions_expected_publications_nonnegative" CHECK("__new_restore_sessions"."expected_publications" >= 0),
	CONSTRAINT "restore_sessions_expected_bytes_nonnegative" CHECK("__new_restore_sessions"."expected_bytes" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_restore_sessions`("id", "owner_identity", "status", "backup_version", "expected_pages", "expected_revisions", "expected_assets", "expected_publications", "expected_bytes", "created_at", "updated_at", "expires_at") SELECT "id", "owner_identity", "status", "backup_version", "expected_pages", "expected_revisions", "expected_assets", 0, "expected_bytes", "created_at", "updated_at", "expires_at" FROM `restore_sessions`;--> statement-breakpoint
DROP TABLE `restore_sessions`;--> statement-breakpoint
ALTER TABLE `__new_restore_sessions` RENAME TO `restore_sessions`;--> statement-breakpoint
CREATE INDEX `restore_sessions_owner_updated` ON `restore_sessions` (`owner_identity`, "updated_at" DESC);--> statement-breakpoint
CREATE INDEX `restore_sessions_status` ON `restore_sessions` (`status`);
