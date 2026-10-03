import { desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';

import { files, type FileSource } from '../schema';
import type { AppDatabase, FileRow, NewFile } from '../types';

/**
 * Builds an FTS5 MATCH expression from free text: every word becomes a quoted
 * prefix term ("word"*), all terms must match. Characters other than letters
 * and digits are separators, so user input can never inject FTS5 syntax.
 * Input is NFC-normalised (and combining marks kept inside words) so a
 * decomposed "Résumé" is not split into "Re" + "sume".
 * Returns null when the input has no searchable words.
 */
export function toFtsQuery(input: string): string | null {
  const words = input.normalize('NFC').match(/[\p{L}\p{M}\p{N}]+/gu);
  if (!words) return null;
  return words.map((word) => `"${word}"*`).join(' ');
}

export function createFilesRepository(db: AppDatabase) {
  return {
    /**
     * Inserts a file or refreshes its metadata if the path is already known.
     * User state (favorite, last opened) is kept; the cached page count is
     * cleared when the file changed on disk.
     */
    upsert(file: NewFile): FileRow {
      return db
        .insert(files)
        .values(file)
        .onConflictDoUpdate({
          target: files.path,
          set: {
            uri: file.uri,
            name: file.name,
            ext: file.ext,
            mime: file.mime,
            size: file.size,
            mtime: file.mtime,
            source: file.source,
            pageCount: sql`CASE WHEN ${files.mtime} = excluded.mtime AND ${files.size} = excluded.size THEN ${files.pageCount} ELSE NULL END`,
          },
        })
        .returning()
        .get();
    },

    getById(id: number): FileRow | undefined {
      return db.select().from(files).where(eq(files.id, id)).get();
    },

    getByPath(path: string): FileRow | undefined {
      return db.select().from(files).where(eq(files.path, path)).get();
    },

    /** Newest first by modification time, optionally limited to one source. */
    list(options: { source?: FileSource; limit?: number; offset?: number } = {}): FileRow[] {
      const { source, limit = 100, offset = 0 } = options;
      return db
        .select()
        .from(files)
        .where(source ? eq(files.source, source) : undefined)
        .orderBy(desc(files.mtime), desc(files.id))
        .limit(limit)
        .offset(offset)
        .all();
    },

    listRecent(limit = 20): FileRow[] {
      return db
        .select()
        .from(files)
        .where(isNotNull(files.lastOpenedAt))
        .orderBy(desc(files.lastOpenedAt))
        .limit(limit)
        .all();
    },

    listFavorites(): FileRow[] {
      return db.select().from(files).where(eq(files.isFavorite, true)).orderBy(files.name).all();
    },

    setFavorite(id: number, isFavorite: boolean): void {
      db.update(files).set({ isFavorite }).where(eq(files.id, id)).run();
    },

    markOpened(id: number, openedAt: number): void {
      db.update(files).set({ lastOpenedAt: openedAt }).where(eq(files.id, id)).run();
    },

    setPageCount(id: number, pageCount: number): void {
      db.update(files).set({ pageCount }).where(eq(files.id, id)).run();
    },

    /** Deletes the row; bookmarks, reading state and drafts cascade. */
    remove(id: number): void {
      db.delete(files).where(eq(files.id, id)).run();
    },

    /** Full-text search on file names, best matches first. */
    search(query: string, limit = 50): FileRow[] {
      const match = toFtsQuery(query);
      if (match === null) return [];
      const ranked = db.all<{ id: number }>(
        sql`SELECT rowid AS id FROM files_fts WHERE files_fts MATCH ${match} ORDER BY rank LIMIT ${limit}`,
      );
      if (ranked.length === 0) return [];
      const ids = ranked.map((row) => row.id);
      const rows = db.select().from(files).where(inArray(files.id, ids)).all();
      const byId = new Map(rows.map((row) => [row.id, row]));
      return ids.flatMap((id) => {
        const row = byId.get(id);
        return row ? [row] : [];
      });
    },
  };
}

export type FilesRepository = ReturnType<typeof createFilesRepository>;
