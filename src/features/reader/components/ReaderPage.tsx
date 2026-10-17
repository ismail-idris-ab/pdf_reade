import { memo, useCallback, useMemo, useState, type ReactNode } from 'react';
import { Text, View, type AccessibilityActionEvent } from 'react-native';

import { Button } from '@/components/ui';
import { useTranslation } from '@/i18n';
import { PageView } from '@/lib/engine';
import { toRecoveryLabel, toUserMessage, type AppError, type AppErrorCode } from '@/lib/errors';

import { recordDetailRender } from '../detailMetrics';
import type { PageFrame } from '../layout';
import { useReaderStore } from '../store';

/** The displayed page's box inside the overlay slot, dp (rotation already applied). */
export type PageOverlayLayout = { width: number; height: number };

/**
 * Renders content over one page, in a layer exactly covering the displayed
 * page. Rectangles in normalized page space are placed with
 * `normalizedRectToView` (overlayGeometry.ts). The layer passes touches it
 * does not handle through to the page.
 */
export type RenderPageOverlay = (page: number, layout: PageOverlayLayout) => ReactNode;

export type ReaderPageProps = {
  docId: string;
  page: number;
  pageCount: number;
  frame: PageFrame;
  nightMode: boolean;
  sepia: boolean;
  /**
   * Toggles the chrome. Taps themselves are recognised by the reader's
   * gesture detector (they must not fire on a double tap); this is the
   * screen-reader "activate" action.
   */
  onTap: () => void;
  /**
   * Screen-reader zoom ("zoom in" / "zoom out" actions): TalkBack users
   * cannot pinch or double tap the page.
   */
  onZoomStep: (direction: 'in' | 'out') => void;
  /** Screen-reader "select all text on this page" (TalkBack users cannot long-press text). */
  onSelectAll: (page: number) => void;
  /**
   * Whether a render error should be shown in the cell; false drops it (e.g.
   * the document was closed under this view while the reader is closing).
   */
  acceptRenderError: (error: AppError) => boolean;
  renderOverlay?: RenderPageOverlay;
};

type FailedRender = { page: number; code: AppErrorCode };

/**
 * One page cell of the reader list: the native page, the overlay slot, and an
 * in-cell error with "Try again" when the page cannot be rendered. A tap
 * toggles the reader chrome.
 */
export const ReaderPage = memo(function ReaderPage({
  docId,
  page,
  pageCount,
  frame,
  nightMode,
  sepia,
  onTap,
  onZoomStep,
  onSelectAll,
  acceptRenderError,
  renderOverlay,
}: ReaderPageProps) {
  const { t } = useTranslation();
  // FlashList recycles this cell across pages: an error or retry only counts
  // while it belongs to the page the cell holds now.
  const [failed, setFailed] = useState<FailedRender | null>(null);
  const [retryToken, setRetryToken] = useState(0);

  const onRenderError = useCallback(
    (error: AppError, failedPage: number) => {
      if (!acceptRenderError(error)) return;
      setFailed({ page: failedPage, code: error.code });
    },
    [acceptRenderError],
  );
  const onRendered = useCallback(() => setFailed(null), []);
  const retry = useCallback(() => {
    setFailed(null);
    setRetryToken((value) => value + 1);
  }, []);

  const error = failed?.page === page ? failed : null;
  // Sharp tile for the visible part of this page while zoomed and settled.
  const detailRegion = useReaderStore((state) => state.details[page] ?? null);
  const onAccessibilityAction = useCallback(
    (event: AccessibilityActionEvent) => {
      switch (event.nativeEvent.actionName) {
        case 'activate':
          onTap();
          return;
        case 'zoomIn':
          onZoomStep('in');
          return;
        case 'zoomOut':
          onZoomStep('out');
          return;
        case 'selectText':
          onSelectAll(page);
          return;
      }
    },
    [onTap, onZoomStep, onSelectAll, page],
  );
  const accessibilityActions = useMemo(
    () => [
      { name: 'activate' },
      { name: 'zoomIn', label: t('reader.zoomIn') },
      { name: 'zoomOut', label: t('reader.zoomOut') },
      { name: 'selectText', label: t('reader.selection.selectAll') },
    ],
    [t],
  );
  const pageStyle = {
    position: 'absolute' as const,
    left: frame.left,
    top: frame.top,
    width: frame.pageWidth,
    height: frame.pageHeight,
  };

  return (
    <View
      testID={`reader-page-${page}`}
      accessible
      accessibilityActions={accessibilityActions}
      onAccessibilityAction={onAccessibilityAction}
      accessibilityRole="button"
      accessibilityLabel={t('reader.pageLabel', { page: page + 1, total: pageCount })}
      accessibilityHint={t('reader.toggleControlsHint')}
      style={{ width: frame.cellWidth, height: frame.cellHeight }}
    >
      <PageView
        docId={docId}
        page={page}
        nightMode={nightMode}
        sepia={sepia}
        retryToken={retryToken}
        detailRegion={detailRegion}
        onRendered={onRendered}
        onDetailRendered={__DEV__ ? recordDetailRender : undefined}
        onRenderError={onRenderError}
        style={pageStyle}
      />
      {renderOverlay ? (
        <View testID={`reader-overlay-${page}`} pointerEvents="box-none" style={pageStyle}>
          {renderOverlay(page, { width: frame.pageWidth, height: frame.pageHeight })}
        </View>
      ) : null}
      {error ? (
        <View
          testID={`reader-page-error-${page}`}
          style={pageStyle}
          className="items-center justify-center gap-3 bg-surface px-6"
        >
          <Text className="w-full text-center text-base font-semibold text-foreground">
            {toUserMessage(error.code).title}
          </Text>
          <Button label={toRecoveryLabel('retry')} variant="secondary" onPress={retry} />
        </View>
      ) : null}
    </View>
  );
});
