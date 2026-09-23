CREATE TABLE `assets` (
	`id` text PRIMARY KEY NOT NULL,
	`object_key` text NOT NULL,
	`original_filename` text NOT NULL,
	`mime_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`width` integer,
	`height` integer,
	`sha256` text,
	`uploaded_for_page_id` text,
	`created_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`uploaded_for_page_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "assets_size_nonnegative" CHECK("assets"."size_bytes" >= 0),
	CONSTRAINT "assets_width_positive" CHECK("assets"."width" IS NULL OR "assets"."width" > 0),
	CONSTRAINT "assets_height_positive" CHECK("assets"."height" IS NULL OR "assets"."height" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assets_object_key_unique` ON `assets` (`object_key`);--> statement-breakpoint
CREATE INDEX `assets_uploaded_for_page` ON `assets` (`uploaded_for_page_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `page_assets` (
	`page_id` text NOT NULL,
	`asset_id` text NOT NULL,
	PRIMARY KEY(`page_id`, `asset_id`),
	FOREIGN KEY (`page_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `page_assets_asset` ON `page_assets` (`asset_id`);--> statement-breakpoint
CREATE TABLE `page_links` (
	`id` text PRIMARY KEY NOT NULL,
	`source_page_id` text NOT NULL,
	`target_page_id` text,
	`target_title` text NOT NULL,
	`target_title_normalized` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`source_page_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_page_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `page_links_source` ON `page_links` (`source_page_id`);--> statement-breakpoint
CREATE INDEX `page_links_target` ON `page_links` (`target_page_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `page_links_source_title` ON `page_links` (`source_page_id`,`target_title_normalized`);--> statement-breakpoint
CREATE TABLE `pages` (
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
	FOREIGN KEY (`parent_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "pages_title_length" CHECK(length("pages"."title") BETWEEN 1 AND 200),
	CONSTRAINT "pages_position_nonnegative" CHECK("pages"."position" >= 0),
	CONSTRAINT "pages_revision_positive" CHECK("pages"."revision" > 0),
	CONSTRAINT "pages_parent_not_self" CHECK("pages"."parent_id" IS NULL OR "pages"."parent_id" <> "pages"."id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pages_id_unique` ON `pages` (`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `pages_slug_unique` ON `pages` ("slug" COLLATE NOCASE);--> statement-breakpoint
CREATE INDEX `pages_parent_position` ON `pages` (`parent_id`,`position`,`title`);--> statement-breakpoint
CREATE INDEX `pages_updated_at` ON `pages` (`updated_at`);--> statement-breakpoint
CREATE INDEX `pages_deleted_at` ON `pages` (`deleted_at`);
