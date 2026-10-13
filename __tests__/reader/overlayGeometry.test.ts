import { normalizedRectToView, viewPointToNormalized } from '@/features/reader/overlayGeometry';
import type { NormalizedRect, PageRotation } from '@/lib/engine';

// A portrait page of 600×800 dp as displayed; for 90°/270° the unrotated page
// is landscape (its long side runs across the displayed height).
const VIEW = { width: 600, height: 800 };
const ROTATIONS: PageRotation[] = [0, 90, 180, 270];

// A small box near the unrotated page's top-left corner.
const CORNER: NormalizedRect = { x: 0.1, y: 0.2, width: 0.3, height: 0.1 };

describe('normalizedRectToView', () => {
  it('scales an unrotated rect by the view size', () => {
    expect(normalizedRectToView(CORNER, 0, VIEW)).toEqual({
      x: 60,
      y: 160,
      width: 180,
      height: 80,
    });
  });

  it('turns the unrotated top-left corner to the top-right at 90°', () => {
    const rect = normalizedRectToView(CORNER, 90, VIEW);
    // x' = 1 − (y + h) = 0.7, y' = x = 0.1, w' = h, h' = w.
    expect(rect.x).toBeCloseTo(0.7 * 600);
    expect(rect.y).toBeCloseTo(0.1 * 800);
    expect(rect.width).toBeCloseTo(0.1 * 600);
    expect(rect.height).toBeCloseTo(0.3 * 800);
  });

  it('mirrors both axes at 180°', () => {
    const rect = normalizedRectToView(CORNER, 180, VIEW);
    expect(rect.x).toBeCloseTo(0.6 * 600);
    expect(rect.y).toBeCloseTo(0.7 * 800);
    expect(rect.width).toBeCloseTo(0.3 * 600);
    expect(rect.height).toBeCloseTo(0.1 * 800);
  });

  it('turns the unrotated top-left corner to the bottom-left at 270°', () => {
    const rect = normalizedRectToView(CORNER, 270, VIEW);
    // x' = y = 0.2, y' = 1 − (x + w) = 0.6.
    expect(rect.x).toBeCloseTo(0.2 * 600);
    expect(rect.y).toBeCloseTo(0.6 * 800);
    expect(rect.width).toBeCloseTo(0.1 * 600);
    expect(rect.height).toBeCloseTo(0.3 * 800);
  });

  it.each(ROTATIONS)('maps the whole page onto the whole view at %i°', (rotation) => {
    const rect = normalizedRectToView({ x: 0, y: 0, width: 1, height: 1 }, rotation, VIEW);
    expect(rect.x).toBeCloseTo(0);
    expect(rect.y).toBeCloseTo(0);
    expect(rect.width).toBeCloseTo(600);
    expect(rect.height).toBeCloseTo(800);
  });

  it.each(ROTATIONS)('keeps a rect inside the view at %i°', (rotation) => {
    const rect = normalizedRectToView(
      { x: 0.9, y: 0.95, width: 0.1, height: 0.05 },
      rotation,
      VIEW,
    );
    expect(rect.x).toBeGreaterThanOrEqual(-1e-9);
    expect(rect.y).toBeGreaterThanOrEqual(-1e-9);
    expect(rect.x + rect.width).toBeLessThanOrEqual(600 + 1e-9);
    expect(rect.y + rect.height).toBeLessThanOrEqual(800 + 1e-9);
  });

  it('rotating by 90° four times returns the original rect', () => {
    let rect: NormalizedRect = CORNER;
    for (let i = 0; i < 4; i += 1) rect = normalizedRectToView(rect, 90, { width: 1, height: 1 });
    expect(rect.x).toBeCloseTo(CORNER.x);
    expect(rect.y).toBeCloseTo(CORNER.y);
    expect(rect.width).toBeCloseTo(CORNER.width);
    expect(rect.height).toBeCloseTo(CORNER.height);
  });

  it('composes 90° twice into 180° and 90° with 180° into 270°', () => {
    const unit = { width: 1, height: 1 };
    const twice = normalizedRectToView(normalizedRectToView(CORNER, 90, unit), 90, unit);
    const half = normalizedRectToView(CORNER, 180, unit);
    const three = normalizedRectToView(normalizedRectToView(CORNER, 90, unit), 180, unit);
    const quarter = normalizedRectToView(CORNER, 270, unit);
    for (const key of ['x', 'y', 'width', 'height'] as const) {
      expect(twice[key]).toBeCloseTo(half[key]);
      expect(three[key]).toBeCloseTo(quarter[key]);
    }
  });
});

describe('viewPointToNormalized', () => {
  it.each(ROTATIONS)('inverts normalizedRectToView for a point at %i°', (rotation) => {
    const point = { x: 0.15, y: 0.65 };
    const view = normalizedRectToView({ ...point, width: 0, height: 0 }, rotation, VIEW);
    const back = viewPointToNormalized({ x: view.x, y: view.y }, rotation, VIEW);
    expect(back.x).toBeCloseTo(point.x);
    expect(back.y).toBeCloseTo(point.y);
  });

  it('maps the displayed top-right corner to the unrotated top-left at 90°', () => {
    const point = viewPointToNormalized({ x: 600, y: 0 }, 90, VIEW);
    expect(point.x).toBeCloseTo(0);
    expect(point.y).toBeCloseTo(0);
  });

  it('does not clamp points outside the page', () => {
    expect(viewPointToNormalized({ x: -60, y: 1600 }, 0, VIEW)).toEqual({ x: -0.1, y: 2 });
  });

  it('answers 0 on a view that has no size yet', () => {
    expect(viewPointToNormalized({ x: 10, y: 10 }, 0, { width: 0, height: 0 })).toEqual({
      x: 0,
      y: 0,
    });
  });
});
