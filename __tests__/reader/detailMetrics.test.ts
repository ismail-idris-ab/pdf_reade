import {
  detailRenderStats,
  markMovement,
  recordDetailRender,
  resetDetailRenderStats,
} from '@/features/reader/detailMetrics';

const tile = (ms: number, waitMs: number) => ({
  page: 2,
  region: { x: 0, y: 0, width: 0.5, height: 0.5 },
  widthPx: 800,
  heightPx: 600,
  ms,
  waitMs,
});

describe('detail tile dev metric', () => {
  let info: jest.SpyInstance;
  beforeEach(() => {
    resetDetailRenderStats();
    info = jest.spyOn(console, 'info').mockImplementation(() => undefined);
  });
  afterEach(() => info.mockRestore());

  it('measures from the last movement (settle) to the tile, with wait and render times', () => {
    markMovement(1_000);
    markMovement(1_050);
    recordDetailRender(tile(90, 20), 1_330);
    expect(info).toHaveBeenLastCalledWith(
      expect.stringContaining('crisp p3 280 ms after settle (wait 20 ms, render 90 ms, 800x600px'),
    );
    markMovement(2_000);
    recordDetailRender(tile(60, 0), 2_120);
    expect(detailRenderStats()).toEqual({ count: 2, totalSettleMs: 400, maxSettleMs: 280 });
    expect(info).toHaveBeenLastCalledWith(expect.stringContaining('avg 200 ms, max 280 ms, n=2'));
  });

  it('logs a tile that arrives before any movement without a settle time', () => {
    recordDetailRender(tile(40, 5), 500);
    expect(info).toHaveBeenLastCalledWith(expect.stringContaining('? ms after settle'));
    expect(detailRenderStats().count).toBe(0);
  });
});
