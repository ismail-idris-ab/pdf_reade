import { and, asc, eq } from 'drizzle-orm';

import { bookmarks } from '../schema';
import type { AppDatabase, BookmarkRow } from '../types';

export function createBookmarksRepository(db: AppDatabase) {
  return {
    /** One bookmark per page: adding an existing page updates its label. */
    add(fileId: number, page: number, label: string | null, createdAt: number): BookmarkRow {
      return db
        .insert(bookmarks)
        .values({ fileId, page, label, createdAt })
        .onConflictDoUpdate({ target: [bookmarks.fileId, bookmarks.page], set: { label } })
        .returning()
        .get();
    },

    remove(fileId: number, page: number): void {
      db.delete(bookmarks)
        .where(and(eq(bookmarks.fileId, fileId), eq(bookmarks.page, page)))
        .run();
    },

    listForFile(fileId: number): BookmarkRow[] {
      return db
        .select()
        .from(bookmarks)
        .where(eq(bookmarks.fileId, fileId))
        .orderBy(asc(bookmarks.page))
        .all();
    },
  };
}

export type BookmarksRepository = ReturnType<typeof createBookmarksRepository>;
