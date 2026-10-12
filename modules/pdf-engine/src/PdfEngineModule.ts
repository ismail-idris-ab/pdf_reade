import { NativeModule, requireNativeModule } from 'expo';

export type SpikeRenderResult = {
  pageCount: number;
  width: number;
  height: number;
  nonWhiteRatio: number;
  pngPath: string;
  elapsedMs: number;
};

export type SpikeMergeResult = {
  pdfboxPages: number;
  pdfboxBytes: number;
  pdfboxMs: number;
  pdfiumPages: number;
  pdfiumBytes: number;
  pdfiumMs: number;
};

export type ThumbnailRequest = {
  /** Unique per call, chosen by JS; used by `cancelThumbnail`. */
  requestId: string;
  /** Absolute file path or content:// URI. */
  source: string;
  /** Epoch milliseconds; part of the cache key. */
  mtime: number;
  /** Bytes; part of the cache key. */
  size: number;
  /** Target bitmap width in px, clamped natively to [48, 360]. */
  widthPx: number;
};

export type ThumbnailResult = {
  /** file:// URI of the cached WebP. */
  uri: string;
  width: number;
  height: number;
};

declare class PdfEngineNativeModule extends NativeModule {
  readonly apiVersion: number;
  /**
   * Renders (or returns the cached) first-page thumbnail. Rejects with
   * PASSWORD_REQUIRED, CORRUPT_FILE, NOT_FOUND, PERMISSION_DENIED, UNSUPPORTED,
   * OUT_OF_MEMORY, NO_SPACE, CANCELLED, or a non-shared code (→ UNKNOWN).
   */
  renderThumbnail(request: ThumbnailRequest): Promise<ThumbnailResult>;
  /** Drops a queued request (it rejects with CANCELLED). Never throws. */
  cancelThumbnail(requestId: string): void;
  /** T0.1b spike, dev-only. */
  spikeRender(): Promise<SpikeRenderResult>;
  /** T0.1b spike, dev-only. */
  spikeMerge(): Promise<SpikeMergeResult>;
}

export default requireNativeModule<PdfEngineNativeModule>('PdfEngine');
