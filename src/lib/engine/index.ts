import PdfEngineModule, {
  type SpikeMergeResult,
  type SpikeRenderResult,
  type ThumbnailRequest,
  type ThumbnailResult,
} from '../../../modules/pdf-engine/src/PdfEngineModule';
import { toAppError } from '@/lib/errors';

export type { SpikeMergeResult, SpikeRenderResult, ThumbnailRequest, ThumbnailResult };

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

/** T0.1b spike, dev-only: render page 1 of a generated fixture with PDFium. */
export function runSpikeRender(): Promise<SpikeRenderResult> {
  return PdfEngineModule.spikeRender();
}

/** T0.1b spike, dev-only: merge two fixtures with PdfBox and with PDFium. */
export function runSpikeMerge(): Promise<SpikeMergeResult> {
  return PdfEngineModule.spikeMerge();
}
