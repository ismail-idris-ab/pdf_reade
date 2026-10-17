/** Shortest gap between two throttled announcements, ms. */
export const ANNOUNCE_INTERVAL_MS = 1500;

/** A message, or a function that builds it only when it is actually announced. */
export type Announcement = string | (() => string);

const resolve = (message: Announcement) => (typeof message === 'string' ? message : message());

export type ThrottledAnnouncer = {
  /**
   * Announces now, or once the interval has passed (only the latest message
   * waits). A message equal to the last one announced is skipped. A function
   * is called only if its message is announced (never for one superseded
   * while waiting).
   */
  say: (message: Announcement) => void;
  /** Announces now, always, dropping any message still waiting. */
  sayNow: (message: string) => void;
  /** Forgets the last message and drops a waiting one (a new search starts). */
  reset: () => void;
  dispose: () => void;
};

/**
 * Screen-reader announcements that never flood: progress messages (`say`)
 * at most one per `intervalMs`, the latest winning, never the same text
 * twice in a row; final messages (`sayNow`) at once.
 */
export function createThrottledAnnouncer(
  announce: (message: string) => void,
  intervalMs = ANNOUNCE_INTERVAL_MS,
  now: () => number = Date.now,
): ThrottledAnnouncer {
  let lastAt = -Infinity;
  let lastMessage: string | null = null;
  let waiting: Announcement | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function dropWaiting() {
    waiting = null;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function emit(message: string) {
    dropWaiting();
    lastAt = now();
    lastMessage = message;
    announce(message);
  }

  function emitThrottled(message: string) {
    if (message === lastMessage) {
      dropWaiting();
      return;
    }
    emit(message);
  }

  return {
    say: (message) => {
      const wait = lastAt + intervalMs - now();
      if (wait <= 0) {
        emitThrottled(resolve(message));
        return;
      }
      waiting = message;
      timer ??= setTimeout(() => {
        timer = null;
        if (waiting !== null) emitThrottled(resolve(waiting));
      }, wait);
    },
    sayNow: emit,
    reset: () => {
      dropWaiting();
      lastMessage = null;
    },
    dispose: dropWaiting,
  };
}
