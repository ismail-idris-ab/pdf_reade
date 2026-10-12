-- Adds 'myfiles' to the files.source CHECK. SQLite cannot alter a CHECK, so
-- drizzle-kit rebuilds the table (ids are kept, so bookmarks, reading_state
-- and annotation_drafts still point at the same rows). The PRAGMAs are no-ops
-- inside the migrator's transaction; foreign keys are already off while
-- migrations run (see src/db/client.ts), so DROP TABLE does not cascade.
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_files` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`path` text NOT NULL,
	`uri` text,
	`name` text NOT NULL,
	`ext` text NOT NULL,
	`mime` text,
	`size` integer NOT NULL,
	`mtime` integer NOT NULL,
	`page_count` integer,
	`last_opened_at` integer,
	`is_favorite` integer DEFAULT false NOT NULL,
	`source` text NOT NULL,
	CONSTRAINT "files_source_check" CHECK("__new_files"."source" IN ('downloads', 'whatsapp', 'scans', 'device', 'myfiles'))
);
--> statement-breakpoint
INSERT INTO `__new_files`("id", "path", "uri", "name", "ext", "mime", "size", "mtime", "page_count", "last_opened_at", "is_favorite", "source") SELECT "id", "path", "uri", "name", "ext", "mime", "size", "mtime", "page_count", "last_opened_at", "is_favorite", "source" FROM `files`;--> statement-breakpoint
DROP TABLE `files`;--> statement-breakpoint
ALTER TABLE `__new_files` RENAME TO `files`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `files_path_unique` ON `files` (`path`);--> statement-breakpoint
CREATE INDEX `files_last_opened_idx` ON `files` (`last_opened_at`);--> statement-breakpoint
CREATE INDEX `files_favorite_idx` ON `files` (`is_favorite`);--> statement-breakpoint
CREATE INDEX `files_mtime_idx` ON `files` (`mtime`,`id`);--> statement-breakpoint
CREATE INDEX `files_source_mtime_idx` ON `files` (`source`,`mtime`);--> statement-breakpoint
-- Dropping `files` dropped the files_fts triggers (schema.ts migration rule):
-- recreate them exactly as in 0001_files_fts.sql, then reindex.
CREATE TRIGGER `files_fts_after_insert` AFTER INSERT ON `files` BEGIN
	INSERT INTO files_fts(rowid, name) VALUES (new.id, new.name);
END;
--> statement-breakpoint
CREATE TRIGGER `files_fts_after_delete` AFTER DELETE ON `files` BEGIN
	INSERT INTO files_fts(files_fts, rowid, name) VALUES ('delete', old.id, old.name);
END;
--> statement-breakpoint
CREATE TRIGGER `files_fts_after_update_name` AFTER UPDATE OF name ON `files`
WHEN old.name IS NOT new.name BEGIN
	INSERT INTO files_fts(files_fts, rowid, name) VALUES ('delete', old.id, old.name);
	INSERT INTO files_fts(rowid, name) VALUES (new.id, new.name);
END;
--> statement-breakpoint
INSERT INTO files_fts(files_fts) VALUES ('rebuild');
