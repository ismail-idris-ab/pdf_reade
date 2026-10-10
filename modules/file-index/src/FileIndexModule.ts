import { NativeModule, requireNativeModule } from 'expo';

/** A document found on storage by a scan. `mtime` is epoch milliseconds. */
export type ScannedFile = {
  path: string;
  name: string;
  ext: string;
  size: number;
  mtime: number;
};

export type ScanBatchEvent = {
  scanId: string;
  files: ScannedFile[];
};

export type ScanCompleteEvent = {
  scanId: string;
  /** Files with a matching extension that the walk visited. */
  scanned: number;
  /** Files reported through `onScanBatch` (new or changed since `knownMtimes`). */
  emitted: number;
  /** Paths from `knownMtimes` that no longer exist. */
  deleted: string[];
  /** Directories the walk skipped. */
  skippedDirs: number;
  durationMs: number;
  cancelled: boolean;
};

export type ScanErrorEvent = {
  scanId: string;
  code: string;
  message: string;
};

export type StartScanOptions = {
  /** Lower-case extensions without the dot, e.g. `pdf`. */
  exts: string[];
  /** Path → mtime of files already indexed; unchanged files are not re-emitted. */
  knownMtimes: Record<string, number>;
};

export type FileStat = {
  exists: boolean;
  isFile: boolean;
  size: number;
  mtime: number;
};

export type CachedContent = {
  path: string;
  /** Cleaned file name on disk; a fallback ("document[.ext]") when the provider gave none. */
  name: string;
  /** False when `name` is the fallback: show a localized label instead. */
  nameFromProvider: boolean;
  /** Bytes actually copied. */
  size: number;
  mime: string | null;
};

export type PickDocumentsOptions = {
  /** MIME types the system picker offers, e.g. `application/pdf`. */
  mimeTypes: string[];
  multiple: boolean;
  /**
   * Take persistable grants (default true). Imports pass false: they copy the
   * files right away, so they must not use up the system's grant cap.
   * With false, every result has `persisted: false` and is readable only now.
   */
  persist?: boolean;
};

/**
 * A document chosen in the system picker (Storage Access Framework). Provider
 * metadata may be missing; `mtime` is epoch milliseconds.
 */
export type PickedDocument = {
  uri: string;
  name: string | null;
  size: number | null;
  mime: string | null;
  mtime: number | null;
  /**
   * Whether a persistable read permission is held for `uri`. False when the
   * provider refused it: the URI is readable only for now.
   */
  persisted: boolean;
};

/** Result of a file operation: where the file now lives, with fresh metadata. */
export type FileOpResult = {
  path: string;
  name: string;
  size: number;
  /** Epoch milliseconds. */
  mtime: number;
};

export type FolderEntry = {
  path: string;
  name: string;
  isDirectory: boolean;
  /** Bytes; 0 for directories. */
  size: number;
  mtime: number;
};

export type FolderListing = {
  path: string;
  entries: FolderEntry[];
};

export type FolderStats = {
  /** Files (not directories) anywhere under the folder. */
  fileCount: number;
  /** Directories under the folder, not counting the folder itself. */
  folderCount: number;
  totalBytes: number;
};

export type ImportResult = {
  /** The source URI, in request order. */
  uri: string;
  /** Present when the copy succeeded. */
  file?: FileOpResult;
  /** Error code when it failed (shared code or a non-shared ERR_*). */
  errorCode?: string;
};

export type DocumentCapabilities = {
  canRename: boolean;
  canDelete: boolean;
};

export type SharedWriteAccessResult = 'granted' | 'denied' | 'blocked';

export type FileIndexEvents = {
  onScanBatch: (event: ScanBatchEvent) => void;
  onScanComplete: (event: ScanCompleteEvent) => void;
  onScanError: (event: ScanErrorEvent) => void;
};

declare class FileIndexNativeModule extends NativeModule<FileIndexEvents> {
  readonly apiVersion: number;
  hasAllFilesAccess(): boolean;
  openAllFilesAccessSettings(): Promise<void>;
  /** Resolves with the scan id; results arrive through the scan events. */
  startScan(options: StartScanOptions): Promise<string>;
  cancelScan(scanId: string): void;
  stat(path: string): Promise<FileStat>;
  copyContentUriToCache(uri: string): Promise<CachedContent>;
  share(paths: string[], mime: string): Promise<void>;
  /**
   * Resolves with an empty list when the user cancels. A new call rejects a
   * still-pending one with CANCELLED.
   */
  pickDocuments(options: PickDocumentsOptions): Promise<PickedDocument[]>;
  /** content:// URIs the app still holds a persisted permission for. */
  listPersistedUris(): string[];
  /** Gives up the persisted permission for a URI. Never throws. */
  releasePersistedUri(uri: string): void;

  // ── Shared-storage write access (apiVersion 5) ───────────────────────────
  /**
   * Whether file actions on shared storage (rename, move, copy, delete) are
   * allowed right now: all-files access on Android 11+, the legacy
   * WRITE_EXTERNAL_STORAGE runtime permission on Android 8–10.
   */
  hasSharedWriteAccess(): boolean;
  /**
   * Android 8–10: shows the system prompt for WRITE_EXTERNAL_STORAGE.
   * 'blocked' = denied with "don't ask again" (only Settings can grant it).
   * Android 11+: never prompts; resolves 'granted' or 'denied' from
   * all-files access (the UI sends users to openAllFilesAccessSettings).
   */
  requestSharedWriteAccess(): Promise<SharedWriteAccessResult>;

  // ── File actions (apiVersion 4) ──────────────────────────────────────────
  // Paths must lie inside shared storage or the My Files root; anything else
  // rejects with PERMISSION_DENIED. Names are trimmed, then validated natively:
  // rejects with ERR_NAME_INVALID (empty, leading ".", "/", "\", control chars,
  // : * ? " < > |, > 255 UTF-8 bytes) or ERR_NAME_EXISTS (rename onto an
  // existing entry). Other rejections: NOT_FOUND, PERMISSION_DENIED, NO_SPACE,
  // UNSUPPORTED, OUT_OF_MEMORY, ERR_DUPLICATE_LEFT (a move/copy failed and its
  // new copy could not be removed: two copies exist), ERR_FILE_OP_FAILED;
  // printPdf adds ERR_NO_ACTIVITY and ERR_PRINT_FAILED.

  /** Absolute path of the app-private My Files root (created if missing). */
  getMyFilesRoot(): string;
  /** Renames in place; `newName` is a bare file name. */
  renameFile(path: string, newName: string): Promise<FileOpResult>;
  /** Moves into `destDir`, suffixing " (1)", " (2)"… on a name clash. Atomic. */
  moveFile(path: string, destDir: string): Promise<FileOpResult>;
  /**
   * Copies into `destDir` (atomic: temp → fsync → size check → rename).
   * Same directory → "Name (copy).ext", then " (copy 2)"… on clash.
   */
  copyFile(path: string, destDir: string): Promise<FileOpResult>;
  /** Permanently deletes a file. */
  deleteFile(path: string): Promise<void>;
  /** Folder operations; only allowed inside the My Files root. */
  listFolder(path: string): Promise<FolderListing>;
  folderStats(path: string): Promise<FolderStats>;
  createFolder(parent: string, name: string): Promise<FolderEntry>;
  renameFolder(path: string, newName: string): Promise<FolderEntry>;
  /** Deletes the folder and everything in it. The My Files root itself is refused. */
  deleteFolder(path: string): Promise<void>;
  /** Copies picked documents into `destDir` (inside My Files); per-item results. */
  importDocuments(uris: string[], destDir: string): Promise<ImportResult[]>;
  /** What the provider allows for a persisted content:// document. Never throws. */
  documentCapabilities(uri: string): Promise<DocumentCapabilities>;
  /**
   * Renames a content:// document. Always resolves with the URI that is live
   * now and holds a persisted grant (the caller must store it and drop the old
   * one when it differs). `renamed: false` means the provider could not keep
   * access under the new name, so the document was renamed back: `name` is the
   * original name and the UI should offer "Copy to My Files". Rejects
   * (ERR_FILE_OP_FAILED) only when no live, persisted URI can be established.
   */
  renameDocument(
    uri: string,
    newName: string,
  ): Promise<{ uri: string; name: string; renamed: boolean }>;
  /** Deletes a content:// document through its provider. */
  deleteDocument(uri: string): Promise<void>;
  /** Opens the system print dialog for a PDF (path or content:// URI). */
  printPdf(source: string, jobName: string): Promise<void>;
}

export default requireNativeModule<FileIndexNativeModule>('FileIndex');
