import PdfEngineModule, {
  type NormalizedRect,
  type OpenedDocument,
  type OutlineItem,
  type PageInfo,
  type PageRotation,
  type PageTextRects,
  type SearchDoneEvent,
  type SearchOptions,
  type SearchProgressEvent,
  type SearchResultEvent,
  type SearchStarted,
  type ThumbnailRequest,
  type ThumbnailResult,
} from '../../../modules/pdf-engine/src/PdfEngineModule';
import { AppError, toAppError } from '@/lib/errors';

export {
  PdfPageView,
  type PageRenderedEvent,
  type PageRenderErrorEvent,
  type PdfPageViewProps,
} from '../../../modules/pdf-engine/src/PdfPageView';
export { PageView, pageRenderError, type PageViewProps } from './PageView';

export type {
  NormalizedRect,
  OpenedDocument,
  OutlineItem,
  PageInfo,
  PageRotation,
  PageTextRects,
  SearchDoneEvent,
  SearchOptions,
  SearchProgressEvent,
  SearchResultEvent,
  ThumbnailRequest,
  ThumbnailResult,
};

/** Contract version reported by the native `pdf-engine` module. */
export function getPdfEngineApiVersion(): number {
  return PdfEngineModule.apiVersion;
}

/**
 * Renders (or returns the natively cached) first-page thumbnail of a PDF as a
 * file:// WebP. Rejects with an AppError: PASSWORD_REQUIRED, CORRUPT_FILE,
 * NOT_FOUND, PERMISSION_DENIED, UNSUPPORTED, OUT_OF_MEMORY, NO_SPACE,
 * CANCELLED (after cancelThumbnail), or UNKNOWN.
 */
export async function renderThumbnail(request: ThumbnailRequest): Promise<ThumbnailResult> {
  try {
    return await PdfEngineModule.renderThumbnail(request);
  } catch (error) {
    throw toAppError(error);
  }
}

/** Drops a queued thumbnail request; its promise rejects with CANCELLED. */
export function cancelThumbnail(requestId: string): void {
  try {
    PdfEngineModule.cancelThumbnail(requestId);
  } catch (error) {
    throw toAppError(error);
  }
}

export type OpenDocumentOptions = {
  /** Omitted or empty means none. */
  password?: string;
  /** Aborting stops the open; the promise rejects with CANCELLED. */
  signal?: AbortSignal;
};

let openCounter = 0;

function nextOpenId(): string {
  openCounter += 1;
  return `open-${Date.now().toString(36)}-${openCounter}`;
}

function cancelNativeOpen(openId: string) {
  try {
    PdfEngineModule.cancelOpen(openId);
  } catch {
    // Never throws by contract; the open is already abandoned on this side.
  }
}

/**
 * Opens a PDF for reading. `source` is an absolute path, a file:// URI or a
 * content:// URI. The returned `docId` must be released with `closeDocument`.
 * Rejects with an AppError: PASSWORD_REQUIRED (no password given),
 * WRONG_PASSWORD (password rejected), CORRUPT_FILE, NOT_FOUND,
 * PERMISSION_DENIED, UNSUPPORTED, NO_SPACE, OUT_OF_MEMORY, CANCELLED, or
 * UNKNOWN.
 *
 * Aborting `signal` rejects with CANCELLED at once and stops the native open.
 * A signal that is already aborted never reaches native, so no file is copied.
 * If the native open still completes after the abort, the document is closed
 * again, so nothing leaks.
 */
export function openDocument(
  source: string,
  options: OpenDocumentOptions = {},
): Promise<OpenedDocument> {
  const { password, signal } = options;
  if (signal?.aborted) return Promise.reject(new AppError('CANCELLED'));
  const openId = nextOpenId();

  return new Promise<OpenedDocument>((resolve, reject) => {
    let settled = false;

    function settle() {
      settled = true;
      signal?.removeEventListener('abort', onAbort);
    }

    function onAbort() {
      if (settled) return;
      settle();
      cancelNativeOpen(openId);
      reject(new AppError('CANCELLED'));
    }

    signal?.addEventListener('abort', onAbort);

    let started: Promise<OpenedDocument>;
    try {
      started = PdfEngineModule.open(source, password ?? null, openId);
    } catch (error) {
      settle();
      reject(toAppError(error));
      return;
    }

    started.then(
      (document) => {
        if (settled) {
          void closeDocument(document.docId);
          return;
        }
        settle();
        resolve(document);
      },
      (error: unknown) => {
        if (settled) return;
        settle();
        reject(toAppError(error));
      },
    );
  });
}

/**
 * Releases a document opened with `openDocument` and cancels its running
 * search. Idempotent and never rejects, so it is safe in unmount cleanup.
 */
export async function closeDocument(docId: string): Promise<void> {
  try {
    await PdfEngineModule.close(docId);
  } catch {
    // Native close never rejects by contract; there is nothing left to release
    // or to tell the user if the bridge itself fails here.
  }
}

/** The document's outline (bookmarks) tree; [] when it has none. Rejects with an AppError. */
export async function getOutline(docId: string): Promise<OutlineItem[]> {
  try {
    return await PdfEngineModule.getOutline(docId);
  } catch (error) {
    throw toAppError(error);
  }
}

/** Plain text of one page (0-based). Rejects with an AppError. */
export async function getPageText(docId: string, page: number): Promise<string> {
  try {
    return await PdfEngineModule.getPageText(docId, page);
  } catch (error) {
    throw toAppError(error);
  }
}

/** Page text plus one normalized box per character, for selection. Rejects with an AppError. */
export async function getTextRects(docId: string, page: number): Promise<PageTextRects> {
  try {
    return await PdfEngineModule.getTextRects(docId, page);
  } catch (error) {
    throw toAppError(error);
  }
}

export type SearchHandlers = {
  /** A page with matches, in page order. */
  onResult?: (event: SearchResultEvent) => void;
  /** Pages searched so far. */
  onProgress?: (event: SearchProgressEvent) => void;
};

export type SearchSummary = {
  totalMatches: number;
};

export type SearchHandle = {
  /**
   * Resolves when the whole document has been searched. Rejects with an
   * AppError: CANCELLED (after `cancel()` or when the document is closed),
   * OUT_OF_MEMORY, or UNKNOWN. When a handler throws, the search stops and
   * `done` rejects with that error passed through `toAppError`: an AppError
   * keeps its code, anything else becomes UNKNOWN with the thrown value as
   * `cause`. A rejection the caller never observes is not reported as
   * unhandled.
   */
  done: Promise<SearchSummary>;
  /**
   * Stops the search: no further handler calls, `done` rejects with
   * CANCELLED at once. Idempotent, and a no-op once `done` has settled.
   */
  cancel: () => void;
};

type SearchEvent =
  | { type: 'result'; event: SearchResultEvent }
  | { type: 'progress'; event: SearchProgressEvent }
  | { type: 'done'; event: SearchDoneEvent };

/**
 * Searches the whole document, streaming matches to `handlers`. Listeners are
 * attached before the native search starts; events that arrive before its
 * search id is known are buffered and replayed, and events of other searches
 * are ignored. Listeners are always removed once the search settles or is
 * cancelled.
 */
export function searchDocument(
  docId: string,
  query: string,
  options: SearchOptions,
  handlers: SearchHandlers,
): SearchHandle {
  const pending = new Map<string, SearchEvent[]>();
  let searchId: string | null = null;
  let settled = false;

  let resolveDone: (summary: SearchSummary) => void = () => undefined;
  let rejectDone: (error: AppError) => void = () => undefined;
  const done = new Promise<SearchSummary>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });
  done.catch(() => undefined);

  const subscriptions = [
    PdfEngineModule.addListener('onSearchResult', (event) => receive({ type: 'result', event })),
    PdfEngineModule.addListener('onSearchProgress', (event) =>
      receive({ type: 'progress', event }),
    ),
    PdfEngineModule.addListener('onSearchDone', (event) => receive({ type: 'done', event })),
  ];

  function cleanup() {
    settled = true;
    pending.clear();
    for (const subscription of subscriptions) subscription.remove();
  }

  function succeed(summary: SearchSummary) {
    if (settled) return;
    cleanup();
    resolveDone(summary);
  }

  function fail(error: unknown) {
    if (settled) return;
    cleanup();
    rejectDone(toAppError(error));
  }

  function stopNative(id: string) {
    try {
      PdfEngineModule.cancelSearch(id);
    } catch {
      // Never throws by contract; the search is already abandoned on this side.
    }
  }

  function handle(searchEvent: SearchEvent) {
    if (settled || searchId === null) return;
    switch (searchEvent.type) {
      case 'result':
      case 'progress': {
        try {
          if (searchEvent.type === 'result') handlers.onResult?.(searchEvent.event);
          else handlers.onProgress?.(searchEvent.event);
        } catch (error) {
          // Settle first: the native CANCELLED done event must not win.
          const id = searchId;
          fail(error);
          stopNative(id);
        }
        return;
      }
      case 'done': {
        const { errorCode, totalMatches } = searchEvent.event;
        if (errorCode === null) succeed({ totalMatches });
        else fail(Object.assign(new Error(errorCode), { code: errorCode }));
        return;
      }
    }
  }

  function receive(searchEvent: SearchEvent) {
    if (settled) return;
    const id = searchEvent.event.searchId;
    if (searchId === null) {
      const queue = pending.get(id);
      if (queue) queue.push(searchEvent);
      else pending.set(id, [searchEvent]);
      return;
    }
    if (id === searchId) handle(searchEvent);
  }

  function cancel() {
    if (settled) return;
    const id = searchId;
    fail(new AppError('CANCELLED'));
    // Before the id is known, the start callback below stops the native search.
    if (id !== null) stopNative(id);
  }

  let started: Promise<SearchStarted>;
  try {
    started = PdfEngineModule.search(docId, query, options);
  } catch (error) {
    fail(error);
    return { done, cancel };
  }

  started.then(
    (result) => {
      if (settled) {
        stopNative(result.searchId);
        return;
      }
      searchId = result.searchId;
      const buffered = pending.get(result.searchId) ?? [];
      pending.clear();
      for (const searchEvent of buffered) handle(searchEvent);
    },
    (error: unknown) => fail(error),
  );

  return { done, cancel };
}
