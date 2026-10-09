import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import Storage from 'expo-sqlite/kv-store';
import { AppState, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import FileIndexModule from '../../modules/file-index/src/FileIndexModule';
import PdfEngineModule from '../../modules/pdf-engine/src/PdfEngineModule';
import type { FakePdfEngineModule } from '../engine/fakePdfEngine';
import type { FakeFileIndexModule } from '../files/fakeFileIndex';
import { ToastHost, useToastStore } from '@/components/ui';
import { getRepositories } from '@/db/client';
import type { NewFile } from '@/db/types';
import { LibraryScreen } from '@/features/library/LibraryScreen';
import { useLibraryPrefsStore } from '@/features/library/store';
import { clearThumbnailMemo } from '@/features/library/useThumbnail';
import { useOnboardingStore } from '@/features/onboarding/store';
import { formatDate } from '@/i18n';
import { useAllFilesAccessStore } from '@/lib/files';
import { bumpLibraryVersion } from '@/lib/library';
import { ThemeProvider } from '@/theme';

jest.mock('../../modules/file-index/src/FileIndexModule', () =>
  jest.requireActual('../files/fakeFileIndex').createFakeFileIndexModule(),
);
jest.mock('../../modules/pdf-engine/src/PdfEngineModule', () =>
  jest.requireActual('../engine/fakePdfEngine').createFakePdfEngineModule(),
);
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/db/client', () => {
  const { createTestDatabase } =
    jest.requireActual<typeof import('../db/testDatabase')>('../db/testDatabase');
  const { createRepositories } =
    jest.requireActual<typeof import('@/db/repositories')>('@/db/repositories');
  const repositories = createRepositories(createTestDatabase().db);
  return { getRepositories: () => repositories, getDatabase: jest.fn() };
});

const files = FileIndexModule as unknown as FakeFileIndexModule;
const engine = PdfEngineModule as unknown as FakePdfEngineModule;
const DL = '/storage/emulated/0/Download';
const WA = '/storage/emulated/0/WhatsApp/Media/WhatsApp Documents';

function row(path: string, overrides: Partial<NewFile> = {}): NewFile {
  const name = path.split('/').pop() ?? path;
  return {
    path,
    uri: null,
    name,
    ext: name.split('.').pop() ?? '',
    mime: null,
    size: 1_500_000,
    mtime: Date.UTC(2026, 9, 4, 12),
    source: 'downloads',
    ...overrides,
  };
}

function seed() {
  return getRepositories().files.upsertMany([
    row(`${DL}/banana report.pdf`, { mtime: Date.UTC(2026, 9, 3, 12), size: 3_000 }),
    row(`${DL}/Apple notes.docx`, { mtime: Date.UTC(2026, 9, 1, 12), size: 1_000 }),
    row(`${WA}/cherry budget.xlsx`, { mtime: Date.UTC(2026, 9, 2, 12), source: 'whatsapp' }),
    row(`${DL}/readme.txt`, { mtime: Date.UTC(2026, 8, 30, 12), size: 10 }),
  ]);
}

async function renderLibrary() {
  await render(
    <ThemeProvider>
      <LibraryScreen />
      <ToastHost />
    </ThemeProvider>,
  );
  // FlashList finishes its first layout pass in a macrotask.
  await act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
}

type HostNode = ReturnType<typeof screen.getByTestId>;

// FlashList recycles cells, so tree order is not screen order after the data
// is reordered; each cell's container is absolutely positioned at `top`.
function topOf(node: HostNode): number {
  for (let current = node.parent; current; current = current.parent) {
    const top = StyleSheet.flatten(current.props.style as StyleProp<ViewStyle>)?.top;
    if (typeof top === 'number') return top;
  }
  return 0;
}

/** Visible list rows, top to bottom. */
const rowNames = () =>
  screen
    .queryAllByTestId(/^library-row-/)
    .map((node) => ({ top: topOf(node), label: node.props.accessibilityLabel as string }))
    .sort((a, b) => a.top - b.top)
    .map(({ label }) => label.split(', ')[0]);

beforeEach(() => {
  jest.clearAllMocks();
  (Storage as unknown as { clearSync: () => boolean }).clearSync();
  useLibraryPrefsStore.setState({
    view: 'list',
    sort: 'name',
    sortDir: 'asc',
    tab: 'all',
    chip: 'all',
  });
  useOnboardingStore.setState({ onboardingComplete: true });
  useAllFilesAccessStore.setState({ granted: null });
  useToastStore.setState({ current: null });
  files.hasAllFilesAccess.mockImplementation(() => true);
  files.pickDocuments.mockImplementation(() => Promise.resolve([]));
  engine.reset();
  clearThumbnailMemo();
  for (const entry of getRepositories().files.listIndexEntries()) {
    getRepositories().files.remove(entry.id);
  }
  jest.spyOn(AppState, 'addEventListener').mockImplementation(() => ({ remove: jest.fn() }));
});

afterEach(() => jest.restoreAllMocks());

describe('LibraryScreen', () => {
  it('lists every file with its size and date, sorted by the saved sort', async () => {
    seed();
    await renderLibrary();
    expect(rowNames()).toEqual([
      'Apple notes.docx',
      'banana report.pdf',
      'cherry budget.xlsx',
      'readme.txt',
    ]);
    expect(
      screen.getByText(`1.5 MB · ${formatDate(Date.UTC(2026, 9, 2, 12), 'en')}`),
    ).toBeOnTheScreen();
    // Rows do not open files until the reader exists; the only control on a
    // row is its actions button.
    expect(
      screen
        .queryAllByRole('button', { name: /banana report/ })
        .map((node) => node.props.accessibilityLabel as string),
    ).toEqual(['More actions for banana report.pdf']);
  });

  it('filters by type tab and by source chip', async () => {
    seed();
    await renderLibrary();
    const pdfTab = screen.getByRole('tab', { name: 'PDF' });
    expect(pdfTab).not.toBeSelected();

    await fireEvent.press(pdfTab);
    expect(screen.getByRole('tab', { name: 'PDF' })).toBeSelected();
    expect(rowNames()).toEqual(['banana report.pdf']);

    await fireEvent.press(screen.getByRole('tab', { name: 'Other' }));
    expect(rowNames()).toEqual(['readme.txt']);

    await fireEvent.press(screen.getByRole('tab', { name: 'All' }));
    await fireEvent.press(screen.getByTestId('library-chip-whatsapp'));
    expect(rowNames()).toEqual(['cherry budget.xlsx']);
    expect(useLibraryPrefsStore.getState()).toMatchObject({ tab: 'all', chip: 'whatsapp' });
  });

  it('shows a neutral empty state for a source with no files (Scans)', async () => {
    seed();
    await renderLibrary();
    await fireEvent.press(screen.getByTestId('library-chip-scans'));
    expect(rowNames()).toEqual([]);
    expect(screen.getByText('No files here yet')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Pick files' })).toBeNull();
  });

  it('browses My Files (empty) with folder actions instead of the library empty state', async () => {
    seed();
    await renderLibrary();
    await fireEvent.press(screen.getByTestId('library-chip-myfiles'));
    await waitFor(() => expect(screen.getByText('This folder is empty')).toBeOnTheScreen());
    expect(rowNames()).toEqual([]);
    expect(screen.getByRole('button', { name: 'New folder' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Import' })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Pick files' })).toBeNull();
  });

  it('searches names (debounced), applies the tab filter, and clears', async () => {
    seed();
    await renderLibrary();
    await fireEvent.changeText(screen.getByTestId('library-search'), 'report');
    await waitFor(() => expect(rowNames()).toEqual(['banana report.pdf']));

    await fireEvent.press(screen.getByRole('tab', { name: 'Word' }));
    expect(rowNames()).toEqual([]);
    expect(screen.getByText('No matching files')).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('tab', { name: 'All' }));
    await fireEvent.changeText(screen.getByTestId('library-search'), 'zzz');
    await waitFor(() => expect(screen.getByText('No matching files')).toBeOnTheScreen());

    await fireEvent.press(screen.getByRole('button', { name: 'Clear search' }));
    expect(rowNames()).toHaveLength(4);
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull();
  });

  it('switches between list and grid', async () => {
    seed();
    await renderLibrary();
    expect(screen.queryAllByTestId(/^library-cell-/)).toEqual([]);

    await fireEvent.press(screen.getByRole('button', { name: 'Show as grid' }));
    expect(screen.queryAllByTestId(/^library-row-/)).toEqual([]);
    expect(screen.getAllByTestId(/^library-cell-/)).toHaveLength(4);
    expect(useLibraryPrefsStore.getState().view).toBe('grid');

    await fireEvent.press(screen.getByRole('button', { name: 'Show as list' }));
    expect(rowNames()).toHaveLength(4);
  });

  it('changes field and direction from the sort sheet', async () => {
    seed();
    await renderLibrary();
    await fireEvent.press(screen.getByRole('button', { name: 'Sort' }));
    const sheet = screen.getByTestId('library-sort-sheet', { includeHiddenElements: true });
    const option = (name: string) =>
      within(sheet).getByRole('radio', { name, includeHiddenElements: true });
    expect(option('Name')).toBeChecked();
    expect(option('A to Z')).toBeChecked();

    await fireEvent.press(option('Size'));
    expect(useLibraryPrefsStore.getState().sort).toBe('size');
    // Size starts largest first.
    expect(rowNames()).toEqual([
      'cherry budget.xlsx',
      'banana report.pdf',
      'Apple notes.docx',
      'readme.txt',
    ]);
    await fireEvent.press(option('Smallest first'));
    expect(rowNames()[0]).toBe('readme.txt');

    await fireEvent.press(option('Date modified'));
    expect(rowNames()[0]).toBe('banana report.pdf');
    expect(useLibraryPrefsStore.getState()).toMatchObject({ sort: 'date', sortDir: 'desc' });
  });

  it('offers picking files when the library is empty', async () => {
    await renderLibrary();
    expect(screen.getByText('No documents yet')).toBeOnTheScreen();
    files.pickDocuments.mockResolvedValueOnce([
      {
        uri: 'content://p/doc/1',
        name: 'picked.pdf',
        size: 10,
        mime: 'application/pdf',
        mtime: 1_000,
        persisted: true,
      },
    ]);
    await fireEvent.press(screen.getByRole('button', { name: 'Pick files' }));
    await waitFor(() => expect(rowNames()).toEqual(['picked.pdf']));
    expect(files.pickDocuments).toHaveBeenCalledTimes(1);
  });

  it('shows the access banner in the list header when access is missing', async () => {
    files.hasAllFilesAccess.mockImplementation(() => false);
    await renderLibrary();
    expect(screen.getByTestId('access-banner')).toBeOnTheScreen();
    expect(screen.getByText('No documents yet')).toBeOnTheScreen();
  });

  it('shows Recent and Favorites only when they have files, on All / All without search', async () => {
    const [banana, apple] = seed();
    await renderLibrary();
    expect(screen.queryByTestId('library-recent')).toBeNull();
    expect(screen.queryByTestId('library-favorites')).toBeNull();

    await act(async () => {
      getRepositories().files.markOpened(banana?.id ?? 0, 5);
      getRepositories().files.setFavorite(apple?.id ?? 0, true);
      bumpLibraryVersion();
    });
    // Library changes are re-read when the JS thread is idle, not at once.
    await waitFor(() => expect(screen.getByText('Recent')).toBeOnTheScreen());
    expect(screen.getByTestId(`library-recent-${banana?.id}`)).toBeOnTheScreen();
    expect(screen.getByText('Favorites')).toBeOnTheScreen();
    expect(screen.getByTestId(`library-favorites-${apple?.id}`)).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('tab', { name: 'PDF' }));
    expect(screen.queryByTestId('library-recent')).toBeNull();
    await fireEvent.press(screen.getByRole('tab', { name: 'All' }));
    await fireEvent.changeText(screen.getByTestId('library-search'), 'apple');
    await waitFor(() => expect(screen.queryByTestId('library-favorites')).toBeNull());
  });

  it('requests PDF thumbnails only, and labels password-protected files', async () => {
    const [banana] = seed();
    await renderLibrary();
    const requests = engine.pendingRequests();
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ source: banana?.path, mtime: banana?.mtime });
    expect(requests[0]?.widthPx).toBeGreaterThan(0);

    await act(async () => {
      engine.rejectThumbnail(requests[0]?.requestId ?? '', 'PASSWORD_REQUIRED');
    });
    await waitFor(() =>
      expect(screen.getByTestId(`library-row-${banana?.id}`)).toHaveProp(
        'accessibilityLabel',
        expect.stringContaining('Password-protected'),
      ),
    );
  });

  it('shows a retryable error when the library cannot be read', async () => {
    seed();
    const listLibrary = jest
      .spyOn(getRepositories().files, 'listLibrary')
      .mockImplementation(() => {
        throw new Error('disk I/O error');
      });
    await renderLibrary();
    expect(screen.getByText('Something went wrong')).toBeOnTheScreen();

    listLibrary.mockRestore();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(rowNames()).toHaveLength(4));
  });

  it('shows the developer tools button only in dev builds', async () => {
    const globals = globalThis as unknown as { __DEV__: boolean };
    await renderLibrary();
    expect(screen.getByRole('button', { name: 'Developer tools' })).toBeOnTheScreen();
    await screen.unmount();

    globals.__DEV__ = false;
    try {
      await renderLibrary();
      expect(screen.queryByRole('button', { name: 'Developer tools' })).toBeNull();
    } finally {
      globals.__DEV__ = true;
    }
  });
});
