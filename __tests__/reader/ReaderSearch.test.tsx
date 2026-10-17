import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react-native';
import { AccessibilityInfo, AppState, BackHandler, Dimensions } from 'react-native';

import PdfEngineModule from '../../modules/pdf-engine/src/PdfEngineModule';
import type { FakePdfEngineModule } from '../engine/fakePdfEngine';
import { getRepositories } from '@/db/client';
import { pageFrame } from '@/features/reader/layout';
import { CLOSE_DELAY_MS } from '@/features/reader/useReaderDocument';
import { ReaderScreen } from '@/features/reader/ReaderScreen';
import { SEARCH_TOOLS_HEIGHT, TOP_BAR_HEIGHT } from '@/features/reader/chrome';
import { SEARCH_DEBOUNCE_MS, SEARCH_MATCH_CAP } from '@/features/reader/search';
import { reportError } from '@/lib/crash';
import type { NormalizedRect } from '@/lib/engine';
import { ThemeProvider, useThemeStore } from '@/theme';

jest.mock('../../modules/pdf-engine/src/PdfEngineModule', () =>
  jest.requireActual('../engine/fakePdfEngine').createFakePdfEngineModule(),
);
jest.mock('../../modules/pdf-engine/src/PdfPageView', () =>
  jest.requireActual('../engine/fakePdfPageView').createFakePdfPageViewModule(),
);
jest.mock('../../modules/file-index/src/FileIndexModule', () =>
  jest.requireActual('../files/fakeFileIndex').createFakeFileIndexModule(),
);
jest.mock('expo-keep-awake', () => ({ useKeepAwake: jest.fn() }));
jest.mock('@/lib/crash', () => ({
  ...jest.requireActual<typeof import('@/lib/crash')>('@/lib/crash'),
  reportError: jest.fn(),
}));
jest.mock('expo-router', () => ({
  router: { back: jest.fn(), canGoBack: jest.fn(() => true), replace: jest.fn() },
}));
jest.mock('@/db/client', () => {
  const { createTestDatabase } =
    jest.requireActual<typeof import('../db/testDatabase')>('../db/testDatabase');
  const { createRepositories } =
    jest.requireActual<typeof import('@/db/repositories')>('@/db/repositories');
  const repositories = createRepositories(createTestDatabase().db);
  return { getRepositories: () => repositories, getDatabase: jest.fn() };
});

const engine = PdfEngineModule as unknown as FakePdfEngineModule;

/** Highlights are hidden from screen readers; the queries must include them. */
const HIDDEN = { includeHiddenElements: true };

const QUERY = 'confidential-salary';

function addFile() {
  return getRepositories().files.upsert({
    path: '/storage/emulated/0/Download/report.pdf',
    uri: null,
    name: 'report.pdf',
    ext: 'pdf',
    mime: 'application/pdf',
    size: 100,
    mtime: 1,
    source: 'downloads',
  });
}

const wait = (ms: number) => act(() => new Promise<void>((resolve) => setTimeout(resolve, ms)));

async function renderReader(fileId: number) {
  const result = await render(
    <ThemeProvider>
      <ReaderScreen fileId={fileId} />
    </ThemeProvider>,
  );
  await wait(0);
  return result;
}

async function openSearch() {
  await act(async () => fireEvent.press(screen.getByTestId('reader-search')));
}

async function type(text: string) {
  await act(async () => fireEvent.changeText(screen.getByTestId('reader-search-input'), text));
}

/** Types and waits out the debounce, so the search has started. */
async function search(text: string) {
  await type(text);
  await wait(SEARCH_DEBOUNCE_MS + 50);
}

const box = (x: number, y = 0.1): NormalizedRect => ({ x, y, width: 0.1, height: 0.02 });

/** Matches on a page: one single-rect match per x position. */
async function emitPage(searchId: string, page: number, xs: number[], rotation: 0 | 90 = 0) {
  return act(async () => {
    engine.emitSearchResult({ searchId, page, matches: xs.map((x) => [box(x)]), rotation });
  });
}

async function emitDone(searchId: string, totalMatches: number, errorCode: string | null = null) {
  await act(async () => engine.emitSearchDone({ searchId, totalMatches, errorCode }));
}

const summary = () => screen.getByTestId('reader-search-summary').props.children as string;
const indicator = () =>
  screen.getByTestId('reader-page-indicator').props.accessibilityLabel as string;

afterEach(async () => {
  cleanup();
  await wait(CLOSE_DELAY_MS + 20);
});

beforeEach(() => {
  jest.clearAllMocks();
  engine.reset();
  useThemeStore.setState({ preference: 'light' });
  for (const row of getRepositories().files.listIndexEntries()) {
    getRepositories().files.remove(row.id);
  }
  jest.spyOn(AppState, 'addEventListener').mockImplementation(() => ({ remove: jest.fn() }));
});

describe('Reader search (T2.6)', () => {
  it('opens a field in place of the title and searches after a typing pause', async () => {
    await renderReader(addFile().id);
    await openSearch();
    expect(screen.queryByText('report.pdf')).toBeNull();
    expect(screen.getByTestId('reader-search-input')).toBeOnTheScreen();

    await type('con');
    await type('conf');
    expect(engine.search).not.toHaveBeenCalled();
    expect(summary()).toBe('Searching…');
    await wait(SEARCH_DEBOUNCE_MS + 50);
    expect(engine.search).toHaveBeenCalledTimes(1);
    expect(engine.search).toHaveBeenCalledWith('doc-1', 'conf', {
      matchCase: false,
      wholeWord: false,
    });
  });

  it('cancels the running search on a new query, on close and on unmount', async () => {
    const { unmount } = await renderReader(addFile().id);
    await openSearch();
    await search('first');
    expect(engine.runningSearchIds()).toEqual(['search-1']);

    await type('second');
    expect(engine.cancelSearch).toHaveBeenCalledWith('search-1');
    expect(engine.runningSearchIds()).toEqual([]);
    await wait(SEARCH_DEBOUNCE_MS + 50);
    expect(engine.runningSearchIds()).toEqual(['search-2']);

    await act(async () => fireEvent.press(screen.getByTestId('reader-search-close')));
    expect(engine.cancelSearch).toHaveBeenCalledWith('search-2');
    expect(screen.getByText('report.pdf')).toBeOnTheScreen();

    await openSearch();
    expect(screen.getByTestId('reader-search-input').props.value).toBe('');
    await search('third');
    expect(engine.runningSearchIds()).toEqual(['search-3']);
    await act(async () => unmount());
    expect(engine.cancelSearch).toHaveBeenCalledWith('search-3');
    expect(engine.runningSearchIds()).toEqual([]);
    expect(engine.listenerCount()).toBe(0);
  });

  it('restarts at once with match case and whole word', async () => {
    await renderReader(addFile().id);
    await openSearch();
    await search('Word');
    const toggle = screen.getByTestId('reader-search-match-case');
    expect(toggle.props.accessibilityState).toMatchObject({ checked: false });
    await act(async () => fireEvent.press(toggle));
    await wait(10);
    expect(screen.getByTestId('reader-search-match-case').props.accessibilityState).toMatchObject({
      checked: true,
    });
    await act(async () => fireEvent.press(screen.getByTestId('reader-search-whole-word')));
    await wait(10);
    expect(engine.cancelSearch).toHaveBeenCalledWith('search-1');
    expect(engine.search).toHaveBeenLastCalledWith('doc-1', 'Word', {
      matchCase: true,
      wholeWord: true,
    });
  });

  it('streams progress and counts, then steps through matches in order, wrapping', async () => {
    await renderReader(addFile().id);
    await openSearch();
    await search('tax');
    await act(async () =>
      engine.emitSearchProgress({ searchId: 'search-1', pagesSearched: 1, pageCount: 3 }),
    );
    expect(summary()).toBe('Searching… 1 of 3');
    expect(screen.getByTestId('reader-search-next')).toBeDisabled();

    await emitPage('search-1', 0, [0.1, 0.5]);
    await act(async () =>
      engine.emitSearchProgress({ searchId: 'search-1', pagesSearched: 2, pageCount: 3 }),
    );
    expect(summary()).toBe('2 results');
    expect(screen.getByTestId('reader-search-progress').props.children).toBe('Searching… 2 of 3');
    await emitPage('search-1', 2, [0.3]);
    await emitDone('search-1', 3);
    expect(summary()).toBe('3 results');
    expect(screen.queryByTestId('reader-search-progress')).toBeNull();

    const next = () => act(async () => fireEvent.press(screen.getByTestId('reader-search-next')));
    const previous = () =>
      act(async () => fireEvent.press(screen.getByTestId('reader-search-previous')));
    await next();
    expect(summary()).toBe('Result 1 of 3');
    expect(indicator()).toBe('Page 1 of 3');
    await next();
    expect(summary()).toBe('Result 2 of 3');
    await next();
    expect(summary()).toBe('Result 3 of 3');
    expect(indicator()).toBe('Page 3 of 3');
    await next();
    expect(summary()).toBe('Result 1 of 3');
    expect(indicator()).toBe('Page 1 of 3');
    await previous();
    expect(summary()).toBe('Result 3 of 3');
    expect(indicator()).toBe('Page 3 of 3');
    // The keyboard's search key also goes to the next result.
    await act(async () => fireEvent(screen.getByTestId('reader-search-input'), 'submitEditing'));
    expect(summary()).toBe('Result 1 of 3');
  });

  it('keeps the zoom when it jumps to a match', async () => {
    const file = addFile();
    getRepositories().readingState.save({ fileId: file.id, page: 0, mode: 'vertical', zoom: 3 });
    await renderReader(file.id);
    await openSearch();
    await search('tax');
    await emitPage('search-1', 2, [0.8]);
    await emitDone('search-1', 1);
    await act(async () => fireEvent.press(screen.getByTestId('reader-search-next')));
    expect(indicator()).toBe('Page 3 of 3');
    expect(screen.getByTestId('reader-pan').props.scrollEnabled).toBe(true);
    expect(getRepositories().readingState.get(file.id)?.zoom).toBe(3);
  });

  it('highlights matches on their page, through the page rotation, without taking touches', async () => {
    await renderReader(addFile().id);
    await openSearch();
    await search('tax');
    await act(async () =>
      engine.emitSearchResult({
        searchId: 'search-1',
        page: 1,
        matches: [[{ x: 0.1, y: 0.2, width: 0.3, height: 0.05 }], [box(0.6)]],
        rotation: 90,
      }),
    );
    await emitDone('search-1', 2);

    const { width, height } = Dimensions.get('window');
    const frame = pageFrame({ width: 612, height: 792 }, 'vertical', { width, height });
    const W = frame.pageWidth;
    const H = frame.pageHeight;
    const r = (value: number) => Math.round(value * 10) / 10;
    // 90°: (x, y, w, h) → (1 − (y + h), x, h, w) of the displayed page.
    const first = `M${r(0.75 * W)} ${r(0.1 * H)}h${r(0.05 * W)}v${r(0.3 * H)}h${r(-0.05 * W)}Z`;

    const layer = screen.getByTestId('search-highlights-1', HIDDEN);
    expect(layer.props.pointerEvents).toBe('none');
    expect(screen.queryByTestId('search-highlights-0', HIDDEN)).toBeNull();
    const matches = screen.getByTestId('search-matches-1', HIDDEN);
    expect(matches.props.d.startsWith(first)).toBe(true);
    expect(screen.queryByTestId('search-current-1', HIDDEN)).toBeNull();

    await act(async () => fireEvent.press(screen.getByTestId('reader-search-next')));
    const current = screen.getByTestId('search-current-1', HIDDEN);
    expect(current.props.d).toBe(first);
    // Outlined as well as stronger (react-native-svg passes colours on processed).
    expect(current.props.stroke).toBeTruthy();
    expect(screen.getByTestId('search-matches-1', HIDDEN).props.stroke).toBeFalsy();
    // The all-matches path is not rebuilt for a new selection; the current one is drawn on top.
    expect(screen.getByTestId('search-matches-1', HIDDEN).props.d).toBe(matches.props.d);

    await act(async () => fireEvent.press(screen.getByTestId('reader-search-close')));
    expect(screen.queryByTestId('search-highlights-1', HIDDEN)).toBeNull();
  });

  it('says No results, and shows a capped count as 10,000+', async () => {
    await renderReader(addFile().id);
    await openSearch();
    await search('zzz');
    await emitDone('search-1', 0);
    expect(summary()).toBe('No results');
    expect(screen.getByTestId('reader-search-next')).toBeDisabled();

    await search('e');
    // The engine stops at the cap; here as two pages of 5,000.
    const many = Array.from({ length: SEARCH_MATCH_CAP / 2 }, (_, i) => i / SEARCH_MATCH_CAP);
    await emitPage('search-2', 0, many);
    await emitPage('search-2', 1, many);
    await emitDone('search-2', SEARCH_MATCH_CAP);
    expect(summary()).toBe('10,000+ results');
    await act(async () => fireEvent.press(screen.getByTestId('reader-search-next')));
    expect(summary()).toBe('Result 1 of 10,000+');
  });

  it('shows a failed search with its message and Try again; a cancel says nothing', async () => {
    await renderReader(addFile().id);
    await openSearch();
    await search('tax');
    await emitDone('search-1', 0, 'OUT_OF_MEMORY');
    expect(summary()).toBe('This file is too large to handle right now');
    expect(reportError).not.toHaveBeenCalled();

    await act(async () => fireEvent.press(screen.getByTestId('reader-search-retry')));
    await wait(10);
    expect(engine.search).toHaveBeenCalledTimes(2);
    await emitDone('search-2', 0, 'ERR_SEARCH_FAILED');
    expect(summary()).toBe('Something went wrong');
    expect(reportError).toHaveBeenCalledTimes(1);

    await act(async () => fireEvent.press(screen.getByTestId('reader-search-retry')));
    await wait(10);
    // A search ended by something else (e.g. the document closing): no error shown.
    await emitDone('search-3', 0, 'CANCELLED');
    expect(screen.queryByTestId('reader-search-summary')).toBeNull();
  });

  it('announces counts politely, the final count at once', async () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
    await renderReader(addFile().id);
    await openSearch();
    await search('tax');
    await emitPage('search-1', 0, [0.1]);
    await emitPage('search-1', 1, [0.1]);
    await emitPage('search-1', 2, [0.1]);
    expect(announce.mock.calls).toEqual([['1 result so far']]);
    await emitDone('search-1', 3);
    expect(announce.mock.calls).toEqual([['1 result so far'], ['3 results']]);
  });

  it('closes the search with Android back before leaving the reader', async () => {
    const handlers: (() => boolean)[] = [];
    jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_event, handler) => {
      handlers.push(handler as () => boolean);
      return { remove: () => handlers.splice(handlers.indexOf(handler as () => boolean), 1) };
    });
    await renderReader(addFile().id);
    await openSearch();
    await search('tax');
    let handled = false;
    await act(async () => {
      handled = handlers.at(-1)?.() ?? false;
    });
    expect(handled).toBe(true);
    expect(engine.cancelSearch).toHaveBeenCalledWith('search-1');
    expect(screen.queryByTestId('reader-search-input')).toBeNull();
    expect(handlers).toHaveLength(0);
  });

  it('starts the first page below the search tools, and hides the thumbnails while searching', async () => {
    await renderReader(addFile().id);
    const header = () => screen.getByTestId('reader-list-header').props.style as { height: number };
    expect(header().height).toBe(TOP_BAR_HEIGHT);
    expect(screen.getByTestId('reader-thumb-0')).toBeOnTheScreen();
    await openSearch();
    expect(header().height).toBe(TOP_BAR_HEIGHT + SEARCH_TOOLS_HEIGHT);
    expect(screen.queryByTestId('reader-thumb-0')).toBeNull();
    await act(async () => fireEvent.press(screen.getByTestId('reader-search-close')));
    expect(header().height).toBe(TOP_BAR_HEIGHT);
    expect(screen.getByTestId('reader-thumb-0')).toBeOnTheScreen();
  });

  it('does not wrap around while the search is still running', async () => {
    await renderReader(addFile().id);
    await openSearch();
    await search('tax');
    await emitPage('search-1', 0, [0.1]);
    const next = () => act(async () => fireEvent.press(screen.getByTestId('reader-search-next')));
    await next();
    expect(summary()).toBe('Result 1 of 1');
    // Nothing after it yet, and the search goes on: stays put.
    await next();
    expect(summary()).toBe('Result 1 of 1');
    await act(async () => fireEvent.press(screen.getByTestId('reader-search-previous')));
    expect(summary()).toBe('Result 1 of 1');
    await emitPage('search-1', 2, [0.1]);
    await next();
    expect(summary()).toBe('Result 2 of 2');
    expect(indicator()).toBe('Page 3 of 3');
    await emitDone('search-1', 2);
    await next();
    expect(summary()).toBe('Result 1 of 2');
    expect(indicator()).toBe('Page 1 of 3');
  });

  it('formats the progress numbers for the language', async () => {
    await renderReader(addFile().id);
    await openSearch();
    await search('tax');
    await act(async () =>
      engine.emitSearchProgress({ searchId: 'search-1', pagesSearched: 1000, pageCount: 1200 }),
    );
    expect(summary()).toBe('Searching… 1,000 of 1,200');
  });

  it('opens the keyboard when search opens, not each time the controls come back', async () => {
    await renderReader(addFile().id);
    await openSearch();
    expect(screen.getByTestId('reader-search-input').props.autoFocus).toBe(true);
    const tap = () =>
      act(async () =>
        fireEvent(screen.getByTestId('reader-page-0'), 'accessibilityAction', {
          nativeEvent: { actionName: 'activate' },
        }),
      );
    await tap();
    await tap();
    expect(screen.getByTestId('reader-search-input').props.autoFocus).toBe(false);
    await act(async () => fireEvent.press(screen.getByTestId('reader-search-close')));
    await openSearch();
    expect(screen.getByTestId('reader-search-input').props.autoFocus).toBe(true);
  });

  it('keeps the query out of crash reports and logs', async () => {
    const consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
      jest.spyOn(console, method),
    );
    const { unmount } = await renderReader(addFile().id);
    await openSearch();
    await search(QUERY);
    await emitDone('search-1', 0, 'ERR_SEARCH_FAILED');
    await act(async () => fireEvent.press(screen.getByTestId('reader-search-retry')));
    await wait(10);
    await act(async () => {
      engine.emitSearchResult({ searchId: 'search-2', page: 0, matches: [[box(0)]], rotation: 0 });
    });
    await act(async () => unmount());

    expect(reportError).toHaveBeenCalled();
    for (const [reported] of jest.mocked(reportError).mock.calls) {
      const error = reported as Error & { cause?: unknown };
      const text = `${error.message} ${error.stack ?? ''} ${String(error.cause)} ${JSON.stringify(error)}`;
      expect(text.includes(QUERY)).toBe(false);
    }
    for (const spy of consoleSpies) {
      expect(JSON.stringify(spy.mock.calls).includes(QUERY)).toBe(false);
    }
  });

  it('hides everything, search included, in fullscreen, and keeps the query', async () => {
    await renderReader(addFile().id);
    await openSearch();
    await type('tax');
    const area = screen.getByTestId('reader');
    expect(within(area).getByTestId('reader-search-tools')).toBeOnTheScreen();
    await act(async () =>
      fireEvent(screen.getByTestId('reader-page-0'), 'accessibilityAction', {
        nativeEvent: { actionName: 'activate' },
      }),
    );
    expect(screen.queryByTestId('reader-top-bar')).toBeNull();
    expect(screen.queryByTestId('reader-search-input')).toBeNull();
    await act(async () =>
      fireEvent(screen.getByTestId('reader-page-0'), 'accessibilityAction', {
        nativeEvent: { actionName: 'activate' },
      }),
    );
    expect(screen.getByTestId('reader-search-input').props.value).toBe('tax');
  });
});
