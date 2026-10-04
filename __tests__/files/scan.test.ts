import FileIndexModule, {
  type ScanCompleteEvent,
  type ScannedFile,
} from '../../modules/file-index/src/FileIndexModule';
import type { FakeFileIndexModule } from './fakeFileIndex';
import { AppError } from '@/lib/errors';
import { scanDocuments } from '@/lib/files';

jest.mock('../../modules/file-index/src/FileIndexModule', () =>
  jest.requireActual('./fakeFileIndex').createFakeFileIndexModule(),
);

const native = FileIndexModule as unknown as FakeFileIndexModule;

const file = (name: string): ScannedFile => ({
  path: `/storage/emulated/0/Download/${name}`,
  name,
  ext: 'pdf',
  size: 100,
  mtime: 1_700_000_000_000,
});

const complete = (scanId: string, overrides: Partial<ScanCompleteEvent> = {}) => ({
  scanId,
  scanned: 10,
  emitted: 2,
  deleted: ['/storage/emulated/0/Download/gone.pdf'],
  skippedDirs: 1,
  durationMs: 42,
  cancelled: false,
  ...overrides,
});

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

beforeEach(() => {
  jest.clearAllMocks();
  native.startScan.mockImplementation(() => Promise.resolve('scan-1'));
});

describe('scanDocuments', () => {
  it('passes exts and knownMtimes to startScan', async () => {
    const handle = scanDocuments({
      exts: ['pdf', 'docx'],
      knownMtimes: { '/a.pdf': 1 },
      onBatch: jest.fn(),
    });
    await flush();
    expect(native.startScan).toHaveBeenCalledWith({
      exts: ['pdf', 'docx'],
      knownMtimes: { '/a.pdf': 1 },
    });
    native.emitComplete(complete('scan-1'));
    await handle.result;
  });

  it('forwards batches in order and resolves with the completion summary', async () => {
    const onBatch = jest.fn();
    const handle = scanDocuments({ exts: ['pdf'], knownMtimes: {}, onBatch });
    await flush();
    native.emitBatch({ scanId: 'scan-1', files: [file('a.pdf')] });
    native.emitBatch({ scanId: 'scan-1', files: [file('b.pdf')] });
    native.emitComplete(complete('scan-1'));
    await expect(handle.result).resolves.toEqual(complete('scan-1'));
    expect(onBatch.mock.calls).toEqual([[[file('a.pdf')]], [[file('b.pdf')]]]);
    expect(native.listenerCount()).toBe(0);
  });

  it('subscribes before startScan and replays events that arrive before it resolves', async () => {
    const start = deferred<string>();
    native.startScan.mockImplementation(() => {
      expect(native.listenerCount()).toBe(3);
      return start.promise;
    });
    const onBatch = jest.fn();
    const handle = scanDocuments({ exts: ['pdf'], knownMtimes: {}, onBatch });

    native.emitBatch({ scanId: 'scan-7', files: [file('early.pdf')] });
    native.emitBatch({ scanId: 'other', files: [file('foreign.pdf')] });
    native.emitComplete(complete('scan-7'));
    expect(onBatch).not.toHaveBeenCalled();

    start.resolve('scan-7');
    await expect(handle.result).resolves.toEqual(complete('scan-7'));
    expect(onBatch).toHaveBeenCalledTimes(1);
    expect(onBatch).toHaveBeenCalledWith([file('early.pdf')]);
    expect(native.listenerCount()).toBe(0);
  });

  it("ignores other scans' events", async () => {
    const onBatch = jest.fn();
    const handle = scanDocuments({ exts: ['pdf'], knownMtimes: {}, onBatch });
    await flush();
    native.emitBatch({ scanId: 'other', files: [file('x.pdf')] });
    native.emitError({ scanId: 'other', code: 'NO_SPACE', message: 'boom' });
    native.emitComplete(complete('other'));
    native.emitBatch({ scanId: 'scan-1', files: [file('mine.pdf')] });
    native.emitComplete(complete('scan-1', { emitted: 1 }));
    await expect(handle.result).resolves.toEqual(complete('scan-1', { emitted: 1 }));
    expect(onBatch).toHaveBeenCalledTimes(1);
    expect(onBatch).toHaveBeenCalledWith([file('mine.pdf')]);
  });

  it('rejects with an AppError carrying the native code on onScanError', async () => {
    const handle = scanDocuments({ exts: ['pdf'], knownMtimes: {}, onBatch: jest.fn() });
    await flush();
    native.emitError({ scanId: 'scan-1', code: 'PERMISSION_DENIED', message: 'no access' });
    const error = await handle.result.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe('PERMISSION_DENIED');
    expect(native.listenerCount()).toBe(0);
  });

  it('maps unknown native codes to UNKNOWN', async () => {
    const handle = scanDocuments({ exts: ['pdf'], knownMtimes: {}, onBatch: jest.fn() });
    await flush();
    native.emitError({ scanId: 'scan-1', code: 'ERR_WEIRD', message: 'x' });
    await expect(handle.result).rejects.toMatchObject({ code: 'UNKNOWN' });
  });

  it('rejects with an AppError and removes listeners when startScan rejects', async () => {
    native.startScan.mockImplementation(() =>
      Promise.reject(Object.assign(new Error('denied'), { code: 'PERMISSION_DENIED' })),
    );
    const handle = scanDocuments({ exts: ['pdf'], knownMtimes: {}, onBatch: jest.fn() });
    await expect(handle.result).rejects.toMatchObject({
      name: 'AppError',
      code: 'PERMISSION_DENIED',
    });
    expect(native.listenerCount()).toBe(0);
  });

  it('rejects and removes listeners when startScan throws synchronously', async () => {
    native.startScan.mockImplementation(() => {
      throw new Error('bridge failure');
    });
    const handle = scanDocuments({ exts: ['pdf'], knownMtimes: {}, onBatch: jest.fn() });
    await expect(handle.result).rejects.toMatchObject({ name: 'AppError', code: 'UNKNOWN' });
    expect(native.listenerCount()).toBe(0);
  });

  it('cancels the native scan and rejects when onBatch throws', async () => {
    const onBatch = jest.fn(() => {
      throw new Error('consumer failed');
    });
    const handle = scanDocuments({ exts: ['pdf'], knownMtimes: {}, onBatch });
    await flush();
    native.emitBatch({ scanId: 'scan-1', files: [file('a.pdf')] });
    await expect(handle.result).rejects.toMatchObject({ code: 'UNKNOWN' });
    expect(native.cancelScan).toHaveBeenCalledWith('scan-1');
    expect(native.listenerCount()).toBe(0);
  });

  it('cancel() calls cancelScan, stops batches and resolves cancelled with no deletions', async () => {
    const onBatch = jest.fn();
    const handle = scanDocuments({ exts: ['pdf'], knownMtimes: {}, onBatch });
    await flush();
    native.emitBatch({ scanId: 'scan-1', files: [file('a.pdf')] });
    handle.cancel();
    expect(native.cancelScan).toHaveBeenCalledWith('scan-1');
    native.emitBatch({ scanId: 'scan-1', files: [file('late.pdf')] });
    native.emitComplete(complete('scan-1', { cancelled: true }));
    const summary = await handle.result;
    expect(summary).toMatchObject({
      scanId: 'scan-1',
      cancelled: true,
      deleted: [],
      emitted: 1,
      scanned: 10,
    });
    expect(onBatch).toHaveBeenCalledTimes(1);
    expect(native.listenerCount()).toBe(0);
  });

  it('cancel() before startScan resolves cancels as soon as the id is known', async () => {
    const start = deferred<string>();
    native.startScan.mockImplementation(() => start.promise);
    const onBatch = jest.fn();
    const handle = scanDocuments({ exts: ['pdf'], knownMtimes: {}, onBatch });
    native.emitBatch({ scanId: 'scan-9', files: [file('early.pdf')] });
    handle.cancel();
    expect(native.cancelScan).not.toHaveBeenCalled();
    start.resolve('scan-9');
    await flush();
    expect(native.cancelScan).toHaveBeenCalledWith('scan-9');
    expect(onBatch).not.toHaveBeenCalled();
    native.emitComplete(complete('scan-9', { cancelled: true }));
    await expect(handle.result).resolves.toMatchObject({ cancelled: true, deleted: [] });
    expect(native.listenerCount()).toBe(0);
  });

  it('treats a CANCELLED error after cancel() as a cancelled result', async () => {
    const handle = scanDocuments({ exts: ['pdf'], knownMtimes: {}, onBatch: jest.fn() });
    await flush();
    handle.cancel();
    native.emitError({ scanId: 'scan-1', code: 'CANCELLED', message: 'cancelled' });
    await expect(handle.result).resolves.toMatchObject({
      scanId: 'scan-1',
      cancelled: true,
      deleted: [],
      emitted: 0,
    });
    expect(native.listenerCount()).toBe(0);
  });

  it('cancels when the abort signal fires, and when it is already aborted', async () => {
    const controller = new AbortController();
    const handle = scanDocuments({
      exts: ['pdf'],
      knownMtimes: {},
      onBatch: jest.fn(),
      signal: controller.signal,
    });
    await flush();
    controller.abort();
    expect(native.cancelScan).toHaveBeenCalledWith('scan-1');
    native.emitComplete(complete('scan-1', { cancelled: true }));
    await expect(handle.result).resolves.toMatchObject({ cancelled: true });

    native.cancelScan.mockClear();
    native.startScan.mockImplementation(() => Promise.resolve('scan-2'));
    const aborted = new AbortController();
    aborted.abort();
    const second = scanDocuments({
      exts: ['pdf'],
      knownMtimes: {},
      onBatch: jest.fn(),
      signal: aborted.signal,
    });
    await flush();
    expect(native.cancelScan).toHaveBeenCalledWith('scan-2');
    native.emitComplete(complete('scan-2', { cancelled: true }));
    await expect(second.result).resolves.toMatchObject({ cancelled: true });
    expect(native.listenerCount()).toBe(0);
  });

  it('ignores cancel() after the scan settled', async () => {
    const handle = scanDocuments({ exts: ['pdf'], knownMtimes: {}, onBatch: jest.fn() });
    await flush();
    native.emitComplete(complete('scan-1'));
    await handle.result;
    handle.cancel();
    expect(native.cancelScan).not.toHaveBeenCalled();
  });
});
