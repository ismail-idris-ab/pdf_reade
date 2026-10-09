import FileIndexModule, {
  type PickedDocument,
} from '../../../modules/file-index/src/FileIndexModule';
import { toAppError } from '@/lib/errors';

import { DEFAULT_SCAN_EXTS, mimeForExt } from './classify';

/** MIME types offered by the system picker: the same document types the scan indexes. */
export const DEFAULT_PICK_MIME_TYPES: readonly string[] = DEFAULT_SCAN_EXTS.map((ext) => {
  const mime = mimeForExt(ext);
  if (mime === null) throw new Error(`No MIME type for .${ext}`);
  return mime;
});

export type PickDocumentsOptions = {
  mimeTypes?: readonly string[];
  multiple?: boolean;
  /**
   * Take persistable grants (native default: true). Pass false when the
   * documents are only read now (imports copy them): no grant is taken and
   * every result has `persisted: false`.
   */
  persist?: boolean;
};

/**
 * Opens the system document picker (works without all-files access). Resolves
 * with an empty list when the user cancels. `persisted` on each document says
 * whether a persistable read permission is held for it. Rejects with an
 * AppError; a newer call rejects a still-pending one with CANCELLED.
 */
export async function pickDocuments(options: PickDocumentsOptions = {}): Promise<PickedDocument[]> {
  const { mimeTypes = DEFAULT_PICK_MIME_TYPES, multiple = true, persist } = options;
  try {
    return await FileIndexModule.pickDocuments({
      mimeTypes: [...mimeTypes],
      multiple,
      // Omitted unless set, so the native default applies.
      ...(persist === undefined ? {} : { persist }),
    });
  } catch (error) {
    throw toAppError(error);
  }
}

/** content:// URIs the app still holds a persisted read permission for. */
export function listPersistedUris(): string[] {
  try {
    return FileIndexModule.listPersistedUris();
  } catch (error) {
    throw toAppError(error);
  }
}

/** Gives up the persisted permission for a picked URI. */
export function releasePersistedUri(uri: string): void {
  try {
    FileIndexModule.releasePersistedUri(uri);
  } catch (error) {
    throw toAppError(error);
  }
}
