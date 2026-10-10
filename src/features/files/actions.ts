import { Platform } from 'react-native';

import type { Repositories } from '@/db/repositories';
import type { FileSource } from '@/db/schema';
import type { FileRow, NewFile } from '@/db/types';
import { reportError } from '@/lib/crash';
import { AppError, toAppError } from '@/lib/errors';
import {
  ERR_NAME_INVALID,
  classifySource,
  copyContentUriToCache,
  copyFile,
  createFolder,
  deleteDocument,
  deleteFile,
  deleteFolder,
  getMyFilesRoot,
  hasAllFilesAccess,
  importDocuments,
  isInMyFiles,
  isTempEntry,
  keepExtension,
  listFolder,
  listPersistedUris,
  mimeForExt,
  moveFile,
  printPdf,
  releasePersistedUri,
  renameDocument,
  renameFile,
  renameFolder,
  share,
  stat,
  tryGetMyFilesRoot,
  validateFileName,
  type FileOpResult,
  type FolderEntry,
  type PickedDocument,
} from '@/lib/files';
import { exclusive } from '@/lib/library/exclusive';
import { bumpLibraryVersion } from '@/lib/library/version';

// File actions: each runs the native operation and then brings the files
// table in line with it, in one place, and tells library screens
// (bumpLibraryVersion). All of them reject with an AppError; name errors
// (ERR_NAME_INVALID / ERR_NAME_EXISTS) are told apart with fileOpErrorKind.
//
// Grants (see the library rule in src/lib/library/index.ts): a picked
// content:// row keeps its grant. A path row's fallback `uri` points at the
// file's old location once the file is renamed or moved, so it is dropped
// and its grant released (unless another row still uses it); path rows
// renamed or moved by the app are only reachable by path afterwards, which
// these shared-storage operations need anyway (all-files access; on Android
// 8–10 the storage permissions). Imported
// copies live in My Files and are stored by path; imports pick without
// persisting grants, and any grant the picker did persist is released.
//
// Operations run one at a time through the shared library queue
// (exclusive), together with reconcileMyFiles and mergePickedDuplicates, so
// none of them sees another half-applied.

/**
 * First Android API level (11) where shared-storage writes need all-files
 * access; below it they need the legacy storage write permission.
 */
export const MIN_SHARED_WRITE_API = 30;

/**
 * Whether shared-storage writes use the legacy runtime permission (Android
 * 8–10), which the app asks for on first use (see ensureSharedWriteAccess).
 * False on Android 11+ and on anything that is not Android.
 */
export function usesLegacyWritePermission(apiLevel: number | string = Platform.Version): boolean {
  return typeof apiLevel === 'number' && apiLevel < MIN_SHARED_WRITE_API;
}

/**
 * Whether to offer rename, move, copy and delete for files in shared
 * storage. Android 11+: only with all-files access (otherwise hidden, the
 * access banner explains). Android 8–10: always; the first such action
 * explains and asks for the legacy write permission. My Files and picked
 * documents are unaffected.
 */
export function canChangeSharedStorage(
  hasAllFilesAccess: boolean,
  apiLevel: number | string = Platform.Version,
): boolean {
  if (typeof apiLevel !== 'number') return false;
  return apiLevel < MIN_SHARED_WRITE_API || hasAllFilesAccess;
}

/** True for Storage Access Framework URIs (picked rows). */
export function isContentPath(path: string): boolean {
  return /^content:\/\//i.test(path);
}

/** Parent folder of an absolute path. */
export function parentDir(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash <= 0 ? '/' : path.slice(0, slash);
}

/** Lower-case extension of a file name ("" when it has none). */
export function extOfName(name: string): string {
  const match = /\.([A-Za-z0-9]{1,10})$/.exec(name);
  return match?.[1]?.toLowerCase() ?? '';
}

function requireRow(repos: Repositories, id: number): FileRow {
  const row = repos.files.getById(id);
  if (row === undefined) throw new AppError('NOT_FOUND', 'Library row is gone');
  return row;
}

/** Trims and checks a name; throws an UNKNOWN AppError carrying ERR_NAME_INVALID. */
function checkedName(name: string): string {
  const trimmed = name.trim();
  if (validateFileName(trimmed) !== null) {
    throw new AppError('UNKNOWN', 'Invalid name', { cause: { code: ERR_NAME_INVALID } });
  }
  return trimmed;
}

// Releases grants no row uses any more. Never throws: the database already
// changed, and an orphan grant is reclaimed by enforceGrantLimit later.
function releaseUnused(repos: Repositories, uris: readonly (string | null)[]): void {
  for (const uri of uris) {
    if (uri === null || !isContentPath(uri)) continue;
    try {
      if (!repos.files.isGrantInUse(uri)) releasePersistedUri(uri);
    } catch (error) {
      reportError(error);
    }
  }
}

// Writes the database half of an operation whose native half already
// succeeded. A failure here leaves disk and table apart until the next scan
// or My Files reconcile, so it is reported, then rethrown as an AppError.
function writeDb<T>(write: () => T): T {
  try {
    return write();
  } catch (error) {
    reportError(error);
    throw toAppError(error);
  }
}

// A newly created file gets a fresh row (FilesRepository.replaceAt): a stale
// row at its path must not hand over its id, favorite or bookmarks.
function replaceOne(repos: Repositories, file: NewFile): FileRow {
  const [inserted] = repos.files.replaceAt([file]);
  if (inserted === undefined) throw new AppError('UNKNOWN', 'Row not inserted');
  return inserted;
}

function rowFromResult(result: FileOpResult, like: Pick<FileRow, 'mime' | 'ext'>): NewFile {
  const ext = extOfName(result.name) || like.ext;
  return {
    path: result.path,
    uri: null,
    name: result.name,
    ext,
    mime: mimeForExt(ext) ?? like.mime,
    size: result.size,
    mtime: result.mtime,
    source: sourceOf(result.path),
  };
}

/** Library source of a path; anything under the native My Files root is 'myfiles'. */
export function sourceOf(path: string): FileSource {
  return isInMyFiles(path, tryGetMyFilesRoot()) ? 'myfiles' : classifySource(path);
}

/**
 * Renames a file, keeping its library row (id, favorite, bookmarks…).
 * Path rows are renamed on disk and re-classified. Picked rows are renamed
 * through their provider, which always answers with the URI that is live now
 * (holding a persisted grant): the row (and any path row using the old URI
 * as its fallback) switches to it, even when the provider kept the old name
 * (`renamed: false`: it could not keep access under the new one, so the UI
 * offers Copy to My Files instead). The live URI's grant is never released.
 * The file keeps its extension (keepExtension: "Report" → "Report.pdf"), so
 * its type never silently changes.
 */
export function renameLibraryFile(
  repos: Repositories,
  id: number,
  newName: string,
): Promise<RenameOutcome> {
  return exclusive(async () => {
    const row = requireRow(repos, id);
    const name = checkedName(keepExtension(newName.trim(), row.name));
    if (name === row.name) return { row, renamed: true };

    if (isContentPath(row.path)) {
      const result = await renameDocument(row.path, name);
      const finalName = result.renamed ? result.name : row.name;
      const ext = extOfName(finalName);
      const updated = writeDb(() =>
        repos.files.relocate(id, {
          path: result.uri,
          uri: result.uri,
          name: finalName,
          // The provider's MIME type still decides the type when the name
          // has no known extension.
          ext: mimeForExt(ext) !== null ? ext : row.ext,
          mime: row.mime,
          size: row.size,
          mtime: row.mtime,
          source: row.source,
        }),
      );
      bumpLibraryVersion();
      return { row: updated ?? requireRow(repos, id), renamed: result.renamed };
    }

    const result = await renameFile(row.path, name);
    const next = rowFromResult(result, row);
    const updated = writeDb(() => repos.files.relocate(id, next));
    releaseUnused(repos, [row.uri]);
    bumpLibraryVersion();
    return { row: updated ?? requireRow(repos, id), renamed: true };
  });
}

export type RenameOutcome = {
  row: FileRow;
  /**
   * False when a picked document's provider could not keep access under the
   * new name and kept the old one (the row still follows its live URI).
   */
  renamed: boolean;
};

/**
 * Moves a file (path rows only) into a My Files folder, keeping its row.
 * Moving into the folder it is already in does nothing.
 */
export function moveLibraryFile(
  repos: Repositories,
  id: number,
  destDir: string,
): Promise<FileRow> {
  return exclusive(async () => {
    const row = requireRow(repos, id);
    if (isContentPath(row.path)) throw new AppError('UNSUPPORTED', 'Picked files are copied');
    if (parentDir(row.path) === destDir) return row;
    const result = await moveFile(row.path, destDir);
    const updated = writeDb(() => repos.files.relocate(id, rowFromResult(result, row)));
    releaseUnused(repos, [row.uri]);
    bumpLibraryVersion();
    return updated ?? requireRow(repos, id);
  });
}

/**
 * Copies a picked (content://) document into a My Files folder as a new
 * row; the original row and its grant stay.
 */
export function copyToMyFiles(repos: Repositories, id: number, destDir: string): Promise<FileRow> {
  return exclusive(async () => {
    const row = requireRow(repos, id);
    const [result] = await importDocuments([row.path], destDir);
    if (result?.file === undefined) {
      throw toAppError({ code: result?.errorCode ?? 'UNKNOWN' });
    }
    const file = result.file;
    const inserted = writeDb(() => replaceOne(repos, rowFromResult(file, row)));
    bumpLibraryVersion();
    return inserted;
  });
}

/** Copies a file (path rows only) next to itself ("Name (copy).ext") as a new row. */
export function duplicateLibraryFile(repos: Repositories, id: number): Promise<FileRow> {
  return exclusive(async () => {
    const row = requireRow(repos, id);
    if (isContentPath(row.path))
      throw new AppError('UNSUPPORTED', 'Picked files cannot be copied in place');
    const result = await copyFile(row.path, parentDir(row.path));
    const inserted = writeDb(() => replaceOne(repos, rowFromResult(result, row)));
    bumpLibraryVersion();
    return inserted;
  });
}

/**
 * Permanently deletes a file and its row (bookmarks, reading state and
 * drafts cascade). Picked rows are deleted through their provider, which
 * also gives up the grant natively; path rows using that URI as a fallback
 * lose it. If the provider answers NOT_FOUND the document is already gone
 * (deleted outside the app): the user asked for it to go, so the row goes
 * anyway and the grant, which native did not release, is released here.
 * A path row's own fallback grant is released if unused.
 */
export function deleteLibraryFile(repos: Repositories, id: number): Promise<void> {
  return exclusive(async () => {
    const row = requireRow(repos, id);
    if (isContentPath(row.path)) {
      let alreadyGone = false;
      try {
        await deleteDocument(row.path);
      } catch (error) {
        if (toAppError(error).code !== 'NOT_FOUND') throw error;
        alreadyGone = true;
      }
      writeDb(() => {
        repos.files.remove(id);
        const fallbacks = repos.files
          .listGrantsByAge()
          .filter((entry) => !entry.picked && entry.grant === row.path)
          .map((entry) => entry.id);
        repos.files.clearFallbackUris(fallbacks);
      });
      // A successful delete released the grant natively; a NOT_FOUND did not.
      if (alreadyGone) releaseUnused(repos, [row.path]);
    } else {
      await deleteFile(row.path);
      writeDb(() => repos.files.remove(id));
      releaseUnused(repos, [row.uri]);
    }
    bumpLibraryVersion();
  });
}

/**
 * Removes a row whose file is gone (NOT_FOUND recovery) without touching
 * storage, and releases the grants it used if no other row uses them.
 */
export function removeFromLibrary(repos: Repositories, id: number): Promise<void> {
  return exclusive(async () => {
    const row = repos.files.getById(id);
    if (row === undefined) return;
    writeDb(() => repos.files.remove(id));
    releaseUnused(repos, [isContentPath(row.path) ? row.path : null, row.uri]);
    bumpLibraryVersion();
  });
}

/** Marks or unmarks a file as a favorite. */
export function setFileFavorite(repos: Repositories, id: number, isFavorite: boolean): void {
  try {
    repos.files.setFavorite(id, isFavorite);
  } catch (error) {
    throw toAppError(error);
  }
  bumpLibraryVersion();
}

/**
 * Whether a library row's file is really gone, so "Remove from library" is
 * the right recovery after `error` (the failure of an operation on it).
 * Path rows: stat says the file does not exist. Picked rows: the provider
 * itself answered NOT_FOUND (a document deleted outside its provider usually
 * leaves our grant in place, so the grant alone proves nothing), or the app
 * no longer holds the URI's persisted grant. Anything uncertain (a failing
 * check) answers false: the row is then kept and only the error is shown.
 */
export async function isFileGone(
  repos: Repositories,
  id: number,
  error: unknown,
): Promise<boolean> {
  const row = repos.files.getById(id);
  if (row === undefined) return true;
  try {
    if (isContentPath(row.path)) {
      return toAppError(error).code === 'NOT_FOUND' || !listPersistedUris().includes(row.path);
    }
    return !(await stat(row.path)).exists;
  } catch {
    return false;
  }
}

// A failed check counts as "not granted", as everywhere else in the app.
function holdsAllFilesAccess(): boolean {
  try {
    return hasAllFilesAccess();
  } catch {
    return false;
  }
}

/**
 * Where a file can be read from right now: its path, or its content:// URI.
 * A shared-storage path is unreadable without all-files access, so a row
 * with a fallback content:// `uri` (a pick merged into it) is read through
 * that instead. Picked rows always use their URI; My Files is app storage.
 */
function readableSource(row: FileRow): string {
  if (isContentPath(row.path)) return row.path;
  if (
    row.uri !== null &&
    isContentPath(row.uri) &&
    !isInMyFiles(row.path, tryGetMyFilesRoot()) &&
    !holdsAllFilesAccess()
  ) {
    return row.uri;
  }
  return row.path;
}

/**
 * Opens the share sheet for a file. Documents read through a content:// URI
 * are first copied into the app cache (the share provider only serves app
 * files).
 */
export async function shareLibraryFile(repos: Repositories, id: number): Promise<void> {
  const row = requireRow(repos, id);
  const mime = row.mime ?? mimeForExt(row.ext) ?? '';
  const source = readableSource(row);
  if (isContentPath(source)) {
    const cached = await copyContentUriToCache(source);
    await share([cached.path], cached.mime ?? mime);
  } else {
    await share([source], mime);
  }
}

/** Opens the system print dialog for a PDF, with the file name as the job name. */
export async function printLibraryFile(repos: Repositories, id: number): Promise<void> {
  const row = requireRow(repos, id);
  if (row.ext.toLowerCase() !== 'pdf') throw new AppError('UNSUPPORTED', 'Only PDFs print');
  await printPdf(readableSource(row), row.name);
}

// Folder operations always bump: the My Files browser lists folders from
// disk and re-lists on every library change.

/** Creates a folder inside My Files. */
export function createMyFilesFolder(parent: string, name: string): Promise<FolderEntry> {
  return exclusive(async () => {
    const entry = await createFolder(parent, checkedName(name));
    bumpLibraryVersion();
    return entry;
  });
}

/** Renames a My Files folder; rows under it keep their ids. */
export function renameMyFilesFolder(
  repos: Repositories,
  path: string,
  newName: string,
): Promise<FolderEntry> {
  return exclusive(async () => {
    const name = checkedName(newName);
    const entry = await renameFolder(path, name);
    writeDb(() => repos.files.relocateUnder(path, entry.path));
    bumpLibraryVersion();
    return entry;
  });
}

/** Deletes a My Files folder with everything in it, and the rows under it. */
export function deleteMyFilesFolder(repos: Repositories, path: string): Promise<void> {
  return exclusive(async () => {
    await deleteFolder(path);
    const { grants } = writeDb(() => repos.files.removeUnder(path));
    releaseUnused(repos, grants);
    bumpLibraryVersion();
  });
}

export type ImportFailure = { uri: string; code: string };

export type ImportOutcome = {
  imported: FileRow[];
  failed: ImportFailure[];
};

/**
 * Copies picked documents into a My Files folder and adds the copies to the
 * library (source 'myfiles'). The copies are stored by path, so every
 * persisted grant the picker took is released afterwards, whatever the
 * outcome, unless a library row already used it before the pick.
 */
export function importIntoMyFiles(
  repos: Repositories,
  picked: readonly PickedDocument[],
  destDir: string,
): Promise<ImportOutcome> {
  return exclusive(async () => {
    const keep = new Set(
      picked.filter((document) => repos.files.isGrantInUse(document.uri)).map((d) => d.uri),
    );
    try {
      const results = await importDocuments(
        picked.map((document) => document.uri),
        destDir,
      );
      const failed: ImportFailure[] = [];
      const rows: NewFile[] = [];
      results.forEach((result, index) => {
        const document = picked[index];
        if (result.file === undefined) {
          failed.push({ uri: result.uri, code: result.errorCode ?? 'UNKNOWN' });
          return;
        }
        const ext = extOfName(result.file.name);
        rows.push(
          rowFromResult(result.file, {
            ext,
            mime: mimeForExt(ext) ?? document?.mime ?? null,
          }),
        );
      });
      const imported = writeDb(() => repos.files.replaceAt(rows));
      if (imported.length > 0) bumpLibraryVersion();
      return { imported, failed };
    } finally {
      for (const document of picked) {
        if (!document.persisted || keep.has(document.uri)) continue;
        try {
          releasePersistedUri(document.uri);
        } catch (error) {
          reportError(error);
        }
      }
    }
  });
}

export type ReconcileResult = { added: number; updated: number; removed: number };

/**
 * Brings the rows under My Files in line with disk: files the table lacks are
 * added, changed ones refreshed, rows whose file is gone removed (with their
 * cascades). The storage scan never covers My Files, so this is what heals
 * changes made outside the app's own actions. Only the native side's
 * in-progress work files are skipped (isTempEntry); other dot-names are real
 * files and are kept. Rows under a folder that could not be listed are left
 * alone. Bumps the library version if anything
 * changed. Rejects with an AppError only if the root cannot be listed.
 */
export function reconcileMyFiles(repos: Repositories): Promise<ReconcileResult> {
  return exclusive(async () => {
    const root = getMyFilesRoot();
    const onDisk = new Map<string, FolderEntry>();
    const unlisted: string[] = [];
    const pending = [root];
    for (let dir = pending.pop(); dir !== undefined; dir = pending.pop()) {
      let entries: FolderEntry[];
      try {
        entries = (await listFolder(dir)).entries;
      } catch (error) {
        if (dir === root) throw toAppError(error);
        unlisted.push(dir);
        continue;
      }
      for (const entry of entries) {
        if (isTempEntry(entry.name)) continue;
        if (entry.isDirectory) pending.push(entry.path);
        else onDisk.set(entry.path, entry);
      }
    }

    const known = new Map(repos.files.listUnder(root).map((row) => [row.path, row]));
    const upserts: NewFile[] = [];
    let added = 0;
    for (const [path, entry] of onDisk) {
      const row = known.get(path);
      if (row !== undefined && row.size === entry.size && row.mtime === entry.mtime) continue;
      if (row === undefined) added += 1;
      const ext = extOfName(entry.name);
      upserts.push({
        path,
        uri: null,
        name: entry.name,
        ext,
        mime: mimeForExt(ext),
        size: entry.size,
        mtime: entry.mtime,
        source: 'myfiles',
      });
    }
    const gone = [...known.keys()].filter(
      (path) => !onDisk.has(path) && !unlisted.some((dir) => path.startsWith(`${dir}/`)),
    );
    writeDb(() => repos.files.upsertMany(upserts));
    const removed = writeDb(() => repos.files.removeByPaths(gone));
    const result = { added, updated: upserts.length - added, removed };
    if (upserts.length > 0 || removed > 0) bumpLibraryVersion();
    return result;
  });
}
