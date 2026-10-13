import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { PixelRatio } from 'react-native';

import DevPages from '../../app/dev/pages';
import FileIndexModule from '../../modules/file-index/src/FileIndexModule';
import PdfEngineModule from '../../modules/pdf-engine/src/PdfEngineModule';
import type { FakeFileIndexModule } from '../files/fakeFileIndex';
import { codedError, FAKE_PAGE_COUNT, type FakePdfEngineModule } from './fakePdfEngine';
import { nativeEvent } from './fakePdfPageView';
import { ThemeProvider } from '@/theme';

jest.mock('../../modules/file-index/src/FileIndexModule', () =>
  jest.requireActual('../files/fakeFileIndex').createFakeFileIndexModule(),
);
jest.mock('../../modules/pdf-engine/src/PdfEngineModule', () =>
  jest.requireActual('./fakePdfEngine').createFakePdfEngineModule(),
);
jest.mock('../../modules/pdf-engine/src/PdfPageView', () =>
  jest.requireActual('./fakePdfPageView').createFakePdfPageViewModule(),
);
jest.mock('expo-router', () => ({ Redirect: () => null }));

const files = FileIndexModule as unknown as FakeFileIndexModule;
const engine = PdfEngineModule as unknown as FakePdfEngineModule;
const URI = 'content://downloads/public_downloads/7';

async function renderPages() {
  await render(
    <ThemeProvider>
      <DevPages />
    </ThemeProvider>,
  );
}

async function pickPdf() {
  files.pickDocuments.mockResolvedValueOnce([
    { uri: URI, name: 'big.pdf', size: 1, mime: 'application/pdf', mtime: 1, persisted: false },
  ]);
  await fireEvent.press(screen.getByRole('button', { name: 'Pick PDF' }));
  // FlashList finishes its first layout pass in a macrotask.
  await act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
}

beforeEach(() => {
  jest.clearAllMocks();
  engine.reset();
});

describe('dev page view screen', () => {
  it('opens the picked PDF and renders a page view per page', async () => {
    await renderPages();
    await pickPdf();

    expect(files.pickDocuments).toHaveBeenCalledWith(
      expect.objectContaining({ mimeTypes: ['application/pdf'], multiple: false }),
    );
    expect(engine.open).toHaveBeenCalledWith(URI, null, expect.any(String));
    for (let page = 0; page < FAKE_PAGE_COUNT; page += 1) {
      const view = screen.getByTestId(`pdf-page-view-${page}`);
      expect(view.props.docId).toBe('doc-1');
      expect(view.props.renderScale).toBe(PixelRatio.get());
    }
  });

  it('applies the night, sepia and 2× toggles', async () => {
    await renderPages();
    await pickPdf();
    await fireEvent.press(screen.getByRole('button', { name: 'Night off' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Sepia off' }));
    await fireEvent.press(screen.getByRole('button', { name: '2×' }));

    const view = screen.getByTestId('pdf-page-view-0');
    expect(view.props.nightMode).toBe(true);
    expect(view.props.sepia).toBe(true);
    expect(view.props.renderScale).toBe(PixelRatio.get() * 2);
  });

  it('shows per-page render stats, errors and the average', async () => {
    await renderPages();
    await pickPdf();
    await fireEvent(
      screen.getByTestId('pdf-page-view-0'),
      'rendered',
      nativeEvent({ page: 0, widthPx: 800, heightPx: 1035, ms: 20 }),
    );
    await fireEvent(
      screen.getByTestId('pdf-page-view-1'),
      'rendered',
      nativeEvent({ page: 1, widthPx: 800, heightPx: 1035, ms: 40 }),
    );
    await fireEvent(
      screen.getByTestId('pdf-page-view-2'),
      'renderError',
      nativeEvent({ page: 2, code: 'CORRUPT_FILE' }),
    );

    expect(screen.getByText('p1 · 20 ms · 800×1035px')).toBeOnTheScreen();
    expect(screen.getByText('p3 · CORRUPT_FILE (CORRUPT_FILE)')).toBeOnTheScreen();
    expect(screen.getByText('avg 30.0 ms · 2 renders · 1 errors')).toBeOnTheScreen();
  });

  it('asks for a password and reopens with it', async () => {
    engine.open.mockRejectedValueOnce(codedError('PASSWORD_REQUIRED'));
    await renderPages();
    await pickPdf();

    expect(screen.getByText('Password required')).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByTestId('dev-pages-password'), 'secret');
    await fireEvent.press(screen.getByRole('button', { name: 'Open' }));
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

    expect(engine.open).toHaveBeenLastCalledWith(URI, 'secret', expect.any(String));
    await waitFor(() => expect(screen.getByTestId('pdf-page-view-0')).toBeOnTheScreen());
  });

  it('shows other open errors', async () => {
    engine.open.mockRejectedValueOnce(codedError('CORRUPT_FILE'));
    await renderPages();
    await pickPdf();
    expect(screen.getByText('Error: CORRUPT_FILE')).toBeOnTheScreen();
  });

  it('closes the document on unmount', async () => {
    await renderPages();
    await pickPdf();
    expect(engine.openDocIds()).toEqual(['doc-1']);

    await screen.unmount();
    expect(engine.close).toHaveBeenCalledWith('doc-1');
    expect(engine.openDocIds()).toEqual([]);
  });

  it('cancels an open still running on unmount', async () => {
    engine.setHoldOpens(true);
    await renderPages();
    await pickPdf();
    expect(engine.pendingOpenIds()).toHaveLength(1);

    await screen.unmount();
    expect(engine.cancelOpen).toHaveBeenCalled();
    expect(engine.pendingOpenIds()).toEqual([]);
  });
});
