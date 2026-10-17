// Text selection & copy (T2.8) on the reader screen: gestures are driven
// through react-native-gesture-handler's Jest utilities.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import { setStringAsync } from 'expo-clipboard';
import { AccessibilityInfo, AppState, BackHandler, Dimensions, Share } from 'react-native';
import { State } from 'react-native-gesture-handler';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';

import PdfEngineModule from '../../modules/pdf-engine/src/PdfEngineModule';
import type { FakePdfEngineModule } from '../engine/fakePdfEngine';
import { useToastStore } from '@/components/ui';
import { getRepositories } from '@/db/client';
import { pageFrame } from '@/features/reader/layout';
import { ReaderScreen } from '@/features/reader/ReaderScreen';
import { CLOSE_DELAY_MS } from '@/features/reader/useReaderDocument';
import { DETAIL_SETTLE_MS } from '@/features/reader/zoom';
import { reportError } from '@/lib/crash';
import type { PageTextRects } from '@/lib/engine';
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
const clipboard = setStringAsync as jest.MockedFunction<typeof setStringAsync>;
const HIDDEN = { includeHiddenElements: true };

/** Words no log or report may ever contain. */
const SECRET = 'Zanzibar';
const W = 0.02;
const H = 0.02;
// Jest's FlashList measures every cell as 100 dp tall (jest.setup.ts) and
// reports no header offset, so the fixture line sits near the top of page 0,
// inside that first 100 dp, and points are measured from the list's top.
const LINE_Y = 0.02;

/** One line of text from x = 0.1 at LINE_Y, a W×H box per character. */
function pageText(text: string): PageTextRects {
  const boxes: number[] = [];
  for (let i = 0; i < text.length; i += 1) boxes.push(0.1 + i * W, LINE_Y, W, H);
  return { text, boxes, rotation: 0 };
}

const TEXT = `${SECRET} salary report`;

/** An engine rejection with a typed error code. */
const coded = (code: string) =>
  Object.assign(new Error('The page text could not be read'), { code });

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

async function renderReader() {
  const result = await render(
    <ThemeProvider>
      <ReaderScreen fileId={addFile().id} />
    </ThemeProvider>,
  );
  await wait(0);
  return result;
}

/** Page 0 as laid out at 1× in vertical mode (below the list header). */
function page0() {
  const window = Dimensions.get('window');
  return pageFrame({ width: 612, height: 792 }, 'vertical', window);
}

/** The page-area point over character `index` of the fixture line on page 0. */
function pointOver(index: number) {
  const frame = page0();
  return {
    x: (0.1 + index * W + W / 2) * frame.pageWidth,
    y: frame.top + (LINE_Y + H / 2) * frame.pageHeight,
  };
}

async function longPress({ x, y }: { x: number; y: number }) {
  await act(async () =>
    fireGestureHandler(getByGestureTestId('reader-long-press'), [
      { state: State.BEGAN, x, y },
      { state: State.ACTIVE, x, y },
      { state: State.END, x, y },
    ]),
  );
  await wait(0);
}

async function tap() {
  await act(async () =>
    fireGestureHandler(getByGestureTestId('reader-single-tap'), [
      { state: State.BEGAN, x: 10, y: 400 },
      { state: State.ACTIVE, x: 10, y: 400 },
      { state: State.END, x: 10, y: 400 },
    ]),
  );
}

const selected = () => screen.queryByTestId('selection-path-0', HIDDEN);
const toastMessage = () => useToastStore.getState().current?.message;

/** Every argument ever passed to console and reportError, as text. */
function logged(spies: jest.SpyInstance[]): string {
  const calls = [...spies.flatMap((spy) => spy.mock.calls), ...jest.mocked(reportError).mock.calls];
  return calls.map((args) => JSON.stringify(args, (_key, value: unknown) => String(value))).join();
}

afterEach(async () => {
  // Let the zoom hook's detail-settle timer fire inside act, before unmounting.
  await wait(DETAIL_SETTLE_MS + 30);
  cleanup();
  await wait(CLOSE_DELAY_MS + 20);
});

beforeEach(() => {
  jest.clearAllMocks();
  engine.reset();
  useThemeStore.setState({ preference: 'light' });
  useToastStore.setState({ current: null });
  for (const row of getRepositories().files.listIndexEntries()) {
    getRepositories().files.remove(row.id);
  }
  jest.spyOn(AppState, 'addEventListener').mockImplementation(() => ({ remove: jest.fn() }));
  engine.getTextRects.mockResolvedValue(pageText(TEXT));
});

describe('Reader text selection (T2.8)', () => {
  it('selects the word under a long press, with handles, actions and an announcement', async () => {
    jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(true);
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
    await renderReader();
    await longPress(pointOver(2));

    expect(engine.getTextRects).toHaveBeenCalledWith('doc-1', 0);
    expect(selected()).toBeOnTheScreen();
    expect(screen.getByTestId('selection-handle-start', HIDDEN)).toBeOnTheScreen();
    expect(screen.getByTestId('selection-handle-end', HIDDEN)).toBeOnTheScreen();
    expect(screen.getByLabelText('Copy')).toBeOnTheScreen();
    expect(screen.getByLabelText('Share')).toBeOnTheScreen();
    expect(screen.getByLabelText('Selected text actions')).toBeOnTheScreen();
    expect(announce).toHaveBeenCalledWith('Selected: 8 characters');
  });

  it('loads a page’s text once', async () => {
    await renderReader();
    await longPress(pointOver(2));
    await tap();
    await longPress(pointOver(12));
    expect(engine.getTextRects).toHaveBeenCalledTimes(1);
    expect(selected()).toBeOnTheScreen();
  });

  it('copies the selection and confirms it', async () => {
    await renderReader();
    await longPress(pointOver(2));
    await act(async () => fireEvent.press(screen.getByLabelText('Copy')));
    expect(clipboard).toHaveBeenCalledWith(SECRET);
    expect(toastMessage()).toBe('Copied');
    expect(selected()).toBeNull();
  });

  it('shares the selection', async () => {
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });
    await renderReader();
    await longPress(pointOver(2));
    await act(async () => fireEvent.press(screen.getByLabelText('Share')));
    expect(share).toHaveBeenCalledWith({ message: SECRET });
    expect(selected()).toBeNull();
  });

  it('extends the selection by dragging a handle', async () => {
    await renderReader();
    await longPress(pointOver(2));
    const frame = page0();
    // From the last letter of the word to the last letter of "report".
    const dx = 14 * W * frame.pageWidth;
    await act(async () =>
      fireGestureHandler(getByGestureTestId('selection-handle-focus'), [
        { state: State.BEGAN, absoluteX: 100, absoluteY: 300 },
        { state: State.ACTIVE, absoluteX: 100, absoluteY: 300 },
        { state: State.ACTIVE, absoluteX: 100 + dx, absoluteY: 300 },
        { state: State.END, absoluteX: 100 + dx, absoluteY: 300 },
      ]),
    );
    await act(async () => fireEvent.press(screen.getByLabelText('Copy')));
    expect(clipboard).toHaveBeenCalledWith(TEXT);
  });

  it('clears on a tap without toggling the reading controls', async () => {
    await renderReader();
    await longPress(pointOver(2));
    await tap();
    expect(selected()).toBeNull();
    expect(screen.getByTestId('reader-top-bar')).toBeOnTheScreen();
  });

  it('drops a long press still loading when the page is tapped', async () => {
    let resolve: (value: PageTextRects) => void = () => undefined;
    engine.getTextRects.mockReturnValueOnce(
      new Promise<PageTextRects>((done) => {
        resolve = done;
      }),
    );
    await renderReader();
    await longPress(pointOver(2));
    await tap();
    await act(async () => resolve(pageText(TEXT)));
    expect(selected()).toBeNull();
    // The tap only cancelled the press: the reading controls stay.
    expect(screen.getByTestId('reader-top-bar')).toBeOnTheScreen();
  });

  it('selects all text on a page from the screen-reader action', async () => {
    await renderReader();
    await act(async () =>
      fireEvent(screen.getByTestId('reader-page-0'), 'accessibilityAction', {
        nativeEvent: { actionName: 'selectText' },
      }),
    );
    await wait(0);
    expect(selected()).toBeOnTheScreen();
    const page = screen.getByTestId('reader-page-0');
    expect(page.props.accessibilityActions).toContainEqual({
      name: 'selectText',
      label: 'Select all text on this page',
    });
    await act(async () => fireEvent.press(screen.getByLabelText('Copy')));
    expect(clipboard).toHaveBeenCalledWith(TEXT);
  });

  it('clears when the pages scroll', async () => {
    await renderReader();
    await longPress(pointOver(2));
    await act(async () =>
      fireEvent.scroll(screen.getByTestId('reader-pages'), {
        nativeEvent: {
          contentOffset: { x: 0, y: 300 },
          layoutMeasurement: { width: 400, height: 900 },
          contentSize: { width: 400, height: 9000 },
        },
      }),
    );
    expect(selected()).toBeNull();
  });

  it('clears when a zoom starts', async () => {
    await renderReader();
    await longPress(pointOver(2));
    await act(async () =>
      fireGestureHandler(getByGestureTestId('reader-pinch'), [
        { state: State.BEGAN, scale: 1, focalX: 100, focalY: 300 },
        { state: State.ACTIVE, scale: 1, focalX: 100, focalY: 300 },
      ]),
    );
    expect(selected()).toBeNull();

    await longPress(pointOver(2));
    expect(selected()).toBeOnTheScreen();
    await act(async () =>
      fireGestureHandler(getByGestureTestId('reader-double-tap'), [
        { state: State.BEGAN, x: 100, y: 300 },
        { state: State.ACTIVE, x: 100, y: 300 },
        { state: State.END, x: 100, y: 300 },
      ]),
    );
    expect(selected()).toBeNull();
  });

  it('clears when the search opens', async () => {
    await renderReader();
    await longPress(pointOver(2));
    await act(async () => fireEvent.press(screen.getByTestId('reader-search')));
    expect(selected()).toBeNull();
  });

  it('clears with Android back before anything else', async () => {
    const handlers: (() => boolean)[] = [];
    jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_event, handler) => {
      handlers.push(handler as () => boolean);
      return { remove: () => handlers.splice(handlers.indexOf(handler as () => boolean), 1) };
    });
    await renderReader();
    await longPress(pointOver(2));
    let handled = false;
    await act(async () => {
      handled = handlers.at(-1)?.() ?? false;
    });
    expect(handled).toBe(true);
    expect(selected()).toBeNull();
    expect(handlers).toHaveLength(0);
  });

  it('explains that an image-only page has no text to select', async () => {
    engine.getTextRects.mockResolvedValue({ text: '', boxes: [], rotation: 0 });
    await renderReader();
    await longPress(pointOver(2));
    expect(selected()).toBeNull();
    expect(toastMessage()).toBe('This page is an image; text can’t be selected');
  });

  it('selects nothing on a blank part of the page', async () => {
    await renderReader();
    const frame = page0();
    await longPress({ x: frame.pageWidth * 0.8, y: frame.top + 40 });
    expect(engine.getTextRects).toHaveBeenCalledTimes(1);
    expect(selected()).toBeNull();
    expect(toastMessage()).toBeUndefined();
  });

  it('offers a retry when reading the text fails for a passing reason', async () => {
    engine.getTextRects.mockRejectedValueOnce(coded('OUT_OF_MEMORY'));
    await renderReader();
    await longPress(pointOver(2));
    expect(selected()).toBeNull();
    const shown = useToastStore.getState().current;
    expect(shown?.actionLabel).toBe('Try again');

    await act(async () => shown?.onAction?.());
    await wait(0);
    expect(engine.getTextRects).toHaveBeenCalledTimes(2);
    expect(selected()).toBeOnTheScreen();
  });

  it.each([
    ['CORRUPT_FILE', 'This file is damaged'],
    ['NOT_FOUND', 'File not found'],
  ])('explains a %s error without a retry', async (code, title) => {
    engine.getTextRects.mockRejectedValueOnce(coded(code));
    await renderReader();
    await longPress(pointOver(2));
    const shown = useToastStore.getState().current;
    expect(shown?.message).toContain(title);
    expect(shown?.actionLabel).toBeUndefined();
    expect(selected()).toBeNull();
  });

  it('shows nothing for a cancelled read', async () => {
    engine.getTextRects.mockRejectedValueOnce(coded('CANCELLED'));
    await renderReader();
    await longPress(pointOver(2));
    expect(toastMessage()).toBeUndefined();
  });

  it('never logs or reports the selected text', async () => {
    const spies = [
      jest.spyOn(console, 'log'),
      jest.spyOn(console, 'warn'),
      jest.spyOn(console, 'error'),
    ];
    clipboard.mockRejectedValueOnce(new Error('clipboard unavailable'));
    jest.spyOn(Share, 'share').mockRejectedValueOnce(new Error('no share target'));
    await renderReader();
    await longPress(pointOver(2));
    await act(async () => fireEvent.press(screen.getByLabelText('Copy')));
    await act(async () => fireEvent.press(screen.getByLabelText('Share')));
    expect(selected()).toBeOnTheScreen();
    expect(logged(spies)).not.toContain(SECRET);
  });

  it('drops a selection still loading when the reader closes', async () => {
    let resolve: (value: PageTextRects) => void = () => undefined;
    engine.getTextRects.mockReturnValueOnce(
      new Promise<PageTextRects>((done) => {
        resolve = done;
      }),
    );
    const { unmount } = await renderReader();
    await longPress(pointOver(2));
    await act(async () => unmount());
    await act(async () => resolve(pageText(TEXT)));
    expect(toastMessage()).toBeUndefined();
    expect(reportError).not.toHaveBeenCalled();
  });
});
