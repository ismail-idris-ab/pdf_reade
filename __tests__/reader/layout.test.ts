import { router } from 'expo-router';

import { readerErrorActions, type ReaderOpenErrorCode } from '@/features/reader/errorActions';
import {
  clampPage,
  isReaderSupported,
  mostVisiblePage,
  PAGE_GAP,
  PAGED_MARGIN,
  pageFrame,
  paperModeFor,
  pageAtScroll,
  parseJumpTarget,
} from '@/features/reader/layout';
import {
  OPEN_GUARD_MS,
  openReader,
  parseFileIdParam,
  readerHref,
  readerOpened,
  resetOpenReaderGuard,
} from '@/features/reader/navigation';
import { ERROR_CODES, type AppErrorCode } from '@/lib/errors';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

const A4 = { width: 595, height: 842 };
const LANDSCAPE = { width: 842, height: 595 };
const VIEWPORT = { width: 400, height: 900 };

describe('pageFrame', () => {
  it('vertical: spans the width at the page aspect ratio, with a gap above', () => {
    const frame = pageFrame(A4, 'vertical', VIEWPORT);
    expect(frame.pageWidth).toBe(400);
    expect(frame.pageHeight).toBeCloseTo((400 * 842) / 595);
    expect(frame.cellHeight).toBeCloseTo(frame.pageHeight + PAGE_GAP);
    expect(frame.cellWidth).toBe(400);
    expect(frame).toMatchObject({ left: 0, top: PAGE_GAP });
  });

  it('horizontal: one viewport per cell, a tall page fitted by height and centred', () => {
    const frame = pageFrame({ width: 100, height: 1000 }, 'horizontal', VIEWPORT, {
      top: 24,
      bottom: 16,
    });
    expect(frame.cellWidth).toBe(400);
    expect(frame.cellHeight).toBe(900);
    const boxHeight = 900 - 24 - 16 - PAGED_MARGIN * 2;
    expect(frame.pageHeight).toBeCloseTo(boxHeight);
    expect(frame.pageWidth).toBeCloseTo(boxHeight / 10);
    expect(frame.left).toBeCloseTo((400 - frame.pageWidth) / 2);
    expect(frame.top).toBeCloseTo(24 + PAGED_MARGIN);
  });

  it('horizontal: a landscape page is fitted by width and centred vertically', () => {
    const frame = pageFrame(LANDSCAPE, 'horizontal', VIEWPORT);
    expect(frame.pageWidth).toBeCloseTo(400 - PAGED_MARGIN * 2);
    expect(frame.left).toBeCloseTo(PAGED_MARGIN);
    expect(frame.top + frame.pageHeight / 2).toBeCloseTo(450);
  });

  it('falls back to an A-series aspect for a page with no size', () => {
    const frame = pageFrame({ width: 0, height: 0 }, 'vertical', VIEWPORT);
    expect(frame.pageHeight).toBeCloseTo(400 * Math.SQRT2);
  });
});

describe('mostVisiblePage', () => {
  const spans = [
    { index: 0, start: 0, length: 500 },
    { index: 1, start: 500, length: 500 },
    { index: 2, start: 1000, length: 500 },
  ];

  it('picks the page covering most of the viewport', () => {
    expect(mostVisiblePage(spans, 0, 900)).toBe(0);
    expect(mostVisiblePage(spans, 300, 900)).toBe(1);
    expect(mostVisiblePage(spans, 900, 600)).toBe(2);
  });

  it('breaks a tie towards the earlier page', () => {
    expect(mostVisiblePage(spans, 250, 500)).toBe(0);
  });

  it('handles items in any order', () => {
    expect(mostVisiblePage([...spans].reverse(), 300, 900)).toBe(1);
  });

  it('returns null when nothing overlaps the viewport', () => {
    expect(mostVisiblePage(spans, 2000, 500)).toBeNull();
    expect(mostVisiblePage([], 0, 500)).toBeNull();
  });

  it('works for horizontal paging (one page per viewport)', () => {
    const pages = [0, 1, 2, 3].map((index) => ({ index, start: index * 400, length: 400 }));
    expect(mostVisiblePage(pages, 1200, 400)).toBe(3);
    expect(mostVisiblePage(pages, 590, 400)).toBe(1);
    expect(mostVisiblePage(pages, 610, 400)).toBe(2);
  });
});

describe('clampPage', () => {
  it('clamps into the document', () => {
    expect(clampPage(5, 3)).toBe(2);
    expect(clampPage(-1, 3)).toBe(0);
    expect(clampPage(1, 3)).toBe(1);
    expect(clampPage(1.7, 3)).toBe(1);
  });

  it('answers 0 for an empty document or a non-number', () => {
    expect(clampPage(4, 0)).toBe(0);
    expect(clampPage(Number.NaN, 3)).toBe(0);
  });
});

describe('parseJumpTarget', () => {
  it('accepts 1..pageCount and returns the 0-based page', () => {
    expect(parseJumpTarget('1', 300)).toBe(0);
    expect(parseJumpTarget(' 300 ', 300)).toBe(299);
    expect(parseJumpTarget('012', 300)).toBe(11);
  });

  it.each(['', ' ', '0', '301', '-3', '2.5', '1e2', 'abc', '12a'])('rejects %p', (text) => {
    expect(parseJumpTarget(text, 300)).toBeNull();
  });
});

describe('paperModeFor', () => {
  it('follows the app theme', () => {
    expect(paperModeFor('light')).toEqual({ nightMode: false, sepia: false });
    // Dark keeps white pages: inversion would turn photos into negatives (T2.7 option).
    expect(paperModeFor('dark')).toEqual({ nightMode: false, sepia: false });
    expect(paperModeFor('sepia')).toEqual({ nightMode: false, sepia: true });
  });
});

describe('isReaderSupported', () => {
  it('reads PDFs only, whatever the case of the extension', () => {
    expect(isReaderSupported({ ext: 'pdf' })).toBe(true);
    expect(isReaderSupported({ ext: 'PDF' })).toBe(true);
    for (const ext of ['docx', 'xlsx', 'csv', 'txt', '']) {
      expect(isReaderSupported({ ext })).toBe(false);
    }
  });
});

describe('readerErrorActions', () => {
  // The password codes go to the password prompt, never to the error screen.
  const codes = ([...ERROR_CODES, 'UNKNOWN'] as AppErrorCode[]).filter(
    (code): code is ReaderOpenErrorCode =>
      code !== 'PASSWORD_REQUIRED' && code !== 'WRONG_PASSWORD',
  );

  it.each(codes)('offers at least one way out for %s', (code) => {
    for (const contentSource of [false, true]) {
      const actions = readerErrorActions(code, { contentSource });
      expect(actions.length).toBeGreaterThan(0);
      expect(actions.some((action) => action === 'back' || action === 'pickAnotherFile')).toBe(
        true,
      );
    }
  });

  it('maps codes to their recovery', () => {
    const path = { contentSource: false };
    expect(readerErrorActions('CORRUPT_FILE', path)).toEqual(['pickAnotherFile']);
    expect(readerErrorActions('UNSUPPORTED', path)).toEqual(['pickAnotherFile']);
    expect(readerErrorActions('NOT_FOUND', path)).toEqual(['pickAnotherFile']);
    expect(readerErrorActions('NO_SPACE', path)).toEqual(['freeSpace', 'retry', 'back']);
    for (const code of ['OUT_OF_MEMORY', 'CANCELLED', 'UNKNOWN'] as const) {
      expect(readerErrorActions(code, path)).toEqual(['retry', 'back']);
    }
  });

  it('PERMISSION_DENIED: all-files access for a path, pick again for a lost content:// grant', () => {
    expect(readerErrorActions('PERMISSION_DENIED', { contentSource: false })).toEqual([
      'allFilesAccess',
      'retry',
      'back',
    ]);
    expect(readerErrorActions('PERMISSION_DENIED', { contentSource: true })).toEqual([
      'pickAgain',
      'retry',
      'back',
    ]);
  });
});

describe('pageAtScroll', () => {
  // A list with a 100dp header and pages of 500dp at y = 0, 500, 1000, 1500.
  function fakeList(visible: { startIndex: number; endIndex: number }) {
    return {
      computeVisibleIndices: jest.fn(() => visible),
      getLayout: jest.fn((index: number) =>
        index >= 0 && index < 4
          ? { x: index * 400, y: index * 500, width: 400, height: 500 }
          : undefined,
      ),
      getFirstItemOffset: jest.fn(() => 100),
    };
  }

  it('subtracts the header and picks the most visible page', () => {
    const list = fakeList({ startIndex: 1, endIndex: 2 });
    // Scroll 800 → item space 700..1600: page 1 shows 300, page 2 shows 500.
    expect(pageAtScroll(list, 800, 900, false)).toBe(2);
    expect(pageAtScroll(list, 600, 900, false)).toBe(1);
  });

  it('also looks one item beyond the reported visible range', () => {
    const list = fakeList({ startIndex: 2, endIndex: 2 });
    pageAtScroll(list, 1100, 900, false);
    expect(list.getLayout).toHaveBeenCalledWith(1);
    expect(list.getLayout).toHaveBeenCalledWith(3);
  });

  it('uses x and width when horizontal', () => {
    const list = fakeList({ startIndex: 0, endIndex: 3 });
    expect(pageAtScroll(list, 100 + 1200, 400, true)).toBe(3);
  });

  it('returns null when no layout is known', () => {
    const list = { ...fakeList({ startIndex: 0, endIndex: 0 }), getLayout: () => undefined };
    expect(pageAtScroll(list, 0, 900, false)).toBeNull();
  });
});

describe('reader navigation', () => {
  it('builds the reader route', () => {
    expect(readerHref(7)).toEqual({ pathname: '/reader/[fileId]', params: { fileId: '7' } });
  });

  it('parses only positive whole ids', () => {
    expect(parseFileIdParam('42')).toBe(42);
    expect(parseFileIdParam(['5', '6'])).toBe(5);
    for (const value of [undefined, '', '0', '-1', '1.5', 'abc', '99999999999999999999']) {
      expect(parseFileIdParam(value)).toBeNull();
    }
  });
});

describe('openReader', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetOpenReaderGuard();
  });

  it('opens once for presses within the guard window, then again after it', () => {
    expect(openReader(3, 10_000)).toBe(true);
    expect(openReader(3, 10_000 + 50)).toBe(false);
    expect(openReader(4, 10_000 + OPEN_GUARD_MS - 1)).toBe(false);
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith(readerHref(3));

    expect(openReader(4, 10_000 + OPEN_GUARD_MS)).toBe(true);
    expect(router.push).toHaveBeenLastCalledWith(readerHref(4));
  });

  it('lets another file open as soon as the reader has mounted', () => {
    expect(openReader(3, 20_000)).toBe(true);
    readerOpened();
    expect(openReader(5, 20_010)).toBe(true);
    expect(router.push).toHaveBeenCalledTimes(2);
    expect(router.push).toHaveBeenLastCalledWith(readerHref(5));
  });
});
