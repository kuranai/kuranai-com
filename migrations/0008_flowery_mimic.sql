PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_page_publications` (
	`id` text PRIMARY KEY NOT NULL,
	`page_id` text NOT NULL,
	`public_id` text NOT NULL,
	`source_revision` integer NOT NULL,
	`published_content_json` text NOT NULL,
	`published_content_text` text DEFAULT '' NOT NULL,
	`published_title` text NOT NULL,
	`allow_indexing` integer DEFAULT false NOT NULL,
	`published_parent_public_id` text,
	`published_position` integer DEFAULT 0 NOT NULL,
	`published_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`page_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "page_publications_source_revision_positive" CHECK("__new_page_publications"."source_revision" > 0),
	CONSTRAINT "page_publications_title_length" CHECK(length("__new_page_publications"."published_title") BETWEEN 1 AND 200),
	CONSTRAINT "page_publications_allow_indexing_boolean" CHECK("__new_page_publications"."allow_indexing" IN (0, 1)),
	CONSTRAINT "page_publications_position_nonnegative" CHECK("__new_page_publications"."published_position" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_page_publications`("id", "page_id", "public_id", "source_revision", "published_content_json", "published_content_text", "published_title", "allow_indexing", "published_parent_public_id", "published_position", "published_at", "updated_at") SELECT "id", "page_id", "public_id", "source_revision", "published_content_json", '', "published_title", "allow_indexing", NULL, 0, "published_at", "updated_at" FROM `page_publications`;--> statement-breakpoint
DROP TABLE `page_publications`;--> statement-breakpoint
ALTER TABLE `__new_page_publications` RENAME TO `page_publications`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `page_publications_page_id_unique` ON `page_publications` (`page_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `page_publications_public_id_unique` ON `page_publications` (`public_id`);--> statement-breakpoint
CREATE INDEX `page_publications_updated` ON `page_publications` (`updated_at` DESC, `public_id` DESC);--> statement-breakpoint
UPDATE `page_publications`
SET `published_content_text` = COALESCE(
  (
    SELECT trim(group_concat(value, ' '))
    FROM (
      SELECT CAST(tree.value AS TEXT) AS value, tree.id
      FROM json_tree(`page_publications`.`published_content_json`) AS tree
      WHERE tree.type = 'text' AND tree.key IN ('text', 'targetTitle')
      ORDER BY tree.id
    )
  ),
  ''
);--> statement-breakpoint
UPDATE `page_publications`
SET `published_position` = COALESCE(
  (SELECT `pages`.`position` FROM `pages` WHERE `pages`.`id` = `page_publications`.`page_id`),
  0
);--> statement-breakpoint
WITH RECURSIVE `publication_ancestors`(`root_page_id`, `ancestor_page_id`, `depth`) AS (
  SELECT `page_publications`.`page_id`, `pages`.`parent_id`, 1
  FROM `page_publications`
  INNER JOIN `pages` ON `pages`.`id` = `page_publications`.`page_id`
  WHERE `pages`.`parent_id` IS NOT NULL
  UNION ALL
  SELECT `publication_ancestors`.`root_page_id`, `pages`.`parent_id`,
         `publication_ancestors`.`depth` + 1
  FROM `publication_ancestors`
  INNER JOIN `pages` ON `pages`.`id` = `publication_ancestors`.`ancestor_page_id`
  WHERE `pages`.`parent_id` IS NOT NULL AND `publication_ancestors`.`depth` < 100
), `nearest_publication_ancestors` AS (
  SELECT `publication_ancestors`.`root_page_id`, `page_publications`.`public_id`,
         ROW_NUMBER() OVER (
           PARTITION BY `publication_ancestors`.`root_page_id`
           ORDER BY `publication_ancestors`.`depth`
         ) AS `rank`
  FROM `publication_ancestors`
  INNER JOIN `page_publications`
    ON `page_publications`.`page_id` = `publication_ancestors`.`ancestor_page_id`
  INNER JOIN `pages` ON `pages`.`id` = `page_publications`.`page_id`
  WHERE `pages`.`deleted_at` IS NULL
)
UPDATE `page_publications`
SET `published_parent_public_id` = (
  SELECT `nearest_publication_ancestors`.`public_id`
  FROM `nearest_publication_ancestors`
  WHERE `nearest_publication_ancestors`.`root_page_id` = `page_publications`.`page_id`
    AND `nearest_publication_ancestors`.`rank` = 1
)
WHERE `page_publications`.`published_parent_public_id` IS NULL;--> statement-breakpoint
CREATE VIRTUAL TABLE `publications_fts` USING fts5(
	`published_title`,
	`published_content_text`,
	content=`page_publications`,
	content_rowid=`rowid`,
	tokenize='unicode61 remove_diacritics 2',
	prefix='2 3 4'
);--> statement-breakpoint
CREATE TRIGGER `publications_fts_insert`
AFTER INSERT ON `page_publications`
BEGIN
	INSERT INTO publications_fts(rowid, published_title, published_content_text)
	VALUES (new.rowid, new.published_title, new.published_content_text);
END;--> statement-breakpoint
CREATE TRIGGER `publications_fts_delete`
AFTER DELETE ON `page_publications`
BEGIN
	INSERT INTO publications_fts(publications_fts, rowid, published_title, published_content_text)
	VALUES ('delete', old.rowid, old.published_title, old.published_content_text);
END;--> statement-breakpoint
CREATE TRIGGER `publications_fts_update`
AFTER UPDATE OF published_title, published_content_text ON `page_publications`
BEGIN
	INSERT INTO publications_fts(publications_fts, rowid, published_title, published_content_text)
	VALUES ('delete', old.rowid, old.published_title, old.published_content_text);
	INSERT INTO publications_fts(rowid, published_title, published_content_text)
	VALUES (new.rowid, new.published_title, new.published_content_text);
END;--> statement-breakpoint
INSERT INTO publications_fts(publications_fts) VALUES ('rebuild');
