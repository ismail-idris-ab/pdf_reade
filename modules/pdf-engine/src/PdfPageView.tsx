import { requireNativeView } from 'expo';
import type { NativeSyntheticEvent, ViewProps } from 'react-native';

export type PageRenderedEvent = {
  /** 0-based page the bitmap shows. */
  page: number;
  /** Size of the bitmap now on screen, in pixels (after any memory cap). */
  widthPx: number;
  heightPx: number;
  /** Wall-clock render time on the PDFium thread, in ms. */
  ms: number;
};

export type PageRenderErrorEvent = {
  /** 0-based page that failed. */
  page: number;
  /**
   * CORRUPT_FILE (the page cannot be loaded), OUT_OF_MEMORY (no bitmap even
   * at the lowest scale), or a non-shared code that JS maps to UNKNOWN
   * (ERR_DOC_NOT_OPEN after close, ERR_INVALID_ARGUMENT for a bad page,
   * ERR_RENDER_FAILED).
   */
  code: string;
};

export type PdfPageViewProps = ViewProps & {
  /** Document from `open`; the view never opens or closes documents. */
  docId: string;
  /** 0-based page index. */
  page: number;
  /**
   * Bitmap pixels per layout dp. Pass the screen density for 1× (PixelRatio.get());
   * T2.4 passes zoom × density. The native side lowers it when the bitmap
   * would exceed its memory caps, and reports the result in onRendered.
   */
  renderScale: number;
  /** Draw inverted (dark paper, light ink). Applied at draw time; no re-render. */
  nightMode?: boolean;
  /** Draw with a warm paper tint. Applied at draw time; no re-render. Ignored when nightMode. */
  sepia?: boolean;
  /**
   * Change this value (e.g. increment it) to render the current docId/page
   * again after onRenderError, for a "Try again" action. Re-sending unchanged
   * props does not retry.
   */
  retryToken?: number;
  /**
   * Fired each time a bitmap for the current docId/page/renderScale is on
   * screen. While a new render is running the previous bitmap stays visible;
   * until the first one, a paper-coloured placeholder is drawn.
   */
  onRendered?: (event: NativeSyntheticEvent<PageRenderedEvent>) => void;
  /**
   * Fired when the current docId/page cannot be rendered. If a bitmap of this
   * page is already shown (e.g. a higher renderScale failed), it stays;
   * otherwise the placeholder stays.
   */
  onRenderError?: (event: NativeSyntheticEvent<PageRenderErrorEvent>) => void;
};

/**
 * One PDF page drawn natively. Lay it out at the page's displayed aspect ratio
 * (OpenedDocument.pages). Changing docId/page cancels the render in progress,
 * which is what a recycled list cell needs.
 */
export const PdfPageView = requireNativeView<PdfPageViewProps>('PdfEngine');
