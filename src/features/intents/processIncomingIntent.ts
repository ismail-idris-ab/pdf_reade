import type { IncomingIntent } from '../../../modules/file-index/src/FileIndexModule';
import type { Repositories } from '@/db/repositories';
import type { FileRow, NewFile } from '@/db/types';

import { AppError, toAppError } from '@/lib/errors';
import {
  type CachedContent,
  copyContentUriToCache,
  extForMime,
  mimeForExt,
  stat,
} from '@/lib/files';
import { bumpLibraryVersion, exclusive } from '@/lib/library';

import type { IntentRouteTarget, ReceivedImage } from './types';

export type ProcessIntentOptions = {
  /** Epoch ms used for a cached file's mtime (the cache has no original one). */
  now: () => number;
  /** Localized name shown instead of a provider-less `CachedContent.name`. */
  fallbackName: string;
};

/**
 * One handed-over file, however it arrived: a `content://` URI copied into
 * the cache, or a `file://` URI that already names a path we can read.
 */
type ResolvedFile = {
  content: CachedContent;
  /** The file's own mtime; null for a cache copy, which has none of its own. */
  mtime: number | null;
};

const FILE_SCHEME = 'file://';

/** True for a URI that already names a readable filesystem path. */
function isFileUri(uri: string): boolean {
  return uri.toLowerCase().startsWith(FILE_SCHEME);
}

/** `file:///a/b%20c.pdf` → `/a/b c.pdf`. */
function pathFromFileUri(uri: string): string {
  const withoutScheme = uri.slice(FILE_SCHEME.length);
  const withoutQuery = withoutScheme.split(/[?#]/)[0] ?? '';
  try {
    return decodeURIComponent(withoutQuery);
  } catch {
    // A stray % that is not an escape: the raw path is the best we have.
    return withoutQuery;
  }
}

function extFromName(name: string): string | null {
  const match = /\.([A-Za-z0-9]{1,10})$/.exec(name);
  return match?.[1]?.toLowerCase() ?? null;
}

/**
 * Describes a `file://` hand-off without copying it: the path is already a
 * real one, and it depends on no transient grant, so the row can point
 * straight at it. Its own mtime is kept, which also lets the dedupe match a
 * row the scan already indexed for the same file.
 */
async function resolveFileUri(uri: string): Promise<ResolvedFile> {
  const path = pathFromFileUri(uri);
  const info = await stat(path);
  if (!info.exists || !info.isFile) throw new AppError('NOT_FOUND');
  const name = path.slice(path.lastIndexOf('/') + 1);
  const ext = extFromName(name);
  return {
    content: {
      path,
      name,
      // A path's own basename is as authoritative as a provider's name.
      nameFromProvider: true,
      size: info.size,
      mime: ext === null ? null : mimeForExt(ext),
    },
    mtime: info.mtime,
  };
}

// A known MIME type wins; otherwise a known extension in the name; else null
// (not a document type this app indexes).
function documentExt(content: CachedContent): string | null {
  if (content.mime) {
    const fromMime = extForMime(content.mime);
    if (fromMime) return fromMime;
  }
  const fromName = extFromName(content.name);
  return fromName !== null && mimeForExt(fromName) !== null ? fromName : null;
}

function isImage(content: CachedContent): boolean {
  return content.mime !== null && content.mime.startsWith('image/');
}

// Shows a localized fallback instead of the native fallback name
// ("document[.ext]") the provider-less case already carries in `name`.
function displayName(content: CachedContent, fallbackName: string): string {
  return content.nameFromProvider ? content.name : fallbackName;
}

/**
 * Resolves every URI in `intent`: a `content://` one is copied into the app
 * cache, because its grant is transient (see IncomingIntent), while a
 * `file://` one already names a path we can read and is used where it lies.
 * Each is then classified as a document this app indexes or an image, and
 * the documents are stored in the library while images are handed off for
 * Image→PDF (T3.4, not built yet). Mixed batches (some documents, some
 * images) and any file that is neither are rejected as UNSUPPORTED: the
 * native intent filters only ever send one kind at a time, so this only
 * fires for a MIME type this app does not handle at all.
 *
 * Rejects with an AppError (including UNSUPPORTED, NOT_FOUND for a
 * `file://` path that is gone, and whatever copyContentUriToCache rejects
 * with — NOT_FOUND, PERMISSION_DENIED, NO_SPACE, CANCELLED). Callers show
 * it; see handleIncomingIntent.
 */
export async function processIncomingIntent(
  repos: Repositories,
  intent: IncomingIntent,
  options: ProcessIntentOptions,
): Promise<IntentRouteTarget> {
  const resolved: ResolvedFile[] = [];
  for (const uri of intent.uris) {
    // Sequential and awaited: a failed copy must not leave a later one
    // half-started, and the sender's grants are good for only a short time.
    resolved.push(
      isFileUri(uri)
        ? await resolveFileUri(uri)
        : { content: await copyContentUriToCache(uri), mtime: null },
    );
  }

  const documents: { file: ResolvedFile; ext: string }[] = [];
  const images: CachedContent[] = [];
  for (const file of resolved) {
    const ext = documentExt(file.content);
    if (ext !== null) documents.push({ file, ext });
    else if (isImage(file.content)) images.push(file.content);
    else throw new AppError('UNSUPPORTED');
  }

  if (images.length > 0) {
    if (documents.length > 0) throw new AppError('UNSUPPORTED');
    const receivedImages: ReceivedImage[] = images.map((content) => ({
      path: content.path,
      name: displayName(content, options.fallbackName),
      size: content.size,
    }));
    return { type: 'imageToPdf', images: receivedImages };
  }

  const rows = await storeDocuments(repos, documents, options);
  return rows.length === 1
    ? { type: 'open', fileId: rows[0]!.id }
    : { type: 'library', firstFileId: rows[0]!.id };
}

/**
 * Inserts the documents into the library by path with `uri` null — the cache
 * path for a copied `content://` hand-off, the file's own path for a
 * `file://` one — and never by the original content:// URI, whose grant is
 * transient and already gone (see the library rule in
 * src/lib/library/index.ts). A copy
 * already matching an indexed row by name and size (findByNameSize) is not
 * re-inserted: its existing row is reused instead, so the same document
 * never ends up listed twice. Runs as one task on the shared library queue
 * (exclusive), so it cannot interleave with a scan, a pick or a file action.
 */
function storeDocuments(
  repos: Repositories,
  documents: readonly { file: ResolvedFile; ext: string }[],
  { now, fallbackName }: ProcessIntentOptions,
): Promise<FileRow[]> {
  return exclusive(() => {
    try {
      // Rows already in the library keep their place; the rest are collected
      // and written in a single upsertMany, which is one transaction. Writing
      // them one at a time would leave the first documents of a failing batch
      // committed and the rest missing.
      const slots: ({ existing: FileRow } | { pending: NewFile })[] = [];
      for (const { file, ext } of documents) {
        const { content, mtime } = file;
        const name = displayName(content, fallbackName);
        const existing = repos.files.findByNameSize(name, content.size, mtime);
        if (existing) {
          slots.push({ existing });
          continue;
        }
        slots.push({
          pending: {
            path: content.path,
            // Critical: a transient grant, never the original content:// URI
            // (see the T1.2/T1.3 library rule) — prunePickedDocuments must
            // never see this row as a picked one.
            uri: null,
            name,
            ext,
            mime: content.mime ?? mimeForExt(ext),
            size: content.size,
            // A file:// hand-off keeps its own mtime; a cache copy has none.
            mtime: mtime ?? now(),
            source: 'device',
          },
        });
      }

      const pending = slots.flatMap((slot) => ('pending' in slot ? [slot.pending] : []));
      const inserted = pending.length > 0 ? repos.files.upsertMany(pending) : [];
      let next = 0;
      const rows = slots.map((slot) => ('existing' in slot ? slot.existing : inserted[next++]!));

      if (inserted.length > 0) bumpLibraryVersion();
      return rows;
    } catch (error) {
      throw toAppError(error);
    }
  });
}
