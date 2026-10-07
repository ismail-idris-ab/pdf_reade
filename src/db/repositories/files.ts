import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNotNull,
  notInArray,
  notLike,
  sql,
  type SQL,
} from 'drizzle-orm';

import { GROUP_EXTS, GROUPED_EXTS, type ExtGroup } from '@/lib/files/extGroups';

import { files, type FileSource } from '../schema';
import type { AppDatabase, FileRow, NewFile } from '../types';

export type LibrarySort = 'name' | 'date' | 'size';
export type SortDir = 'asc' | 'desc';

export type LibraryQuery = {
  /** Document-type tab; 'all' (or omitted) for every type. */
  extGroup?: ExtGroup | 'all';
  /** Source chip; 'all' (or omitted) for every source. */
  source?: FileSource | 'all';
  sort: LibrarySort;
  dir: SortDir;
  /** BCP 47 locale for name sorting; defaults to the runtime's. */
  locale?: string;
};

/** A persisted grant used by a row; see listGrantsByAge. */
export type GrantEntry = { id: number; grant: string; picked: boolean };

export type MergeContentResult = {
  /** content:// rows folded into a path row (now deleted). */
  merged: string[];
  /**
   * Of those, grants no row uses any more (the path row already kept another
   * fallback URI): the caller releases them after commit. Every other merged
   * URI is kept as the path row's fallback `uri`.
   */
  release: string[];
};

const collators = new Map<string, Intl.Collator>();

// Locale-aware, accent- and case-insensitive name order ("Élan" with the
// E's, "file2" before "file10"). Hermes ships Intl.Collator on Android.
function collatorFor(locale: string | undefined): Intl.Collator {
  const key = locale ?? '';
  let collator = collators.get(key);
  if (!collator) {
    const options: Intl.CollatorOptions = { sensitivity: 'base', numeric: true };
    try {
      collator = new Intl.Collator(locale, options);
    } catch {
      // Unknown or malformed locale tag: fall back to the runtime default.
      collator = new Intl.Collator(undefined, options);
    }
    collators.set(key, collator);
  }
  return collator;
}

/** Name order used by the library: locale collation, then id. */
export function compareNames(
  a: Pick<LibraryFile, 'id' | 'name'>,
  b: Pick<LibraryFile, 'id' | 'name'>,
  locale?: string,
): number {
  return collatorFor(locale).compare(a.name, b.name) || a.id - b.id;
}

// Only what the library list renders (and the thumbnail cache key needs).
const LIBRARY_COLUMNS = {
  id: files.id,
  path: files.path,
  name: files.name,
  ext: files.ext,
  size: files.size,
  mtime: files.mtime,
  isFavorite: files.isFavorite,
  lastOpenedAt: files.lastOpenedAt,
  source: files.source,
};

/** A library list entry: the subset of a files row the list shows. */
export type LibraryFile = Pick<
  FileRow,
  'id' | 'path' | 'name' | 'ext' | 'size' | 'mtime' | 'isFavorite' | 'lastOpenedAt' | 'source'
>;

function extGroupCondition(group: ExtGroup): SQL {
  return group === 'other'
    ? notInArray(files.ext, [...GROUPED_EXTS])
    : inArray(files.ext, [...GROUP_EXTS[group]]);
}

const SORT_COLUMN = {
  date: sql`${files.mtime}`,
  size: sql`${files.size}`,
} as const;

/** A content:// row whose file the storage scan also found by path. */
type DuplicatePair = {
  contentId: number;
  contentPath: string;
  contentFavorite: number;
  contentOpenedAt: number | null;
  contentPageCount: number | null;
  pathId: number;
  pathOpenedAt: number | null;
};

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

/**
 * Inserts a file or refreshes its metadata if the path is already known.
 * User state (favorite, last opened) is kept; the cached page count is
 * cleared when the file changed on disk.
 */
function upsertFile(db: AppDatabase, file: NewFile): FileRow {
  return db
    .insert(files)
    .values(file)
    .onConflictDoUpdate({
      target: files.path,
      set: {
        // Scans pass uri null: keep the fallback URI of a merged pick.
        uri: sql`COALESCE(excluded.uri, ${files.uri})`,
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
}

export function createFilesRepository(db: AppDatabase) {
  return {
    /** See upsertFile. */
    upsert(file: NewFile): FileRow {
      return upsertFile(db, file);
    },

    /** Upserts all rows in one transaction: all are written, or none. */
    upsertMany(rows: readonly NewFile[]): FileRow[] {
      if (rows.length === 0) return [];
      return db.transaction((tx) => rows.map((row) => upsertFile(tx, row)));
    },

    /**
     * Deletes the rows with these paths in one transaction (bookmarks, reading
     * state and drafts cascade). Unknown paths are ignored. Returns the number
     * of rows deleted.
     */
    removeByPaths(paths: readonly string[]): number {
      if (paths.length === 0) return 0;
      return db.transaction((tx) => {
        let removed = 0;
        // Chunked to stay under SQLite's bound-parameter limit.
        for (let start = 0; start < paths.length; start += 500) {
          const chunk = paths.slice(start, start + 500);
          removed += tx
            .delete(files)
            .where(inArray(files.path, chunk))
            .returning({ id: files.id })
            .all().length;
        }
        return removed;
      });
    },

    /**
     * Every persisted grant a row uses, least recently used first (never
     * opened before opened, then oldest open, then oldest mtime): a picked
     * row's content:// path (`picked: true`), or the fallback content:// uri
     * of a scanned path row a pick was merged into (`picked: false`).
     */
    listGrantsByAge(): GrantEntry[] {
      return db
        .select({
          id: files.id,
          grant: sql<string>`CASE WHEN ${files.path} LIKE 'content://%' THEN ${files.path} ELSE ${files.uri} END`,
          picked: sql<number>`${files.path} LIKE 'content://%'`,
        })
        .from(files)
        .where(sql`${files.path} LIKE 'content://%' OR ${files.uri} LIKE 'content://%'`)
        .orderBy(
          sql`${files.lastOpenedAt} IS NOT NULL`,
          asc(files.lastOpenedAt),
          asc(files.mtime),
          asc(files.id),
        )
        .all()
        .map((row) => ({ id: row.id, grant: row.grant, picked: Boolean(row.picked) }));
    },

    /** Whether any row uses this grant, as its path or as its fallback uri. */
    isGrantInUse(uri: string): boolean {
      const row = db
        .select({ id: files.id })
        .from(files)
        .where(sql`${files.path} = ${uri} OR ${files.uri} = ${uri}`)
        .limit(1)
        .get();
      return row !== undefined;
    },

    /**
     * Drops the fallback content:// uri of these path rows (their grant was
     * released or lost); the rows themselves stay. Picked rows are never
     * touched. Returns the number of rows changed.
     */
    clearFallbackUris(ids: readonly number[]): number {
      if (ids.length === 0) return 0;
      return db.transaction((tx) => {
        let changed = 0;
        for (let start = 0; start < ids.length; start += 500) {
          changed += tx
            .update(files)
            .set({ uri: null })
            .where(
              and(
                inArray(files.id, ids.slice(start, start + 500)),
                notLike(files.path, 'content://%'),
              ),
            )
            .returning({ id: files.id })
            .all().length;
        }
        return changed;
      });
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

    /** Id, path and mtime of every row (unpaged), for incremental scans and pruning. */
    listIndexEntries(): Pick<FileRow, 'id' | 'path' | 'mtime'>[] {
      return db.select({ id: files.id, path: files.path, mtime: files.mtime }).from(files).all();
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

    /**
     * Every row matching the tab and source filters (unpaged: the library
     * holds at most a few thousand files), with only the list's columns.
     * Name sort is done here with a locale collator (SQLite's NOCASE folds
     * ASCII only, so "Élan" would sort after "Zebra"); date and size sort in
     * SQL. Ties are broken by id in the same direction so the order is stable.
     */
    listLibrary({
      extGroup = 'all',
      source = 'all',
      sort,
      dir,
      locale,
    }: LibraryQuery): LibraryFile[] {
      const order = dir === 'asc' ? asc : desc;
      const query = db
        .select(LIBRARY_COLUMNS)
        .from(files)
        .where(
          and(
            extGroup === 'all' ? undefined : extGroupCondition(extGroup),
            source === 'all' ? undefined : eq(files.source, source),
          ),
        );
      if (sort !== 'name') return query.orderBy(order(SORT_COLUMN[sort]), order(files.id)).all();
      const sign = dir === 'asc' ? 1 : -1;
      return query.all().sort((a, b) => sign * compareNames(a, b, locale));
    },

    /** Number of rows in the library. */
    countAll(): number {
      return db.select({ n: count() }).from(files).get()?.n ?? 0;
    },

    /**
     * Folds picked (content://) rows into the scanned path row of the same
     * file, matched on name, size (known, > 0) and modification time to the
     * second (some providers report whole seconds). If several path rows
     * match, the oldest (lowest id) wins. Per merge, in one transaction:
     * favorite is OR-ed, last opened takes the later time, a missing page
     * count is copied; bookmarks move unless the path row already has one
     * on the same page; reading state and the annotation draft move when
     * the path row has none, otherwise the more recent one is kept (the
     * content row's reading state if it was opened later, the draft with
     * the later updatedAt). The content:// URI becomes the path row's
     * fallback `uri` (unless it already has one), so the document stays
     * openable through its persisted grant even if all-files access is
     * revoked later. Then the content row is deleted.
     *
     * `withoutMtime` lists picked URIs whose provider reported no
     * modification time (their stored mtime is the pick time): those match
     * on name and size alone.
     *
     * Throws (and changes nothing) if any statement fails.
     */
    mergeContentDuplicates(options: { withoutMtime?: readonly string[] } = {}): MergeContentResult {
      const withoutMtime = options.withoutMtime ?? [];
      const sizeOnly =
        withoutMtime.length === 0
          ? sql`0`
          : sql`c.path IN (${sql.join(
              withoutMtime.map((uri) => sql`${uri}`),
              sql`, `,
            )})`;
      return db.transaction((tx) => {
        const pairs = tx.all<DuplicatePair>(
          sql`SELECT c.id AS contentId, c.path AS contentPath, c.is_favorite AS contentFavorite,
                  c.last_opened_at AS contentOpenedAt, c.page_count AS contentPageCount,
                  p.id AS pathId, p.last_opened_at AS pathOpenedAt
                FROM files c
                JOIN files p ON p.id = (
                  SELECT m.id FROM files m
                  WHERE m.path LIKE '/%' AND m.name = c.name AND m.size = c.size
                    AND (m.mtime / 1000 = c.mtime / 1000 OR ${sizeOnly})
                  ORDER BY m.id LIMIT 1
                )
                WHERE c.path LIKE 'content://%' AND c.size > 0
                ORDER BY c.id`,
        );
        const release: string[] = [];

        // Several content rows can fold into one path row; later merges must
        // compare against the last-opened time earlier merges wrote.
        const openedAt = new Map<number, number | null>();
        for (const pair of pairs) {
          const { contentId: c, pathId: p } = pair;
          const pathOpened = openedAt.has(p) ? (openedAt.get(p) ?? null) : pair.pathOpenedAt;
          const contentNewer =
            pair.contentOpenedAt !== null &&
            (pathOpened === null || pair.contentOpenedAt > pathOpened);

          tx.run(sql`UPDATE OR IGNORE bookmarks SET file_id = ${p} WHERE file_id = ${c}`);

          if (contentNewer) {
            tx.run(
              sql`DELETE FROM reading_state WHERE file_id = ${p}
                  AND EXISTS (SELECT 1 FROM reading_state WHERE file_id = ${c})`,
            );
          }
          tx.run(sql`UPDATE OR IGNORE reading_state SET file_id = ${p} WHERE file_id = ${c}`);

          tx.run(
            sql`DELETE FROM annotation_drafts WHERE file_id = ${p}
                AND updated_at < (SELECT updated_at FROM annotation_drafts WHERE file_id = ${c})`,
          );
          tx.run(sql`UPDATE OR IGNORE annotation_drafts SET file_id = ${p} WHERE file_id = ${c}`);

          const mergedOpened = contentNewer ? pair.contentOpenedAt : pathOpened;
          tx.run(
            sql`UPDATE files SET
                  is_favorite = (is_favorite OR ${pair.contentFavorite}),
                  last_opened_at = ${mergedOpened},
                  page_count = COALESCE(page_count, ${pair.contentPageCount}),
                  uri = COALESCE(uri, ${pair.contentPath})
                WHERE id = ${p}`,
          );
          openedAt.set(p, mergedOpened);

          // Leftovers (same-page bookmarks, older state/draft) cascade.
          tx.delete(files).where(eq(files.id, c)).run();

          const kept = tx.select({ uri: files.uri }).from(files).where(eq(files.id, p)).get();
          if (kept?.uri !== pair.contentPath) release.push(pair.contentPath);
        }
        return { merged: pairs.map((pair) => pair.contentPath), release };
      });
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
