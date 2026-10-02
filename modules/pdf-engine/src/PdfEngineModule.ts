import { NativeModule, requireNativeModule } from 'expo';

declare class PdfEngineNativeModule extends NativeModule {
  readonly apiVersion: number;
}

export default requireNativeModule<PdfEngineNativeModule>('PdfEngine');
