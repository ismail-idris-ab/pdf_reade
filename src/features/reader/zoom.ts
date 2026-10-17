import { MAX_ZOOM, MIN_ZOOM } from '@/db/schema';
import type { DetailRegion } from '@/lib/engine';

import type { ItemSpan, PageFrame } from './layout';

/** Double tap toggles between 1× and this zoom. */
export const DOUBLE_TAP_ZOOM = 2.5;

/**
 * Longest gap between the two taps of a double tap, ms. A single tap (show or
 * hide the controls) waits this long for a second tap, so it is kept short:
 * below Android's 300 ms double-tap timeout, still long enough for a normal
 * double tap.
 */
export const DOUBLE_TAP_MAX_DELAY_MS = 250;

/**
 * Hold time that starts a text selection (T2.8), ms. Below RNGH's 500 ms tap
 * limit, so a press held this long is never also a tap.
 */
export const LONG_PRESS_MS = 450;

/**
 * How far a finger may move during that hold, dp: no more than Android's
 * touch slop, so a slow drag fails the long press before the list scrolls.
 */
export const LONG_PRESS_MAX_DISTANCE = 8;

/** Each screen-reader "zoom in" / "zoom out" action multiplies or divides by this. */
export const ACCESSIBILITY_ZOOM_STEP = 1.5;

/** Duration of the animated double-tap zoom, ms. */
export const DOUBLE_TAP_ANIMATION_MS = 200;

/** A zoom or pan counts as settled after this long without movement, ms. */
export const DETAIL_SETTLE_MS = 120;

/** Zoom steps closer than this are treated as no change. */
const ZOOM_EPSILON = 0.01;

/** A zoom clamped to MIN_ZOOM–MAX_ZOOM (1×–5×); 1 for a non-number. */
export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return MIN_ZOOM;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/** Whether two zooms are the same for layout purposes. */
export function sameZoom(a: number, b: number): boolean {
  return Math.abs(a - b) < ZOOM_EPSILON;
}

/** Where a double tap goes: back to 1× when zoomed in, else DOUBLE_TAP_ZOOM. */
export function doubleTapTarget(zoom: number): number {
  return zoom > MIN_ZOOM + ZOOM_EPSILON ? MIN_ZOOM : DOUBLE_TAP_ZOOM;
}

/**
 * One screen-reader zoom step from `zoom`, clamped to 1×–5×; zooming out
 * that ends close to 1× lands on 1×.
 */
export function stepZoom(zoom: number, direction: 'in' | 'out'): number {
  const next = direction === 'in' ? zoom * ACCESSIBILITY_ZOOM_STEP : zoom / ACCESSIBILITY_ZOOM_STEP;
  return clampZoom(direction === 'out' && next < MIN_ZOOM + 0.1 ? MIN_ZOOM : next);
}

/**
 * The live transform of the page area during a pinch, about the point where
 * the fingers started (`origin`, relative to the area's centre `center`)
 * and following them as they move (`pan` = current focal − origin). Views
 * scale about their centre, so the origin's shift is compensated: a content
 * point p ends at center + scale·(p − center) + translate.
 */
export function pinchTranslate(origin: number, center: number, scale: number, pan: number): number {
  'worklet';
  return (origin - center) * (1 - scale) + pan;
}

/**
 * The live pinch scale allowed on top of the committed zoom, so the
 * resulting zoom stays within 1×–5×.
 */
export function clampPinchScale(scale: number, committedZoom: number): number {
  'worklet';
  const min = MIN_ZOOM / committedZoom;
  const max = MAX_ZOOM / committedZoom;
  return Math.min(max, Math.max(min, scale));
}

/** A page frame at `zoom`: the cell and the page grow together, gaps included. */
export function zoomFrame(frame: PageFrame, zoom: number): PageFrame {
  return {
    cellWidth: frame.cellWidth * zoom,
    cellHeight: frame.cellHeight * zoom,
    pageWidth: frame.pageWidth * zoom,
    pageHeight: frame.pageHeight * zoom,
    left: frame.left * zoom,
    top: frame.top * zoom,
  };
}

/** Where to scroll the list after a zoom: `scrollToIndex({ index, viewOffset })`. */
export type ZoomAnchor = { index: number; viewOffset: number };

/**
 * Keeps the point under the fingers in place along the list's scroll axis.
 * `contentPosition` is that point in item space (scroll offset minus the
 * list header, plus the focal point's distance from the viewport start);
 * `focal` is its distance from the viewport start. Every cell grows by
 * `ratio`, so the point keeps its fraction of its cell. The result is for
 * `scrollToIndex`, whose final offset is the item's start plus the header
 * plus `viewOffset`. Null when no item is known.
 */
export function zoomAnchor(
  spans: readonly ItemSpan[],
  contentPosition: number,
  focal: number,
  ratio: number,
): ZoomAnchor | null {
  if (spans.length === 0) return null;
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  let item = sorted[0];
  for (const span of sorted) {
    if (span.start <= contentPosition) item = span;
  }
  if (!item) return null;
  const fraction =
    item.length > 0 ? Math.min(1, Math.max(0, (contentPosition - item.start) / item.length)) : 0;
  return { index: item.index, viewOffset: fraction * item.length * ratio - focal };
}

/**
 * The cross-axis scroll offset (sideways in vertical mode) after a zoom: the
 * content point that was under `focal` (the fingers when the pinch began)
 * grows by `ratio` and ends up under `targetFocal` (where the fingers are
 * now; the same point when they did not move). Clamped to the new
 * scrollable range.
 */
export function crossAxisOffset(
  offset: number,
  focal: number,
  ratio: number,
  newContentLength: number,
  viewLength: number,
  targetFocal: number = focal,
): number {
  const next = (offset + focal) * ratio - targetFocal;
  return Math.min(Math.max(0, newContentLength - viewLength), Math.max(0, next));
}

export type Rect = { x: number; y: number; width: number; height: number };

/**
 * The part of `page` inside `view`, in the page's own normalized displayed
 * coordinates (what PdfPageView's detailRegion takes). Null when they do not
 * overlap. Both rects share one coordinate space.
 */
export function visibleDetailRegion(page: Rect, view: Rect): DetailRegion | null {
  if (page.width <= 0 || page.height <= 0) return null;
  const left = Math.max(page.x, view.x);
  const top = Math.max(page.y, view.y);
  const right = Math.min(page.x + page.width, view.x + view.width);
  const bottom = Math.min(page.y + page.height, view.y + view.height);
  if (right <= left || bottom <= top) return null;
  return {
    x: (left - page.x) / page.width,
    y: (top - page.y) / page.height,
    width: (right - left) / page.width,
    height: (bottom - top) / page.height,
  };
}

export type DetailViewport = {
  /** Scroll position along the list axis, in item space (header removed). */
  mainStart: number;
  mainLength: number;
  /** Scroll position across the list axis (the sideways pan). */
  crossStart: number;
  crossLength: number;
};

/**
 * The detail region of each visible page: the list's item spans place each
 * cell along its scroll axis, the (zoomed) frame of that page places it inside
 * its cell, and the viewport window is the scroll position on both axes.
 */
export function detailRegions(
  spans: readonly ItemSpan[],
  frameAt: (page: number) => PageFrame | undefined,
  viewport: DetailViewport,
  horizontal: boolean,
): Record<number, DetailRegion> {
  const view: Rect = horizontal
    ? {
        x: viewport.mainStart,
        y: viewport.crossStart,
        width: viewport.mainLength,
        height: viewport.crossLength,
      }
    : {
        x: viewport.crossStart,
        y: viewport.mainStart,
        width: viewport.crossLength,
        height: viewport.mainLength,
      };
  const regions: Record<number, DetailRegion> = {};
  for (const span of spans) {
    const frame = frameAt(span.index);
    if (!frame) continue;
    const page: Rect = horizontal
      ? {
          x: span.start + frame.left,
          y: frame.top,
          width: frame.pageWidth,
          height: frame.pageHeight,
        }
      : {
          x: frame.left,
          y: span.start + frame.top,
          width: frame.pageWidth,
          height: frame.pageHeight,
        };
    const region = visibleDetailRegion(page, view);
    if (region) regions[span.index] = region;
  }
  return regions;
}
