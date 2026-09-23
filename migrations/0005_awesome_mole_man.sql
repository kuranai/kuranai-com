CREATE TABLE `restore_session_assets` (
	`session_id` text NOT NULL,
	`asset_id` text NOT NULL,
	`object_key` text NOT NULL,
	`metadata_json` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`sha256` text NOT NULL,
	`uploaded_at` text NOT NULL,
	PRIMARY KEY(`session_id`, `asset_id`),
	FOREIGN KEY (`session_id`) REFERENCES `restore_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "restore_session_assets_size_nonnegative" CHECK("restore_session_assets"."size_bytes" >= 0)
);
--> statement-breakpoint
CREATE INDEX `restore_session_assets_session` ON `restore_session_assets` (`session_id`);--> statement-breakpoint
CREATE TABLE `restore_session_records` (
	`session_id` text NOT NULL,
	`record_type` text NOT NULL,
	`record_id` text NOT NULL,
	`payload_json` text NOT NULL,
	`sha256` text NOT NULL,
	`uploaded_at` text NOT NULL,
	PRIMARY KEY(`session_id`, `record_type`, `record_id`),
	FOREIGN KEY (`session_id`) REFERENCES `restore_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "restore_session_records_type_allowed" CHECK("restore_session_records"."record_type" IN ('page', 'revision'))
);
--> statement-breakpoint
CREATE INDEX `restore_session_records_session` ON `restore_session_records` (`session_id`,`record_type`);--> statement-breakpoint
CREATE TABLE `restore_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_identity` text NOT NULL,
	`status` text NOT NULL,
	`backup_version` integer NOT NULL,
	`expected_pages` integer NOT NULL,
	`expected_revisions` integer NOT NULL,
	`expected_assets` integer NOT NULL,
	`expected_bytes` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`expires_at` text NOT NULL,
	CONSTRAINT "restore_sessions_status_allowed" CHECK("restore_sessions"."status" IN ('uploading', 'finalizing', 'failed')),
	CONSTRAINT "restore_sessions_backup_version_supported" CHECK("restore_sessions"."backup_version" = 1),
	CONSTRAINT "restore_sessions_expected_pages_nonnegative" CHECK("restore_sessions"."expected_pages" >= 0),
	CONSTRAINT "restore_sessions_expected_revisions_nonnegative" CHECK("restore_sessions"."expected_revisions" >= 0),
	CONSTRAINT "restore_sessions_expected_assets_nonnegative" CHECK("restore_sessions"."expected_assets" >= 0),
	CONSTRAINT "restore_sessions_expected_bytes_nonnegative" CHECK("restore_sessions"."expected_bytes" >= 0)
);
--> statement-breakpoint
CREATE INDEX `restore_sessions_owner_updated` ON `restore_sessions` (`owner_identity`,"updated_at" desc);--> statement-breakpoint
CREATE INDEX `restore_sessions_status` ON `restore_sessions` (`status`);