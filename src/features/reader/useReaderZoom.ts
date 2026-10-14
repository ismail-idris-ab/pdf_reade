import type { FlashListRef } from '@shopify/flash-list';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react';
import type { ScrollView } from 'react-native';
import { Gesture } from 'react-native-gesture-handler';
import { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { reportError } from '@/lib/crash';
import type { DetailRegion, PageInfo } from '@/lib/engine';

import { markMovement } from './detailMetrics';
import { visibleSpans, type PageFrame, type Viewport } from './layout';
import type { ReadingStateSaver } from './readingState';
import type { ReaderStore } from './store';
import {
  clampPinchScale,
  clampZoom,
  crossAxisOffset,
  detailRegions,
  DETAIL_SETTLE_MS,
  DOUBLE_TAP_ANIMATION_MS,
  DOUBLE_TAP_MAX_DELAY_MS,
  doubleTapTarget,
  pinchTranslate,
  sameZoom,
  stepZoom,
  zoomAnchor,
  zoomFrame,
  type ZoomAnchor,
} from './zoom';

/**
 * The regions of pages still in `spans`; the same object when nothing was
 * dropped (so the store does not change).
 */
export function keepVisibleDetails(
  details: Readonly<Record<number, DetailRegion>>,
  spans: readonly { index: number }[],
): Readonly<Record<number, DetailRegion>> {
  const visible = new Set(spans.map((span) => span.index));
  const kept: Record<number, DetailRegion> = {};
  let dropped = false;
  for (const [page, region] of Object.entries(details)) {
    if (visible.has(Number(page))) kept[Number(page)] = region;
    else dropped = true;
  }
  return dropped ? kept : details;
}

/** A committed zoom waiting for its layout: where both scrolls must go. */
type PendingCommit = {
  zoom: number;
  ratio: number;
  anchor: ZoomAnchor | null;
  /** The anchor item's start before the zoom (item space). */
  anchorStart: number;
  anchorLength: number;
  crossOffset: number;
};

/** A point of the page area where a gesture started and where it is now. */
type FocalMove = { fromX: number; fromY: number; toX: number; toY: number };

export type ReaderZoomOptions = {
  initialZoom: number;
  viewport: Viewport;
  horizontal: boolean;
  /** Every page's frame at 1× (for the detail regions). */
  baseFrames: readonly PageFrame[];
  listRef: RefObject<FlashListRef<PageInfo> | null>;
  crossRef: RefObject<ScrollView | null>;
  store: ReaderStore;
  saverRef: RefObject<ReadingStateSaver | null>;
  /** Puts `page` back in place (paged mode at 1×). */
  scrollToPage: (page: number) => Promise<void>;
  /** A single tap that was not part of a double tap. */
  onSingleTap: () => void;
};

/**
 * Pinch and double-tap zoom for the reader (T2.4).
 *
 * While a pinch runs, the page area is only transformed visually: scaled
 * about the point where the fingers started and moved along with them (a
 * Reanimated transform on the UI thread; no React render per frame). When it
 * ends, the zoom is COMMITTED by layout: every cell becomes zoom × its 1×
 * size and both scrolls move so the content point that started under the
 * fingers ends up where the fingers are; the visual transform is reset in the
 * same commit. Pages keep rendering at screen density; whenever the page area
 * has settled, each visible page gets a `detailRegion` (its visible part) and
 * the native view renders it sharp where its page bitmap was capped.
 */
export function useReaderZoom({
  initialZoom,
  viewport,
  horizontal,
  baseFrames,
  listRef,
  crossRef,
  store,
  saverRef,
  scrollToPage,
  onSingleTap,
}: ReaderZoomOptions) {
  const [zoom, setZoom] = useState(() => clampZoom(initialZoom));
  const zoomRef = useRef(zoom);
  const mainOffsetRef = useRef(0);
  const crossOffsetRef = useRef(0);
  const pendingRef = useRef<PendingCommit | null>(null);
  const detailTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const correctionFrameRef = useRef<number | null>(null);
  // The main-axis offset the last zoom commit scrolled to.
  const committedOffsetRef = useRef<number | null>(null);

  // UI-thread state of the live gesture: the scale, the point it is about
  // (where the fingers started) and how far the fingers have moved since.
  const committed = useSharedValue(zoom);
  const liveScale = useSharedValue(1);
  const originX = useSharedValue(0);
  const originY = useSharedValue(0);
  const panX = useSharedValue(0);
  const panY = useSharedValue(0);

  const width = viewport.width;
  const height = viewport.height;
  const liveStyle = useAnimatedStyle(() => {
    const scale = liveScale.get();
    return {
      transform: [
        { translateX: pinchTranslate(originX.get(), width / 2, scale, panX.get()) },
        { translateY: pinchTranslate(originY.get(), height / 2, scale, panY.get()) },
        { scale },
      ],
    };
  }, [width, height]);

  const resetLiveTransform = useCallback(() => {
    liveScale.set(1);
    panX.set(0);
    panY.set(0);
  }, [liveScale, panX, panY]);

  const clearDetails = useCallback(() => {
    if (detailTimerRef.current !== null) {
      clearTimeout(detailTimerRef.current);
      detailTimerRef.current = null;
    }
    store.getState().setDetails({});
  }, [store]);

  const updateDetails = useCallback(() => {
    detailTimerRef.current = null;
    const list = listRef.current;
    if (!list) return;
    const regions = detailRegions(
      visibleSpans(list, horizontal),
      (page) => {
        const base = baseFrames[page];
        return base ? zoomFrame(base, zoomRef.current) : undefined;
      },
      {
        mainStart: mainOffsetRef.current - list.getFirstItemOffset(),
        mainLength: horizontal ? width : height,
        crossStart: crossOffsetRef.current,
        crossLength: horizontal ? height : width,
      },
      horizontal,
    );
    store.getState().setDetails(regions);
  }, [listRef, horizontal, baseFrames, width, height, store]);

  /**
   * Sends the detail regions once the page area has stopped moving for
   * DETAIL_SETTLE_MS, at any zoom (the native view only tiles a page whose
   * whole-page bitmap was capped, which can happen at 1× on large screens).
   */
  const scheduleDetails = useCallback(() => {
    if (detailTimerRef.current !== null) clearTimeout(detailTimerRef.current);
    detailTimerRef.current = setTimeout(updateDetails, DETAIL_SETTLE_MS);
  }, [updateDetails]);

  /**
   * The page area moved. Regions of pages still in view are kept (their
   * sharp tile stays drawn while panning, at its place on the page); regions
   * of pages that left the view are dropped, so a recycled cell never gets
   * another page's region. Updated regions are sent once movement settles.
   */
  const onMovement = useCallback(() => {
    markMovement();
    const { details, setDetails } = store.getState();
    const list = listRef.current;
    if (list && Object.keys(details).length > 0) {
      const kept = keepVisibleDetails(details, visibleSpans(list, horizontal));
      if (kept !== details) setDetails(kept);
    }
    scheduleDetails();
  }, [store, listRef, horizontal, scheduleDetails]);

  useEffect(
    () => () => {
      if (detailTimerRef.current !== null) clearTimeout(detailTimerRef.current);
      if (correctionFrameRef.current !== null) cancelAnimationFrame(correctionFrameRef.current);
    },
    [],
  );

  /** The list scrolled along its axis (also feeds the zoom focal math). */
  const onMainScroll = useCallback(
    (offset: number) => {
      mainOffsetRef.current = offset;
      // A scroll the commit did not ask for (the user is already moving):
      // the pending correction must not yank the list back.
      const expected = committedOffsetRef.current;
      if (
        correctionFrameRef.current !== null &&
        (expected === null || Math.abs(offset - expected) >= 1)
      ) {
        cancelAnimationFrame(correctionFrameRef.current);
        correctionFrameRef.current = null;
      }
      onMovement();
    },
    [onMovement],
  );

  /** The sideways (cross-axis) pan moved. */
  const onCrossScroll = useCallback(
    (offset: number) => {
      crossOffsetRef.current = offset;
      onMovement();
    },
    [onMovement],
  );

  /** A list rebuilt for a new mode or size starts at its own origin. */
  const resetOffsets = useCallback(() => {
    mainOffsetRef.current = 0;
    crossOffsetRef.current = 0;
  }, []);

  const scrollCross = useCallback(
    (offset: number) => {
      crossOffsetRef.current = offset;
      crossRef.current?.scrollTo(
        horizontal ? { x: 0, y: offset, animated: false } : { x: offset, y: 0, animated: false },
      );
    },
    [crossRef, horizontal],
  );

  /**
   * Commits a zoom reached by a gesture. The content point under (fromX,
   * fromY) when the gesture began must end up under (toX, toY), positions in
   * the page area. A changed zoom re-lays out; the scrolls and the reset of
   * the live transform follow in the layout effect below. The same zoom only
   * applies the pan.
   */
  const commitZoom = useCallback(
    (target: number, move: FocalMove) => {
      markMovement();
      const next = clampZoom(target);
      const previous = zoomRef.current;
      const list = listRef.current;
      const fromMain = horizontal ? move.fromX : move.fromY;
      const toMain = horizontal ? move.toX : move.toY;
      const fromCross = horizontal ? move.fromY : move.fromX;
      const toCross = horizontal ? move.toY : move.toX;
      const crossLength = horizontal ? height : width;

      if (sameZoom(next, previous)) {
        // Only the fingers' travel: scroll by it, then drop the transform.
        if (list) {
          list.scrollToOffset({
            offset: Math.max(0, mainOffsetRef.current - (toMain - fromMain)),
            animated: false,
          });
        }
        scrollCross(
          crossAxisOffset(
            crossOffsetRef.current,
            fromCross,
            1,
            crossLength * previous,
            crossLength,
            toCross,
          ),
        );
        resetLiveTransform();
        scheduleDetails();
        return;
      }

      const ratio = next / previous;
      const spans = list ? visibleSpans(list, horizontal) : [];
      const anchor = list
        ? zoomAnchor(
            spans,
            mainOffsetRef.current - list.getFirstItemOffset() + fromMain,
            toMain,
            ratio,
          )
        : null;
      const anchorSpan = anchor ? spans.find((span) => span.index === anchor.index) : undefined;
      pendingRef.current = {
        zoom: next,
        ratio,
        anchor,
        anchorStart: anchorSpan?.start ?? 0,
        anchorLength: anchorSpan?.length ?? 0,
        crossOffset: crossAxisOffset(
          crossOffsetRef.current,
          fromCross,
          ratio,
          crossLength * next,
          crossLength,
          toCross,
        ),
      };
      zoomRef.current = next;
      committed.set(next);
      setZoom(next);
      saverRef.current?.setZoom(next);
    },
    [
      listRef,
      horizontal,
      width,
      height,
      committed,
      saverRef,
      scheduleDetails,
      scrollCross,
      resetLiveTransform,
    ],
  );

  /**
   * The main-axis scroll offset that puts the pending anchor in place: the
   * anchor item's start (the list's re-measured layout when it already has
   * the zoomed size, otherwise the old start × ratio: every cell grew by the
   * same ratio) plus the header and the anchor's viewOffset.
   */
  const anchorOffset = useCallback(
    (pending: PendingCommit): number | null => {
      const list = listRef.current;
      if (!list || !pending.anchor) return null;
      const layout = list.getLayout(pending.anchor.index);
      const zoomedLength = pending.anchorLength * pending.ratio;
      const layoutLength = layout ? (horizontal ? layout.width : layout.height) : null;
      const start =
        layout && layoutLength !== null && Math.abs(layoutLength - zoomedLength) < 1
          ? horizontal
            ? layout.x
            : layout.y
          : pending.anchorStart * pending.ratio;
      return Math.max(0, start + list.getFirstItemOffset() + pending.anchor.viewOffset);
    },
    [listRef, horizontal],
  );

  // After the zoomed layout is committed: move both scrolls so the focal
  // point lands under the fingers and drop the live transform in the same
  // frame. One direct scrollToOffset (a single native scrollTo) rather than
  // scrollToIndex, which in FlashList 2.0.2 walks several re-render steps
  // before scrolling, showing the zoomed layout at the old offset meanwhile.
  // The next frame corrects it once FlashList has re-measured the cells.
  useLayoutEffect(() => {
    const pending = pendingRef.current;
    if (pending === null || !sameZoom(pending.zoom, zoom)) return;
    pendingRef.current = null;
    const list = listRef.current;
    scrollCross(pending.crossOffset);
    if (horizontal && zoom <= 1) {
      // Paged again: snap to the page being read.
      resetLiveTransform();
      scrollToPage(store.getState().page).catch(reportError);
      scheduleDetails();
      return;
    }
    const offset = anchorOffset(pending);
    if (list && offset !== null) {
      list.scrollToOffset({ offset, animated: false });
      mainOffsetRef.current = offset;
    }
    committedOffsetRef.current = offset;
    resetLiveTransform();
    if (correctionFrameRef.current !== null) cancelAnimationFrame(correctionFrameRef.current);
    correctionFrameRef.current = requestAnimationFrame(() => {
      correctionFrameRef.current = null;
      const corrected = anchorOffset(pending);
      if (corrected !== null && Math.abs(corrected - mainOffsetRef.current) >= 1) {
        listRef.current?.scrollToOffset({ offset: corrected, animated: false });
        mainOffsetRef.current = corrected;
        committedOffsetRef.current = corrected;
      }
    });
    scheduleDetails();
  }, [
    zoom,
    horizontal,
    listRef,
    scrollCross,
    resetLiveTransform,
    anchorOffset,
    scrollToPage,
    store,
    scheduleDetails,
  ]);

  const onPinchStart = useCallback(() => clearDetails(), [clearDetails]);

  const onDoubleTap = useCallback(
    (x: number, y: number) => {
      const target = doubleTapTarget(zoomRef.current);
      clearDetails();
      originX.set(x);
      originY.set(y);
      panX.set(0);
      panY.set(0);
      const move: FocalMove = { fromX: x, fromY: y, toX: x, toY: y };
      liveScale.set(
        withTiming(target / zoomRef.current, { duration: DOUBLE_TAP_ANIMATION_MS }, (finished) => {
          'worklet';
          if (finished) scheduleOnRN(commitZoom, target, move);
        }),
      );
    },
    [clearDetails, originX, originY, panX, panY, liveScale, commitZoom],
  );

  /** Screen-reader zoom step, about the middle of the page area. */
  const zoomStep = useCallback(
    (direction: 'in' | 'out') => {
      clearDetails();
      const centre = { fromX: width / 2, fromY: height / 2, toX: width / 2, toY: height / 2 };
      commitZoom(stepZoom(zoomRef.current, direction), centre);
    },
    [clearDetails, commitZoom, width, height],
  );

  // The callbacks below run on gesture events (on the UI thread, handing over
  // with scheduleOnRN), never during render; the React Compiler lint cannot
  // see that and reads them as render-time ref access.
  /* eslint-disable react-hooks/refs */
  const gesture = useMemo(() => {
    const pinch = Gesture.Pinch()
      .withTestId('reader-pinch')
      .onStart((event) => {
        originX.set(event.focalX);
        originY.set(event.focalY);
        panX.set(0);
        panY.set(0);
        scheduleOnRN(onPinchStart);
      })
      .onUpdate((event) => {
        liveScale.set(clampPinchScale(event.scale, committed.get()));
        // The content follows the fingers as they move.
        panX.set(event.focalX - originX.get());
        panY.set(event.focalY - originY.get());
      })
      .onEnd(() => {
        const fromX = originX.get();
        const fromY = originY.get();
        scheduleOnRN(commitZoom, committed.get() * liveScale.get(), {
          fromX,
          fromY,
          toX: fromX + panX.get(),
          toY: fromY + panY.get(),
        });
      });
    const doubleTap = Gesture.Tap()
      .withTestId('reader-double-tap')
      .numberOfTaps(2)
      .maxDelay(DOUBLE_TAP_MAX_DELAY_MS)
      .onEnd((event, success) => {
        if (success) scheduleOnRN(onDoubleTap, event.x, event.y);
      });
    const singleTap = Gesture.Tap()
      .withTestId('reader-single-tap')
      .onEnd((_event, success) => {
        if (success) scheduleOnRN(onSingleTap);
      });
    // A single tap waits for the double tap to fail (at most
    // DOUBLE_TAP_MAX_DELAY_MS); pinching works alongside either.
    return Gesture.Simultaneous(pinch, Gesture.Exclusive(doubleTap, singleTap));
  }, [
    committed,
    liveScale,
    originX,
    originY,
    panX,
    panY,
    commitZoom,
    onPinchStart,
    onDoubleTap,
    onSingleTap,
  ]);
  /* eslint-enable react-hooks/refs */

  return {
    zoom,
    gesture,
    liveStyle,
    onMainScroll,
    onCrossScroll,
    resetOffsets,
    scheduleDetails,
    zoomStep,
  };
}
