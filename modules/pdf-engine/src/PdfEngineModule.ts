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

declare class PdfEngineNativeModule extends NativeModule {
  readonly apiVersion: number;
  /** T0.1b spike, dev-only. */
  spikeRender(): Promise<SpikeRenderResult>;
  /** T0.1b spike, dev-only. */
  spikeMerge(): Promise<SpikeMergeResult>;
}

export default requireNativeModule<PdfEngineNativeModule>('PdfEngine');
