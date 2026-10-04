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
}

export default requireNativeModule<FileIndexNativeModule>('FileIndex');
