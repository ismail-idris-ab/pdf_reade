-- Full-text index over file names. External-content FTS5 table backed by
-- `files` (content_rowid = files.id), kept in sync by the triggers below.
-- unicode61 with remove_diacritics 2 lets "resume" match "Résumé".
-- See the migration rule in src/db/schema.ts before recreating `files`.
CREATE VIRTUAL TABLE `files_fts` USING fts5(
	name,
	content='files',
	content_rowid='id',
	tokenize='unicode61 remove_diacritics 2'
);
--> statement-breakpoint
CREATE TRIGGER `files_fts_after_insert` AFTER INSERT ON `files` BEGIN
	INSERT INTO files_fts(rowid, name) VALUES (new.id, new.name);
END;
--> statement-breakpoint
CREATE TRIGGER `files_fts_after_delete` AFTER DELETE ON `files` BEGIN
	INSERT INTO files_fts(files_fts, rowid, name) VALUES ('delete', old.id, old.name);
END;
--> statement-breakpoint
-- Library rescans upsert every file; only reindex when the name changed.
CREATE TRIGGER `files_fts_after_update_name` AFTER UPDATE OF name ON `files`
WHEN old.name IS NOT new.name BEGIN
	INSERT INTO files_fts(files_fts, rowid, name) VALUES ('delete', old.id, old.name);
	INSERT INTO files_fts(rowid, name) VALUES (new.id, new.name);
END;
--> statement-breakpoint
-- Index any rows that existed before this migration.
INSERT INTO files_fts(files_fts) VALUES ('rebuild');
