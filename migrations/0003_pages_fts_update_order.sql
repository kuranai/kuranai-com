DROP TRIGGER `pages_fts_update_delete`;
--> statement-breakpoint
DROP TRIGGER `pages_fts_update_insert`;
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
