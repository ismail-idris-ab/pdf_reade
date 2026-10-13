import { router } from 'expo-router';

/** The reader route for a library file. */
export function readerHref(fileId: number) {
  return { pathname: '/reader/[fileId]', params: { fileId: String(fileId) } } as const;
}

/** The route parameter as a library row id, or null when it is not one. */
export function parseFileIdParam(value: string | string[] | undefined): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === undefined || !/^\d+$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/**
 * Longest time a push counts as in flight, ms: normally the reader clears it
 * on mount (readerOpened); this only bounds a push that never lands.
 */
export const OPEN_GUARD_MS = 1000;

// When the push now in flight started; null when none is.
let inFlightSince: number | null = null;

/**
 * Pushes the reader for `fileId`, unless a push is still in flight (the
 * reader has not mounted yet): a double tap must not stack two readers. Any
 * file opens again as soon as the previous reader has mounted.
 */
export function openReader(fileId: number, now: number = Date.now()): boolean {
  if (inFlightSince !== null && now - inFlightSince < OPEN_GUARD_MS) return false;
  inFlightSince = now;
  router.push(readerHref(fileId));
  return true;
}

/** Called by the reader on mount: the push has landed. */
export function readerOpened(): void {
  inFlightSince = null;
}

/** Forgets any push in flight (tests). */
export function resetOpenReaderGuard(): void {
  inFlightSince = null;
}
