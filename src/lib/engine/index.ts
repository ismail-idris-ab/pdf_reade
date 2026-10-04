import PdfEngineModule, {
  type SpikeMergeResult,
  type SpikeRenderResult,
} from '../../../modules/pdf-engine/src/PdfEngineModule';

export type { SpikeMergeResult, SpikeRenderResult };

/** Contract version reported by the native `pdf-engine` module. */
export function getPdfEngineApiVersion(): number {
  return PdfEngineModule.apiVersion;
}

/** T0.1b spike, dev-only: render page 1 of a generated fixture with PDFium. */
export function runSpikeRender(): Promise<SpikeRenderResult> {
  return PdfEngineModule.spikeRender();
}

/** T0.1b spike, dev-only: merge two fixtures with PdfBox and with PDFium. */
export function runSpikeMerge(): Promise<SpikeMergeResult> {
  return PdfEngineModule.spikeMerge();
}
