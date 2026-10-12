import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import Storage from 'expo-sqlite/kv-store';
import {
  AppState,
  BackHandler,
  Linking,
  Platform,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import FileIndexModule from '../../modules/file-index/src/FileIndexModule';
import PdfEngineModule from '../../modules/pdf-engine/src/PdfEngineModule';
import type { FakePdfEngineModule } from '../engine/fakePdfEngine';
import { FAKE_MY_FILES_ROOT, type FakeFileIndexModule } from './fakeFileIndex';
import { ToastHost, useToastStore } from '@/components/ui';
import { getRepositories } from '@/db/client';
import type { NewFile } from '@/db/types';
import { useWriteAccessExplainerStore } from '@/features/files/sharedWriteAccess';
import { useFileActionsStore, useMyFilesStore } from '@/features/files/store';
import { LibraryScreen } from '@/features/library/LibraryScreen';
import { useLibraryPrefsStore } from '@/features/library/store';
import { clearThumbnailMemo } from '@/features/library/useThumbnail';
import { useOnboardingStore } from '@/features/onboarding/store';
import { useAllFilesAccessStore } from '@/lib/files';
import { ThemeProvider } from '@/theme';

jest.mock('../../modules/file-index/src/FileIndexModule', () =>
  jest.requireActual('./fakeFileIndex').createFakeFileIndexModule(),
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

const native = FileIndexModule as unknown as FakeFileIndexModule;
const engine = PdfEngineModule as unknown as FakePdfEngineModule;
const ROOT = FAKE_MY_FILES_ROOT;
const DL = '/storage/emulated/0/Download';
// Overlays are announced as modal, which hides the rest of the tree from
// role queries; queries inside them include hidden elements.
const H = { includeHiddenElements: true } as const;

function row(path: string, overrides: Partial<NewFile> = {}): NewFile {
  const name = path.split('/').pop() ?? path;
  const ext = name.includes('.') ? (name.split('.').pop() ?? '') : '';
  return {
    path,
    uri: null,
    name,
    ext,
    mime: null,
    size: 100,
    mtime: 1_000,
    source: 'downloads',
    ...overrides,
  };
}

/** A library row whose file also exists in the fake filesystem. */
function seedFile(path: string, overrides: Partial<NewFile> = {}) {
  native.addFile(path, overrides.size ?? 100, overrides.mtime ?? 1_000);
  return getRepositories().files.upsert(row(path, overrides));
}

const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

async function renderLibrary() {
  await render(
    <ThemeProvider>
      <LibraryScreen />
      <ToastHost />
    </ThemeProvider>,
  );
  // FlashList finishes its first layout pass in a macrotask.
  await settle();
}

type HostNode = ReturnType<typeof screen.getByTestId>;

function topOf(node: HostNode): number {
  for (let current = node.parent; current; current = current.parent) {
    const top = StyleSheet.flatten(current.props.style as StyleProp<ViewStyle>)?.top;
    if (typeof top === 'number') return top;
  }
  return 0;
}

/** Visible list entries (folders and files), top to bottom, by accessible name. */
const entryNames = () =>
  screen
    .queryAllByTestId(/^(library-row-|myfiles-folder-(?!more))/)
    .map((node) => ({ top: topOf(node), label: node.props.accessibilityLabel as string }))
    .sort((a, b) => a.top - b.top)
    .map(({ label }) => label.split(', ')[0] + (label.endsWith(', folder') ? '/' : ''));

const sheet = () => within(screen.getByTestId('file-actions-sheet', H));
const sheetActions = () =>
  sheet()
    .getAllByRole('button', H)
    .map((node) => node.props.accessibilityLabel as string);

async function openActions(id: number) {
  await fireEvent.press(screen.getByTestId(`library-more-${id}`));
}

async function choose(action: string) {
  await fireEvent.press(sheet().getByRole('button', { name: action, ...H }));
}

const toastText = () => useToastStore.getState().current?.message;

beforeEach(() => {
  jest.clearAllMocks();
  (Storage as unknown as { clearSync: () => boolean }).clearSync();
  jest.spyOn(Platform, 'Version', 'get').mockReturnValue(34);
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
  useFileActionsStore.setState({ target: null, overlay: null });
  useWriteAccessExplainerStore.setState({ resolve: null });
  useMyFilesStore.setState({ dir: null });
  native.resetFs();
  native.hasAllFilesAccess.mockImplementation(() => true);
  native.pickDocuments.mockImplementation(() => Promise.resolve([]));
  native.documentCapabilities.mockImplementation(async () => ({
    canRename: true,
    canDelete: true,
  }));
  engine.reset();
  clearThumbnailMemo();
  for (const entry of getRepositories().files.listIndexEntries()) {
    getRepositories().files.remove(entry.id);
  }
  jest.spyOn(AppState, 'addEventListener').mockImplementation(() => ({ remove: jest.fn() }));
});

afterEach(() => jest.restoreAllMocks());

describe('actions sheet', () => {
  it('opens from ⋮ and from a long-press, and offers Print only for PDFs', async () => {
    const pdf = seedFile(`${DL}/report.pdf`);
    const docx = seedFile(`${DL}/notes.docx`);
    await renderLibrary();

    // The row itself is not a button (no reader yet); ⋮ is.
    expect(screen.getByRole('button', { name: 'More actions for report.pdf' })).toBeOnTheScreen();
    await openActions(pdf.id);
    expect(sheet().getByRole('header', { name: 'report.pdf', ...H })).toBeTruthy();
    expect(sheetActions()).toEqual([
      'Add to favorites',
      'Rename',
      'Move',
      'Duplicate',
      'Details',
      'Share',
      'Print',
      'Delete',
    ]);
    await fireEvent.press(screen.getByTestId('file-actions-sheet-backdrop', H));
    expect(screen.queryByTestId('file-actions-sheet', H)).toBeNull();

    await fireEvent(screen.getByTestId(`library-row-${docx.id}`), 'longPress');
    expect(sheet().getByRole('header', { name: 'notes.docx', ...H })).toBeTruthy();
    expect(sheetActions()).not.toContain('Print');
  });

  it('hides actions that change shared storage without all-files access', async () => {
    native.hasAllFilesAccess.mockImplementation(() => false);
    const pdf = seedFile(`${DL}/report.pdf`);
    await renderLibrary();
    await openActions(pdf.id);
    expect(sheetActions()).toEqual(['Add to favorites', 'Details', 'Share', 'Print']);
  });

  it.each([
    ['with', true],
    ['without', false],
  ])(
    'shows them on Android 10 and below %s all-files access (asked on first use)',
    async (_label, access) => {
      jest.spyOn(Platform, 'Version', 'get').mockReturnValue(29);
      native.hasAllFilesAccess.mockImplementation(() => access);
      native.setSharedWriteAccess(false);
      const pdf = seedFile(`${DL}/report.pdf`);
      await renderLibrary();
      await openActions(pdf.id);
      expect(sheetActions()).toEqual([
        'Add to favorites',
        'Rename',
        'Move',
        'Duplicate',
        'Details',
        'Share',
        'Print',
        'Delete',
      ]);
      // Opening the sheet asks for nothing.
      expect(native.requestSharedWriteAccess).not.toHaveBeenCalled();
    },
  );

  it('for picked documents: Copy to My Files, no Duplicate, rename/delete as the provider allows', async () => {
    native.documentCapabilities.mockImplementation(async () => ({
      canRename: true,
      canDelete: false,
    }));
    const picked = getRepositories().files.upsert(
      row('content://p/1', {
        uri: 'content://p/1',
        name: 'picked.pdf',
        ext: 'pdf',
        source: 'device',
      }),
    );
    await renderLibrary();
    await openActions(picked.id);
    await waitFor(() => expect(sheetActions()).toContain('Rename'));
    expect(native.documentCapabilities).toHaveBeenCalledWith('content://p/1');
    expect(sheetActions()).toEqual([
      'Add to favorites',
      'Rename',
      'Copy to My Files',
      'Details',
      'Share',
      'Print',
    ]);
  });

  it('toggles the favorite and confirms with a toast', async () => {
    const pdf = seedFile(`${DL}/report.pdf`);
    await renderLibrary();
    await openActions(pdf.id);
    await choose('Add to favorites');
    expect(getRepositories().files.getById(pdf.id)?.isFavorite).toBe(true);
    expect(toastText()).toBe('Added to favorites');
  });

  it('shares and prints', async () => {
    const pdf = seedFile(`${DL}/report.pdf`, { mime: 'application/pdf' });
    await renderLibrary();
    await openActions(pdf.id);
    await choose('Share');
    await waitFor(() =>
      expect(native.share).toHaveBeenCalledWith([`${DL}/report.pdf`], 'application/pdf'),
    );
    await openActions(pdf.id);
    await choose('Print');
    await waitFor(() =>
      expect(native.printPdf).toHaveBeenCalledWith(`${DL}/report.pdf`, 'report.pdf'),
    );
  });
});

describe('rename', () => {
  it('prefills the name with the base name selected, validates inline, shows a clash, then renames', async () => {
    const pdf = seedFile(`${DL}/banana report.pdf`);
    native.addFile(`${DL}/taken.pdf`);
    await renderLibrary();
    await openActions(pdf.id);
    await choose('Rename');

    const input = screen.getByTestId('rename-dialog-input', H);
    expect(input.props.value).toBe('banana report.pdf');
    expect(input.props.selection).toEqual({ start: 0, end: 'banana report'.length });
    const save = () => screen.getByTestId('rename-dialog-confirm', H);

    await fireEvent.changeText(input, 'a/b.pdf');
    expect(screen.getByTestId('rename-dialog-error', H)).toHaveTextContent(
      'Names can’t contain any of these: \\ / : * ? " < > |',
    );
    expect(save()).toBeDisabled();

    await fireEvent.changeText(input, '   ');
    expect(screen.getByTestId('rename-dialog-error', H)).toHaveTextContent('Enter a name.');

    await fireEvent.changeText(input, 'taken.pdf');
    expect(save()).toBeEnabled();
    await fireEvent.press(save());
    await waitFor(() =>
      expect(screen.getByTestId('rename-dialog-error', H)).toHaveTextContent(
        'Something with this name is already here.',
      ),
    );
    expect(getRepositories().files.getById(pdf.id)?.name).toBe('banana report.pdf');

    await fireEvent.changeText(screen.getByTestId('rename-dialog-input', H), 'fresh.pdf');
    await fireEvent.press(save());
    await waitFor(() => expect(screen.queryByTestId('rename-dialog', H)).toBeNull());
    expect(toastText()).toBe('Renamed');
    await waitFor(() => expect(entryNames()).toContain('fresh.pdf'));
    expect(getRepositories().files.getById(pdf.id)?.path).toBe(`${DL}/fresh.pdf`);
  });

  it('cancelling changes nothing', async () => {
    const pdf = seedFile(`${DL}/a.pdf`);
    await renderLibrary();
    await openActions(pdf.id);
    await choose('Rename');
    await fireEvent.changeText(screen.getByTestId('rename-dialog-input', H), 'b.pdf');
    await fireEvent.press(screen.getByTestId('rename-dialog-cancel', H));
    expect(screen.queryByTestId('rename-dialog', H)).toBeNull();
    expect(native.renameFile).not.toHaveBeenCalled();
  });
});

describe('delete', () => {
  it('asks first, naming the file, and deletes only on confirm', async () => {
    const pdf = seedFile(`${DL}/report.pdf`);
    await renderLibrary();
    await openActions(pdf.id);
    await choose('Delete');

    const dialog = within(screen.getByTestId('delete-dialog', H));
    expect(dialog.getByRole('header', { name: 'Delete “report.pdf”?', ...H })).toBeTruthy();
    expect(dialog.getByText('This can’t be undone.', H)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('delete-cancel', H));
    expect(native.deleteFile).not.toHaveBeenCalled();
    expect(getRepositories().files.getById(pdf.id)).toBeDefined();

    await openActions(pdf.id);
    await choose('Delete');
    await fireEvent.press(screen.getByTestId('delete-confirm', H));
    await waitFor(() => expect(toastText()).toBe('Deleted'));
    expect(native.deleteFile).toHaveBeenCalledTimes(1);
    expect(native.exists(`${DL}/report.pdf`)).toBe(false);
    await waitFor(() => expect(entryNames()).toEqual([]));
  });

  it('ignores a double tap on Delete while it runs', async () => {
    const pdf = seedFile(`${DL}/report.pdf`);
    let finish: () => void = () => undefined;
    native.deleteFile.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    await renderLibrary();
    await openActions(pdf.id);
    await choose('Delete');
    const confirm = screen.getByTestId('delete-confirm', H);
    await fireEvent.press(confirm);
    await fireEvent.press(confirm);
    await act(async () => finish());
    await waitFor(() => expect(toastText()).toBe('Deleted'));
    expect(native.deleteFile).toHaveBeenCalledTimes(1);
  });

  it('offers all-files access when shared storage refuses', async () => {
    const pdf = seedFile(`${DL}/report.pdf`);
    native.deleteFile.mockRejectedValueOnce(
      Object.assign(new Error('denied'), { code: 'PERMISSION_DENIED' }),
    );
    await renderLibrary();
    await openActions(pdf.id);
    await choose('Delete');
    await fireEvent.press(screen.getByTestId('delete-confirm', H));
    await waitFor(() =>
      expect(toastText()).toBe(
        'Permission needed. Allow all-files access so the app can change files on your phone.',
      ),
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Open Settings' }));
    expect(native.openAllFilesAccessSettings).toHaveBeenCalledTimes(1);
    expect(getRepositories().files.getById(pdf.id)).toBeDefined();
  });
});

describe('missing files', () => {
  it('offers removing the row when the file is gone', async () => {
    // In the library, but not on disk.
    const pdf = getRepositories().files.upsert(row(`${DL}/ghost.pdf`));
    await renderLibrary();
    await openActions(pdf.id);
    await choose('Duplicate');
    await waitFor(() =>
      expect(toastText()).toBe('File not found. It may have been moved or deleted.'),
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Remove from library' }));
    await waitFor(() => expect(getRepositories().files.getById(pdf.id)).toBeUndefined());
    await waitFor(() => expect(toastText()).toBe('Removed from library'));
  });
});

describe('move', () => {
  it('browses My Files, creates a folder, goes back up and moves there', async () => {
    const pdf = seedFile(`${DL}/report.pdf`);
    native.addFolder(`${ROOT}/Work`);
    await renderLibrary();
    await openActions(pdf.id);
    await choose('Move');

    const picker = () => within(screen.getByTestId('folder-picker', H));
    await waitFor(() => expect(picker().getByTestId('folder-picker-folder-Work', H)).toBeTruthy());
    expect(picker().getByRole('header', { name: 'Move to', ...H })).toBeTruthy();
    expect(picker().getByRole('header', { name: 'My Files', ...H })).toBeTruthy();

    await fireEvent.press(picker().getByTestId('folder-picker-folder-Work', H));
    await waitFor(() => expect(picker().getByRole('header', { name: 'Work', ...H })).toBeTruthy());
    expect(picker().getByRole('button', { name: 'My Files', ...H })).toBeTruthy();

    await fireEvent.press(picker().getByTestId('folder-picker-new', H));
    await fireEvent.changeText(screen.getByTestId('new-folder-dialog-input', H), 'Q3');
    await fireEvent.press(screen.getByTestId('new-folder-dialog-confirm', H));
    await waitFor(() => expect(picker().getByRole('header', { name: 'Q3', ...H })).toBeTruthy());
    expect(native.exists(`${ROOT}/Work/Q3`)).toBe(true);

    // Android back goes up one level.
    await fireEvent(screen.getByTestId('folder-picker', H), 'requestClose');
    await waitFor(() => expect(picker().getByRole('header', { name: 'Work', ...H })).toBeTruthy());

    await fireEvent.press(picker().getByTestId('folder-picker-confirm', H));
    await waitFor(() => expect(toastText()).toBe('Moved to Work'));
    expect(screen.queryByTestId('folder-picker', H)).toBeNull();
    expect(getRepositories().files.getById(pdf.id)).toMatchObject({
      path: `${ROOT}/Work/report.pdf`,
      source: 'myfiles',
    });
  });

  it('copies picked documents into My Files instead', async () => {
    native.addDocument('content://p/1', { name: 'picked.pdf', size: 5 });
    const picked = getRepositories().files.upsert(
      row('content://p/1', {
        uri: 'content://p/1',
        name: 'picked.pdf',
        ext: 'pdf',
        source: 'device',
      }),
    );
    await renderLibrary();
    await openActions(picked.id);
    await choose('Copy to My Files');
    expect(
      within(screen.getByTestId('folder-picker', H)).getByRole('header', {
        name: 'Copy to My Files',
        ...H,
      }),
    ).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('folder-picker-confirm', H)).toBeEnabled());
    await fireEvent.press(screen.getByTestId('folder-picker-confirm', H));
    await waitFor(() => expect(toastText()).toBe('Copied to My Files'));
    expect(getRepositories().files.getByPath(`${ROOT}/picked.pdf`)?.source).toBe('myfiles');
    expect(getRepositories().files.getById(picked.id)).toBeDefined();
  });

  it('cannot move into the folder the file is already in', async () => {
    const mine = seedFile(`${ROOT}/a.pdf`, { source: 'myfiles' });
    await renderLibrary();
    await openActions(mine.id);
    await choose('Move');
    await waitFor(() => expect(screen.getByTestId('folder-picker-confirm', H)).toBeDisabled());
  });
});

describe('details', () => {
  it('shows a friendly location, type, size, date and page count', async () => {
    const picked = getRepositories().files.upsert(
      row('content://p/1', {
        uri: 'content://p/1',
        name: 'picked.pdf',
        ext: 'pdf',
        size: 1_500_000,
      }),
    );
    getRepositories().files.setPageCount(picked.id, 12);
    const nested = seedFile(`${ROOT}/Sub/Deeper/n.docx`, { source: 'myfiles' });
    await renderLibrary();

    await openActions(picked.id);
    await choose('Details');
    const label = (id: string) => screen.getByTestId(id, H).props.accessibilityLabel as string;
    expect(label('details-name')).toBe('Name, picked.pdf');
    expect(label('details-type')).toBe('Type, PDF file');
    expect(label('details-size')).toBe('Size, 1.5 MB');
    expect(label('details-location')).toBe('Location, Picked file');
    expect(label('details-pages')).toBe('Pages, 12');
    expect(JSON.stringify(screen.toJSON())).not.toContain('content://');

    await fireEvent.press(screen.getByTestId('details-sheet-backdrop', H));
    await openActions(nested.id);
    await choose('Details');
    expect(label('details-location')).toBe('Location, My Files › Sub › Deeper');
    expect(screen.queryByTestId('details-pages', H)).toBeNull();
  });
});

describe('My Files', () => {
  function seedTree() {
    native.addFolder(`${ROOT}/Alpha`);
    native.addFile(`${ROOT}/Beta/inner.pdf`, 10, 10);
    native.addFile(`${ROOT}/top.pdf`, 20, 20);
  }

  async function openMyFiles() {
    await fireEvent.press(screen.getByTestId('library-chip-myfiles'));
    await waitFor(() => expect(entryNames()).toContain('top.pdf'));
  }

  it('lists folders first, then files, with the uninstall note; folders open; back goes up', async () => {
    seedTree();
    type BackListener = Parameters<typeof BackHandler.addEventListener>[1];
    let listener: BackListener | undefined;
    // Simulates the hardware back button against the registered listener.
    const back = () => listener?.({} as Parameters<BackListener>[0]);
    jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_event, handler) => {
      listener = handler;
      return { remove: () => (listener = undefined) };
    });
    await renderLibrary();
    await openMyFiles();

    expect(entryNames()).toEqual(['Alpha/', 'Beta/', 'top.pdf']);
    expect(
      screen.getByText('Files in My Files are removed if you uninstall the app.'),
    ).toBeTruthy();
    // Reconcile added the files found on disk.
    expect(getRepositories().files.getByPath(`${ROOT}/Beta/inner.pdf`)?.source).toBe('myfiles');
    expect(listener).toBeUndefined();

    await fireEvent.press(screen.getByTestId('myfiles-folder-Beta'));
    await waitFor(() => expect(entryNames()).toEqual(['inner.pdf']));
    expect(screen.getByRole('header', { name: 'Beta' })).toBeTruthy();

    await act(async () => {
      expect(back()).toBe(true);
    });
    await waitFor(() => expect(entryNames()).toEqual(['Alpha/', 'Beta/', 'top.pdf']));
    expect(listener).toBeUndefined();

    await fireEvent.press(screen.getByTestId('myfiles-folder-Beta'));
    await waitFor(() => expect(entryNames()).toEqual(['inner.pdf']));
    // The breadcrumb's root (the source chip is also called "My Files").
    const crumb = screen.getByTestId('myfiles-crumbs-0');
    expect(crumb).toHaveAccessibleName('My Files');
    await fireEvent.press(crumb);
    await waitFor(() => expect(entryNames()).toEqual(['Alpha/', 'Beta/', 'top.pdf']));
  });

  it('shows an empty folder state', async () => {
    native.addFolder(`${ROOT}/Empty`);
    await renderLibrary();
    await fireEvent.press(screen.getByTestId('library-chip-myfiles'));
    await waitFor(() => expect(entryNames()).toEqual(['Empty/']));
    await fireEvent.press(screen.getByTestId('myfiles-folder-Empty'));
    await waitFor(() => expect(screen.getByText('This folder is empty')).toBeTruthy());
  });

  it('creates a folder from the header', async () => {
    seedTree();
    await renderLibrary();
    await openMyFiles();
    await fireEvent.press(screen.getByTestId('myfiles-new-folder'));
    await fireEvent.changeText(screen.getByTestId('new-folder-dialog-input', H), 'Gamma');
    await fireEvent.press(screen.getByTestId('new-folder-dialog-confirm', H));
    await waitFor(() => expect(entryNames()).toEqual(['Alpha/', 'Beta/', 'Gamma/', 'top.pdf']));
    expect(toastText()).toBe('Folder created');
  });

  it('imports into the current folder without taking grants, and reports partial failures', async () => {
    native.addFolder(`${ROOT}/Inbox`);
    native.addDocument('content://p/ok', { name: 'ok.pdf', size: 3 });
    // Picked with persist: false, so nothing is persisted.
    native.pickDocuments.mockResolvedValueOnce([
      {
        uri: 'content://p/ok',
        name: 'ok.pdf',
        size: 3,
        mime: 'application/pdf',
        mtime: 1,
        persisted: false,
      },
      {
        uri: 'content://p/bad',
        name: 'bad.pdf',
        size: 3,
        mime: 'application/pdf',
        mtime: 1,
        persisted: false,
      },
    ]);
    await renderLibrary();
    await fireEvent.press(screen.getByTestId('library-chip-myfiles'));
    await waitFor(() => expect(entryNames()).toEqual(['Inbox/']));
    await fireEvent.press(screen.getByTestId('myfiles-folder-Inbox'));
    await waitFor(() => expect(screen.getByText('This folder is empty')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('myfiles-import'));
    await waitFor(() =>
      expect(toastText()).toBe(
        '1 file of 2 couldn’t be imported. It may have been moved or deleted.',
      ),
    );
    expect(native.pickDocuments).toHaveBeenCalledWith(
      expect.objectContaining({ multiple: true, persist: false }),
    );
    expect(native.importDocuments).toHaveBeenCalledWith(
      ['content://p/ok', 'content://p/bad'],
      `${ROOT}/Inbox`,
    );
    await waitFor(() => expect(entryNames()).toEqual(['ok.pdf']));
    // No grant was taken, so none is released.
    expect(native.releasePersistedUri).not.toHaveBeenCalled();
  });

  it('uses the plural form when several imports fail', async () => {
    native.pickDocuments.mockResolvedValueOnce(
      ['a', 'b', 'c'].map((id) => ({
        uri: `content://p/${id}`,
        name: `${id}.pdf`,
        size: 1,
        mime: 'application/pdf',
        mtime: 1,
        persisted: false,
      })),
    );
    native.addDocument('content://p/a', { name: 'a.pdf', size: 1 });
    await renderLibrary();
    await fireEvent.press(screen.getByTestId('library-chip-myfiles'));
    await waitFor(() => expect(screen.getByText('This folder is empty')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('myfiles-import'));
    await waitFor(() =>
      expect(toastText()).toBe(
        '2 of 3 files couldn’t be imported. It may have been moved or deleted.',
      ),
    );
  });

  it('reports a full import with a count', async () => {
    native.addDocument('content://p/ok', { name: 'ok.pdf', size: 3 });
    native.pickDocuments.mockResolvedValueOnce([
      {
        uri: 'content://p/ok',
        name: 'ok.pdf',
        size: 3,
        mime: 'application/pdf',
        mtime: 1,
        persisted: true,
      },
    ]);
    await renderLibrary();
    await fireEvent.press(screen.getByTestId('library-chip-myfiles'));
    await waitFor(() => expect(screen.getByText('This folder is empty')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('myfiles-import'));
    await waitFor(() => expect(toastText()).toBe('Imported to My Files (1)'));
    await waitFor(() => expect(entryNames()).toEqual(['ok.pdf']));
  });

  it('renames and deletes folders; the delete dialog names the folder and counts its items', async () => {
    seedTree();
    await renderLibrary();
    await openMyFiles();
    const inner = getRepositories().files.getByPath(`${ROOT}/Beta/inner.pdf`);

    await fireEvent(screen.getByTestId('myfiles-folder-Beta'), 'longPress');
    const folderSheet = within(screen.getByTestId('folder-actions-sheet', H));
    expect(
      folderSheet.getAllByRole('button', H).map((node) => node.props.accessibilityLabel),
    ).toEqual(['Rename', 'Delete']);
    await fireEvent.press(folderSheet.getByRole('button', { name: 'Rename', ...H }));
    await fireEvent.changeText(screen.getByTestId('rename-folder-dialog-input', H), 'Bravo');
    await fireEvent.press(screen.getByTestId('rename-folder-dialog-confirm', H));
    await waitFor(() => expect(entryNames()).toEqual(['Alpha/', 'Bravo/', 'top.pdf']));
    expect(getRepositories().files.getById(inner?.id ?? 0)?.path).toBe(`${ROOT}/Bravo/inner.pdf`);

    await fireEvent.press(screen.getByTestId('myfiles-folder-more-Bravo'));
    await fireEvent.press(
      within(screen.getByTestId('folder-actions-sheet', H)).getByRole('button', {
        name: 'Delete',
        ...H,
      }),
    );
    await waitFor(() =>
      expect(
        within(screen.getByTestId('delete-folder-dialog', H)).getByRole('header', {
          name: 'Delete “Bravo” and the item inside?',
          ...H,
        }),
      ).toBeTruthy(),
    );
    await fireEvent.press(screen.getByTestId('delete-folder-confirm', H));
    await waitFor(() => expect(entryNames()).toEqual(['Alpha/', 'top.pdf']));
    expect(toastText()).toBe('Folder deleted');
    expect(getRepositories().files.getById(inner?.id ?? 0)).toBeUndefined();
  });

  it('searching from My Files searches all of it (flat results)', async () => {
    seedTree();
    await renderLibrary();
    await openMyFiles();
    await fireEvent.changeText(screen.getByTestId('library-search'), 'inner');
    await waitFor(() => expect(entryNames()).toEqual(['inner.pdf']));
    expect(screen.queryByTestId('myfiles-header')).toBeNull();
  });
});

describe('review fixes', () => {
  it('keeps the extension on rename and previews the final name', async () => {
    const pdf = seedFile(`${DL}/report.pdf`);
    await renderLibrary();
    await openActions(pdf.id);
    await choose('Rename');
    const input = screen.getByTestId('rename-dialog-input', H);

    await fireEvent.changeText(input, '.secret');
    expect(screen.getByTestId('rename-dialog-error', H)).toHaveTextContent(
      'Names can’t start with a dot.',
    );
    expect(screen.getByTestId('rename-dialog-confirm', H)).toBeDisabled();

    await fireEvent.changeText(input, 'Summary');
    expect(screen.getByTestId('rename-dialog-preview', H)).toHaveTextContent(
      'Will be saved as “Summary.pdf”',
    );
    await fireEvent.press(screen.getByTestId('rename-dialog-confirm', H));
    await waitFor(() => expect(toastText()).toBe('Renamed'));
    expect(native.renameFile).toHaveBeenCalledWith(`${DL}/report.pdf`, 'Summary.pdf');
    expect(getRepositories().files.getById(pdf.id)).toMatchObject({
      name: 'Summary.pdf',
      ext: 'pdf',
    });
  });

  it('shows no preview when the typed name already has the extension', async () => {
    const pdf = seedFile(`${DL}/report.pdf`);
    await renderLibrary();
    await openActions(pdf.id);
    await choose('Rename');
    await fireEvent.changeText(screen.getByTestId('rename-dialog-input', H), 'Summary.pdf');
    expect(screen.queryByTestId('rename-dialog-preview', H)).toBeNull();
  });

  it('uses the plural form for several items in a folder', async () => {
    native.addFile(`${ROOT}/Many/a.pdf`);
    native.addFile(`${ROOT}/Many/b.pdf`);
    native.addFolder(`${ROOT}/Many/Sub`);
    await renderLibrary();
    await fireEvent.press(screen.getByTestId('library-chip-myfiles'));
    await waitFor(() => expect(entryNames()).toEqual(['Many/']));
    await fireEvent.press(screen.getByTestId('myfiles-folder-more-Many'));
    await fireEvent.press(
      within(screen.getByTestId('folder-actions-sheet', H)).getByRole('button', {
        name: 'Delete',
        ...H,
      }),
    );
    await waitFor(() =>
      expect(
        within(screen.getByTestId('delete-folder-dialog', H)).getByRole('header', {
          name: 'Delete “Many” and the 3 items inside?',
          ...H,
        }),
      ).toBeTruthy(),
    );
  });

  it('explains a picked document the provider cannot rename and offers Copy to My Files', async () => {
    native.addDocument('content://p/1', { name: 'picked.pdf', size: 5 });
    const picked = getRepositories().files.upsert(
      row('content://p/1', {
        uri: 'content://p/1',
        name: 'picked.pdf',
        ext: 'pdf',
        source: 'device',
      }),
    );
    // The provider keeps the old name and answers with a new live URI.
    native.refuseRename('content://p/1');
    await renderLibrary();
    await openActions(picked.id);
    await waitFor(() => expect(sheetActions()).toContain('Rename'));
    await choose('Rename');
    await fireEvent.changeText(screen.getByTestId('rename-dialog-input', H), 'new');
    await fireEvent.press(screen.getByTestId('rename-dialog-confirm', H));
    await waitFor(() =>
      expect(toastText()).toBe(
        'This app can’t rename this file. Copy it to My Files to rename it.',
      ),
    );
    expect(getRepositories().files.getById(picked.id)).toMatchObject({
      name: 'picked.pdf',
      path: 'content://p/1-renamed',
    });

    // Meanwhile another file's sheet was opened and closed: the toast's
    // action still targets the file it was shown for.
    const other = seedFile(`${DL}/other.pdf`);
    await act(async () => {
      useFileActionsStore.setState({
        target: { kind: 'file', file: { ...picked, id: other.id, name: 'other.pdf' } },
        overlay: null,
      });
    });

    await fireEvent.press(screen.getByRole('button', { name: 'Copy to My Files' }));
    expect(
      within(screen.getByTestId('folder-picker', H)).getByRole('header', {
        name: 'Copy to My Files',
        ...H,
      }),
    ).toBeTruthy();
    const target = useFileActionsStore.getState().target;
    expect(target?.kind === 'file' ? target.file : null).toMatchObject({
      id: picked.id,
      path: 'content://p/1-renamed',
    });
    // Copying uses the live URI.
    await waitFor(() => expect(screen.getByTestId('folder-picker-confirm', H)).toBeEnabled());
    await fireEvent.press(screen.getByTestId('folder-picker-confirm', H));
    await waitFor(() =>
      expect(native.importDocuments).toHaveBeenCalledWith(['content://p/1-renamed'], ROOT),
    );
  });

  it('explains a move that left a second copy behind, and lists the copy', async () => {
    const pdf = seedFile(`${DL}/report.pdf`);
    native.moveFile.mockImplementationOnce(async (_path, dest) => {
      native.addFile(`${dest}/report.pdf`);
      throw Object.assign(new Error('x'), { code: 'ERR_DUPLICATE_LEFT' });
    });
    await renderLibrary();
    await openActions(pdf.id);
    await choose('Move');
    await waitFor(() => expect(screen.getByTestId('folder-picker-confirm', H)).toBeEnabled());
    await fireEvent.press(screen.getByTestId('folder-picker-confirm', H));
    await waitFor(() =>
      expect(toastText()).toBe(
        'The file was moved, but the original couldn’t be removed: a second copy is still in its old folder.',
      ),
    );
    // The original row still points at the original; the copy is reconciled in.
    expect(getRepositories().files.getById(pdf.id)?.path).toBe(`${DL}/report.pdf`);
    await waitFor(() =>
      expect(getRepositories().files.getByPath(`${ROOT}/report.pdf`)?.source).toBe('myfiles'),
    );
  });

  it('offers the long-press as a named accessibility action', async () => {
    const pdf = seedFile(`${DL}/report.pdf`);
    await renderLibrary();
    const rowNode = screen.getByTestId(`library-row-${pdf.id}`);
    expect(rowNode.props.accessibilityActions).toEqual([
      { name: 'longpress', label: 'More actions for report.pdf' },
    ]);
    await fireEvent(rowNode, 'accessibilityAction', { nativeEvent: { actionName: 'longpress' } });
    expect(sheet().getByRole('header', { name: 'report.pdf', ...H })).toBeTruthy();
  });
});

describe('second review fixes', () => {
  it('NOT_FOUND on a file that still exists shows the error without "Remove from library"', async () => {
    const pdf = seedFile(`${DL}/report.pdf`);
    native.copyFile.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'NOT_FOUND' }));
    await renderLibrary();
    await openActions(pdf.id);
    await choose('Duplicate');
    await waitFor(() =>
      expect(toastText()).toBe('File not found. It may have been moved or deleted.'),
    );
    expect(screen.queryByRole('button', { name: 'Remove from library' })).toBeNull();
    expect(getRepositories().files.getById(pdf.id)).toBeDefined();
  });

  it('a failed rename offers "Try again", which re-opens the dialog for the same file', async () => {
    const pdf = seedFile(`${DL}/report.pdf`);
    native.renameFile.mockRejectedValueOnce(
      Object.assign(new Error('x'), { code: 'ERR_FILE_OP_FAILED' }),
    );
    await renderLibrary();
    await openActions(pdf.id);
    await choose('Rename');
    await fireEvent.changeText(screen.getByTestId('rename-dialog-input', H), 'Summary');
    await fireEvent.press(screen.getByTestId('rename-dialog-confirm', H));
    await waitFor(() => expect(toastText()).toBe('Something went wrong. Please try again.'));
    expect(screen.queryByTestId('rename-dialog', H)).toBeNull();

    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.getByTestId('rename-dialog-input', H).props.value).toBe('report.pdf');
    await fireEvent.changeText(screen.getByTestId('rename-dialog-input', H), 'Summary');
    await fireEvent.press(screen.getByTestId('rename-dialog-confirm', H));
    await waitFor(() => expect(toastText()).toBe('Renamed'));
    expect(getRepositories().files.getById(pdf.id)?.name).toBe('Summary.pdf');
  });

  it('a failed folder delete offers "Try again" for the same folder', async () => {
    native.addFile(`${ROOT}/Keep/a.pdf`);
    native.deleteFolder.mockRejectedValueOnce(
      Object.assign(new Error('x'), { code: 'ERR_FILE_OP_FAILED' }),
    );
    await renderLibrary();
    await fireEvent.press(screen.getByTestId('library-chip-myfiles'));
    await waitFor(() => expect(entryNames()).toEqual(['Keep/']));
    await fireEvent.press(screen.getByTestId('myfiles-folder-more-Keep'));
    await fireEvent.press(
      within(screen.getByTestId('folder-actions-sheet', H)).getByRole('button', {
        name: 'Delete',
        ...H,
      }),
    );
    await fireEvent.press(screen.getByTestId('delete-folder-confirm', H));
    await waitFor(() => expect(toastText()).toBe('Something went wrong. Please try again.'));
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    await fireEvent.press(screen.getByTestId('delete-folder-confirm', H));
    await waitFor(() => expect(toastText()).toBe('Folder deleted'));
    expect(native.exists(`${ROOT}/Keep`)).toBe(false);
  });
});

describe('picked documents deleted outside the app', () => {
  afterEach(() => native.listPersistedUris.mockImplementation(() => []));

  function seedPicked() {
    // Our grant is still held: only the provider knows the document is gone.
    native.listPersistedUris.mockImplementation(() => ['content://p/gone']);
    return getRepositories().files.upsert(
      row('content://p/gone', {
        uri: 'content://p/gone',
        name: 'gone.pdf',
        ext: 'pdf',
        source: 'device',
      }),
    );
  }

  it('a provider NOT_FOUND offers "Remove from library" even with the grant held', async () => {
    const picked = seedPicked();
    native.copyContentUriToCache.mockRejectedValueOnce(
      Object.assign(new Error('x'), { code: 'NOT_FOUND' }),
    );
    await renderLibrary();
    await openActions(picked.id);
    await choose('Share');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Remove from library' })).toBeTruthy(),
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Remove from library' }));
    await waitFor(() => expect(getRepositories().files.getById(picked.id)).toBeUndefined());
    expect(native.releasePersistedUri).toHaveBeenCalledWith('content://p/gone');
  });

  it('a confirmed delete drops the row when the provider says it is already gone', async () => {
    const picked = seedPicked();
    await renderLibrary();
    await openActions(picked.id);
    await waitFor(() => expect(sheetActions()).toContain('Delete'));
    await choose('Delete');
    await fireEvent.press(screen.getByTestId('delete-confirm', H));
    await waitFor(() => expect(toastText()).toBe('Deleted'));
    expect(native.deleteDocument).toHaveBeenCalledWith('content://p/gone');
    expect(getRepositories().files.getById(picked.id)).toBeUndefined();
    expect(native.releasePersistedUri).toHaveBeenCalledWith('content://p/gone');
  });
});

describe('storage permission on Android 8–10', () => {
  const DENIED = 'Storage permission is needed to change files on your phone.';
  const BLOCKED =
    'Storage permission is turned off. Allow it in Settings to change files on your phone.';
  const explainer = () => screen.queryByTestId('write-access-dialog', H);

  beforeEach(() => {
    jest.spyOn(Platform, 'Version', 'get').mockReturnValue(29);
    native.hasAllFilesAccess.mockImplementation(() => false);
    native.setSharedWriteAccess(false);
    // Duplicate copies into the file's own folder.
    native.addFolder(DL);
  });

  it('explains, asks, and opens the action once granted', async () => {
    const pdf = seedFile(`${DL}/report.pdf`);
    await renderLibrary();
    await openActions(pdf.id);
    await choose('Rename');

    await waitFor(() => expect(explainer()).not.toBeNull());
    const dialog = within(screen.getByTestId('write-access-dialog', H));
    expect(dialog.getByRole('header', { name: 'Allow storage access', ...H })).toBeTruthy();
    expect(
      dialog.getByText(
        'To change files on your phone, the app needs storage permission. Android will ask you next.',
        H,
      ),
    ).toBeTruthy();
    // The actions sheet is closed behind the explanation.
    expect(screen.queryByTestId('file-actions-sheet', H)).toBeNull();
    expect(native.requestSharedWriteAccess).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByTestId('write-access-continue', H));
    await waitFor(() => expect(screen.getByTestId('rename-dialog', H)).toBeTruthy());
    expect(explainer()).toBeNull();
    expect(native.requestSharedWriteAccess).toHaveBeenCalledTimes(1);

    await fireEvent.changeText(screen.getByTestId('rename-dialog-input', H), 'fresh.pdf');
    await fireEvent.press(screen.getByTestId('rename-dialog-confirm', H));
    await waitFor(() => expect(toastText()).toBe('Renamed'));
    expect(getRepositories().files.getById(pdf.id)?.path).toBe(`${DL}/fresh.pdf`);

    // Granted now: the next write action asks nothing.
    await openActions(pdf.id);
    await choose('Delete');
    await waitFor(() => expect(screen.getByTestId('delete-dialog', H)).toBeTruthy());
    expect(explainer()).toBeNull();
    expect(native.requestSharedWriteAccess).toHaveBeenCalledTimes(1);
  });

  it('runs straight away when the permission is already held', async () => {
    native.setSharedWriteAccess(true);
    const pdf = seedFile(`${DL}/report.pdf`);
    await renderLibrary();
    await openActions(pdf.id);
    await choose('Duplicate');
    await waitFor(() => expect(toastText()).toBe('Copy created'));
    expect(native.copyFile).toHaveBeenCalledTimes(1);
    expect(explainer()).toBeNull();
    expect(native.requestSharedWriteAccess).not.toHaveBeenCalled();
  });

  it('cancelling the explanation asks nothing and changes nothing', async () => {
    const pdf = seedFile(`${DL}/report.pdf`);
    await renderLibrary();
    await openActions(pdf.id);
    await choose('Move');
    await waitFor(() => expect(explainer()).not.toBeNull());
    await fireEvent.press(screen.getByTestId('write-access-cancel', H));
    await waitFor(() => expect(explainer()).toBeNull());
    expect(native.requestSharedWriteAccess).not.toHaveBeenCalled();
    expect(screen.queryByTestId('folder-picker', H)).toBeNull();
    expect(useFileActionsStore.getState().overlay).toBeNull();
  });

  it('denied: explains with "Try again", which asks again and then runs the action', async () => {
    native.setSharedWriteRequestOutcome('denied');
    const pdf = seedFile(`${DL}/report.pdf`);
    await renderLibrary();
    await openActions(pdf.id);
    await choose('Duplicate');
    await waitFor(() => expect(explainer()).not.toBeNull());
    await fireEvent.press(screen.getByTestId('write-access-continue', H));
    await waitFor(() => expect(toastText()).toBe(DENIED));
    expect(native.copyFile).not.toHaveBeenCalled();

    native.setSharedWriteRequestOutcome('granted');
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(explainer()).not.toBeNull());
    await fireEvent.press(screen.getByTestId('write-access-continue', H));
    await waitFor(() => expect(toastText()).toBe('Copy created'));
    expect(native.requestSharedWriteAccess).toHaveBeenCalledTimes(2);
    expect(native.copyFile).toHaveBeenCalledTimes(1);
  });

  it('blocked: offers Open Settings (the app settings page)', async () => {
    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    native.setSharedWriteRequestOutcome('blocked');
    const pdf = seedFile(`${DL}/report.pdf`);
    await renderLibrary();
    await openActions(pdf.id);
    await choose('Delete');
    await waitFor(() => expect(explainer()).not.toBeNull());
    await fireEvent.press(screen.getByTestId('write-access-continue', H));
    await waitFor(() => expect(toastText()).toBe(BLOCKED));
    expect(screen.queryByTestId('delete-dialog', H)).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Open Settings' }));
    expect(openSettings).toHaveBeenCalledTimes(1);
    expect(native.openAllFilesAccessSettings).not.toHaveBeenCalled();
    expect(native.deleteFile).not.toHaveBeenCalled();
  });

  it('a failing system prompt shows an error with "Try again"', async () => {
    native.requestSharedWriteAccess.mockRejectedValueOnce(
      Object.assign(new Error('no activity'), { code: 'UNKNOWN' }),
    );
    const pdf = seedFile(`${DL}/report.pdf`);
    await renderLibrary();
    await openActions(pdf.id);
    await choose('Rename');
    await waitFor(() => expect(explainer()).not.toBeNull());
    await fireEvent.press(screen.getByTestId('write-access-continue', H));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Try again' })).toBeOnTheScreen(),
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(explainer()).not.toBeNull());
    await fireEvent.press(screen.getByTestId('write-access-continue', H));
    await waitFor(() => expect(screen.getByTestId('rename-dialog', H)).toBeTruthy());
  });

  it('ignores a double tap: one explanation, one prompt', async () => {
    const pdf = seedFile(`${DL}/report.pdf`);
    await renderLibrary();
    await openActions(pdf.id);
    const rename = sheet().getByRole('button', { name: 'Rename', ...H });
    // Two taps on the same button: the second reaches the handler while the
    // gate from the first is still open, so the guard has to drop it. The
    // presses are awaited one after the other because concurrent fireEvent
    // calls overlap React's act() scopes, which corrupts later renders.
    await fireEvent.press(rename);
    await fireEvent.press(rename);
    await waitFor(() => expect(explainer()).not.toBeNull());
    await fireEvent.press(screen.getByTestId('write-access-continue', H));
    await waitFor(() => expect(screen.getByTestId('rename-dialog', H)).toBeTruthy());
    expect(native.requestSharedWriteAccess).toHaveBeenCalledTimes(1);
    // The guard is free again once the gate has finished.
    expect(native.hasSharedWriteAccess).toHaveBeenCalledTimes(1);
  });

  it('PERMISSION_DENIED after the permission was revoked: same explanation and "Try again"', async () => {
    native.setSharedWriteAccess(true);
    const pdf = seedFile(`${DL}/report.pdf`);
    native.deleteFile.mockImplementationOnce(async () => {
      // Revoked in Settings while the app was running.
      native.setSharedWriteAccess(false);
      throw Object.assign(new Error('denied'), { code: 'PERMISSION_DENIED' });
    });
    await renderLibrary();
    await openActions(pdf.id);
    await choose('Delete');
    await fireEvent.press(screen.getByTestId('delete-confirm', H));
    await waitFor(() => expect(toastText()).toBe(DENIED));
    expect(native.openAllFilesAccessSettings).not.toHaveBeenCalled();
    expect(getRepositories().files.getById(pdf.id)).toBeDefined();

    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(explainer()).not.toBeNull());
    await fireEvent.press(screen.getByTestId('write-access-continue', H));
    await waitFor(() => expect(screen.getByTestId('delete-dialog', H)).toBeTruthy());
    await fireEvent.press(screen.getByTestId('delete-confirm', H));
    await waitFor(() => expect(toastText()).toBe('Deleted'));
    expect(native.requestSharedWriteAccess).toHaveBeenCalledTimes(1);
  });
});

describe('storage permission on Android 11+', () => {
  it('never asks for the legacy permission: write actions open directly', async () => {
    native.addFolder(DL);
    const pdf = seedFile(`${DL}/report.pdf`);
    await renderLibrary();
    await openActions(pdf.id);
    await choose('Rename');
    await waitFor(() => expect(screen.getByTestId('rename-dialog', H)).toBeTruthy());
    await fireEvent.press(screen.getByTestId('rename-dialog-cancel', H));
    await openActions(pdf.id);
    await choose('Delete');
    await waitFor(() => expect(screen.getByTestId('delete-dialog', H)).toBeTruthy());
    await fireEvent.press(screen.getByTestId('delete-cancel', H));
    await openActions(pdf.id);
    await choose('Duplicate');
    await waitFor(() => expect(toastText()).toBe('Copy created'));
    expect(screen.queryByTestId('write-access-dialog', H)).toBeNull();
    expect(native.requestSharedWriteAccess).not.toHaveBeenCalled();
    expect(native.hasSharedWriteAccess).not.toHaveBeenCalled();
  });
});
