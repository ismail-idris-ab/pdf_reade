// In-memory stand-in for the native PdfEngine module. Test files install it
// with:
//   jest.mock('../../modules/pdf-engine/src/PdfEngineModule', () =>
//     jest.requireActual('../engine/fakePdfEngine').createFakePdfEngineModule());
//
// renderThumbnail requests stay pending until the test settles them with
// resolveThumbnail / rejectThumbnail (or cancelThumbnail, which rejects with
// CANCELLED like the native queue does).
import type {
  SpikeMergeResult,
  SpikeRenderResult,
  ThumbnailRequest,
  ThumbnailResult,
} from '../../modules/pdf-engine/src/PdfEngineModule';

type Pending = {
  request: ThumbnailRequest;
  resolve: (result: ThumbnailResult) => void;
  reject: (error: Error) => void;
};

export type FakePdfEngineModule = ReturnType<typeof createFakePdfEngine>;

export const codedError = (code: string, message = code) =>
  Object.assign(new Error(message), { code });

function createFakePdfEngine() {
  const pending = new Map<string, Pending>();
  // When true, cancelThumbnail does nothing (the native request was already
  // rendering), so the request can still resolve after the cell moved on.
  let cancelIsNoop = false;

  return {
    apiVersion: 2,
    setCancelIsNoop(value: boolean) {
      cancelIsNoop = value;
    },
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
    spikeRender: jest.fn<Promise<SpikeRenderResult>, []>(),
    spikeMerge: jest.fn<Promise<SpikeMergeResult>, []>(),
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
    reset() {
      pending.clear();
      cancelIsNoop = false;
    },
  };
}

export function createFakePdfEngineModule() {
  return { __esModule: true, default: createFakePdfEngine() };
}
