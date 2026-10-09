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
  /** Absolute folder path: only files directly inside it (My Files browsing). */
  folder?: string;
};

/** Where a file now lives after a rename or move, with fresh metadata. */
export type FileLocation = Pick<
  NewFile,
  'path' | 'uri' | 'name' | 'ext' | 'mime' | 'size' | 'mtime' | 'source'
>;

// Rows strictly under `dir` (any depth). substr/length rather than LIKE, so
// "%" and "_" in folder names are not wildcards.
function underDir(dir: string): SQL {
  const prefix = `${dir}/`;
  return sql`substr(${files.path}, 1, length(${prefix})) = ${prefix}`;
}

// Rows directly inside `dir` (no further "/" after the prefix).
function directlyIn(dir: string): SQL {
  const prefix = `${dir}/`;
  return sql`(substr(${files.path}, 1, length(${prefix})) = ${prefix} AND instr(substr(${files.path}, length(${prefix}) + 1), '/') = 0)`;
}

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

    /**
     * Adds rows for files the app has just created (duplicate, copy, import)
     * in one transaction: a stale row already at one of those paths is
     * deleted first (with its cascades) instead of being refreshed, so a new
     * file never inherits an old row's id, favorite, bookmarks or reading
     * state. Returns the new rows in order.
     */
    replaceAt(rows: readonly NewFile[]): FileRow[] {
      if (rows.length === 0) return [];
      return db.transaction((tx) =>
        rows.map((row) => {
          tx.delete(files).where(eq(files.path, row.path)).run();
          return tx.insert(files).values(row).returning().get();
        }),
      );
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
      folder,
    }: LibraryQuery): LibraryFile[] {
      const order = dir === 'asc' ? asc : desc;
      const query = db
        .select(LIBRARY_COLUMNS)
        .from(files)
        .where(
          and(
            extGroup === 'all' ? undefined : extGroupCondition(extGroup),
            source === 'all' ? undefined : eq(files.source, source),
            folder === undefined ? undefined : directlyIn(folder),
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
     * My Files rows are never merge targets: they are the app's own copies
     * (Copy to My Files, Import), so a match there is a separate file, not
     * the picked document. Excluded by source and, for safety, by the My
     * Files root (`myFilesRoot`) when known.
     *
     * Throws (and changes nothing) if any statement fails.
     */
    mergeContentDuplicates(
      options: { withoutMtime?: readonly string[]; myFilesRoot?: string | null } = {},
    ): MergeContentResult {
      const withoutMtime = options.withoutMtime ?? [];
      const sizeOnly =
        withoutMtime.length === 0
          ? sql`0`
          : sql`c.path IN (${sql.join(
              withoutMtime.map((uri) => sql`${uri}`),
              sql`, `,
            )})`;
      const root = options.myFilesRoot ?? null;
      const outsideMyFiles =
        root === null
          ? sql`1`
          : sql`m.path <> ${root} AND substr(m.path, 1, length(${`${root}/`})) <> ${`${root}/`}`;
      return db.transaction((tx) => {
        const pairs = tx.all<DuplicatePair>(
          sql`SELECT c.id AS contentId, c.path AS contentPath, c.is_favorite AS contentFavorite,
                  c.last_opened_at AS contentOpenedAt, c.page_count AS contentPageCount,
                  p.id AS pathId, p.last_opened_at AS pathOpenedAt
                FROM files c
                JOIN files p ON p.id = (
                  SELECT m.id FROM files m
                  WHERE m.path LIKE '/%' AND m.source <> 'myfiles' AND ${outsideMyFiles}
                    AND m.name = c.name AND m.size = c.size
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

    /**
     * Points a row at its new location after a rename or move, keeping its id
     * (so favorite, last opened, bookmarks, reading state and drafts stay).
     * In one transaction: a stale row already holding the new path is
     * deleted (the file there is now this one); the cached page count is
     * kept only if size and mtime are unchanged; and when a picked row's
     * content:// URI changed, path rows using the old URI as their fallback
     * follow it (the grant moved with the document). Returns the updated
     * row, or undefined if the id is unknown.
     */
    relocate(id: number, next: FileLocation): FileRow | undefined {
      return db.transaction((tx) => {
        const old = tx.select().from(files).where(eq(files.id, id)).get();
        if (old === undefined) return undefined;
        tx.delete(files)
          .where(and(eq(files.path, next.path), sql`${files.id} <> ${id}`))
          .run();
        const updated = tx
          .update(files)
          .set({
            path: next.path,
            uri: next.uri,
            name: next.name,
            ext: next.ext,
            mime: next.mime,
            size: next.size,
            mtime: next.mtime,
            source: next.source,
            pageCount: old.size === next.size && old.mtime === next.mtime ? old.pageCount : null,
          })
          .where(eq(files.id, id))
          .returning()
          .get();
        if (old.path.startsWith('content://') && old.path !== next.path) {
          tx.update(files)
            .set({ uri: next.path })
            .where(and(eq(files.uri, old.path), notLike(files.path, 'content://%')))
            .run();
        }
        return updated;
      });
    },

    /**
     * After a folder rename or move: rewrites the paths of every row under
     * `fromDir` to the same place under `toDir`, keeping ids. In one
     * transaction, stale rows already under `toDir` (the folder there is now
     * this one) are deleted first, so the path rewrite cannot hit the unique
     * path index. The prefix is cut with SQLite's own length(), never a JS
     * length: JS counts UTF-16 units, SQLite counts characters, and they
     * differ for emoji. Returns the number of rows moved.
     */
    relocateUnder(fromDir: string, toDir: string): number {
      if (fromDir === toDir) return 0;
      return db.transaction((tx) => {
        tx.delete(files)
          .where(and(underDir(toDir), sql`NOT ${underDir(fromDir)}`))
          .run();
        return tx
          .update(files)
          .set({ path: sql`${toDir} || substr(${files.path}, length(${fromDir}) + 1)` })
          .where(underDir(fromDir))
          .returning({ id: files.id })
          .all().length;
      });
    },

    /**
     * Deletes every row under `dir` (any depth) in one transaction; their
     * bookmarks, reading state and drafts cascade. Returns how many rows went
     * and the content:// grants those rows used, for the caller to release
     * once no other row uses them.
     */
    removeUnder(dir: string): { removed: number; grants: string[] } {
      return db.transaction((tx) => {
        const rows = tx
          .delete(files)
          .where(underDir(dir))
          .returning({ path: files.path, uri: files.uri })
          .all();
        const grants = rows
          .map((row) => (row.path.startsWith('content://') ? row.path : row.uri))
          .filter((uri): uri is string => uri !== null && uri.startsWith('content://'));
        return { removed: rows.length, grants };
      });
    },

    /** Id, path, size and mtime of every row under `dir` (any depth). */
    listUnder(dir: string): Pick<FileRow, 'id' | 'path' | 'size' | 'mtime'>[] {
      return db
        .select({ id: files.id, path: files.path, size: files.size, mtime: files.mtime })
        .from(files)
        .where(underDir(dir))
        .all();
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
