CREATE TABLE `annotation_drafts` (
	`file_id` integer PRIMARY KEY NOT NULL,
	`json` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `bookmarks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`file_id` integer NOT NULL,
	`page` integer NOT NULL,
	`label` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "bookmarks_page_check" CHECK("bookmarks"."page" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bookmarks_file_page_unique` ON `bookmarks` (`file_id`,`page`);--> statement-breakpoint
CREATE TABLE `files` (
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
	CONSTRAINT "files_source_check" CHECK("files"."source" IN ('downloads', 'whatsapp', 'scans', 'device'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `files_path_unique` ON `files` (`path`);--> statement-breakpoint
CREATE INDEX `files_last_opened_idx` ON `files` (`last_opened_at`);--> statement-breakpoint
CREATE INDEX `files_favorite_idx` ON `files` (`is_favorite`);--> statement-breakpoint
CREATE INDEX `files_mtime_idx` ON `files` (`mtime`,`id`);--> statement-breakpoint
CREATE INDEX `files_source_mtime_idx` ON `files` (`source`,`mtime`);--> statement-breakpoint
CREATE TABLE `reading_state` (
	`file_id` integer PRIMARY KEY NOT NULL,
	`page` integer NOT NULL,
	`zoom` real DEFAULT 1 NOT NULL,
	`mode` text DEFAULT 'vertical' NOT NULL,
	FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "reading_state_page_check" CHECK("reading_state"."page" >= 0),
	CONSTRAINT "reading_state_zoom_check" CHECK("reading_state"."zoom" BETWEEN 1 AND 5),
	CONSTRAINT "reading_state_mode_check" CHECK("reading_state"."mode" IN ('vertical', 'horizontal'))
);
--> statement-breakpoint
CREATE TABLE `trash` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`original_path` text NOT NULL,
	`trashed_path` text NOT NULL,
	`name` text NOT NULL,
	`size` integer NOT NULL,
	`mime` text,
	`deleted_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trash_trashed_path_unique` ON `trash` (`trashed_path`);--> statement-breakpoint
CREATE INDEX `trash_deleted_at_idx` ON `trash` (`deleted_at`);--> statement-breakpoint
CREATE TABLE `usage` (
	`feature` text NOT NULL,
	`day` text NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`feature`, `day`)
);
