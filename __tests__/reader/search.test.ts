import type { NormalizedRect } from '@/lib/engine';
import {
  addPageMatches,
  EMPTY_RESULTS,
  highlightPath,
  isSpanVisible,
  isCapped,
  matchBounds,
  matchOrdinal,
  nextMatch,
  previousMatch,
  revealCrossOffset,
  revealWithinCell,
  SEARCH_MATCH_CAP,
  summarizeSearch,
  type SearchResults,
} from '@/features/reader/search';

const rect = (x: number, y = 0.1): NormalizedRect => ({ x, y, width: 0.1, height: 0.02 });

/** `counts` matches on each listed page. */
function resultsWith(counts: Record<number, number>): SearchResults {
  let results = EMPTY_RESULTS;
  for (const [page, count] of Object.entries(counts)) {
    const matches = Array.from({ length: count }, (_, i) => [rect(i / 10)]);
    results = addPageMatches(results, Number(page), matches, 0);
  }
  return results;
}

describe('addPageMatches', () => {
  it('keeps pages ascending and totals the matches', () => {
    let results = addPageMatches(EMPTY_RESULTS, 4, [[rect(0)], [rect(0.2)]], 0);
    results = addPageMatches(results, 1, [[rect(0)]], 90);
    results = addPageMatches(results, 9, [[rect(0)]], 0);
    expect(results.pages).toEqual([1, 4, 9]);
    expect(results.total).toBe(4);
    expect(results.byPage[1]?.rotation).toBe(90);
  });

  it('ignores pages without matches and replaces a repeated page', () => {
    const once = addPageMatches(EMPTY_RESULTS, 2, [[rect(0)], [rect(0.2)]], 0);
    expect(addPageMatches(once, 3, [], 0)).toBe(once);
    const again = addPageMatches(once, 2, [[rect(0)]], 0);
    expect(again.pages).toEqual([2]);
    expect(again.total).toBe(1);
  });

  it('keeps the objects of untouched pages (their cells do not re-render)', () => {
    const first = addPageMatches(EMPTY_RESULTS, 0, [[rect(0)]], 0);
    const second = addPageMatches(first, 5, [[rect(0)]], 0);
    expect(second.byPage[0]).toBe(first.byPage[0]);
  });
});

describe('nextMatch / previousMatch', () => {
  const results = resultsWith({ 1: 2, 4: 1, 7: 3 });

  it('steps through matches in document order and wraps around', () => {
    const order: string[] = [];
    let current = nextMatch(results, null, 0);
    for (let i = 0; i < 7 && current; i += 1) {
      order.push(`${current.page}:${current.index}`);
      current = nextMatch(results, current, 0);
    }
    expect(order).toEqual(['1:0', '1:1', '4:0', '7:0', '7:1', '7:2', '1:0']);
  });

  it('steps backwards and wraps from the first match to the last', () => {
    expect(previousMatch(results, { page: 1, index: 0 }, 0)).toEqual({ page: 7, index: 2 });
    expect(previousMatch(results, { page: 4, index: 0 }, 0)).toEqual({ page: 1, index: 1 });
    expect(previousMatch(results, { page: 7, index: 2 }, 0)).toEqual({ page: 7, index: 1 });
  });

  it('starts from the page being read when nothing is selected', () => {
    expect(nextMatch(results, null, 4)).toEqual({ page: 4, index: 0 });
    expect(nextMatch(results, null, 5)).toEqual({ page: 7, index: 0 });
    expect(nextMatch(results, null, 8)).toEqual({ page: 1, index: 0 });
    expect(previousMatch(results, null, 5)).toEqual({ page: 4, index: 0 });
    expect(previousMatch(results, null, 0)).toEqual({ page: 7, index: 2 });
  });

  it('treats a stale selection as none and returns null without matches', () => {
    expect(nextMatch(results, { page: 3, index: 0 }, 3)).toEqual({ page: 4, index: 0 });
    expect(nextMatch(EMPTY_RESULTS, null, 0)).toBeNull();
    expect(previousMatch(EMPTY_RESULTS, null, 0)).toBeNull();
  });

  it('numbers a match by its place in the document', () => {
    expect(matchOrdinal(results, { page: 1, index: 0 })).toBe(1);
    expect(matchOrdinal(results, { page: 4, index: 0 })).toBe(3);
    expect(matchOrdinal(results, { page: 7, index: 2 })).toBe(6);
  });
});

describe('summarizeSearch', () => {
  it('says nothing without a query', () => {
    expect(summarizeSearch({ kind: 'idle' }, EMPTY_RESULTS, null)).toEqual({
      headline: null,
      progress: null,
    });
  });

  it('shows progress while searching, the count once found, no results when done', () => {
    const searching = { kind: 'searching' as const, pagesSearched: 3, pageCount: 10 };
    expect(summarizeSearch(searching, EMPTY_RESULTS, null)).toEqual({
      headline: { kind: 'searching' },
      progress: { pagesSearched: 3, pageCount: 10 },
    });
    const found = resultsWith({ 2: 3 });
    expect(summarizeSearch(searching, found, null).headline).toEqual({
      kind: 'results',
      total: 3,
      capped: false,
    });
    expect(summarizeSearch({ kind: 'done' }, EMPTY_RESULTS, null)).toEqual({
      headline: { kind: 'noResults' },
      progress: null,
    });
    expect(summarizeSearch({ kind: 'done' }, found, { page: 2, index: 1 }).headline).toEqual({
      kind: 'position',
      ordinal: 2,
      total: 3,
      capped: false,
    });
  });

  it('reports an error, and flags the match cap', () => {
    expect(
      summarizeSearch({ kind: 'error', code: 'OUT_OF_MEMORY' }, EMPTY_RESULTS, null).headline,
    ).toEqual({ kind: 'error', code: 'OUT_OF_MEMORY' });
    expect(isCapped(SEARCH_MATCH_CAP)).toBe(true);
    expect(isCapped(SEARCH_MATCH_CAP - 1)).toBe(false);
  });
});

describe('geometry', () => {
  it('bounds a match that wraps lines', () => {
    const bounds = matchBounds(
      [
        { x: 0.5, y: 0.1, width: 0.4, height: 0.05 },
        { x: 0.1, y: 0.15, width: 0.2, height: 0.05 },
      ],
      0,
      { width: 100, height: 200 },
    );
    expect(bounds?.x).toBeCloseTo(10);
    expect(bounds?.y).toBeCloseTo(20);
    expect(bounds?.width).toBeCloseTo(80);
    expect(bounds?.height).toBeCloseTo(20);
    expect(matchBounds([], 0, { width: 1, height: 1 })).toBeNull();
  });

  it('maps highlight rects through the page rotation', () => {
    // 90°: (x, y, w, h) → (1 − (y + h), x, h, w) on the displayed page.
    expect(
      highlightPath([[{ x: 0.1, y: 0.2, width: 0.3, height: 0.05 }]], 90, {
        width: 200,
        height: 100,
      }),
    ).toBe('M150 10h10v30h-10Z');
  });

  it('scrolls into the cell only when the match is out of view', () => {
    expect(revealWithinCell(100, 20, 600)).toBe(0);
    expect(revealWithinCell(900, 20, 600)).toBe(700);
    expect(revealWithinCell(150, 20, 0)).toBe(0);
  });

  it('pans sideways to centre a hidden match, clamped to the content', () => {
    expect(revealCrossOffset(50, 20, 400, 1200, 0)).toBe(0);
    expect(revealCrossOffset(900, 20, 400, 1200, 0)).toBe(710);
    expect(revealCrossOffset(1180, 20, 400, 1200, 0)).toBe(800);
    expect(revealCrossOffset(10, 20, 400, 1200, 600)).toBe(0);
  });
});

describe('while the search is still running (T2.6 review)', () => {
  const partial = resultsWith({ 1: 1, 4: 2 });

  it('does not wrap: later pages may still bring the next match', () => {
    expect(nextMatch(partial, { page: 4, index: 1 }, 0, false)).toBeNull();
    expect(nextMatch(partial, null, 6, false)).toBeNull();
    expect(previousMatch(partial, { page: 1, index: 0 }, 0, false)).toBeNull();
    expect(previousMatch(partial, null, 0, false)).toBeNull();
  });

  it('still steps between the matches found so far', () => {
    expect(nextMatch(partial, { page: 1, index: 0 }, 0, false)).toEqual({ page: 4, index: 0 });
    expect(previousMatch(partial, { page: 4, index: 0 }, 0, false)).toEqual({
      page: 1,
      index: 0,
    });
    expect(nextMatch(partial, null, 2, false)).toEqual({ page: 4, index: 0 });
  });
});

describe('visibility and chrome insets', () => {
  it('knows a span wholly inside a window', () => {
    expect(isSpanVisible(100, 20, 100, 120)).toBe(true);
    expect(isSpanVisible(99, 20, 100, 400)).toBe(false);
    expect(isSpanVisible(390, 20, 100, 400)).toBe(false);
  });

  it('keeps a match out from under the chrome on the cross axis', () => {
    // Viewport 800, top chrome 150, bottom chrome 130: visible 150..670.
    const insets = { start: 150, end: 130 };
    // Under the top bar at offset 0: moved so it is centred in the free part.
    expect(revealCrossOffset(100, 20, 800, 2400, 0, insets)).toBe(0);
    expect(revealCrossOffset(1000, 20, 800, 2400, 0, insets)).toBe(1000 + 10 - 150 - 260);
    // Already between the bars: unchanged.
    expect(revealCrossOffset(1000, 20, 800, 2400, 700, insets)).toBe(700);
    // Visible without insets but under the bottom bar with them.
    expect(revealCrossOffset(1360, 20, 800, 2400, 700)).toBe(700);
    expect(revealCrossOffset(1360, 20, 800, 2400, 700, insets)).toBe(1360 + 10 - 150 - 260);
  });
});
