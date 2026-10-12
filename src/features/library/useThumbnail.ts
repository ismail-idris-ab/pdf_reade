import { useEffect, useState } from 'react';

import { reportError } from '@/lib/crash';
import { cancelThumbnail, renderThumbnail } from '@/lib/engine';
import { toAppError, type AppErrorCode } from '@/lib/errors';

/** What a thumbnail slot shows. */
export type ThumbnailState =
  | { kind: 'none' }
  | { kind: 'loading' }
  /** `key` identifies the request, for markThumbnailBroken. */
  | { kind: 'ready'; uri: string; key: string }
  /** Password-protected PDF: show a lock instead. */
  | { kind: 'locked' }
  /** Could not be rendered (damaged, missing, out of memory...): show the type icon. */
  | { kind: 'failed' };

/** Identity of the file version a thumbnail is for. */
export type ThumbnailSource = { path: string; mtime: number; size: number };

/** Small insertion-ordered LRU map. */
class LruMap<V> {
  private readonly map = new Map<string, V>();

  constructor(private readonly capacity: number) {}

  get(key: string): V | undefined {
    const value = this.map.get(key);
    if (value !== undefined) {
      this.map.delete(key);
      this.map.set(key, value);
    }
    return value;
  }

  set(key: string, value: V): void {
    this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.capacity) {
      const oldest = this.map.keys().next();
      if (oldest.done) break;
      this.map.delete(oldest.value);
    }
  }

  delete(key: string): void {
    this.map.delete(key);
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  clear(): void {
    this.map.clear();
  }
}

// key → file:// URI of the natively cached WebP, so a remounted (or recycled)
// cell shows its thumbnail on the first frame without a bridge round trip.
const uris = new LruMap<string>(500);
// key → failure kind for this session, so scrolling past a damaged or locked
// PDF does not ask the engine again. A changed file (mtime/size) has a new key.
const failures = new LruMap<'locked' | 'failed'>(2000);
// Keys whose cached image failed to decode once; a second failure is final.
const brokenOnce = new LruMap<true>(2000);

/**
 * Failures that describe the file itself, remembered for the session. Others
 * (OUT_OF_MEMORY, NO_SPACE, PERMISSION_DENIED, UNKNOWN) can pass, so they show
 * the type icon for now and are retried on the next mount.
 */
const LASTING_FAILURES: Partial<Record<AppErrorCode, 'locked' | 'failed'>> = {
  PASSWORD_REQUIRED: 'locked',
  CORRUPT_FILE: 'failed',
  UNSUPPORTED: 'failed',
  NOT_FOUND: 'failed',
};

const NONE: ThumbnailState = { kind: 'none' };
const LOADING: ThumbnailState = { kind: 'loading' };
const LOCKED: ThumbnailState = { kind: 'locked' };
const FAILED: ThumbnailState = { kind: 'failed' };

let nextRequest = 0;

function thumbnailKey(file: ThumbnailSource, widthPx: number): string {
  return `${file.path}\u0000${file.mtime}\u0000${file.size}\u0000${widthPx}`;
}

function lookup(key: string): ThumbnailState {
  const uri = uris.get(key);
  if (uri !== undefined) return { kind: 'ready', uri, key };
  const failure = failures.get(key);
  if (failure === 'locked') return LOCKED;
  if (failure === 'failed') return FAILED;
  return LOADING;
}

/**
 * The image at a ready thumbnail's URI could not be shown (e.g. the cached
 * file was evicted or is damaged): forget the URI so the next mount asks the
 * engine again, once; if that image fails too, the file stays 'failed' for
 * the session.
 */
export function markThumbnailBroken(key: string): void {
  uris.delete(key);
  if (brokenOnce.has(key)) failures.set(key, 'failed');
  else brokenOnce.set(key, true);
}

/** Test hook: forgets every cached URI and failure. */
export function clearThumbnailMemo(): void {
  uris.clear();
  failures.clear();
  brokenOnce.clear();
}

/**
 * First-page thumbnail of a PDF at `widthPx` physical pixels. Pass null for
 * files that have no thumbnail (non-PDFs). Each request has a unique id and is
 * cancelled when the cell unmounts or is recycled for another file; CANCELLED
 * is ignored, and a result arriving after the cell moved on is cached but
 * never shown there. Never throws: failures become 'locked'
 * (PASSWORD_REQUIRED) or 'failed' (every other code; see LASTING_FAILURES for
 * which are remembered; unexpected ones go to crash reporting).
 */
export function useThumbnail(file: ThumbnailSource | null, widthPx: number): ThumbnailState {
  const path = file?.path ?? null;
  const mtime = file?.mtime ?? 0;
  const size = file?.size ?? 0;
  const key = path === null ? null : thumbnailKey({ path, mtime, size }, widthPx);
  const [settled, setSettled] = useState<{ key: string; state: ThumbnailState } | null>(null);

  useEffect(() => {
    if (key === null || path === null) return;
    if (lookup(key).kind !== 'loading') return;

    nextRequest += 1;
    const requestId = `thumb-${nextRequest}`;
    let active = true;
    let pending = true;

    renderThumbnail({ requestId, source: path, mtime, size, widthPx }).then(
      (result) => {
        pending = false;
        uris.set(key, result.uri);
        if (active) setSettled({ key, state: { kind: 'ready', uri: result.uri, key } });
      },
      (error: unknown) => {
        pending = false;
        const { code } = toAppError(error);
        if (code === 'CANCELLED') return;
        // Expected file problems (locked, damaged...) are filtered out there.
        reportError(error);
        const lasting = LASTING_FAILURES[code];
        if (lasting !== undefined) failures.set(key, lasting);
        if (active) setSettled({ key, state: lasting === 'locked' ? LOCKED : FAILED });
      },
    );

    return () => {
      active = false;
      if (!pending) return;
      try {
        cancelThumbnail(requestId);
      } catch (error) {
        reportError(error);
      }
    };
  }, [key, path, mtime, size, widthPx]);

  if (key === null) return NONE;
  if (settled?.key === key) return settled.state;
  return lookup(key);
}
