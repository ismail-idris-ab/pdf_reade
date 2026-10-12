import FileIndexModule, {
  type DocumentCapabilities,
  type FileOpResult,
  type FolderEntry,
  type FolderListing,
  type FolderStats,
  type ImportResult,
} from '../../../modules/file-index/src/FileIndexModule';
import { toAppError } from '@/lib/errors';

import { classifySource } from './classify';

export type {
  DocumentCapabilities,
  FileOpResult,
  FolderEntry,
  FolderListing,
  FolderStats,
  ImportResult,
};

// File actions (file-index apiVersion 4). Every wrapper rejects with an
// AppError. The native module also rejects with codes outside the shared
// ERROR_CODES list (ERR_NAME_INVALID, ERR_NAME_EXISTS, ERR_DUPLICATE_LEFT,
// ERR_FILE_OP_FAILED, …); those become UNKNOWN AppErrors
// whose `cause` keeps the native error, and fileOpErrorKind tells the ones
// with their own message apart.

/** Native code for an invalid name (see validateFileName for the rules). */
export const ERR_NAME_INVALID = 'ERR_NAME_INVALID';
/** Native code for a rename onto an existing entry. */
export const ERR_NAME_EXISTS = 'ERR_NAME_EXISTS';
/**
 * Native code for a move that copied the file to its destination but could
 * not remove the original: two copies now exist.
 */
export const ERR_DUPLICATE_LEFT = 'ERR_DUPLICATE_LEFT';
/** Longest file or folder name the native side accepts, in UTF-8 bytes. */
export const MAX_NAME_BYTES = 255;

/** A failure the rename / new-folder dialogs show inline instead of as a toast. */
export type NameErrorKind = 'nameInvalid' | 'nameExists';

/** Native failures with their own message (see fileOpErrorKind). */
export type FileOpErrorKind = NameErrorKind | 'duplicateLeft';

/** Whether a kind is a name error (shown inline in the name dialogs). */
export function isNameErrorKind(kind: FileOpErrorKind | null): kind is NameErrorKind {
  return kind === 'nameInvalid' || kind === 'nameExists';
}

function codeOf(value: unknown): string | null {
  const code = (value as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : null;
}

/**
 * The native error code behind an error from these wrappers, including codes
 * outside the shared list (an AppError keeps the native error as `cause`).
 */
export function nativeErrorCode(error: unknown): string | null {
  const own = codeOf(error);
  if (own !== null && own !== 'UNKNOWN') return own;
  const cause = (error as { cause?: unknown } | null)?.cause;
  return codeOf(cause) ?? own;
}

/**
 * The kind of a native failure that has its own message: the name errors
 * and a move that left a duplicate. Null for everything else (shared codes,
 * ERR_FILE_OP_FAILED…).
 */
export function fileOpErrorKind(error: unknown): FileOpErrorKind | null {
  const code = nativeErrorCode(error);
  if (code === ERR_NAME_INVALID) return 'nameInvalid';
  if (code === ERR_NAME_EXISTS) return 'nameExists';
  if (code === ERR_DUPLICATE_LEFT) return 'duplicateLeft';
  return null;
}

function utf8Length(text: string): number {
  let bytes = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
}

export type NameProblem = 'empty' | 'invalidChars' | 'leadingDot' | 'tooLong';

/** Characters the native side refuses in names: \ / : * ? " < > | and control characters. */
const FORBIDDEN_NAME_CHARS = /[\\/:*?"<>|\u0000-\u001f\u007f]/;

/**
 * Client-side mirror of the native name rules, so dialogs can explain a
 * problem before calling native. Native trims surrounding whitespace and
 * validates the trimmed name, so callers pass the trimmed name too. Names
 * starting with "." (including "." and "..") are refused: hidden entries are
 * not listed, so such a file would become unreachable. Null when valid.
 */
export function validateFileName(name: string): NameProblem | null {
  if (name === '') return 'empty';
  if (FORBIDDEN_NAME_CHARS.test(name)) return 'invalidChars';
  if (name.startsWith('.')) return 'leadingDot';
  if (utf8Length(name) > MAX_NAME_BYTES) return 'tooLong';
  return null;
}

// Native work files, mirroring NameRules.isTempName in Kotlin:
// ".<name>.tmp-<stamp>-<rand>" (atomic copy), ".rename-<stamp>-<rand>"
// (two-step rename) and its ".rename-<stamp>-<rand>.orig" journal.
const RENAME_PREFIX = '.rename-';
const TEMP_MARKER = '.tmp-';

/**
 * Whether a folder entry is one of the native side's in-progress work files.
 * Only those are hidden from listings; any other entry is shown, even one
 * whose name starts with "." (e.g. created by another app), so nothing that
 * is really there becomes unreachable.
 */
export function isTempEntry(name: string): boolean {
  return name.startsWith(RENAME_PREFIX) || (name.startsWith('.') && name.includes(TEMP_MARKER));
}

/**
 * Splits a name into base and extension (with its dot), like the native
 * side: only the last dot counts, and a leading or trailing dot is not an
 * extension.
 */
export function splitExtension(name: string): { base: string; ext: string } {
  const dot = name.lastIndexOf('.');
  return dot > 0 && dot < name.length - 1
    ? { base: name.slice(0, dot), ext: name.slice(dot) }
    : { base: name, ext: '' };
}

/**
 * The name a file rename will really use: a file keeps its extension, so
 * when the new name lacks the original extension (or has another one) the
 * original is appended ("Report" → "Report.pdf"). The comparison ignores
 * case, so "report.PDF" stays as typed.
 */
export function keepExtension(newName: string, originalName: string): string {
  const { ext } = splitExtension(originalName);
  if (ext === '' || newName.toLowerCase().endsWith(ext.toLowerCase())) return newName;
  return `${newName}${ext}`;
}

async function call<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw toAppError(error);
  }
}

/** Absolute path of the app-private My Files root (created if missing). */
export function getMyFilesRoot(): string {
  try {
    return FileIndexModule.getMyFilesRoot();
  } catch (error) {
    throw toAppError(error);
  }
}

/** The My Files root, or null if the native module cannot give it. */
export function tryGetMyFilesRoot(): string | null {
  try {
    return FileIndexModule.getMyFilesRoot();
  } catch {
    return null;
  }
}

/**
 * Whether a path lies inside My Files (the root itself or anything under
 * it). Matches the native root when known, and the classifier's My Files
 * locations either way.
 */
export function isInMyFiles(path: string, root: string | null): boolean {
  if (root !== null && (path === root || path.startsWith(`${root}/`))) return true;
  return classifySource(path) === 'myfiles';
}

/** Renames a file in place; `newName` is a bare file name. */
export function renameFile(path: string, newName: string): Promise<FileOpResult> {
  return call(() => FileIndexModule.renameFile(path, newName));
}

/** Moves a file into `destDir`; a name clash gets a " (1)" suffix. */
export function moveFile(path: string, destDir: string): Promise<FileOpResult> {
  return call(() => FileIndexModule.moveFile(path, destDir));
}

/** Copies a file into `destDir` (same folder: "Name (copy).ext"). */
export function copyFile(path: string, destDir: string): Promise<FileOpResult> {
  return call(() => FileIndexModule.copyFile(path, destDir));
}

/** Permanently deletes a file. */
export function deleteFile(path: string): Promise<void> {
  return call(() => FileIndexModule.deleteFile(path));
}

/** Direct children of a folder inside My Files. */
export function listFolder(path: string): Promise<FolderListing> {
  return call(() => FileIndexModule.listFolder(path));
}

/** File / folder counts and total size under a folder inside My Files. */
export function folderStats(path: string): Promise<FolderStats> {
  return call(() => FileIndexModule.folderStats(path));
}

export function createFolder(parent: string, name: string): Promise<FolderEntry> {
  return call(() => FileIndexModule.createFolder(parent, name));
}

export function renameFolder(path: string, newName: string): Promise<FolderEntry> {
  return call(() => FileIndexModule.renameFolder(path, newName));
}

/** Deletes a folder and everything in it (never the My Files root). */
export function deleteFolder(path: string): Promise<void> {
  return call(() => FileIndexModule.deleteFolder(path));
}

/** Copies picked documents into `destDir` (inside My Files); per-item results. */
export function importDocuments(uris: readonly string[], destDir: string): Promise<ImportResult[]> {
  return call(() => FileIndexModule.importDocuments([...uris], destDir));
}

const NO_CAPABILITIES: DocumentCapabilities = { canRename: false, canDelete: false };

/** What the provider allows for a persisted content:// document. Never rejects. */
export async function documentCapabilities(uri: string): Promise<DocumentCapabilities> {
  try {
    return await FileIndexModule.documentCapabilities(uri);
  } catch {
    // The contract says this never throws; if it does, offer nothing.
    return NO_CAPABILITIES;
  }
}

export type RenameDocumentResult = {
  /** The URI that is live now, with a persisted grant (may differ from the old one). */
  uri: string;
  /** The document's name now (the original one when `renamed` is false). */
  name: string;
  /** False when the provider could not keep access under the new name. */
  renamed: boolean;
};

/**
 * Renames a content:// document. Always resolves with the live URI; when the
 * provider could not keep access under the new name it is renamed back and
 * `renamed` is false. Rejects (ERR_FILE_OP_FAILED) only when no live URI
 * with a persisted grant can be established.
 */
export function renameDocument(uri: string, newName: string): Promise<RenameDocumentResult> {
  return call(() => FileIndexModule.renameDocument(uri, newName));
}

/** Deletes a content:// document through its provider. */
export function deleteDocument(uri: string): Promise<void> {
  return call(() => FileIndexModule.deleteDocument(uri));
}

/** Opens the system print dialog for a PDF (path or content:// URI). */
export function printPdf(source: string, jobName: string): Promise<void> {
  return call(() => FileIndexModule.printPdf(source, jobName));
}
