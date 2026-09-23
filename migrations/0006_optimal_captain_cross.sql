CREATE TABLE `auth_login_attempts` (
	`source_hash` text PRIMARY KEY NOT NULL,
	`window_started_at` integer NOT NULL,
	`failure_count` integer NOT NULL,
	CONSTRAINT "auth_login_attempts_window_nonnegative" CHECK("auth_login_attempts"."window_started_at" >= 0),
	CONSTRAINT "auth_login_attempts_count_positive" CHECK("auth_login_attempts"."failure_count" > 0)
);
--> statement-breakpoint
CREATE TABLE `auth_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`worker_version` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	CONSTRAINT "auth_sessions_created_at_nonnegative" CHECK("auth_sessions"."created_at" >= 0),
	CONSTRAINT "auth_sessions_expires_after_created" CHECK("auth_sessions"."expires_at" > "auth_sessions"."created_at")
);
--> statement-breakpoint
CREATE INDEX `auth_sessions_expires_at` ON `auth_sessions` (`expires_at`);