// Zoom (T2.4) on the reader screen: gestures are driven through
// react-native-gesture-handler's Jest utilities.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react-native';
import { AppState, Dimensions } from 'react-native';
import { State } from 'react-native-gesture-handler';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';

import PdfEngineModule from '../../modules/pdf-engine/src/PdfEngineModule';
import type { FakePdfEngineModule } from '../engine/fakePdfEngine';
import { nativeEvent } from '../engine/fakePdfPageView';
import { getRepositories } from '@/db/client';
import type { NewFile } from '@/db/types';
import type { RenderPageOverlay } from '@/features/reader/components/ReaderPage';
import { pageFrame } from '@/features/reader/layout';
import { ReaderScreen } from '@/features/reader/ReaderScreen';
import { CLOSE_DELAY_MS } from '@/features/reader/useReaderDocument';
import { DETAIL_SETTLE_MS } from '@/features/reader/zoom';
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

async function renderReader(fileId: number, renderOverlay?: RenderPageOverlay) {
  const result = await render(
    <ThemeProvider>
      <ReaderScreen fileId={fileId} renderOverlay={renderOverlay} />
    </ThemeProvider>,
  );
  // The open resolves in a microtask; FlashList lays out in a macrotask.
  await act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
  return result;
}

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
  jest.spyOn(AppState, 'addEventListener').mockImplementation(() => ({ remove: jest.fn() }));
});

const winWidth = Dimensions.get('window').width;
const cellWidth = (page: number) =>
  (screen.getByTestId(`reader-page-${page}`).props.style as { width: number }).width;
const settle = () =>
  act(() => new Promise<void>((resolve) => setTimeout(resolve, DETAIL_SETTLE_MS + 30)));

async function doubleTap(x = 100, y = 300) {
  await act(async () =>
    fireGestureHandler(getByGestureTestId('reader-double-tap'), [
      { state: State.BEGAN, x, y },
      { state: State.ACTIVE, x, y },
      { state: State.END, x, y },
    ]),
  );
}

async function pinch(scale: number, focalX = 100, focalY = 300) {
  await act(async () =>
    fireGestureHandler(getByGestureTestId('reader-pinch'), [
      { state: State.BEGAN, scale: 1, focalX, focalY },
      { state: State.ACTIVE, scale: 1, focalX, focalY },
      { state: State.ACTIVE, scale, focalX, focalY },
      { state: State.END, scale, focalX, focalY },
    ]),
  );
}

describe('ReaderScreen — zoom (T2.4)', () => {
  it('double tap zooms to 2.5× and back to 1×, saving the zoom', async () => {
    const file = addFile();
    await renderReader(file.id);
    expect(cellWidth(0)).toBeCloseTo(winWidth);
    expect(screen.getByTestId('reader-pan').props.scrollEnabled).toBe(false);

    await doubleTap();
    expect(cellWidth(0)).toBeCloseTo(winWidth * 2.5);
    expect(screen.getByTestId('reader-pan').props.scrollEnabled).toBe(true);
    expect(getRepositories().readingState.get(file.id)).toMatchObject({ zoom: 2.5 });

    await doubleTap();
    expect(cellWidth(0)).toBeCloseTo(winWidth);
    expect(getRepositories().readingState.get(file.id)).toMatchObject({ zoom: 1 });
  });

  it('a pinch commits its zoom on release, clamped to 5×', async () => {
    const file = addFile();
    await renderReader(file.id);
    await pinch(3);
    expect(cellWidth(1)).toBeCloseTo(winWidth * 3);
    expect(getRepositories().readingState.get(file.id)).toMatchObject({ zoom: 3 });

    await pinch(4);
    expect(cellWidth(1)).toBeCloseTo(winWidth * 5);
    expect(getRepositories().readingState.get(file.id)).toMatchObject({ zoom: 5 });

    await pinch(0.01);
    expect(cellWidth(1)).toBeCloseTo(winWidth);
  });

  it('restores the saved zoom with the page, and the overlay follows the zoomed page', async () => {
    const file = addFile();
    getRepositories().readingState.save({ fileId: file.id, page: 1, mode: 'vertical', zoom: 2 });
    const renderOverlay = jest.fn<ReturnType<RenderPageOverlay>, Parameters<RenderPageOverlay>>(
      () => null,
    );
    await renderReader(file.id, renderOverlay);
    expect(screen.getByText('2 / 3')).toBeOnTheScreen();
    expect(cellWidth(1)).toBeCloseTo(winWidth * 2);
    const { width, height } = Dimensions.get('window');
    const frame = pageFrame({ width: 612, height: 792 }, 'vertical', { width, height });
    expect(renderOverlay).toHaveBeenLastCalledWith(expect.any(Number), {
      width: frame.pageWidth * 2,
      height: frame.pageHeight * 2,
    });
  });

  it('paged mode: paging is off while zoomed in and back on at 1×', async () => {
    const file = addFile();
    getRepositories().readingState.save({ fileId: file.id, page: 0, mode: 'horizontal', zoom: 2 });
    await renderReader(file.id);
    expect(screen.getByTestId('reader-pages').props.pagingEnabled).toBe(false);
    // Sideways pan of a paged list is vertical.
    expect(screen.getByTestId('reader-pan').props.horizontal).toBe(false);

    await doubleTap();
    expect(screen.getByTestId('reader-pages').props.pagingEnabled).toBe(true);
    expect(getRepositories().readingState.get(file.id)).toMatchObject({
      mode: 'horizontal',
      zoom: 1,
    });
  });

  it('keeps the page indicator on the list axis while zoomed (sideways pan ignored)', async () => {
    const file = addFile();
    getRepositories().readingState.save({ fileId: file.id, page: 0, mode: 'vertical', zoom: 2 });
    await renderReader(file.id);
    await act(async () =>
      fireEvent.scroll(screen.getByTestId('reader-pan'), {
        nativeEvent: {
          contentOffset: { x: 600, y: 0 },
          layoutMeasurement: { width: 400, height: 900 },
          contentSize: { width: 1600, height: 900 },
        },
      }),
    );
    expect(screen.getByText('1 / 3')).toBeOnTheScreen();
    // Jest's FlashList cells measure 100dp: at 250 only page 3 is in view.
    await act(async () =>
      fireEvent.scroll(screen.getByTestId('reader-pages'), {
        nativeEvent: {
          contentOffset: { x: 0, y: 250 },
          layoutMeasurement: { width: 400, height: 900 },
          contentSize: { width: 400, height: 4000 },
        },
      }),
    );
    expect(screen.getByText('3 / 3')).toBeOnTheScreen();
  });

  it('jumping keeps the zoom', async () => {
    const file = addFile();
    await renderReader(file.id);
    await doubleTap();
    await act(async () => fireEvent.press(screen.getByTestId('reader-thumb-2')));
    expect(screen.getByText('3 / 3')).toBeOnTheScreen();
    expect(cellWidth(2)).toBeCloseTo(winWidth * 2.5);
  });

  it('sends detail regions of the visible pages whenever settled, at 1× too', async () => {
    const info = jest.spyOn(console, 'info').mockImplementation(() => undefined);
    const file = addFile();
    await renderReader(file.id);
    const detail = (page: number) =>
      screen.getAllByTestId(`pdf-page-view-${page}`)[0]?.props.detailRegion as unknown;
    await settle();
    // 1×: the page fills the width (the native view only tiles a capped page).
    expect(detail(0)).toEqual(expect.objectContaining({ x: 0, width: 1 }));

    await doubleTap();
    // None during the gesture and until it settles.
    expect(detail(0)).toBeNull();
    await settle();
    // The page is 2.5× the viewport wide; the tap at x 100 stayed under the
    // finger, so the sideways pan is at 100 × 2.5 − 100 = 150.
    expect(detail(0)).toEqual(
      expect.objectContaining({
        x: expect.closeTo(150 / (winWidth * 2.5), 5),
        width: expect.closeTo(1 / 2.5, 5),
      }),
    );

    // The dev metric logs each tile: time since settle, queue wait, render.
    const view = screen.getAllByTestId('pdf-page-view-0')[0];
    if (!view) throw new Error('no page view');
    await act(async () =>
      fireEvent(
        view,
        'detailRendered',
        nativeEvent({
          page: 0,
          region: { x: 0, y: 0, width: 0.4, height: 0.2 },
          widthPx: 1080,
          heightPx: 900,
          ms: 120,
          waitMs: 15,
        }),
      ),
    );
    expect(info).toHaveBeenCalledWith(
      expect.stringMatching(/ms after settle \(wait 15 ms, render 120 ms/),
    );
    info.mockRestore();
  });

  it('keeps the regions of pages still in view while panning, and updates them once settled', async () => {
    const file = addFile();
    getRepositories().readingState.save({ fileId: file.id, page: 0, mode: 'vertical', zoom: 2 });
    await renderReader(file.id);
    await settle();
    const detail = () => screen.getAllByTestId('pdf-page-view-0')[0]?.props.detailRegion as unknown;
    expect(detail()).not.toBeNull();
    await act(async () =>
      fireEvent.scroll(screen.getByTestId('reader-pan'), {
        nativeEvent: {
          contentOffset: { x: 120, y: 0 },
          layoutMeasurement: { width: 400, height: 900 },
          contentSize: { width: 1600, height: 900 },
        },
      }),
    );
    // Still in view: its sharp tile stays while moving (the old region).
    expect(detail()).toEqual(expect.objectContaining({ x: 0 }));
    await settle();
    expect(detail()).toEqual(
      expect.objectContaining({ x: expect.closeTo(120 / (winWidth * 2), 5) }),
    );
  });

  it('puts the gesture detector on an untransformed view around the zoom transform', async () => {
    const file = addFile();
    await renderReader(file.id);
    const area = screen.getByTestId('reader-gesture-area');
    expect(area.props.style).toBeUndefined();
    expect(within(area).getByTestId('reader-zoom')).toBeOnTheScreen();
  });

  it('offers zoom in / zoom out to screen readers on each page', async () => {
    const file = addFile();
    await renderReader(file.id);
    const page = screen.getByTestId('reader-page-0');
    expect(page.props.accessibilityActions).toEqual(
      expect.arrayContaining([
        { name: 'zoomIn', label: 'Zoom in' },
        { name: 'zoomOut', label: 'Zoom out' },
      ]),
    );
    const act11y = (actionName: string) =>
      act(async () =>
        fireEvent(screen.getByTestId('reader-page-0'), 'accessibilityAction', {
          nativeEvent: { actionName },
        }),
      );
    await act11y('zoomIn');
    expect(cellWidth(0)).toBeCloseTo(winWidth * 1.5);
    await act11y('zoomIn');
    expect(cellWidth(0)).toBeCloseTo(winWidth * 2.25);
    expect(getRepositories().readingState.get(file.id)).toMatchObject({ zoom: 2.25 });
    await act11y('zoomOut');
    await act11y('zoomOut');
    expect(cellWidth(0)).toBeCloseTo(winWidth);
  });

  it('a pinch that only moves (same zoom) pans by the fingers’ travel', async () => {
    const file = addFile();
    getRepositories().readingState.save({ fileId: file.id, page: 0, mode: 'vertical', zoom: 2 });
    await renderReader(file.id);
    await act(async () =>
      fireEvent.scroll(screen.getByTestId('reader-pan'), {
        nativeEvent: {
          contentOffset: { x: 300, y: 0 },
          layoutMeasurement: { width: 400, height: 900 },
          contentSize: { width: 1600, height: 900 },
        },
      }),
    );
    await settle();
    await act(async () =>
      fireGestureHandler(getByGestureTestId('reader-pinch'), [
        { state: State.BEGAN, scale: 1, focalX: 200, focalY: 300 },
        { state: State.ACTIVE, scale: 1, focalX: 200, focalY: 300 },
        { state: State.ACTIVE, scale: 1, focalX: 120, focalY: 300 },
        { state: State.END, scale: 1, focalX: 120, focalY: 300 },
      ]),
    );
    await settle();
    // Fingers moved 80 left: the page followed, so the pan is now 380.
    expect(screen.getAllByTestId('pdf-page-view-0')[0]?.props.detailRegion as unknown).toEqual(
      expect.objectContaining({ x: expect.closeTo(380 / (winWidth * 2), 5) }),
    );
    expect(cellWidth(0)).toBeCloseTo(winWidth * 2);
  });

  it('drops detail tiles when a pinch starts', async () => {
    const file = addFile();
    getRepositories().readingState.save({ fileId: file.id, page: 0, mode: 'vertical', zoom: 2 });
    await renderReader(file.id);
    await settle();
    const detail = () => screen.getAllByTestId('pdf-page-view-0')[0]?.props.detailRegion as unknown;
    expect(detail()).not.toBeNull();
    await act(async () =>
      fireGestureHandler(getByGestureTestId('reader-pinch'), [
        { state: State.BEGAN, scale: 1, focalX: 10, focalY: 10 },
        { state: State.ACTIVE, scale: 1, focalX: 10, focalY: 10 },
        { state: State.ACTIVE, scale: 1.2, focalX: 10, focalY: 10 },
      ]),
    );
    expect(detail()).toBeNull();
  });
});
