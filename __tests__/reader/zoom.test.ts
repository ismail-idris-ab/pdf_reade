import type { PageFrame } from '@/features/reader/layout';
import { keepVisibleDetails } from '@/features/reader/useReaderZoom';
import {
  clampPinchScale,
  clampZoom,
  crossAxisOffset,
  DOUBLE_TAP_ZOOM,
  detailRegions,
  doubleTapTarget,
  pinchTranslate,
  sameZoom,
  stepZoom,
  visibleDetailRegion,
  zoomAnchor,
  zoomFrame,
} from '@/features/reader/zoom';

describe('zoom limits', () => {
  it('clamps to 1×–5×', () => {
    expect(clampZoom(0.4)).toBe(1);
    expect(clampZoom(3.2)).toBe(3.2);
    expect(clampZoom(9)).toBe(5);
    expect(clampZoom(Number.NaN)).toBe(1);
  });

  it('limits the live pinch scale so committed × scale stays in 1×–5×', () => {
    expect(clampPinchScale(0.2, 2)).toBe(0.5);
    expect(clampPinchScale(4, 2)).toBe(2.5);
    expect(clampPinchScale(1.3, 2)).toBe(1.3);
    expect(clampPinchScale(0.5, 1)).toBe(1);
  });

  it('treats near-equal zooms as the same', () => {
    expect(sameZoom(2, 2.005)).toBe(true);
    expect(sameZoom(2, 2.05)).toBe(false);
  });
});

describe('doubleTapTarget', () => {
  it('toggles 1× ↔ 2.5×', () => {
    expect(doubleTapTarget(1)).toBe(DOUBLE_TAP_ZOOM);
    expect(DOUBLE_TAP_ZOOM).toBe(2.5);
    expect(doubleTapTarget(2.5)).toBe(1);
    // Any zoomed-in state goes back to 1×.
    expect(doubleTapTarget(4.2)).toBe(1);
    expect(doubleTapTarget(1.005)).toBe(DOUBLE_TAP_ZOOM);
  });
});

describe('zoomFrame', () => {
  it('scales the cell, the page and its offsets together', () => {
    const frame: PageFrame = {
      cellWidth: 400,
      cellHeight: 600,
      pageWidth: 380,
      pageHeight: 580,
      left: 10,
      top: 8,
    };
    expect(zoomFrame(frame, 2)).toEqual({
      cellWidth: 800,
      cellHeight: 1200,
      pageWidth: 760,
      pageHeight: 1160,
      left: 20,
      top: 16,
    });
  });
});

describe('zoomAnchor (focal point along the list axis)', () => {
  const spans = [
    { index: 0, start: 0, length: 500 },
    { index: 1, start: 500, length: 500 },
    { index: 2, start: 1000, length: 500 },
  ];

  it('keeps the point under the fingers at the same screen position', () => {
    // Scroll offset 450 in item space, finger 300 below the viewport top:
    // the point is 750, halfway down page 1.
    const anchor = zoomAnchor(spans, 750, 300, 2);
    expect(anchor).toEqual({ index: 1, viewOffset: 0.5 * 1000 - 300 });
    // After the zoom page 1 starts at 1000; scrollToIndex lands at
    // start + viewOffset, so the point (1000 + 500) is 300 below the top again.
    const offset = 1000 + (anchor?.viewOffset ?? 0);
    expect(1000 + 0.5 * 1000 - offset).toBe(300);
  });

  it('works when zooming out', () => {
    expect(zoomAnchor(spans, 1250, 100, 0.5)).toEqual({
      index: 2,
      viewOffset: 0.5 * 250 - 100,
    });
  });

  it('uses the first item for a point above it, and handles unsorted spans', () => {
    expect(zoomAnchor([...spans].reverse(), -40, 0, 2)?.index).toBe(0);
    expect(zoomAnchor([...spans].reverse(), 1499, 0, 1)?.index).toBe(2);
  });

  it('returns null without items', () => {
    expect(zoomAnchor([], 10, 10, 2)).toBeNull();
  });
});

describe('crossAxisOffset (sideways focal point)', () => {
  it('keeps the point under the fingers, within the scrollable range', () => {
    // Viewport 400 wide at 1×, finger at x 100 → 2×: content 800 wide.
    expect(crossAxisOffset(0, 100, 2, 800, 400)).toBe(100);
    // From 2× (offset 300, finger 200: content x 500) to 3×: 1500 − 200.
    expect(crossAxisOffset(300, 200, 1.5, 1200, 400)).toBe(550);
  });

  it('clamps at both ends', () => {
    expect(crossAxisOffset(0, 10, 0.5, 400, 400)).toBe(0);
    expect(crossAxisOffset(390, 390, 5, 2000, 400)).toBe(1600);
  });
});

describe('visibleDetailRegion', () => {
  const page = { x: 0, y: 100, width: 800, height: 1000 };

  it('is the visible part of the page in its own normalized coordinates', () => {
    const region = visibleDetailRegion(page, { x: 200, y: 300, width: 400, height: 500 });
    expect(region).toEqual({ x: 0.25, y: 0.2, width: 0.5, height: 0.5 });
  });

  it('clamps to the page where the viewport sticks out', () => {
    expect(visibleDetailRegion(page, { x: -100, y: 0, width: 400, height: 300 })).toEqual({
      x: 0,
      y: 0,
      width: 300 / 800,
      height: 200 / 1000,
    });
    expect(visibleDetailRegion(page, { x: -10, y: 0, width: 2000, height: 3000 })).toEqual({
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    });
  });

  it('is null when the page is out of view or empty', () => {
    expect(visibleDetailRegion(page, { x: 0, y: 1100, width: 400, height: 300 })).toBeNull();
    expect(visibleDetailRegion(page, { x: 800, y: 0, width: 400, height: 300 })).toBeNull();
    expect(
      visibleDetailRegion(
        { x: 0, y: 0, width: 0, height: 10 },
        { x: 0, y: 0, width: 5, height: 5 },
      ),
    ).toBeNull();
  });
});

describe('detailRegions', () => {
  // Two pages of 800 × 1000 inside cells with an 16dp gap above (2× of 1×).
  const frame: PageFrame = {
    cellWidth: 800,
    cellHeight: 1016,
    pageWidth: 800,
    pageHeight: 1000,
    left: 0,
    top: 16,
  };
  const frameAt = (page: number) => (page < 3 ? frame : undefined);

  it('vertical: the list axis is y, the sideways pan is x', () => {
    const regions = detailRegions(
      [
        { index: 0, start: 0, length: 1016 },
        { index: 1, start: 1016, length: 1016 },
      ],
      frameAt,
      { mainStart: 816, mainLength: 400, crossStart: 400, crossLength: 400 },
      false,
    );
    // Page 0 spans y 16–1016: rows 816–1016 visible (0.8–1.0); x 400–800 (0.5–1.0).
    expect(regions[0]).toEqual({ x: 0.5, y: 0.8, width: 0.5, height: 0.2 });
    // Page 1 spans y 1032–2032: rows 1032–1216 visible.
    expect(regions[1]?.y).toBe(0);
    expect(regions[1]?.height).toBeCloseTo(184 / 1000);
  });

  it('horizontal: the list axis is x, the sideways pan is y', () => {
    const regions = detailRegions(
      [
        { index: 1, start: 800, length: 800 },
        { index: 2, start: 1600, length: 800 },
      ],
      frameAt,
      { mainStart: 1000, mainLength: 400, crossStart: 500, crossLength: 300 },
      true,
    );
    // Page 1 spans x 800–1600: 1000–1400 visible; y 16–1016: 500–800 visible.
    expect(regions[1]).toEqual({ x: 0.25, y: (500 - 16) / 1000, width: 0.5, height: 0.3 });
    expect(regions[2]).toBeUndefined();
  });

  it('skips pages without a frame or out of view', () => {
    expect(
      detailRegions(
        [{ index: 7, start: 0, length: 1016 }],
        frameAt,
        { mainStart: 0, mainLength: 400, crossStart: 0, crossLength: 400 },
        false,
      ),
    ).toEqual({});
  });
});

describe('pinch that moves (pan with the fingers)', () => {
  it('live transform: scales about the start point and follows the fingers', () => {
    // A content point p ends at centre + scale·(p − centre) + translate.
    const centre = 200;
    const origin = 120;
    const at = (p: number, scale: number, pan: number) =>
      centre + scale * (p - centre) + pinchTranslate(origin, centre, scale, pan);
    // The start point stays under the fingers while they do not move…
    expect(at(origin, 2, 0)).toBeCloseTo(origin);
    // …and follows them when they do.
    expect(at(origin, 2, 35)).toBeCloseTo(origin + 35);
    expect(at(origin, 1, -40)).toBeCloseTo(origin - 40);
  });

  it('commit: the point under the start lands under the end position', () => {
    // Cross axis: offset 100, fingers started at 50 and ended at 90, 2×.
    // The content point 150 grows to 300 and must sit at 90: offset 210.
    expect(crossAxisOffset(100, 50, 2, 1600, 400, 90)).toBe(210);
    // Main axis: zoomAnchor takes the start point's content position and the
    // end position on screen.
    const spans = [{ index: 0, start: 0, length: 1000 }];
    const anchor = zoomAnchor(spans, 400, 90, 2);
    // Page point 400 (fraction 0.4) → 800 after 2×, on screen at 90.
    expect(anchor).toEqual({ index: 0, viewOffset: 800 - 90 });
  });
});

describe('stepZoom (screen-reader zoom actions)', () => {
  it('multiplies or divides by 1.5 within 1×–5×, snapping to 1× near it', () => {
    expect(stepZoom(1, 'in')).toBe(1.5);
    expect(stepZoom(4, 'in')).toBe(5);
    expect(stepZoom(2.25, 'out')).toBe(1.5);
    expect(stepZoom(1.6, 'out')).toBe(1);
    expect(stepZoom(1, 'out')).toBe(1);
  });
});

describe('pinch focal frame', () => {
  // Fingers start at x 120 and move 40 right while the scale is 2, about a
  // page area whose centre is 200.
  const centre = 200;
  const origin = 120;
  const travel = 40;
  const scale = 2;
  const screenOf = (p: number, pan: number) =>
    centre + scale * (p - centre) + pinchTranslate(origin, centre, scale, pan);

  it('in the untransformed wrapper frame the pan is exactly the finger travel', () => {
    // The wrapper does not move, so it reports the finger where it is.
    const focal = origin + travel;
    const pan = focal - origin;
    expect(pan).toBe(travel);
    // The content point that started under the finger is under it now.
    expect(screenOf(origin, pan)).toBeCloseTo(origin + travel);
  });

  it('in the transformed view’s own frame the pan feeds back on itself (why not)', () => {
    // RNGH inverts the attached view's transform: a finger at screen x maps
    // to content x' with screenOf(x') = x. The pan then depends on itself.
    const localOf = (x: number, pan: number) =>
      centre + (x - centre - pinchTranslate(origin, centre, scale, pan)) / scale;
    let pan = 0;
    for (let frame = 0; frame < 20; frame += 1) {
      pan = localOf(origin + travel, pan) - origin;
    }
    expect(Math.abs(pan - travel)).toBeGreaterThan(5);
  });
});

describe('keepVisibleDetails', () => {
  const region = { x: 0, y: 0, width: 1, height: 0.5 };

  it('drops only pages that left the view', () => {
    const details = { 3: region, 4: region, 5: region };
    expect(keepVisibleDetails(details, [{ index: 4 }, { index: 5 }, { index: 6 }])).toEqual({
      4: region,
      5: region,
    });
  });

  it('returns the same object when nothing changes', () => {
    const details = { 4: region };
    expect(keepVisibleDetails(details, [{ index: 4 }])).toBe(details);
  });
});
