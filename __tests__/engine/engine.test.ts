import PdfEngineModule, {
  type SearchResultEvent,
} from '../../modules/pdf-engine/src/PdfEngineModule';
import { codedError, FAKE_PAGE_COUNT, type FakePdfEngineModule } from './fakePdfEngine';
import { AppError } from '@/lib/errors';
import {
  closeDocument,
  getOutline,
  getPageText,
  getPdfEngineApiVersion,
  getTextRects,
  openDocument,
  searchDocument,
} from '@/lib/engine';

jest.mock('../../modules/pdf-engine/src/PdfEngineModule', () =>
  jest.requireActual('./fakePdfEngine').createFakePdfEngineModule(),
);

const native = PdfEngineModule as unknown as FakePdfEngineModule;

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const result = (searchId: string, page: number): SearchResultEvent => ({
  searchId,
  page,
  matches: [[{ x: 0.1, y: 0.2, width: 0.3, height: 0.04 }]],
  rotation: 90,
});

async function rejection(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) return error;
    throw new Error(`Rejected with a non-AppError: ${String(error)}`);
  }
  throw new Error('Expected a rejection');
}

beforeEach(() => {
  jest.clearAllMocks();
  native.reset();
});

describe('document wrappers', () => {
  it('reports contract version 3', () => {
    expect(getPdfEngineApiVersion()).toBe(4);
  });

  it('opens with a null password by default and passes one when given', async () => {
    const doc = await openDocument('/storage/emulated/0/Download/a.pdf');
    expect(native.open).toHaveBeenLastCalledWith(
      '/storage/emulated/0/Download/a.pdf',
      null,
      expect.any(String),
    );
    expect(doc.pageCount).toBe(FAKE_PAGE_COUNT);
    expect(doc.pages).toHaveLength(FAKE_PAGE_COUNT);

    await openDocument('content://downloads/1', { password: 'secret' });
    expect(native.open).toHaveBeenLastCalledWith(
      'content://downloads/1',
      'secret',
      expect.any(String),
    );
  });

  it('gives every open a unique openId', async () => {
    await openDocument('/a.pdf');
    await openDocument('/a.pdf');
    const [first, second] = native.open.mock.calls.map(([, , openId]) => openId);
    expect(first).not.toBe(second);
  });

  it.each([
    'PASSWORD_REQUIRED',
    'WRONG_PASSWORD',
    'CORRUPT_FILE',
    'NOT_FOUND',
    'PERMISSION_DENIED',
    'UNSUPPORTED',
    'NO_SPACE',
    'OUT_OF_MEMORY',
  ] as const)('maps an open rejection %s to the same AppError code', async (code) => {
    native.open.mockRejectedValueOnce(codedError(code));
    expect((await rejection(openDocument('/a.pdf'))).code).toBe(code);
  });

  it('maps a non-shared native code to UNKNOWN', async () => {
    native.open.mockRejectedValueOnce(codedError('ERR_PDFIUM_INIT'));
    expect((await rejection(openDocument('/a.pdf'))).code).toBe('UNKNOWN');
  });

  it('closes a document, idempotently', async () => {
    const { docId } = await openDocument('/a.pdf');
    await closeDocument(docId);
    await closeDocument(docId);
    expect(native.close).toHaveBeenCalledTimes(2);
    expect(native.openDocIds()).toEqual([]);
  });

  it('closeDocument swallows a rejection and a synchronous throw', async () => {
    native.close.mockRejectedValueOnce(codedError('ERR_BRIDGE'));
    await expect(closeDocument('doc-1')).resolves.toBeUndefined();
    native.close.mockImplementationOnce(() => {
      throw codedError('ERR_BRIDGE');
    });
    await expect(closeDocument('doc-1')).resolves.toBeUndefined();
  });

  it('passes through outline, page text and text rects', async () => {
    const outline = [{ title: 'Intro', page: 0, children: [] }];
    native.getOutline.mockResolvedValueOnce(outline);
    native.getPageText.mockResolvedValueOnce('Hello');
    const rects = { text: 'Hi', boxes: [0.1, 0.1, 0.05, 0.02, 0, 0, 0, 0], rotation: 270 as const };
    native.getTextRects.mockResolvedValueOnce(rects);

    await expect(getOutline('doc-1')).resolves.toEqual(outline);
    await expect(getPageText('doc-1', 2)).resolves.toBe('Hello');
    await expect(getTextRects('doc-1', 2)).resolves.toEqual(rects);
    expect(native.getPageText).toHaveBeenCalledWith('doc-1', 2);
    expect(native.getTextRects).toHaveBeenCalledWith('doc-1', 2);
  });

  it('wraps outline, page text and text rect rejections in AppErrors', async () => {
    native.getOutline.mockRejectedValueOnce(codedError('OUT_OF_MEMORY'));
    native.getPageText.mockRejectedValueOnce(codedError('ERR_DOC_NOT_OPEN'));
    native.getTextRects.mockRejectedValueOnce(codedError('CORRUPT_FILE'));

    expect((await rejection(getOutline('doc-1'))).code).toBe('OUT_OF_MEMORY');
    expect((await rejection(getPageText('doc-1', 0))).code).toBe('UNKNOWN');
    expect((await rejection(getTextRects('doc-1', 0))).code).toBe('CORRUPT_FILE');
  });
});

describe('openDocument cancellation', () => {
  function trackedSignal() {
    const controller = new AbortController();
    const add = jest.spyOn(controller.signal, 'addEventListener');
    const remove = jest.spyOn(controller.signal, 'removeEventListener');
    /** True when the one listener added for 'abort' was removed again. */
    const detached = () => {
      const added = add.mock.calls.filter(([type]) => type === 'abort').map(([, l]) => l);
      return added.length === 1 && remove.mock.calls.some(([, l]) => l === added[0]);
    };
    return { controller, detached };
  }

  function pendingOpenId(): string {
    const [openId, ...rest] = native.pendingOpenIds();
    if (openId === undefined || rest.length > 0) throw new Error('Expected one pending open');
    return openId;
  }

  it('rejects an already-aborted signal with CANCELLED without calling native', async () => {
    const controller = new AbortController();
    controller.abort();
    expect((await rejection(openDocument('/a.pdf', { signal: controller.signal }))).code).toBe(
      'CANCELLED',
    );
    expect(native.open).not.toHaveBeenCalled();
    expect(native.cancelOpen).not.toHaveBeenCalled();
  });

  it('abort mid-open rejects with CANCELLED, cancels the native open and detaches', async () => {
    native.setHoldOpens(true);
    const { controller, detached } = trackedSignal();
    const opening = openDocument('/a.pdf', { signal: controller.signal });
    const openId = pendingOpenId();
    expect(native.open).toHaveBeenCalledWith('/a.pdf', null, openId);

    controller.abort();
    expect((await rejection(opening)).code).toBe('CANCELLED');
    expect(native.cancelOpen).toHaveBeenCalledWith(openId);
    expect(native.pendingOpenIds()).toEqual([]);
    expect(detached()).toBe(true);
    expect(native.openDocIds()).toEqual([]);
  });

  it('closes a document whose open completes after the abort', async () => {
    native.setHoldOpens(true);
    native.cancelOpen.mockImplementationOnce(() => undefined);
    const controller = new AbortController();
    const opening = openDocument('/a.pdf', { signal: controller.signal });
    const openId = pendingOpenId();

    controller.abort();
    expect((await rejection(opening)).code).toBe('CANCELLED');

    const late = native.resolveOpen(openId);
    await flush();
    expect(native.close).toHaveBeenCalledWith(late.docId);
    expect(native.openDocIds()).toEqual([]);
  });

  it('reports CANCELLED, not a later native error, once aborted', async () => {
    native.setHoldOpens(true);
    native.cancelOpen.mockImplementationOnce(() => undefined);
    const controller = new AbortController();
    const opening = openDocument('/a.pdf', { signal: controller.signal });
    const openId = pendingOpenId();
    controller.abort();
    native.rejectOpen(openId, 'WRONG_PASSWORD');
    expect((await rejection(opening)).code).toBe('CANCELLED');
  });

  it('an open with a signal that never aborts resolves and detaches', async () => {
    native.setHoldOpens(true);
    const { controller, detached } = trackedSignal();
    const opening = openDocument('/a.pdf', { password: 'pw', signal: controller.signal });
    const openId = pendingOpenId();
    const document = native.resolveOpen(openId);

    await expect(opening).resolves.toEqual(document);
    expect(detached()).toBe(true);
    controller.abort();
    expect(native.cancelOpen).not.toHaveBeenCalled();
    expect(native.openDocIds()).toEqual([document.docId]);
  });

  it('detaches from the signal when the open fails', async () => {
    native.open.mockRejectedValueOnce(codedError('NO_SPACE'));
    const { controller, detached } = trackedSignal();
    expect((await rejection(openDocument('/a.pdf', { signal: controller.signal }))).code).toBe(
      'NO_SPACE',
    );
    expect(detached()).toBe(true);
  });

  it('detaches from the signal when native open throws synchronously', async () => {
    native.open.mockImplementationOnce(() => {
      throw codedError('ERR_INVALID_ARGUMENT');
    });
    const { controller, detached } = trackedSignal();
    expect((await rejection(openDocument('', { signal: controller.signal }))).code).toBe('UNKNOWN');
    expect(detached()).toBe(true);
  });
});

describe('searchDocument', () => {
  it('passes the query and options and subscribes before starting', () => {
    let listenersAtStart = -1;
    native.search.mockImplementationOnce(() => {
      listenersAtStart = native.listenerCount();
      return Promise.resolve({ searchId: 'search-1' });
    });
    searchDocument('doc-1', 'invoice', { matchCase: true }, {});
    expect(native.search).toHaveBeenCalledWith('doc-1', 'invoice', { matchCase: true });
    expect(listenersAtStart).toBe(3);
  });

  it('delivers results and progress, resolves with totalMatches and removes listeners', async () => {
    const onResult = jest.fn<void, [SearchResultEvent]>();
    const onProgress = jest.fn();
    const handle = searchDocument('doc-1', 'a', {}, { onResult, onProgress });
    await flush();

    native.emitSearchResult(result('search-1', 0));
    native.emitSearchProgress({ searchId: 'search-1', pagesSearched: 1, pageCount: 2 });
    native.emitSearchResult(result('search-1', 1));
    native.emitSearchProgress({ searchId: 'search-1', pagesSearched: 2, pageCount: 2 });
    native.emitSearchDone({ searchId: 'search-1', totalMatches: 2, errorCode: null });

    await expect(handle.done).resolves.toEqual({ totalMatches: 2 });
    expect(onResult.mock.calls.map(([event]) => event.page)).toEqual([0, 1]);
    expect(onResult).toHaveBeenCalledWith(result('search-1', 0));
    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(onProgress).toHaveBeenLastCalledWith({
      searchId: 'search-1',
      pagesSearched: 2,
      pageCount: 2,
    });
    expect(native.listenerCount()).toBe(0);
  });

  it('ignores events of other searches', async () => {
    const onResult = jest.fn();
    const onProgress = jest.fn();
    const handle = searchDocument('doc-1', 'a', {}, { onResult, onProgress });
    await flush();

    native.emitSearchResult(result('search-other', 0));
    native.emitSearchProgress({ searchId: 'search-other', pagesSearched: 1, pageCount: 1 });
    native.emitSearchDone({ searchId: 'search-other', totalMatches: 9, errorCode: null });
    expect(onResult).not.toHaveBeenCalled();
    expect(onProgress).not.toHaveBeenCalled();
    expect(native.listenerCount()).toBe(3);

    native.emitSearchDone({ searchId: 'search-1', totalMatches: 0, errorCode: null });
    await expect(handle.done).resolves.toEqual({ totalMatches: 0 });
  });

  it('buffers events that arrive before the search id is known, in order', async () => {
    const started = deferred<{ searchId: string }>();
    native.search.mockReturnValueOnce(started.promise);
    const delivered: string[] = [];
    const handle = searchDocument(
      'doc-1',
      'a',
      {},
      {
        onResult: (event) => delivered.push(`result:${event.page}`),
        onProgress: (event) => delivered.push(`progress:${event.pagesSearched}`),
      },
    );

    native.emitSearchResult(result('search-early', 0));
    native.emitSearchResult(result('search-foreign', 5));
    native.emitSearchProgress({ searchId: 'search-early', pagesSearched: 1, pageCount: 1 });
    native.emitSearchDone({ searchId: 'search-early', totalMatches: 1, errorCode: null });
    expect(delivered).toEqual([]);

    started.resolve({ searchId: 'search-early' });
    await expect(handle.done).resolves.toEqual({ totalMatches: 1 });
    expect(delivered).toEqual(['result:0', 'progress:1']);
    expect(native.listenerCount()).toBe(0);
  });

  it.each([
    ['OUT_OF_MEMORY', 'OUT_OF_MEMORY'],
    ['CANCELLED', 'CANCELLED'],
    ['ERR_SEARCH_FAILED', 'UNKNOWN'],
  ] as const)('rejects done when the done event carries %s', async (errorCode, expected) => {
    const handle = searchDocument('doc-1', 'a', {}, {});
    await flush();
    native.emitSearchDone({ searchId: 'search-1', totalMatches: 0, errorCode });
    expect((await rejection(handle.done)).code).toBe(expected);
    expect(native.listenerCount()).toBe(0);
  });

  it('rejects done when closing the document ends the search', async () => {
    const { docId } = await openDocument('/a.pdf');
    const handle = searchDocument(docId, 'a', {}, {});
    await flush();
    await closeDocument(docId);
    expect((await rejection(handle.done)).code).toBe('CANCELLED');
    expect(native.listenerCount()).toBe(0);
  });

  it('rejects done when the native search start rejects or throws', async () => {
    native.search.mockRejectedValueOnce(codedError('ERR_DOC_NOT_OPEN'));
    const rejected = searchDocument('doc-9', 'a', {}, {});
    expect((await rejection(rejected.done)).code).toBe('UNKNOWN');

    native.search.mockImplementationOnce(() => {
      throw codedError('OUT_OF_MEMORY');
    });
    const thrown = searchDocument('doc-9', 'a', {}, {});
    expect((await rejection(thrown.done)).code).toBe('OUT_OF_MEMORY');
    expect(native.listenerCount()).toBe(0);
  });

  it('cancel rejects with CANCELLED, stops native, removes listeners and silences handlers', async () => {
    const onResult = jest.fn();
    const handle = searchDocument('doc-1', 'a', {}, { onResult });
    await flush();

    handle.cancel();
    expect(native.cancelSearch).toHaveBeenCalledWith('search-1');
    expect(native.listenerCount()).toBe(0);
    expect((await rejection(handle.done)).code).toBe('CANCELLED');

    native.emitSearchResult(result('search-1', 0));
    expect(onResult).not.toHaveBeenCalled();
  });

  it('cancel before the search id is known stops the native search once it starts', async () => {
    const started = deferred<{ searchId: string }>();
    native.search.mockReturnValueOnce(started.promise);
    const onResult = jest.fn();
    const handle = searchDocument('doc-1', 'a', {}, { onResult });
    native.emitSearchResult(result('search-7', 0));

    handle.cancel();
    expect(native.listenerCount()).toBe(0);
    expect((await rejection(handle.done)).code).toBe('CANCELLED');
    expect(native.cancelSearch).not.toHaveBeenCalled();

    started.resolve({ searchId: 'search-7' });
    await flush();
    expect(native.cancelSearch).toHaveBeenCalledWith('search-7');
    expect(onResult).not.toHaveBeenCalled();
  });

  it('cancel is idempotent and a no-op after done', async () => {
    const first = searchDocument('doc-1', 'a', {}, {});
    await flush();
    first.cancel();
    first.cancel();
    expect(native.cancelSearch).toHaveBeenCalledTimes(1);

    const second = searchDocument('doc-1', 'b', {}, {});
    await flush();
    native.emitSearchDone({ searchId: 'search-2', totalMatches: 4, errorCode: null });
    await expect(second.done).resolves.toEqual({ totalMatches: 4 });
    second.cancel();
    expect(native.cancelSearch).toHaveBeenCalledTimes(1);
    await expect(second.done).resolves.toEqual({ totalMatches: 4 });
  });

  it('a throwing handler stops the search and rejects done', async () => {
    const handle = searchDocument(
      'doc-1',
      'a',
      {},
      {
        onResult: () => {
          throw new Error('render failed');
        },
      },
    );
    await flush();
    native.emitSearchResult(result('search-1', 0));
    expect(native.cancelSearch).toHaveBeenCalledWith('search-1');
    expect((await rejection(handle.done)).code).toBe('UNKNOWN');
    expect(native.listenerCount()).toBe(0);
  });

  it('a cancelled search left unobserved raises no unhandled rejection', async () => {
    const unhandled = jest.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const handle = searchDocument('doc-1', 'a', {}, {});
      handle.cancel();
      await flush();
      await flush();
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('leaves no listeners or running searches behind across many searches', async () => {
    for (let i = 0; i < 5; i += 1) {
      const handle = searchDocument('doc-1', `q${i}`, {}, {});
      await flush();
      if (i % 2 === 0) handle.cancel();
      else native.emitSearchDone({ searchId: `search-${i + 1}`, totalMatches: 0, errorCode: null });
      await handle.done.catch(() => undefined);
    }
    expect(native.listenerCount()).toBe(0);
    expect(native.runningSearchIds()).toEqual([]);
  });
});
