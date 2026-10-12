import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

// Conventions:
// - Timestamps are Unix epoch milliseconds stored as integers.
// - Page numbers are 0-based page indices, as used by PDFium.
//
// Migration rule: a drizzle-kit migration that recreates `files` (column type
// or constraint change, column drop) drops the files_fts triggers from
// 0001_files_fts.sql. Such a migration must recreate those triggers and run
// INSERT INTO files_fts(files_fts) VALUES ('rebuild').

// 'myfiles': documents in the app's own MyFiles folder (filled from T1.4).
export const FILE_SOURCES = ['downloads', 'whatsapp', 'scans', 'device', 'myfiles'] as const;
export type FileSource = (typeof FILE_SOURCES)[number];

export const READING_MODES = ['vertical', 'horizontal'] as const;
export type ReadingMode = (typeof READING_MODES)[number];

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 5;

// Enum values are fixed literals defined above, so inlining them is safe.
const sqlList = (values: readonly string[]) =>
  sql.raw(values.map((value) => `'${value}'`).join(', '));

export const files = sqliteTable(
  'files',
  {
    // INTEGER PRIMARY KEY is the rowid, which files_fts uses as content_rowid.
    id: integer('id').primaryKey({ autoIncrement: true }),
    // Absolute file path, or the content:// URI for files picked through SAF.
    path: text('path').notNull(),
    uri: text('uri'),
    name: text('name').notNull(),
    ext: text('ext').notNull(),
    mime: text('mime'),
    size: integer('size').notNull(),
    mtime: integer('mtime').notNull(),
    pageCount: integer('page_count'),
    lastOpenedAt: integer('last_opened_at'),
    isFavorite: integer('is_favorite', { mode: 'boolean' }).notNull().default(false),
    source: text('source', { enum: FILE_SOURCES }).notNull(),
  },
  (t) => [
    uniqueIndex('files_path_unique').on(t.path),
    index('files_last_opened_idx').on(t.lastOpenedAt),
    index('files_favorite_idx').on(t.isFavorite),
    index('files_mtime_idx').on(t.mtime, t.id),
    index('files_source_mtime_idx').on(t.source, t.mtime),
    check('files_source_check', sql`${t.source} IN (${sqlList(FILE_SOURCES)})`),
  ],
);

export const bookmarks = sqliteTable(
  'bookmarks',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    fileId: integer('file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'cascade' }),
    page: integer('page').notNull(),
    label: text('label'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('bookmarks_file_page_unique').on(t.fileId, t.page),
    check('bookmarks_page_check', sql`${t.page} >= 0`),
  ],
);

export const readingState = sqliteTable(
  'reading_state',
  {
    fileId: integer('file_id')
      .primaryKey()
      .references(() => files.id, { onDelete: 'cascade' }),
    page: integer('page').notNull(),
    zoom: real('zoom').notNull().default(MIN_ZOOM),
    mode: text('mode', { enum: READING_MODES }).notNull().default('vertical'),
  },
  (t) => [
    check('reading_state_page_check', sql`${t.page} >= 0`),
    check(
      'reading_state_zoom_check',
      sql`${t.zoom} BETWEEN ${sql.raw(String(MIN_ZOOM))} AND ${sql.raw(String(MAX_ZOOM))}`,
    ),
    check('reading_state_mode_check', sql`${t.mode} IN (${sqlList(READING_MODES)})`),
  ],
);

export const trash = sqliteTable(
  'trash',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    originalPath: text('original_path').notNull(),
    trashedPath: text('trashed_path').notNull(),
    // Metadata kept so the trash list can show the file after its `files`
    // row is gone. Bookmarks, reading state and drafts are not restored.
    name: text('name').notNull(),
    size: integer('size').notNull(),
    mime: text('mime'),
    deletedAt: integer('deleted_at').notNull(),
  },
  (t) => [
    uniqueIndex('trash_trashed_path_unique').on(t.trashedPath),
    index('trash_deleted_at_idx').on(t.deletedAt),
  ],
);

export const usage = sqliteTable(
  'usage',
  {
    feature: text('feature').notNull(),
    // Local calendar day as YYYY-MM-DD.
    day: text('day').notNull(),
    count: integer('count').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.feature, t.day] })],
);

export const annotationDrafts = sqliteTable('annotation_drafts', {
  fileId: integer('file_id')
    .primaryKey()
    .references(() => files.id, { onDelete: 'cascade' }),
  json: text('json').notNull(),
  updatedAt: integer('updated_at').notNull(),
});
