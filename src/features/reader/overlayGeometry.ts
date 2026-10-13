import type { NormalizedRect, PageRotation } from '@/lib/engine';

/** Size of a page as laid out on screen (rotation already applied), in dp. */
export type ViewSize = { width: number; height: number };

/** A rectangle in view coordinates (dp), origin top-left of the displayed page. */
export type ViewRect = { x: number; y: number; width: number; height: number };

export type ViewPoint = { x: number; y: number };

/**
 * Maps a rectangle in normalized page space (0–1, relative to the UNROTATED
 * page box, origin top-left, y down — see NormalizedRect) onto the DISPLAYED
 * page, i.e. the page turned by its /Rotate (clockwise) and laid out at
 * `view` size. Overlays (search highlights, text selection) use this to
 * position themselves on a page cell.
 *
 * A point (u, v) of the unrotated page lands, in normalized displayed space, at:
 *   0°: (u, v)   90°: (1 − v, u)   180°: (1 − u, 1 − v)   270°: (v, 1 − u)
 */
export function normalizedRectToView(
  rect: NormalizedRect,
  rotation: PageRotation,
  view: ViewSize,
): ViewRect {
  const { x, y, width, height } = rect;
  let nx: number;
  let ny: number;
  let nw: number;
  let nh: number;
  switch (rotation) {
    case 0:
      nx = x;
      ny = y;
      nw = width;
      nh = height;
      break;
    case 90:
      nx = 1 - (y + height);
      ny = x;
      nw = height;
      nh = width;
      break;
    case 180:
      nx = 1 - (x + width);
      ny = 1 - (y + height);
      nw = width;
      nh = height;
      break;
    case 270:
      nx = y;
      ny = 1 - (x + width);
      nw = height;
      nh = width;
      break;
  }
  return {
    x: nx * view.width,
    y: ny * view.height,
    width: nw * view.width,
    height: nh * view.height,
  };
}

/**
 * Inverse of `normalizedRectToView` for a point: a touch at `point` (dp, on
 * the displayed page of `view` size) as a normalized point of the unrotated
 * page. Not clamped: a point outside the page maps outside 0–1.
 */
export function viewPointToNormalized(
  point: ViewPoint,
  rotation: PageRotation,
  view: ViewSize,
): ViewPoint {
  const px = view.width === 0 ? 0 : point.x / view.width;
  const py = view.height === 0 ? 0 : point.y / view.height;
  switch (rotation) {
    case 0:
      return { x: px, y: py };
    case 90:
      return { x: py, y: 1 - px };
    case 180:
      return { x: 1 - px, y: 1 - py };
    case 270:
      return { x: 1 - py, y: px };
  }
}
