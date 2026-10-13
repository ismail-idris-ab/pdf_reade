// In-memory stand-in for the native PdfEngine module. Test files install it
// with:
//   jest.mock('../../modules/pdf-engine/src/PdfEngineModule', () =>
//     jest.requireActual('../engine/fakePdfEngine').createFakePdfEngineModule());
//
// renderThumbnail requests stay pending until the test settles them with
// resolveThumbnail / rejectThumbnail (or cancelThumbnail, which rejects with
// CANCELLED like the native queue does).
//
// Reading (apiVersion 3): `open` resolves a document with FAKE_PAGE_COUNT
// pages and a fresh docId (`openDocIds` lists the ones not yet closed).
// After `setHoldOpens(true)` opens stay pending until `resolveOpen` /
// `rejectOpen` (or `cancelOpen`, which rejects with CANCELLED).
// `getOutline` / `getPageText` / `getTextRects` answer empty content. `search`
// resolves a fresh searchId and emits nothing: the test drives it with
// emitSearchResult / emitSearchProgress / emitSearchDone. `cancelSearch` and
// `close` end a running search with a CANCELLED done event, like natively.
// Every method is a jest.fn, so tests can override single calls (e.g.
// `mockRejectedValueOnce(codedError('WRONG_PASSWORD'))`).
import type {
  OpenedDocument,
  OutlineItem,
  PageTextRects,
  PdfEngineEvents,
  SearchDoneEvent,
  SearchOptions,
  SearchProgressEvent,
  SearchResultEvent,
  SearchStarted,
  ThumbnailRequest,
  ThumbnailResult,
} from '../../modules/pdf-engine/src/PdfEngineModule';

type Pending = {
  request: ThumbnailRequest;
  resolve: (result: ThumbnailResult) => void;
  reject: (error: Error) => void;
};

type PendingOpen = {
  resolve: (document: OpenedDocument) => void;
  reject: (error: Error) => void;
};

type Listeners = { [K in keyof PdfEngineEvents]: Set<PdfEngineEvents[K]> };

export type FakePdfEngineModule = ReturnType<typeof createFakePdfEngine>;

export const codedError = (code: string, message = code) =>
  Object.assign(new Error(message), { code });

/** Page count of documents the default `open` returns. */
export const FAKE_PAGE_COUNT = 3;

function createFakePdfEngine() {
  const pending = new Map<string, Pending>();
  const listeners: Listeners = {
    onSearchResult: new Set(),
    onSearchProgress: new Set(),
    onSearchDone: new Set(),
  };
  const openDocs = new Set<string>();
  const pendingOpens = new Map<string, PendingOpen>();
  let holdOpens = false;
  // searchId → docId of searches that have not emitted their done event.
  const runningSearches = new Map<string, string>();
  let nextDoc = 1;
  let nextSearch = 1;
  // When true, cancelThumbnail does nothing (the native request was already
  // rendering), so the request can still resolve after the cell moved on.
  let cancelIsNoop = false;

  function addListener<K extends keyof PdfEngineEvents>(name: K, listener: PdfEngineEvents[K]) {
    (listeners[name] as Set<PdfEngineEvents[K]>).add(listener);
    return {
      remove: () => {
        (listeners[name] as Set<PdfEngineEvents[K]>).delete(listener);
      },
    };
  }

  function emit<K extends keyof PdfEngineEvents>(
    name: K,
    event: Parameters<PdfEngineEvents[K]>[0],
  ) {
    for (const listener of [...listeners[name]]) {
      (listener as (payload: typeof event) => void)(event);
    }
  }

  function emitSearchDone(event: SearchDoneEvent) {
    runningSearches.delete(event.searchId);
    emit('onSearchDone', event);
  }

  function openNow(): OpenedDocument {
    const docId = `doc-${nextDoc++}`;
    openDocs.add(docId);
    return {
      docId,
      pageCount: FAKE_PAGE_COUNT,
      pages: Array.from({ length: FAKE_PAGE_COUNT }, () => ({ width: 612, height: 792 })),
      isEncrypted: false,
    };
  }

  function takePendingOpen(openId: string): PendingOpen {
    const entry = pendingOpens.get(openId);
    if (!entry) throw new Error(`No pending open ${openId}`);
    pendingOpens.delete(openId);
    return entry;
  }

  function cancelRunning(searchId: string) {
    if (!runningSearches.has(searchId)) return;
    emitSearchDone({ searchId, totalMatches: 0, errorCode: 'CANCELLED' });
  }

  return {
    apiVersion: 4,
    setCancelIsNoop(value: boolean) {
      cancelIsNoop = value;
    },
    addListener: jest.fn(addListener),
    renderThumbnail: jest.fn<Promise<ThumbnailResult>, [ThumbnailRequest]>(
      (request) =>
        new Promise<ThumbnailResult>((resolve, reject) => {
          pending.set(request.requestId, { request, resolve, reject });
        }),
    ),
    cancelThumbnail: jest.fn<void, [string]>((requestId) => {
      if (cancelIsNoop) return;
      const entry = pending.get(requestId);
      if (!entry) return;
      pending.delete(requestId);
      entry.reject(codedError('CANCELLED'));
    }),
    open: jest.fn<Promise<OpenedDocument>, [string, string | null, string]>(
      (_source, _password, openId) => {
        if (!holdOpens) return Promise.resolve(openNow());
        return new Promise<OpenedDocument>((resolve, reject) => {
          pendingOpens.set(openId, { resolve, reject });
        });
      },
    ),
    cancelOpen: jest.fn<void, [string]>((openId) => {
      const entry = pendingOpens.get(openId);
      if (!entry) return;
      pendingOpens.delete(openId);
      entry.reject(codedError('CANCELLED'));
    }),
    close: jest.fn<Promise<void>, [string]>((docId) => {
      openDocs.delete(docId);
      for (const [searchId, owner] of [...runningSearches]) {
        if (owner === docId) cancelRunning(searchId);
      }
      return Promise.resolve();
    }),
    getOutline: jest.fn<Promise<OutlineItem[]>, [string]>(() => Promise.resolve([])),
    getPageText: jest.fn<Promise<string>, [string, number]>(() => Promise.resolve('')),
    getTextRects: jest.fn<Promise<PageTextRects>, [string, number]>(() =>
      Promise.resolve({ text: '', boxes: [], rotation: 0 }),
    ),
    search: jest.fn<Promise<SearchStarted>, [string, string, SearchOptions]>((docId) => {
      const searchId = `search-${nextSearch++}`;
      runningSearches.set(searchId, docId);
      return Promise.resolve({ searchId });
    }),
    cancelSearch: jest.fn<void, [string]>((searchId) => cancelRunning(searchId)),
    /** Requests not yet settled, oldest first. */
    pendingRequests(): ThumbnailRequest[] {
      return [...pending.values()].map((entry) => entry.request);
    },
    resolveThumbnail(requestId: string, uri = `file:///cache/thumbs/${requestId}.webp`) {
      const entry = pending.get(requestId);
      if (!entry) throw new Error(`No pending thumbnail ${requestId}`);
      pending.delete(requestId);
      entry.resolve({ uri, width: entry.request.widthPx, height: entry.request.widthPx });
    },
    rejectThumbnail(requestId: string, code: string) {
      const entry = pending.get(requestId);
      if (!entry) throw new Error(`No pending thumbnail ${requestId}`);
      pending.delete(requestId);
      entry.reject(codedError(code));
    },
    /** Resolves every pending request. */
    resolveAll() {
      for (const id of [...pending.keys()]) this.resolveThumbnail(id);
    },
    setHoldOpens(value: boolean) {
      holdOpens = value;
    },
    /** openIds of held opens not yet settled, oldest first. */
    pendingOpenIds(): string[] {
      return [...pendingOpens.keys()];
    },
    /** Completes a held open with a fresh document and returns it. */
    resolveOpen(openId: string): OpenedDocument {
      const document = openNow();
      takePendingOpen(openId).resolve(document);
      return document;
    },
    rejectOpen(openId: string, code: string) {
      takePendingOpen(openId).reject(codedError(code));
    },
    emitSearchResult(event: SearchResultEvent) {
      emit('onSearchResult', event);
    },
    emitSearchProgress(event: SearchProgressEvent) {
      emit('onSearchProgress', event);
    },
    emitSearchDone,
    /** Number of attached event listeners, across all events. */
    listenerCount(): number {
      return Object.values(listeners).reduce((sum, set) => sum + set.size, 0);
    },
    /** docIds opened and not yet closed. */
    openDocIds(): string[] {
      return [...openDocs];
    },
    /** searchIds started and not yet done. */
    runningSearchIds(): string[] {
      return [...runningSearches.keys()];
    },
    reset() {
      pending.clear();
      cancelIsNoop = false;
      for (const set of Object.values(listeners)) set.clear();
      openDocs.clear();
      pendingOpens.clear();
      holdOpens = false;
      runningSearches.clear();
      nextDoc = 1;
      nextSearch = 1;
    },
  };
}

export function createFakePdfEngineModule() {
  return { __esModule: true, PDF_ENGINE_API_VERSION: 4, default: createFakePdfEngine() };
}
