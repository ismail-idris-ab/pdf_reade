import type { MergeContentResult, Repositories } from '@/db/repositories';
import type { FileRow } from '@/db/types';
import { Platform } from 'react-native';

import { reportError } from '@/lib/crash';
import { toAppError } from '@/lib/errors';
import {
  DEFAULT_SCAN_EXTS,
  extForMime,
  hasAllFilesAccess,
  listPersistedUris,
  releasePersistedUri,
  mimeForExt,
  scanDocuments,
  toNewFile,
  type PickedDocument,
  type ScanSummary,
} from '@/lib/files';

import { bumpLibraryVersion } from './version';

export { bumpLibraryVersion, useLibraryVersion, useLibraryVersionStore } from './version';

// Library rule: every content:// URI stored in the files table holds a
// persisted read grant taken by the picker. That is either a picked row's
// path (path = uri = the content:// URI) or the fallback `uri` of a scanned
// path row that a pick of the same file was merged into
// (mergePickedDuplicates): the fallback keeps that document openable without
// all-files access, so its grant is kept and counts as in use. Transient URIs,
// such as those from "Open with" or the share target (T1.6), must be copied
// into the cache with copyContentUriToCache and stored by that file path
// instead, so that prunePickedDocuments only ever drops URIs whose grant was
// truly lost.

/** True for Storage Access Framework URIs (files picked or opened from another app). */
export function isContentUri(path: string): boolean {
  return /^content:\/\//i.test(path);
}

// Rows the storage scan owns: absolute filesystem paths. content:// rows come
// from the picker and are never touched by a scan.
function isFilesystemPath(path: string): boolean {
  return path.startsWith('/');
}

/**
 * Outcome of `indexLibrary`. Expected outcomes are values, not errors:
 * - `permissionDenied`: all-files access is not held (or was revoked mid-scan);
 *   nothing was changed. The app stays in manual mode.
 * - `cancelled`: the signal aborted; rows already written are kept, but no
 *   deletions are applied because a partial walk cannot prove a file is gone.
 */
export type IndexLibraryResult =
  | {
      status: 'completed';
      upserted: number;
      removed: number;
      scanned: number;
      /** Picked rows folded into the scanned row of the same file. */
      merged: number;
    }
  | { status: 'cancelled'; upserted: number }
  | { status: 'permissionDenied' };

export type IndexLibraryOptions = {
  signal?: AbortSignal;
};

let running: Promise<IndexLibraryResult> | null = null;

/** Whether an `indexLibrary` run is in progress. */
export function isIndexing(): boolean {
  return running !== null;
}

/**
 * Scans shared storage and brings the `files` table in line with it: new and
 * changed documents are upserted, rows for deleted files are removed. Only
 * filesystem-path rows take part in that; the one exception for picked
 * (content://) rows is that, after a completed scan, a picked row whose file
 * the scan also found is merged into that file's row (mergePickedDuplicates).
 * Mounted library screens are told about changes (bumpLibraryVersion) during
 * the scan, throttled, and once at the end.
 *
 * Runs never overlap: while a run is in progress, further calls return that
 * run's promise (their options are ignored).
 *
 * Resolves with an `IndexLibraryResult` for expected outcomes (including
 * PERMISSION_DENIED and CANCELLED). Rejects with an AppError only for
 * unexpected failures (native scan error, database error).
 */
export function indexLibrary(
  repos: Repositories,
  options: IndexLibraryOptions = {},
): Promise<IndexLibraryResult> {
  if (running !== null) return running;
  const run: Promise<IndexLibraryResult> = runIndex(repos, options).finally(() => {
    if (running === run) running = null;
  });
  running = run;
  return run;
}

// While a scan streams batches, mounted library screens are told at most this
// often (each change makes them re-read the whole list, after interactions).
const BUMP_INTERVAL_MS = 3000;

async function runIndex(
  repos: Repositories,
  { signal }: IndexLibraryOptions,
): Promise<IndexLibraryResult> {
  if (!hasAllFilesAccess()) return { status: 'permissionDenied' };

  const knownMtimes: Record<string, number> = {};
  for (const entry of repos.files.listIndexEntries()) {
    if (isFilesystemPath(entry.path)) knownMtimes[entry.path] = entry.mtime;
  }

  let upserted = 0;
  let lastBump = Date.now();
  // Whether rows changed since screens were last told.
  let dirty = false;
  const handle = scanDocuments({
    exts: DEFAULT_SCAN_EXTS,
    knownMtimes,
    signal,
    onBatch: (files) => {
      // One transaction per batch: a failing row rolls back the whole batch.
      const rows = files
        .filter((file) => isFilesystemPath(file.path))
        .map((file) => toNewFile(file));
      repos.files.upsertMany(rows);
      upserted += rows.length;
      if (rows.length === 0) return;
      dirty = true;
      if (Date.now() - lastBump >= BUMP_INTERVAL_MS) {
        lastBump = Date.now();
        dirty = false;
        bumpLibraryVersion();
      }
    },
  });

  try {
    let summary: ScanSummary;
    try {
      summary = await handle.result;
    } catch (error) {
      const appError = toAppError(error);
      if (appError.code === 'PERMISSION_DENIED') return { status: 'permissionDenied' };
      if (appError.code === 'CANCELLED') return { status: 'cancelled', upserted };
      throw appError;
    }
    if (summary.cancelled) return { status: 'cancelled', upserted };

    // One transaction for all deletions.
    const removed = repos.files.removeByPaths(summary.deleted.filter(isFilesystemPath));
    if (removed > 0) dirty = true;
    const merged = mergePickedDuplicates(repos);
    if (merged > 0) dirty = true;
    return { status: 'completed', upserted, removed, scanned: summary.scanned, merged };
  } finally {
    if (dirty) bumpLibraryVersion();
  }
}

/**
 * Folds picked (content://) rows into the scanned row of the same file
 * (FilesRepository.mergeContentDuplicates), so a document is listed once.
 * The picked URI is kept as the path row's fallback `uri` and its grant is
 * kept (see the library rule above). The database changes commit together;
 * only then are grants released, and only those no row uses any more (the
 * path row already had another fallback). A release failure is reported, not
 * thrown: the row is already gone, and an orphan grant is reclaimed by
 * enforceGrantLimit later. If the transaction fails nothing is released and
 * the AppError is thrown. Returns the number of rows merged.
 */
export function mergePickedDuplicates(
  repos: Repositories,
  options: { withoutMtime?: readonly string[] } = {},
): number {
  let result: MergeContentResult;
  try {
    result = repos.files.mergeContentDuplicates(options);
  } catch (error) {
    throw toAppError(error);
  }
  for (const uri of result.release) {
    try {
      if (!repos.files.isGrantInUse(uri)) releasePersistedUri(uri);
    } catch (error) {
      reportError(error);
    }
  }
  return result.merged.length;
}

export type AddPickedDocumentsOptions = {
  /** Epoch ms used when the provider reports no modification time. */
  now: number;
  /** Localized name for documents whose provider reports none. */
  fallbackName: string;
  /** Override for the persisted-grant safety limit (tests); see pickedGrantLimit. */
  grantLimit?: number;
};

export type AddPickedDocumentsResult = {
  /** Rows stored (only documents whose grant was persisted). */
  rows: FileRow[];
  /** Documents left out because their read grant could not be persisted. */
  notPersisted: number;
  /** Older picked documents removed from the library to stay under the grant cap. */
  evicted: number;
};

/**
 * How many persisted URI grants the app keeps at most. Android caps them per
 * app (128 up to API 29, 512 from API 30) and silently drops the oldest past
 * the cap; staying a little below it lets the app choose what goes and tell
 * the user, instead of rows vanishing at the next prune.
 */
export function pickedGrantLimit(): number {
  const version = Platform.Version;
  return typeof version === 'number' && version < 30 ? 120 : 500;
}

function extFromName(name: string): string | null {
  const match = /\.([A-Za-z0-9]{1,10})$/.exec(name);
  return match?.[1]?.toLowerCase() ?? null;
}

// A known extension in the name wins; otherwise the MIME type decides, then
// whatever extension the name has, then none.
function extOf(document: PickedDocument): string {
  const fromName = document.name ? extFromName(document.name) : null;
  if (fromName !== null && mimeForExt(fromName) !== null) return fromName;
  const fromMime = document.mime ? extForMime(document.mime) : null;
  return fromMime ?? fromName ?? '';
}

/**
 * Keeps the number of persisted grants (existing plus the new picks) within
 * `limit`. Grants no library row uses (as a picked path or a fallback uri)
 * are released first; then the least recently used grants go, only as many
 * as needed: a picked row loses its grant and is removed, a scanned row only
 * loses its fallback uri (it stays listed). New picks are never evicted.
 * Returns the number of rows removed.
 *
 * The picker has already taken the new grants, so they may or may not be in
 * listPersistedUris() yet; counting the union handles both.
 */
function enforceGrantLimit(repos: Repositories, newUris: readonly string[], limit: number): number {
  const fresh = new Set(newUris);
  const persisted = new Set([...listPersistedUris(), ...newUris]);
  let excess = persisted.size - limit;
  if (excess <= 0) return 0;

  const byAge = repos.files.listGrantsByAge().filter((row) => !fresh.has(row.grant));
  const inLibrary = new Set(byAge.map((row) => row.grant));
  for (const uri of persisted) {
    if (excess <= 0) break;
    if (fresh.has(uri) || inLibrary.has(uri)) continue;
    releasePersistedUri(uri);
    excess -= 1;
  }

  // A grant can back several rows (a pick and a fallback); evicting it drops
  // it from all of them.
  const evicted = new Set<string>();
  for (const row of byAge) {
    if (excess <= 0) break;
    if (!persisted.has(row.grant) || evicted.has(row.grant)) continue;
    evicted.add(row.grant);
    excess -= 1;
  }
  const evictRows: string[] = [];
  const evictFallbacks: number[] = [];
  for (const row of byAge) {
    if (!evicted.has(row.grant)) continue;
    if (row.picked) evictRows.push(row.grant);
    else evictFallbacks.push(row.id);
  }
  for (const uri of evicted) releasePersistedUri(uri);
  repos.files.clearFallbackUris(evictFallbacks);
  return repos.files.removeByPaths(evictRows);
}

/**
 * Adds documents chosen in the system picker to the library. Each row is
 * keyed by its content:// URI (path = uri), so picking the same document
 * again refreshes it instead of duplicating it. Documents whose grant was not
 * persisted are left out (the library rule above). All rows are written in
 * one transaction. Older picks may be evicted to respect the grant cap.
 */
export function addPickedDocuments(
  repos: Repositories,
  picked: readonly PickedDocument[],
  { now, fallbackName, grantLimit = pickedGrantLimit() }: AddPickedDocumentsOptions,
): AddPickedDocumentsResult {
  const keep = picked.filter((document) => document.persisted);
  const notPersisted = picked.length - keep.length;
  if (keep.length === 0) return { rows: [], notPersisted, evicted: 0 };

  const evicted = enforceGrantLimit(
    repos,
    keep.map((document) => document.uri),
    grantLimit,
  );
  const rows = repos.files.upsertMany(
    keep.map((document) => {
      const ext = extOf(document);
      return {
        path: document.uri,
        uri: document.uri,
        name: document.name?.trim() ? document.name : fallbackName,
        ext,
        mime: document.mime ?? mimeForExt(ext),
        size: document.size ?? 0,
        mtime: document.mtime ?? now,
        source: 'device' as const,
      };
    }),
  );
  // Fold picks of files the scan already indexed into those rows (cheap).
  // Opportunistic: the picks are stored either way, so a failure is only
  // reported and the next completed scan retries.
  try {
    mergePickedDuplicates(repos, {
      withoutMtime: keep
        .filter((document) => document.mtime === null)
        .map((document) => document.uri),
    });
  } catch (error) {
    reportError(error);
  }
  bumpLibraryVersion();
  return { rows, notPersisted, evicted };
}

/**
 * Drops content:// URIs whose persisted permission is gone (revoked by the
 * user or the provider): picked rows are removed, so the library never lists
 * files it cannot open; a scanned row only loses its fallback uri (its path
 * still works with all-files access). Returns the number of rows removed.
 */
export function prunePickedDocuments(repos: Repositories): number {
  const persisted = new Set(listPersistedUris());
  const lostRows: string[] = [];
  const lostFallbacks: number[] = [];
  for (const entry of repos.files.listGrantsByAge()) {
    if (persisted.has(entry.grant)) continue;
    if (entry.picked) lostRows.push(entry.grant);
    else lostFallbacks.push(entry.id);
  }
  repos.files.clearFallbackUris(lostFallbacks);
  const removed = repos.files.removeByPaths(lostRows);
  if (removed > 0) bumpLibraryVersion();
  return removed;
}
