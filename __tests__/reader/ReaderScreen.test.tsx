import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { useKeepAwake } from 'expo-keep-awake';
import { router } from 'expo-router';
import { AppState, Dimensions, Linking, Text, type AppStateStatus } from 'react-native';

import FileIndexModule from '../../modules/file-index/src/FileIndexModule';
import PdfEngineModule from '../../modules/pdf-engine/src/PdfEngineModule';
import { codedError, type FakePdfEngineModule } from '../engine/fakePdfEngine';
import { nativeEvent } from '../engine/fakePdfPageView';
import type { FakeFileIndexModule } from '../files/fakeFileIndex';
import { getRepositories } from '@/db/client';
import type { NewFile } from '@/db/types';
import { pageFrame } from '@/features/reader/layout';
import { SAVE_PAGE_DELAY_MS } from '@/features/reader/readingState';
import { CLOSE_DELAY_MS } from '@/features/reader/useReaderDocument';
import type { RenderPageOverlay } from '@/features/reader/components/ReaderPage';
import { ReaderScreen } from '@/features/reader/ReaderScreen';
import { reportError } from '@/lib/crash';
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
// Status bars as plain views, so a test can read whether one asks to hide.
jest.mock('expo-status-bar', () => {
  const { createElement } = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    StatusBar: (props: { hidden?: boolean }) =>
      createElement(View, { testID: 'status-bar', nativeID: props.hidden ? 'hidden' : 'shown' }),
  };
});
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
const files = FileIndexModule as unknown as FakeFileIndexModule;

function addFile(overrides: Partial<NewFile> = {}) {
  return getRepositories().files.upsert({
    path: '/storage/emulated/0/Download/report.pdf',
    uri: null,
    name: 'report.pdf',
    ext: 'pdf',
    mime: 'application/pdf',
    size: 100,
    mtime: 1,
    source: 'downloads',
    ...overrides,
  });
}

let appStateListener: ((state: AppStateStatus) => void) | null = null;

async function renderReader(fileId: number | null, renderOverlay?: RenderPageOverlay) {
  const result = await render(
    <ThemeProvider>
      <ReaderScreen fileId={fileId} renderOverlay={renderOverlay} />
    </ThemeProvider>,
  );
  // The open resolves in a microtask; FlashList lays out in a macrotask.
  await act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
  return result;
}

// In Jest every FlashList cell measures 100dp (jest.setup.ts) and the header
// adds no offset, so at 250 only the last page (200..300) is in view.
const SCROLL_TO_LAST_PAGE = 250;

const indicatorText = () =>
  screen.getByTestId('reader-page-indicator').props.accessibilityLabel as string;

// Readers close their document CLOSE_DELAY_MS after unmounting; let that
// happen inside the test that opened it, not during the next one.
afterEach(async () => {
  cleanup();
  await act(() => new Promise<void>((resolve) => setTimeout(resolve, CLOSE_DELAY_MS + 20)));
});

beforeEach(() => {
  jest.clearAllMocks();
  engine.reset();
  useThemeStore.setState({ preference: 'light' });
  for (const row of getRepositories().files.listIndexEntries()) {
    getRepositories().files.remove(row.id);
  }
  appStateListener = null;
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
    appStateListener = listener as (state: AppStateStatus) => void;
    return { remove: jest.fn() };
  });
});

describe('ReaderScreen — reading', () => {
  it('shows every page, the title and the page indicator, and keeps the screen on', async () => {
    const file = addFile();
    await renderReader(file.id);

    expect(screen.getByText('report.pdf')).toBeOnTheScreen();
    expect(screen.getByTestId('reader-page-0')).toBeOnTheScreen();
    expect(screen.getByTestId('reader-page-2')).toBeOnTheScreen();
    expect(screen.getByText('1 / 3')).toBeOnTheScreen();
    expect(indicatorText()).toBe('Page 1 of 3');
    expect(screen.getByTestId('reader-thumb-1')).toBeOnTheScreen();
    expect(useKeepAwake).toHaveBeenCalled();
  });

  it('restores the last page from reading_state, clamped to the document', async () => {
    const file = addFile();
    getRepositories().readingState.save({ fileId: file.id, page: 1, mode: 'vertical', zoom: 1 });
    await renderReader(file.id);
    expect(screen.getByText('2 / 3')).toBeOnTheScreen();
  });

  it('clamps a stored page past the end of the document', async () => {
    const file = addFile();
    getRepositories().readingState.save({ fileId: file.id, page: 40, mode: 'vertical', zoom: 1 });
    await renderReader(file.id);
    expect(screen.getByText('3 / 3')).toBeOnTheScreen();
  });

  it('restores the stored mode and switches mode, saving it at once with the zoom kept', async () => {
    const file = addFile();
    getRepositories().readingState.save({
      fileId: file.id,
      page: 0,
      mode: 'horizontal',
      zoom: 2.5,
    });
    await renderReader(file.id);
    const toggle = screen.getByTestId('reader-mode');
    expect(toggle.props.accessibilityLabel).toBe('Switch to continuous scrolling');

    await act(async () => fireEvent.press(toggle));
    expect(screen.getByTestId('reader-mode').props.accessibilityLabel).toBe(
      'Switch to page-by-page reading',
    );
    expect(getRepositories().readingState.get(file.id)).toEqual({
      fileId: file.id,
      page: 0,
      mode: 'vertical',
      zoom: 2.5,
    });
  });

  it('jumps to a valid page and saves it after the debounce', async () => {
    const file = addFile();
    getRepositories().readingState.save({ fileId: file.id, page: 0, mode: 'vertical', zoom: 3 });
    await renderReader(file.id);

    await act(async () => fireEvent.press(screen.getByTestId('reader-page-indicator')));
    const input = screen.getByTestId('reader-jump-input');
    expect(input.props.value).toBe('1');

    await act(async () => fireEvent.changeText(input, '4'));
    expect(screen.getByTestId('reader-jump-confirm')).toBeDisabled();
    expect(screen.getByText('Enter a page number from 1 to 3.')).toBeOnTheScreen();

    await act(async () => fireEvent.changeText(input, '3'));
    expect(screen.getByTestId('reader-jump-confirm')).toBeEnabled();
    await act(async () => fireEvent.press(screen.getByTestId('reader-jump-confirm')));

    expect(screen.queryByTestId('reader-jump')).toBeNull();
    expect(screen.getByText('3 / 3')).toBeOnTheScreen();
    expect(getRepositories().readingState.get(file.id)?.page).toBe(0);
    // Real timers: the page is written once it has settled for SAVE_PAGE_DELAY_MS.
    await waitFor(
      () =>
        expect(getRepositories().readingState.get(file.id)).toEqual({
          fileId: file.id,
          page: 2,
          mode: 'vertical',
          zoom: 3,
        }),
      { timeout: SAVE_PAGE_DELAY_MS * 4 },
    );
  });

  it('cancels the jump dialog without moving', async () => {
    const file = addFile();
    await renderReader(file.id);
    await act(async () => fireEvent.press(screen.getByTestId('reader-page-indicator')));
    await act(async () => fireEvent.changeText(screen.getByTestId('reader-jump-input'), '2'));
    await act(async () => fireEvent.press(screen.getByTestId('reader-jump-cancel')));
    expect(screen.queryByTestId('reader-jump')).toBeNull();
    expect(screen.getByText('1 / 3')).toBeOnTheScreen();
  });

  it('jumps from the thumbnail strip', async () => {
    const file = addFile();
    await renderReader(file.id);
    await act(async () => fireEvent.press(screen.getByTestId('reader-thumb-1')));
    expect(screen.getByText('2 / 3')).toBeOnTheScreen();
    expect(screen.getByTestId('reader-thumb-1').props.accessibilityState).toEqual({
      selected: true,
    });
  });

  it('saves a pending page when the app goes to the background', async () => {
    const file = addFile();
    await renderReader(file.id);
    await act(async () => fireEvent.press(screen.getByTestId('reader-thumb-2')));
    expect(getRepositories().readingState.get(file.id)).toBeUndefined();
    await act(async () => appStateListener?.('background'));
    expect(getRepositories().readingState.get(file.id)).toMatchObject({ page: 2, zoom: 1 });
  });

  it('saves a pending page and closes the document when the reader closes', async () => {
    const file = addFile();
    const { unmount } = await renderReader(file.id);
    const [docId] = engine.openDocIds();
    await act(async () => fireEvent.press(screen.getByTestId('reader-thumb-1')));
    await act(async () => unmount());
    expect(getRepositories().readingState.get(file.id)).toMatchObject({ page: 1 });
    // Closed a few frames later, once the page views have detached natively.
    expect(engine.close).not.toHaveBeenCalled();
    await waitFor(() => expect(engine.close).toHaveBeenCalledWith(docId), {
      timeout: CLOSE_DELAY_MS * 8,
    });
    expect(engine.openDocIds()).toEqual([]);
  });

  it('shows ERR_DOC_NOT_OPEN while reading (unexpected) in the cell, reported once', async () => {
    const file = addFile();
    await renderReader(file.id);
    for (const page of [0, 1]) {
      const view = screen.getAllByTestId(`pdf-page-view-${page}`)[0];
      if (!view) throw new Error('no page view');
      await act(async () =>
        fireEvent(view, 'renderError', nativeEvent({ page, code: 'ERR_DOC_NOT_OPEN' })),
      );
    }
    expect(screen.getByTestId('reader-page-error-0')).toBeOnTheScreen();
    expect(screen.getByTestId('reader-page-error-1')).toBeOnTheScreen();
    expect(reportError).toHaveBeenCalledTimes(1);
  });

  it('toggles the chrome (fullscreen) with a tap on a page', async () => {
    const file = addFile();
    await renderReader(file.id);
    expect(screen.getByTestId('reader-top-bar')).toBeOnTheScreen();

    const statusBarHidden = () =>
      screen.getAllByTestId('status-bar').some((node) => node.props.nativeID === 'hidden');
    expect(statusBarHidden()).toBe(false);

    await act(async () => fireEvent.press(screen.getByTestId('reader-page-0')));
    expect(statusBarHidden()).toBe(true);
    expect(screen.queryByTestId('reader-top-bar')).toBeNull();
    expect(screen.queryByTestId('reader-page-indicator')).toBeNull();
    expect(screen.queryByTestId('reader-thumbnails')).toBeNull();

    await act(async () => fireEvent.press(screen.getByTestId('reader-page-1')));
    expect(screen.getByTestId('reader-top-bar')).toBeOnTheScreen();
    expect(statusBarHidden()).toBe(false);
  });

  it('shows a page render error in its cell, and "Try again" renders it again', async () => {
    const file = addFile();
    await renderReader(file.id);
    // The main list renders first; the thumbnail of the same page comes later.
    const pageView = () => screen.getAllByTestId('pdf-page-view-1')[0];
    const view = pageView();
    if (!view) throw new Error('no page view');
    const before = view.props.retryToken as number;

    await act(async () =>
      fireEvent(view, 'renderError', nativeEvent({ page: 1, code: 'CORRUPT_FILE' })),
    );
    expect(screen.getByTestId('reader-page-error-1')).toBeOnTheScreen();
    expect(screen.getByText('This file is damaged')).toBeOnTheScreen();

    await act(async () => fireEvent.press(screen.getByText('Try again')));
    expect(screen.queryByTestId('reader-page-error-1')).toBeNull();
    expect(pageView()?.props.retryToken).toBe(before + 1);
  });

  it('keeps white pages in the dark theme and draws warm paper in sepia', async () => {
    const file = addFile();
    useThemeStore.setState({ preference: 'dark' });
    const { unmount } = await renderReader(file.id);
    let view = screen.getAllByTestId('pdf-page-view-0')[0];
    // No inversion from the app theme: it turns photos into negatives (T2.7 option).
    expect(view?.props).toMatchObject({ nightMode: false, sepia: false });
    await act(async () => unmount());

    useThemeStore.setState({ preference: 'sepia' });
    await renderReader(file.id);
    view = screen.getAllByTestId('pdf-page-view-0')[0];
    expect(view?.props).toMatchObject({ nightMode: false, sepia: true });
  });

  it('draws the overlay slot over each page, sized like the displayed page', async () => {
    const file = addFile();
    const renderOverlay = jest.fn<ReturnType<RenderPageOverlay>, Parameters<RenderPageOverlay>>(
      (page) => <Text>{`overlay ${page}`}</Text>,
    );
    await renderReader(file.id, renderOverlay);
    expect(screen.getByText('overlay 1')).toBeOnTheScreen();
    const { width, height } = Dimensions.get('window');
    const frame = pageFrame({ width: 612, height: 792 }, 'vertical', { width, height });
    expect(renderOverlay).toHaveBeenCalledWith(1, {
      width: frame.pageWidth,
      height: frame.pageHeight,
    });
    const layer = screen.getByTestId('reader-overlay-1');
    expect(layer.props.pointerEvents).toBe('box-none');
  });

  it('keeps each reader on its own page (no shared state between readers)', async () => {
    const first = addFile();
    const second = addFile({ path: '/storage/emulated/0/Download/other.pdf', name: 'other.pdf' });
    await render(
      <ThemeProvider>
        <ReaderScreen fileId={first.id} />
        <ReaderScreen fileId={second.id} />
      </ThemeProvider>,
    );
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
    const [thumbOfFirst] = screen.getAllByTestId('reader-thumb-2');
    if (!thumbOfFirst) throw new Error('no thumbnail');
    await act(async () => fireEvent.press(thumbOfFirst));
    expect(
      screen.getAllByTestId('reader-page-indicator').map((node) => node.props.accessibilityLabel),
    ).toEqual(['Page 3 of 3', 'Page 1 of 3']);
  });

  it('follows scrolling: the most visible page becomes current and is saved once settled', async () => {
    const file = addFile();
    await renderReader(file.id);
    const list = screen.getByTestId('reader-pages');
    // Drives the real FlashList: its own layouts decide the page (pageAtScroll).
    const scrollTo = async (y: number) =>
      act(async () =>
        fireEvent.scroll(list, {
          nativeEvent: {
            contentOffset: { x: 0, y },
            layoutMeasurement: { width: 400, height: 900 },
            contentSize: { width: 400, height: 4000 },
          },
        }),
      );
    await scrollTo(SCROLL_TO_LAST_PAGE);
    expect(screen.getByText('3 / 3')).toBeOnTheScreen();
    expect(getRepositories().readingState.get(file.id)).toBeUndefined();
    await waitFor(
      () => expect(getRepositories().readingState.get(file.id)).toMatchObject({ page: 2 }),
      { timeout: SAVE_PAGE_DELAY_MS * 4 },
    );
  });

  const frameOpacity = () => {
    const style = screen.getByTestId('reader-pages-frame').props.style as { opacity: number };
    return style.opacity;
  };

  it('a viewport change while anchoring ends with the list visible on the anchor page', async () => {
    const file = addFile();
    getRepositories().readingState.save({ fileId: file.id, page: 2, mode: 'vertical', zoom: 1 });
    await renderReader(file.id);
    // The container measures differently from the window right away (rotation).
    await act(async () =>
      fireEvent(screen.getByTestId('reader'), 'layout', {
        nativeEvent: { layout: { x: 0, y: 0, width: 640, height: 360 } },
      }),
    );
    await waitFor(() => expect(frameOpacity()).toBe(1), { timeout: 3000 });
    // Any stale timer of the first list has run by now and changed nothing.
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 1200)));
    expect(frameOpacity()).toBe(1);
    expect(screen.getByText('3 / 3')).toBeOnTheScreen();
  });

  it('re-anchors after vertical → horizontal → vertical, keeping the page', async () => {
    const file = addFile();
    getRepositories().readingState.save({ fileId: file.id, page: 2, mode: 'vertical', zoom: 1 });
    await renderReader(file.id);
    await act(async () => fireEvent.press(screen.getByTestId('reader-mode')));
    await act(async () => fireEvent.press(screen.getByTestId('reader-mode')));
    await waitFor(() => expect(frameOpacity()).toBe(1), { timeout: 3000 });
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 1200)));
    expect(frameOpacity()).toBe(1);
    expect(screen.getByText('3 / 3')).toBeOnTheScreen();
    expect(getRepositories().readingState.get(file.id)).toMatchObject({
      page: 2,
      mode: 'vertical',
    });
  });

  it('goes back from the top bar', async () => {
    const file = addFile();
    await renderReader(file.id);
    await act(async () => fireEvent.press(screen.getByTestId('reader-back')));
    expect(router.back).toHaveBeenCalled();
  });
});

describe('ReaderScreen — files that cannot be read', () => {
  it('shows a locked state for a password-protected PDF, with Back', async () => {
    const file = addFile();
    engine.open.mockRejectedValueOnce(codedError('PASSWORD_REQUIRED'));
    await renderReader(file.id);
    expect(screen.getByText('This file is password-protected')).toBeOnTheScreen();
    expect(
      screen.getByText("Opening password-protected files isn't available yet."),
    ).toBeOnTheScreen();
    await act(async () => fireEvent.press(screen.getByTestId('reader-action-back')));
    expect(router.back).toHaveBeenCalled();
  });

  it('offers another file for a damaged PDF, landing in the library when there is no back', async () => {
    jest.mocked(router.canGoBack).mockReturnValueOnce(false);
    const file = addFile();
    engine.open.mockRejectedValueOnce(codedError('CORRUPT_FILE'));
    await renderReader(file.id);
    expect(screen.getByText('This file is damaged')).toBeOnTheScreen();
    await act(async () => fireEvent.press(screen.getByText('Choose another file')));
    expect(router.replace).toHaveBeenCalledWith('/');
  });

  it('PERMISSION_DENIED on a path: opens all-files access settings, then tries again', async () => {
    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue();
    const file = addFile();
    engine.open.mockRejectedValueOnce(codedError('PERMISSION_DENIED'));
    await renderReader(file.id);
    expect(screen.getByTestId('reader-action-back')).toBeOnTheScreen();
    await act(async () => fireEvent.press(screen.getByText('Open Settings')));
    expect(files.openAllFilesAccessSettings).toHaveBeenCalled();
    expect(openSettings).not.toHaveBeenCalled();
    await act(async () => fireEvent.press(screen.getByText('Try again')));
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
    expect(screen.getByTestId('reader')).toBeOnTheScreen();
  });

  it('PERMISSION_DENIED on a content:// URI: picks the file again and reopens the reader on it', async () => {
    const file = addFile({ path: 'content://provider/doc/lost', source: 'device' });
    engine.open.mockRejectedValueOnce(codedError('PERMISSION_DENIED'));
    files.pickDocuments.mockResolvedValueOnce([
      {
        uri: 'content://provider/doc/fresh',
        name: 'report.pdf',
        size: 100,
        mime: 'application/pdf',
        mtime: 1,
        persisted: true,
      },
    ]);
    await renderReader(file.id);
    expect(files.openAllFilesAccessSettings).not.toHaveBeenCalled();
    expect(screen.getByTestId('reader-action-retry')).toBeOnTheScreen();
    expect(screen.getByTestId('reader-action-back')).toBeOnTheScreen();

    await act(async () => fireEvent.press(screen.getByTestId('reader-action-pickAgain')));
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
    expect(files.pickDocuments).toHaveBeenCalledWith(
      expect.objectContaining({ mimeTypes: ['application/pdf'], multiple: false }),
    );
    const picked = getRepositories().files.getByPath('content://provider/doc/fresh');
    expect(picked).toBeDefined();
    expect(router.replace).toHaveBeenCalledWith({
      pathname: '/reader/[fileId]',
      params: { fileId: String(picked?.id) },
    });
  });

  it('re-pick folded into the scanned row of the same file: opens that row, position carried over', async () => {
    const scanned = addFile({ path: '/storage/emulated/0/Download/report.pdf', mtime: 5_000 });
    const lost = addFile({
      path: 'content://provider/doc/lost',
      name: 'old name.pdf',
      source: 'device',
    });
    getRepositories().readingState.save({ fileId: lost.id, page: 2, mode: 'horizontal', zoom: 2 });
    engine.open.mockRejectedValueOnce(codedError('PERMISSION_DENIED'));
    files.pickDocuments.mockResolvedValueOnce([
      {
        uri: 'content://provider/doc/fresh',
        name: 'report.pdf',
        size: 100,
        mime: 'application/pdf',
        mtime: 5_000,
        persisted: true,
      },
    ]);
    await renderReader(lost.id);
    await act(async () => fireEvent.press(screen.getByTestId('reader-action-pickAgain')));
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

    // The pick was merged away into the scanned row in the same call.
    expect(getRepositories().files.getByPath('content://provider/doc/fresh')).toBeUndefined();
    expect(getRepositories().files.getById(scanned.id)?.uri).toBe('content://provider/doc/fresh');
    expect(router.replace).toHaveBeenCalledWith({
      pathname: '/reader/[fileId]',
      params: { fileId: String(scanned.id) },
    });
    expect(getRepositories().readingState.get(scanned.id)).toEqual({
      fileId: scanned.id,
      page: 2,
      mode: 'horizontal',
      zoom: 2,
    });
  });

  it('re-pick keeps a position the target row already has', async () => {
    const scanned = addFile({ path: '/storage/emulated/0/Download/report.pdf', mtime: 5_000 });
    const lost = addFile({
      path: 'content://provider/doc/lost',
      name: 'old name.pdf',
      source: 'device',
    });
    getRepositories().readingState.save({ fileId: scanned.id, page: 7, mode: 'vertical', zoom: 1 });
    getRepositories().readingState.save({ fileId: lost.id, page: 2, mode: 'horizontal', zoom: 2 });
    engine.open.mockRejectedValueOnce(codedError('PERMISSION_DENIED'));
    files.pickDocuments.mockResolvedValueOnce([
      {
        uri: 'content://provider/doc/fresh',
        name: 'report.pdf',
        size: 100,
        mime: 'application/pdf',
        mtime: 5_000,
        persisted: true,
      },
    ]);
    await renderReader(lost.id);
    await act(async () => fireEvent.press(screen.getByTestId('reader-action-pickAgain')));
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

    expect(router.replace).toHaveBeenCalledWith({
      pathname: '/reader/[fileId]',
      params: { fileId: String(scanned.id) },
    });
    expect(getRepositories().readingState.get(scanned.id)).toEqual({
      fileId: scanned.id,
      page: 7,
      mode: 'vertical',
      zoom: 1,
    });
  });

  it('does not navigate when the error screen closed during the re-pick', async () => {
    const file = addFile({ path: 'content://provider/doc/lost', source: 'device' });
    engine.open.mockRejectedValueOnce(codedError('PERMISSION_DENIED'));
    let finishPick: (docs: never[]) => void = () => undefined;
    files.pickDocuments.mockImplementationOnce(
      () => new Promise((resolve) => (finishPick = resolve as (docs: never[]) => void)),
    );
    const { unmount } = await renderReader(file.id);
    await act(async () => fireEvent.press(screen.getByTestId('reader-action-pickAgain')));
    await act(async () => unmount());
    files.pickDocuments.mockClear();
    await act(async () => {
      finishPick([]);
    });
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('NO_SPACE: offers to free up space (storage settings), then Try again and Back', async () => {
    const sendIntent = jest.spyOn(Linking, 'sendIntent').mockResolvedValue();
    const file = addFile();
    engine.open.mockRejectedValueOnce(codedError('NO_SPACE'));
    await renderReader(file.id);
    expect(screen.getByTestId('reader-action-retry')).toBeOnTheScreen();
    expect(screen.getByTestId('reader-action-back')).toBeOnTheScreen();
    await act(async () => fireEvent.press(screen.getByText('Free up space')));
    expect(sendIntent).toHaveBeenCalledWith('android.settings.INTERNAL_STORAGE_SETTINGS');
  });

  it.each(['OUT_OF_MEMORY', 'ERR_SOMETHING'])(
    'offers Try again for %s, which reopens the file',
    async (code) => {
      const file = addFile();
      engine.open.mockRejectedValueOnce(codedError(code));
      await renderReader(file.id);
      expect(screen.getByTestId('reader-action-retry')).toBeOnTheScreen();
      expect(screen.getByTestId('reader-action-back')).toBeOnTheScreen();
      await act(async () => fireEvent.press(screen.getByTestId('reader-action-retry')));
      await act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
      expect(engine.open).toHaveBeenCalledTimes(2);
      expect(screen.getByText('1 / 3')).toBeOnTheScreen();
    },
  );

  it('shows File not found for a missing library row', async () => {
    await renderReader(424242);
    expect(screen.getByTestId('reader-error-NOT_FOUND')).toBeOnTheScreen();
    expect(screen.getByText('File not found')).toBeOnTheScreen();
    expect(engine.open).not.toHaveBeenCalled();
  });

  it('explains an unsupported file type and shares it to another app', async () => {
    const file = addFile({
      path: '/storage/emulated/0/Download/notes.docx',
      name: 'notes.docx',
      ext: 'docx',
      mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    await renderReader(file.id);
    expect(screen.getByTestId('reader-unsupported')).toBeOnTheScreen();
    expect(screen.getByText("This file type isn't supported")).toBeOnTheScreen();
    expect(engine.open).not.toHaveBeenCalled();

    await act(async () => fireEvent.press(screen.getByText('Share to another app')));
    expect(files.share).toHaveBeenCalledWith(
      ['/storage/emulated/0/Download/notes.docx'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    await act(async () => fireEvent.press(screen.getByTestId('reader-action-back')));
    expect(router.back).toHaveBeenCalled();
  });
});
