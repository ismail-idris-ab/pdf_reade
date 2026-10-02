import PdfEngineModule from '../../../modules/pdf-engine/src/PdfEngineModule';

/** Contract version reported by the native `pdf-engine` module. */
export function getPdfEngineApiVersion(): number {
  return PdfEngineModule.apiVersion;
}
