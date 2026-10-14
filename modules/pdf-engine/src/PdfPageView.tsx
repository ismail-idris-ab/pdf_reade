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

/**
 * A region of the page as displayed in this view: 0–1 on both axes relative to
 * the view's own bounds (rotation already applied), origin top-left.
 */
export type DetailRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type DetailRenderedEvent = {
  /** 0-based page the tile belongs to. */
  page: number;
  /** The region the tile covers (as requested, clamped to 0–1). */
  region: DetailRegion;
  /** Tile size in pixels. */
  widthPx: number;
  heightPx: number;
  /** Wall-clock render time on the PDFium thread, in ms. */
  ms: number;
  /** Time the render waited in the PDFium queue before it started, in ms. */
  waitMs: number;
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
   * Bitmap pixels per layout dp; pass the screen density (PixelRatio.get()).
   * The reader zooms by laying the view out larger, so this stays the density
   * at any zoom. The native side lowers the whole-page bitmap's scale when it
   * would exceed its memory caps, and reports the result in onRendered;
   * `detailRegion` restores full sharpness where the user is looking.
   */
  renderScale: number;
  /**
   * The part of the page currently visible, set once a zoom or pan has
   * settled. When the whole-page bitmap is below renderScale (it was capped),
   * the view renders this region at the full renderScale into a tile no larger
   * than the region's on-screen size and draws it over the whole-page bitmap.
   * null or omitted: no tile. Changing it replaces the tile; the previous tile
   * stays drawn until the new one is ready. A docId/page change drops it.
   */
  detailRegion?: DetailRegion | null;
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
  /** Fired each time a detail tile for the current detailRegion is on screen. */
  onDetailRendered?: (event: NativeSyntheticEvent<DetailRenderedEvent>) => void;
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
