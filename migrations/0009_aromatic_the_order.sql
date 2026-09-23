CREATE TABLE `page_tags` (
	`page_id` text NOT NULL,
	`tag_id` text NOT NULL,
	PRIMARY KEY(`page_id`, `tag_id`),
	FOREIGN KEY (`page_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `page_tags_tag` ON `page_tags` (`tag_id`);--> statement-breakpoint
CREATE TABLE `tags` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`name_normalized` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "tags_name_length" CHECK(length("tags"."name") BETWEEN 1 AND 50),
	CONSTRAINT "tags_name_normalized_length" CHECK(length("tags"."name_normalized") BETWEEN 1 AND 50)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_name_normalized_unique` ON `tags` (`name_normalized`);--> statement-breakpoint
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
	CONSTRAINT "restore_session_records_type_allowed" CHECK("__new_restore_session_records"."record_type" IN ('page', 'revision', 'publication', 'tag'))
);
--> statement-breakpoint
INSERT INTO `__new_restore_session_records`("session_id", "record_type", "record_id", "payload_json", "sha256", "uploaded_at") SELECT "session_id", "record_type", "record_id", "payload_json", "sha256", "uploaded_at" FROM `restore_session_records`;--> statement-breakpoint
DROP TABLE `restore_session_records`;--> statement-breakpoint
ALTER TABLE `__new_restore_session_records` RENAME TO `restore_session_records`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `restore_session_records_session` ON `restore_session_records` (`session_id`,`record_type`);--> statement-breakpoint
ALTER TABLE `page_publications` ADD `published_tags_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
CREATE TABLE `__new_pages` (
	`search_id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id` text NOT NULL,
	`title` text NOT NULL,
	`slug` text NOT NULL,
	`content_json` text DEFAULT '{"type":"doc","content":[]}' NOT NULL,
	`content_text` text DEFAULT '' NOT NULL,
	`parent_id` text,
	`position` integer DEFAULT 0 NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`is_favorite` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "pages_title_length" CHECK(length("__new_pages"."title") BETWEEN 1 AND 200),
	CONSTRAINT "pages_position_nonnegative" CHECK("__new_pages"."position" >= 0),
	CONSTRAINT "pages_revision_positive" CHECK("__new_pages"."revision" > 0),
	CONSTRAINT "pages_is_favorite_boolean" CHECK("__new_pages"."is_favorite" IN (0, 1)),
	CONSTRAINT "pages_parent_not_self" CHECK("__new_pages"."parent_id" IS NULL OR "__new_pages"."parent_id" <> "__new_pages"."id")
);
--> statement-breakpoint
INSERT INTO `__new_pages`("search_id", "id", "title", "slug", "content_json", "content_text", "parent_id", "position", "revision", "created_at", "updated_at", "deleted_at", "is_favorite") SELECT "search_id", "id", "title", "slug", "content_json", "content_text", "parent_id", "position", "revision", "created_at", "updated_at", "deleted_at", 0 FROM `pages`;--> statement-breakpoint
DROP TABLE `pages`;--> statement-breakpoint
ALTER TABLE `__new_pages` RENAME TO `pages`;--> statement-breakpoint
CREATE UNIQUE INDEX `pages_id_unique` ON `pages` (`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `pages_slug_unique` ON `pages` ("slug" COLLATE NOCASE);--> statement-breakpoint
CREATE INDEX `pages_parent_position` ON `pages` (`parent_id`,`position`,`title`);--> statement-breakpoint
CREATE INDEX `pages_updated_at` ON `pages` ("updated_at" desc);--> statement-breakpoint
CREATE INDEX `pages_deleted_at` ON `pages` (`deleted_at`);--> statement-breakpoint
CREATE TRIGGER `pages_fts_insert`
AFTER INSERT ON `pages`
WHEN new.deleted_at IS NULL
BEGIN
	INSERT INTO pages_fts(rowid, title, content_text)
	VALUES (new.search_id, new.title, new.content_text);
END;
--> statement-breakpoint
CREATE TRIGGER `pages_fts_delete`
AFTER DELETE ON `pages`
WHEN old.deleted_at IS NULL
BEGIN
	INSERT INTO pages_fts(pages_fts, rowid, title, content_text)
	VALUES ('delete', old.search_id, old.title, old.content_text);
END;
--> statement-breakpoint
CREATE TRIGGER `pages_fts_update`
AFTER UPDATE OF title, content_text, deleted_at ON `pages`
WHEN old.deleted_at IS NULL OR new.deleted_at IS NULL
BEGIN
	INSERT INTO pages_fts(pages_fts, rowid, title, content_text)
	SELECT 'delete', old.search_id, old.title, old.content_text
	WHERE old.deleted_at IS NULL;
	INSERT INTO pages_fts(rowid, title, content_text)
	SELECT new.search_id, new.title, new.content_text
	WHERE new.deleted_at IS NULL;
END;
--> statement-breakpoint
INSERT INTO pages_fts(pages_fts) VALUES ('rebuild');--> statement-breakpoint
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
	CONSTRAINT "restore_sessions_expected_bytes_nonnegative" CHECK("__new_restore_sessions"."expected_bytes" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_restore_sessions`("id", "owner_identity", "status", "backup_version", "expected_pages", "expected_revisions", "expected_assets", "expected_tags", "expected_publications", "expected_bytes", "created_at", "updated_at", "expires_at") SELECT "id", "owner_identity", "status", "backup_version", "expected_pages", "expected_revisions", "expected_assets", 0, "expected_publications", "expected_bytes", "created_at", "updated_at", "expires_at" FROM `restore_sessions`;--> statement-breakpoint
DROP TABLE `restore_sessions`;--> statement-breakpoint
ALTER TABLE `__new_restore_sessions` RENAME TO `restore_sessions`;--> statement-breakpoint
CREATE INDEX `restore_sessions_owner_updated` ON `restore_sessions` (`owner_identity`,"updated_at" desc);--> statement-breakpoint
CREATE INDEX `restore_sessions_status` ON `restore_sessions` (`status`);
