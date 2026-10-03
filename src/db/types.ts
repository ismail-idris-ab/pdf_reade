import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

import type * as schema from './schema';

export type Schema = typeof schema;

/**
 * Any synchronous drizzle SQLite database with our schema. The app uses the
 * expo-sqlite driver; Jest uses better-sqlite3. Repositories depend only on
 * this type so both work.
 */
export type AppDatabase = BaseSQLiteDatabase<'sync', unknown, Schema>;

export type FileRow = typeof schema.files.$inferSelect;
export type NewFile = Omit<
  typeof schema.files.$inferInsert,
  'id' | 'pageCount' | 'lastOpenedAt' | 'isFavorite'
>;
export type BookmarkRow = typeof schema.bookmarks.$inferSelect;
export type ReadingStateRow = typeof schema.readingState.$inferSelect;
export type TrashRow = typeof schema.trash.$inferSelect;
export type NewTrash = Omit<typeof schema.trash.$inferInsert, 'id'>;
export type AnnotationDraftRow = typeof schema.annotationDrafts.$inferSelect;
