import { PixelRatio, type NativeSyntheticEvent } from 'react-native';

import {
  PdfPageView,
  type DetailRenderedEvent,
  type PageRenderedEvent,
  type PageRenderErrorEvent,
  type PdfPageViewProps,
} from '../../../modules/pdf-engine/src/PdfPageView';
import { AppError, toAppError } from '@/lib/errors';

export type PageViewProps = Omit<
  PdfPageViewProps,
  'renderScale' | 'onRendered' | 'onDetailRendered' | 'onRenderError'
> & {
  /** Bitmap pixels per layout dp. Defaults to the screen density (1×). */
  renderScale?: number;
  /** A bitmap for the current docId/page/renderScale is on screen. */
  onRendered?: (event: PageRenderedEvent) => void;
  /** A sharp tile for the current `detailRegion` is on screen. */
  onDetailRendered?: (event: DetailRenderedEvent) => void;
  /**
   * The current page cannot be rendered. `error.code` is CORRUPT_FILE,
   * OUT_OF_MEMORY, or UNKNOWN for a non-shared native code (kept as the
   * error message). If a bitmap of this page is already shown (e.g. a higher
   * renderScale failed) it stays; otherwise the paper placeholder stays. For a
   * "Try again" action, change `retryToken` (passed through to the native view).
   */
  onRenderError?: (error: AppError, page: number) => void;
};

/** Maps a native render-error event to an AppError; unknown codes become UNKNOWN. */
export function pageRenderError(event: PageRenderErrorEvent): AppError {
  return toAppError(Object.assign(new Error(event.code), { code: event.code }));
}

/**
 * One PDF page drawn natively (see PdfPageView). Lay it out at the page's
 * displayed aspect ratio from OpenedDocument.pages; the view never opens or
 * closes the document.
 */
export function PageView({
  renderScale,
  onRendered,
  onDetailRendered,
  onRenderError,
  ...props
}: PageViewProps) {
  const handleRendered = onRendered
    ? (event: NativeSyntheticEvent<PageRenderedEvent>) => onRendered(event.nativeEvent)
    : undefined;
  const handleDetailRendered = onDetailRendered
    ? (event: NativeSyntheticEvent<DetailRenderedEvent>) => onDetailRendered(event.nativeEvent)
    : undefined;
  const handleRenderError = onRenderError
    ? (event: NativeSyntheticEvent<PageRenderErrorEvent>) =>
        onRenderError(pageRenderError(event.nativeEvent), event.nativeEvent.page)
    : undefined;

  return (
    <PdfPageView
      {...props}
      renderScale={renderScale ?? PixelRatio.get()}
      onRendered={handleRendered}
      onDetailRendered={handleDetailRendered}
      onRenderError={handleRenderError}
    />
  );
}
