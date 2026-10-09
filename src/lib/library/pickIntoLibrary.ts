import type { Repositories } from '@/db/repositories';
import { reportError } from '@/lib/crash';
import { toAppError } from '@/lib/errors';
import { DEFAULT_PICK_MIME_TYPES, pickDocuments, releasePersistedUri } from '@/lib/files';

import { addPickedDocuments, type AddPickedDocumentsResult } from './index';

export type PickIntoLibraryOptions = {
  now: () => number;
  fallbackName: string;
};

/**
 * Opens the system picker and adds the chosen documents to the library.
 * Resolves with null when the user cancels. If storing fails, the grants
 * taken for documents that were not already in the library are released
 * (an unused grant would only count against the per-app cap), then the
 * AppError is rethrown.
 */
export async function pickIntoLibrary(
  repos: Repositories,
  { now, fallbackName }: PickIntoLibraryOptions,
): Promise<AddPickedDocumentsResult | null> {
  const picked = await pickDocuments({ mimeTypes: DEFAULT_PICK_MIME_TYPES, multiple: true });
  if (picked.length === 0) return null;
  // In use already: as a picked row, or as a scanned row's fallback uri.
  const alreadyKept = new Set(
    picked.filter((document) => repos.files.isGrantInUse(document.uri)).map((d) => d.uri),
  );
  try {
    // Awaited here so a failure is caught below (grants released).
    return await addPickedDocuments(repos, picked, { now: now(), fallbackName });
  } catch (error) {
    for (const document of picked) {
      if (!document.persisted || alreadyKept.has(document.uri)) continue;
      try {
        releasePersistedUri(document.uri);
      } catch (releaseError) {
        reportError(releaseError);
      }
    }
    throw toAppError(error);
  }
}
