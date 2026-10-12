import { act, renderHook } from '@testing-library/react-native';

import PdfEngineModule from '../../modules/pdf-engine/src/PdfEngineModule';
import type { FakePdfEngineModule } from '../engine/fakePdfEngine';
import {
  clearThumbnailMemo,
  markThumbnailBroken,
  useThumbnail,
  type ThumbnailSource,
} from '@/features/library/useThumbnail';
import { cancelThumbnail, getPdfEngineApiVersion, renderThumbnail } from '@/lib/engine';
import { AppError } from '@/lib/errors';

jest.mock('../../modules/pdf-engine/src/PdfEngineModule', () =>
  jest.requireActual('../engine/fakePdfEngine').createFakePdfEngineModule(),
);

const native = PdfEngineModule as unknown as FakePdfEngineModule;

const doc = (name: string, mtime = 1_000): ThumbnailSource => ({
  path: `/storage/emulated/0/Download/${name}`,
  mtime,
  size: 2_000,
});

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

beforeEach(() => {
  jest.clearAllMocks();
  native.reset();
  clearThumbnailMemo();
});

describe('engine thumbnail wrappers', () => {
  it('reports the v2 contract', () => {
    expect(getPdfEngineApiVersion()).toBe(2);
  });

  it('passes the request through and normalises rejections to AppError', async () => {
    const request = { requestId: 'r1', source: '/a.pdf', mtime: 1, size: 2, widthPx: 120 };
    const pending = renderThumbnail(request);
    expect(native.renderThumbnail).toHaveBeenCalledWith(request);
    native.rejectThumbnail('r1', 'CORRUPT_FILE');
    await expect(pending).rejects.toEqual(expect.objectContaining({ code: 'CORRUPT_FILE' }));
    await expect(pending).rejects.toBeInstanceOf(AppError);

    const odd = renderThumbnail({ ...request, requestId: 'r2' });
    native.rejectThumbnail('r2', 'ERR_SOMETHING_NATIVE');
    await expect(odd).rejects.toMatchObject({ code: 'UNKNOWN' });
  });

  it('cancelThumbnail rejects the queued request with CANCELLED', async () => {
    const pending = renderThumbnail({
      requestId: 'r3',
      source: '/a.pdf',
      mtime: 1,
      size: 2,
      widthPx: 120,
    });
    cancelThumbnail('r3');
    await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' });
  });
});

describe('useThumbnail', () => {
  it('is idle for files without thumbnails and never calls the engine', async () => {
    const { result } = await renderHook(() => useThumbnail(null, 100));
    expect(result.current).toEqual({ kind: 'none' });
    expect(native.renderThumbnail).not.toHaveBeenCalled();
  });

  it('loads, then shows the URI; a remount reuses it without a new request', async () => {
    const file = doc('a.pdf');
    const first = await renderHook(() => useThumbnail(file, 120));
    expect(first.result.current).toEqual({ kind: 'loading' });
    const [request] = native.pendingRequests();
    expect(request).toMatchObject({
      source: file.path,
      mtime: file.mtime,
      size: file.size,
      widthPx: 120,
    });
    await act(async () => native.resolveThumbnail(request?.requestId ?? '', 'file:///t/a.webp'));
    expect(first.result.current).toMatchObject({ kind: 'ready', uri: 'file:///t/a.webp' });
    await first.unmount();
    // Settled requests are not cancelled.
    expect(native.cancelThumbnail).not.toHaveBeenCalled();

    const second = await renderHook(() => useThumbnail(file, 120));
    expect(second.result.current).toMatchObject({ kind: 'ready', uri: 'file:///t/a.webp' });
    expect(native.renderThumbnail).toHaveBeenCalledTimes(1);
  });

  it('uses a unique request id per request and a new one when the file changed', async () => {
    const { rerender } = await renderHook(
      ({ file }: { file: ThumbnailSource }) => useThumbnail(file, 120),
      {
        initialProps: { file: doc('a.pdf') },
      },
    );
    await rerender({ file: doc('a.pdf', 2_000) });
    const ids = native.renderThumbnail.mock.calls.map(([request]) => request.requestId);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    // The stale request was cancelled when the cell moved on.
    expect(native.cancelThumbnail).toHaveBeenCalledWith(ids[0]);
  });

  it('cancels a pending request on unmount and ignores the CANCELLED rejection', async () => {
    const file = doc('b.pdf');
    const hook = await renderHook(() => useThumbnail(file, 120));
    const [request] = native.pendingRequests();
    await hook.unmount();
    expect(native.cancelThumbnail).toHaveBeenCalledWith(request?.requestId);
    await act(flush);

    // CANCELLED is not remembered as a failure: the next mount asks again.
    const again = await renderHook(() => useThumbnail(file, 120));
    expect(again.result.current).toEqual({ kind: 'loading' });
    expect(native.renderThumbnail).toHaveBeenCalledTimes(2);
  });

  it('remembers locked and failed files for the session', async () => {
    const locked = doc('locked.pdf');
    const broken = doc('broken.pdf');
    const a = await renderHook(() => useThumbnail(locked, 120));
    const b = await renderHook(() => useThumbnail(broken, 120));
    const [lockedRequest, brokenRequest] = native.pendingRequests();
    await act(async () => {
      native.rejectThumbnail(lockedRequest?.requestId ?? '', 'PASSWORD_REQUIRED');
      native.rejectThumbnail(brokenRequest?.requestId ?? '', 'CORRUPT_FILE');
      await flush();
    });
    expect(a.result.current).toEqual({ kind: 'locked' });
    expect(b.result.current).toEqual({ kind: 'failed' });
    await a.unmount();
    await b.unmount();

    const again = await renderHook(() => [useThumbnail(locked, 120), useThumbnail(broken, 120)]);
    expect(again.result.current).toEqual([{ kind: 'locked' }, { kind: 'failed' }]);
    expect(native.renderThumbnail).toHaveBeenCalledTimes(2);
  });

  it('turns an unexpected engine error into failed instead of throwing', async () => {
    const hook = await renderHook(() => useThumbnail(doc('odd.pdf'), 120));
    const [request] = native.pendingRequests();
    await act(async () => {
      native.rejectThumbnail(request?.requestId ?? '', 'ERR_WEIRD');
      await flush();
    });
    expect(hook.result.current).toEqual({ kind: 'failed' });
  });

  it('remembers missing files but retries transient failures on the next mount', async () => {
    const gone = doc('gone.pdf');
    const busy = doc('busy.pdf');
    const a = await renderHook(() => useThumbnail(gone, 120));
    const b = await renderHook(() => useThumbnail(busy, 120));
    const [goneRequest, busyRequest] = native.pendingRequests();
    await act(async () => {
      native.rejectThumbnail(goneRequest?.requestId ?? '', 'NOT_FOUND');
      native.rejectThumbnail(busyRequest?.requestId ?? '', 'OUT_OF_MEMORY');
      await flush();
    });
    // Both show the type icon for now.
    expect(a.result.current).toEqual({ kind: 'failed' });
    expect(b.result.current).toEqual({ kind: 'failed' });
    await a.unmount();
    await b.unmount();

    const again = await renderHook(() => [useThumbnail(gone, 120), useThumbnail(busy, 120)]);
    expect(again.result.current).toEqual([{ kind: 'failed' }, { kind: 'loading' }]);
    expect(native.renderThumbnail).toHaveBeenCalledTimes(3);
  });

  it.each(['NO_SPACE', 'PERMISSION_DENIED', 'ERR_WEIRD'])('retries after %s', async (code) => {
    const file = doc(`${code}.pdf`);
    const first = await renderHook(() => useThumbnail(file, 120));
    const [request] = native.pendingRequests();
    await act(async () => {
      native.rejectThumbnail(request?.requestId ?? '', code);
      await flush();
    });
    await first.unmount();
    const second = await renderHook(() => useThumbnail(file, 120));
    expect(second.result.current).toEqual({ kind: 'loading' });
  });

  it('re-requests once after a cached image fails to load, then gives up', async () => {
    const file = doc('decode.pdf');
    const first = await renderHook(() => useThumbnail(file, 120));
    await act(async () => native.resolveAll());
    const ready = first.result.current;
    if (ready.kind !== 'ready') throw new Error('expected ready');
    markThumbnailBroken(ready.key);
    await first.unmount();

    const second = await renderHook(() => useThumbnail(file, 120));
    expect(second.result.current).toEqual({ kind: 'loading' });
    expect(native.renderThumbnail).toHaveBeenCalledTimes(2);
    await act(async () => native.resolveAll());
    const readyAgain = second.result.current;
    if (readyAgain.kind !== 'ready') throw new Error('expected ready');
    markThumbnailBroken(readyAgain.key);
    await second.unmount();

    const third = await renderHook(() => useThumbnail(file, 120));
    expect(third.result.current).toEqual({ kind: 'failed' });
    expect(native.renderThumbnail).toHaveBeenCalledTimes(2);
  });

  it('never shows a stale result after the cell moved on to another file', async () => {
    native.setCancelIsNoop(true);
    const { result, rerender } = await renderHook(
      ({ file }: { file: ThumbnailSource }) => useThumbnail(file, 120),
      { initialProps: { file: doc('old.pdf') } },
    );
    const [oldRequest] = native.pendingRequests();
    await rerender({ file: doc('new.pdf') });
    expect(native.cancelThumbnail).toHaveBeenCalledWith(oldRequest?.requestId);

    await act(async () => {
      native.resolveThumbnail(oldRequest?.requestId ?? '', 'file:///t/old.webp');
      await flush();
    });
    expect(result.current).toEqual({ kind: 'loading' });

    const newRequest = native.pendingRequests()[0];
    await act(async () => {
      native.resolveThumbnail(newRequest?.requestId ?? '', 'file:///t/new.webp');
      await flush();
    });
    expect(result.current).toMatchObject({ kind: 'ready', uri: 'file:///t/new.webp' });
  });
});
