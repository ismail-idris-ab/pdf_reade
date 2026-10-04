import FileIndexModule, {
  type ScanBatchEvent,
  type ScanCompleteEvent,
  type ScanErrorEvent,
  type ScannedFile,
} from '../../../modules/file-index/src/FileIndexModule';
import { toAppError, type AppError } from '@/lib/errors';

export type ScanSummary = ScanCompleteEvent;

export type ScanDocumentsOptions = {
  /** Lower-case extensions without the dot. */
  exts: readonly string[];
  /** Path → mtime of files already indexed; unchanged files are not re-emitted. */
  knownMtimes: Readonly<Record<string, number>>;
  /** Called for every batch of new or changed files, in arrival order. */
  onBatch: (files: ScannedFile[]) => void;
  /** Aborting has the same effect as calling `cancel()`. */
  signal?: AbortSignal;
};

export type ScanHandle = {
  /**
   * Resolves with the native completion summary. Rejects with an AppError when
   * the scan fails or `onBatch` throws.
   */
  result: Promise<ScanSummary>;
  /**
   * Stops the scan. No further batches reach `onBatch`; `result` resolves
   * with `cancelled: true` and an empty `deleted` list, since a partial walk
   * cannot prove a file is gone.
   */
  cancel: () => void;
};

type ScanEvent =
  | { type: 'batch'; event: ScanBatchEvent }
  | { type: 'complete'; event: ScanCompleteEvent }
  | { type: 'error'; event: ScanErrorEvent };

/**
 * Walks shared storage for documents. Results stream through native events;
 * listeners are attached before `startScan` is called, and events that arrive
 * before its scan id is known are buffered per scan id and replayed, so none
 * are lost. Events of other scans are ignored. Listeners are always removed
 * once the scan settles.
 */
export function scanDocuments(options: ScanDocumentsOptions): ScanHandle {
  const { exts, knownMtimes, onBatch, signal } = options;
  const startedAt = Date.now();
  const pending = new Map<string, ScanEvent[]>();
  let scanId: string | null = null;
  let cancelRequested = false;
  let settled = false;
  let emitted = 0;

  let resolveResult: (summary: ScanSummary) => void = () => undefined;
  let rejectResult: (error: AppError) => void = () => undefined;
  const result = new Promise<ScanSummary>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });

  const subscriptions = [
    FileIndexModule.addListener('onScanBatch', (event) => receive({ type: 'batch', event })),
    FileIndexModule.addListener('onScanComplete', (event) => receive({ type: 'complete', event })),
    FileIndexModule.addListener('onScanError', (event) => receive({ type: 'error', event })),
  ];

  function cleanup() {
    settled = true;
    pending.clear();
    for (const subscription of subscriptions) subscription.remove();
    signal?.removeEventListener('abort', cancel);
  }

  function succeed(summary: ScanSummary) {
    if (settled) return;
    cleanup();
    resolveResult(summary);
  }

  function fail(error: unknown) {
    if (settled) return;
    cleanup();
    rejectResult(toAppError(error));
  }

  function cancelledSummary(id: string, base?: ScanCompleteEvent): ScanSummary {
    return {
      scanId: id,
      scanned: base?.scanned ?? emitted,
      emitted,
      deleted: [],
      skippedDirs: base?.skippedDirs ?? 0,
      durationMs: base?.durationMs ?? Date.now() - startedAt,
      cancelled: true,
    };
  }

  function handle(scanEvent: ScanEvent) {
    if (settled || scanId === null) return;
    switch (scanEvent.type) {
      case 'batch': {
        if (cancelRequested) return;
        try {
          onBatch(scanEvent.event.files);
          emitted += scanEvent.event.files.length;
        } catch (error) {
          FileIndexModule.cancelScan(scanId);
          fail(error);
        }
        return;
      }
      case 'complete': {
        const event = scanEvent.event;
        succeed(cancelRequested ? cancelledSummary(scanId, event) : event);
        return;
      }
      case 'error': {
        const { code, message } = scanEvent.event;
        if (cancelRequested && code === 'CANCELLED') {
          succeed(cancelledSummary(scanId));
          return;
        }
        fail(Object.assign(new Error(message), { code }));
        return;
      }
    }
  }

  function receive(scanEvent: ScanEvent) {
    if (settled) return;
    const id = scanEvent.event.scanId;
    if (scanId === null) {
      const queue = pending.get(id);
      if (queue) queue.push(scanEvent);
      else pending.set(id, [scanEvent]);
      return;
    }
    if (id === scanId) handle(scanEvent);
  }

  function cancel() {
    if (settled || cancelRequested) return;
    cancelRequested = true;
    if (scanId !== null) {
      try {
        FileIndexModule.cancelScan(scanId);
      } catch (error) {
        fail(error);
      }
    }
  }

  signal?.addEventListener('abort', cancel);
  if (signal?.aborted) cancel();

  let started: Promise<string>;
  try {
    started = FileIndexModule.startScan({ exts: [...exts], knownMtimes: { ...knownMtimes } });
  } catch (error) {
    fail(error);
    return { result, cancel };
  }

  started.then(
    (id) => {
      if (settled) return;
      scanId = id;
      const buffered = pending.get(id) ?? [];
      pending.clear();
      if (cancelRequested) {
        try {
          FileIndexModule.cancelScan(id);
        } catch (error) {
          fail(error);
          return;
        }
      }
      for (const scanEvent of buffered) handle(scanEvent);
    },
    (error: unknown) => fail(error),
  );

  return { result, cancel };
}
