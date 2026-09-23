CREATE VIRTUAL TABLE `pages_fts` USING fts5(
	`title`,
	`content_text`,
	content=`pages`,
	content_rowid=`search_id`,
	tokenize='unicode61 remove_diacritics 2',
	prefix='2 3 4'
);
--> statement-breakpoint
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
CREATE TRIGGER `pages_fts_update_delete`
AFTER UPDATE OF title, content_text, deleted_at ON `pages`
WHEN old.deleted_at IS NULL
BEGIN
	INSERT INTO pages_fts(pages_fts, rowid, title, content_text)
	VALUES ('delete', old.search_id, old.title, old.content_text);
END;
--> statement-breakpoint
CREATE TRIGGER `pages_fts_update_insert`
AFTER UPDATE OF title, content_text, deleted_at ON `pages`
WHEN new.deleted_at IS NULL
BEGIN
	INSERT INTO pages_fts(rowid, title, content_text)
	VALUES (new.search_id, new.title, new.content_text);
END;
--> statement-breakpoint
INSERT INTO pages_fts(pages_fts) VALUES ('rebuild');
