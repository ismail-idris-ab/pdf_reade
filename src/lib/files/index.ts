import FileIndexModule, {
  type CachedContent,
  type FileStat,
  type PickedDocument,
  type ScannedFile,
} from '../../../modules/file-index/src/FileIndexModule';
import { toAppError } from '@/lib/errors';

export type { CachedContent, FileStat, PickedDocument, ScannedFile };
export {
  useAllFilesAccess,
  useAllFilesAccessStore,
  type AllFilesAccess,
  type AllFilesAccessState,
} from './access';
export {
  APP_PACKAGE,
  DEFAULT_SCAN_EXTS,
  MY_FILES_DIR_NAME,
  SCANS_DIR_NAME,
  classifySource,
  extForMime,
  mimeForExt,
  toNewFile,
} from './classify';
export { EXT_GROUPS, GROUP_EXTS, GROUPED_EXTS, extGroupOf, type ExtGroup } from './extGroups';
export {
  DEFAULT_PICK_MIME_TYPES,
  listPersistedUris,
  pickDocuments,
  releasePersistedUri,
  type PickDocumentsOptions,
} from './picker';
export {
  scanDocuments,
  type ScanDocumentsOptions,
  type ScanHandle,
  type ScanSummary,
} from './scan';

/** Contract version reported by the native `file-index` module. */
export function getFileIndexApiVersion(): number {
  return FileIndexModule.apiVersion;
}

/** Whether the app holds MANAGE_EXTERNAL_STORAGE (all-files access). */
export function hasAllFilesAccess(): boolean {
  try {
    return FileIndexModule.hasAllFilesAccess();
  } catch (error) {
    throw toAppError(error);
  }
}

/** Opens the system screen where the user grants all-files access. */
export async function openAllFilesAccessSettings(): Promise<void> {
  try {
    await FileIndexModule.openAllFilesAccessSettings();
  } catch (error) {
    throw toAppError(error);
  }
}

/** Existence, type, size and mtime (epoch ms) of a path. */
export async function stat(path: string): Promise<FileStat> {
  try {
    return await FileIndexModule.stat(path);
  } catch (error) {
    throw toAppError(error);
  }
}

/** Copies a content:// document into the app cache and returns the copy. */
export async function copyContentUriToCache(uri: string): Promise<CachedContent> {
  try {
    return await FileIndexModule.copyContentUriToCache(uri);
  } catch (error) {
    throw toAppError(error);
  }
}

/** Opens the system share sheet for the given files through the FileProvider. */
export async function share(paths: readonly string[], mime: string): Promise<void> {
  try {
    await FileIndexModule.share([...paths], mime);
  } catch (error) {
    throw toAppError(error);
  }
}
