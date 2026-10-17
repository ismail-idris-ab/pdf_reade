import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react-native';
import { AppState, Dimensions } from 'react-native';

import PdfEngineModule from '../../modules/pdf-engine/src/PdfEngineModule';
import { codedError, type FakePdfEngineModule } from '../engine/fakePdfEngine';
import { useToastStore } from '@/components/ui';
import { getRepositories } from '@/db/client';
import { CLOSE_DELAY_MS } from '@/features/reader/useReaderDocument';
import { ReaderScreen } from '@/features/reader/ReaderScreen';
import { reportError } from '@/lib/crash';
import type { OutlineItem } from '@/lib/engine';
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
  await wait(0);
  return result;
}

const press = (testID: string) => act(async () => fireEvent.press(screen.getByTestId(testID)));
const indicator = () =>
  screen.getByTestId('reader-page-indicator').props.accessibilityLabel as string;

const item = (title: string, page: number | null, children: OutlineItem[] = []): OutlineItem => ({
  title,
  page,
  children,
});

const OUTLINE: OutlineItem[] = [
  item('Cover', 0),
  item('Chapter 1', 1, [item('Section 1.1', 2)]),
  item('Publisher website', null),
];

afterEach(async () => {
  cleanup();
  useToastStore.setState({ current: null });
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

describe('Reader top bar (T2.6)', () => {
  it('fits a 360 dp phone: back, title and four actions, the rest under More options', async () => {
    jest
      .spyOn(Dimensions, 'get')
      .mockReturnValue({ width: 360, height: 760, scale: 2, fontScale: 1 });
    engine.getOutline.mockResolvedValueOnce(OUTLINE);
    await renderReader(addFile().id);
    const bar = screen.getByTestId('reader-top-bar');
    const buttons = within(bar)
      .getAllByRole(/button|togglebutton/)
      .map((node) => node.props.testID as string);
    expect(buttons).toEqual([
      'reader-back',
      'reader-search',
      'reader-bookmark',
      'reader-contents',
      'reader-more',
    ]);
    expect(within(bar).getByText('report.pdf')).toBeOnTheScreen();
    // Back + 4 actions at 48 dp, gaps and padding leave room for the title.
    expect(360 - buttons.length * 48 - buttons.length * 4 - 8).toBeGreaterThanOrEqual(90);

    await press('reader-more');
    const menu = screen.getByTestId('reader-menu');
    expect(within(menu).getByTestId('reader-menu-bookmarks')).toBeOnTheScreen();
    expect(within(menu).getByTestId('reader-menu-jump')).toBeOnTheScreen();
    expect(within(menu).getByTestId('reader-mode')).toBeOnTheScreen();
  });
});

describe('Reader contents (T2.6)', () => {
  it('hides the Contents button for a document without an outline', async () => {
    await renderReader(addFile().id);
    expect(engine.getOutline).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('reader-contents')).toBeNull();
    // The bookmarks list alone, without tabs.
    await press('reader-more');
    await press('reader-menu-bookmarks');
    expect(screen.queryByTestId('reader-nav-tab-contents')).toBeNull();
    expect(screen.getByTestId('reader-bookmarks-empty')).toBeOnTheScreen();
  });

  it('lists the nested outline, jumps to an entry and closes', async () => {
    engine.getOutline.mockResolvedValueOnce(OUTLINE);
    await renderReader(addFile().id);
    await press('reader-contents');

    const tab = screen.getByTestId('reader-nav-tab-contents');
    expect(tab.props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByText('Chapter 1')).toBeOnTheScreen();
    expect(screen.getByText('Section 1.1')).toBeOnTheScreen();
    // The page being read (1) is in "Cover".
    expect(screen.getByTestId('reader-outline-item-0').props.accessibilityLabel).toBe(
      'Cover, Page 1, You are here',
    );

    // Collapsing a chapter hides its sections.
    const toggle = screen.getByTestId('reader-outline-toggle-1');
    expect(toggle.props.accessibilityState).toMatchObject({ expanded: true });
    await press('reader-outline-toggle-1');
    expect(screen.queryByText('Section 1.1')).toBeNull();
    await press('reader-outline-toggle-1');

    await press('reader-outline-item-1.0');
    expect(screen.queryByTestId('reader-nav-sheet')).toBeNull();
    expect(indicator()).toBe('Page 3 of 3');
  });

  it('shows an entry without a page, but not as a button', async () => {
    engine.getOutline.mockResolvedValueOnce(OUTLINE);
    await renderReader(addFile().id);
    await press('reader-contents');
    const entry = screen.getByTestId('reader-outline-item-2');
    expect(entry.props.accessibilityRole).toBeUndefined();
    expect(entry.props.accessibilityLabel).toBe('Publisher website, Not linked to a page');
    expect(entry.props.onPress).toBeUndefined();
  });

  it('shows a failed outline with its message and Try again', async () => {
    engine.getOutline
      .mockRejectedValueOnce(codedError('OUT_OF_MEMORY'))
      .mockResolvedValueOnce(OUTLINE);
    await renderReader(addFile().id);
    await press('reader-contents');
    expect(screen.getByText('This file is too large to handle right now')).toBeOnTheScreen();
    expect(reportError).not.toHaveBeenCalled();
    await press('reader-contents-retry');
    await wait(0);
    expect(screen.getByText('Chapter 1')).toBeOnTheScreen();
  });
});

describe('Reader bookmarks (T2.6)', () => {
  it('toggles the current page, lists, jumps, removes with undo, and survives a restart', async () => {
    const file = addFile();
    getRepositories().readingState.save({ fileId: file.id, page: 1, mode: 'vertical', zoom: 1 });
    const { unmount } = await renderReader(file.id);
    const toggle = () => screen.getByTestId('reader-bookmark');
    expect(toggle().props.accessibilityState).toMatchObject({ checked: false });
    expect(toggle().props.accessibilityLabel).toBe('Bookmark this page');

    await press('reader-bookmark');
    expect(toggle().props.accessibilityState).toMatchObject({ checked: true });
    expect(useToastStore.getState().current?.message).toBe('Page 2 bookmarked');
    expect(
      getRepositories()
        .bookmarks.listForFile(file.id)
        .map((b) => b.page),
    ).toEqual([1]);

    // Restart: the bookmark is read back from the database.
    await act(async () => unmount());
    await wait(CLOSE_DELAY_MS + 20);
    await renderReader(file.id);
    expect(toggle().props.accessibilityState).toMatchObject({ checked: true });

    // Go elsewhere, then back through the list.
    await press('reader-thumb-0');
    expect(toggle().props.accessibilityState).toMatchObject({ checked: false });
    await press('reader-more');
    await press('reader-menu-bookmarks');
    const row = screen.getByTestId('reader-bookmark-item-1');
    expect(row.props.accessibilityLabel).toMatch(/^Page 2, Added /);
    await press('reader-bookmark-item-1');
    expect(screen.queryByTestId('reader-nav-sheet')).toBeNull();
    expect(indicator()).toBe('Page 2 of 3');

    // Remove from the list, then undo.
    await press('reader-more');
    await press('reader-menu-bookmarks');
    expect(screen.getByTestId('reader-bookmark-remove-1').props.accessibilityLabel).toBe(
      'Remove bookmark, page 2',
    );
    await press('reader-bookmark-remove-1');
    expect(getRepositories().bookmarks.listForFile(file.id)).toEqual([]);
    expect(screen.getByTestId('reader-bookmarks-empty')).toBeOnTheScreen();
    // Undo is offered inside the sheet: a toast would be drawn behind it.
    expect(useToastStore.getState().current?.message).not.toBe('Bookmark removed from page 2');
    const sheet = screen.getByTestId('reader-nav-sheet');
    const notice = within(sheet).getByTestId('reader-nav-notice');
    expect(within(notice).getByText('Bookmark removed from page 2')).toBeOnTheScreen();
    expect(within(notice).getByText('Undo')).toBeOnTheScreen();
    await act(async () => fireEvent.press(within(sheet).getByTestId('reader-nav-notice-action')));
    expect(screen.queryByTestId('reader-nav-notice')).toBeNull();
    expect(
      getRepositories()
        .bookmarks.listForFile(file.id)
        .map((b) => b.page),
    ).toEqual([1]);
    expect(screen.getByTestId('reader-bookmark-item-1')).toBeOnTheScreen();
  });

  it('shows a failed removal inside the sheet, with Try again', async () => {
    const file = addFile();
    getRepositories().bookmarks.add(file.id, 2, null, 1);
    await renderReader(file.id);
    await press('reader-more');
    await press('reader-menu-bookmarks');
    const remove = jest.spyOn(getRepositories().bookmarks, 'remove').mockImplementationOnce(() => {
      throw new Error('SQLITE_BUSY');
    });
    await press('reader-bookmark-remove-2');
    const sheet = screen.getByTestId('reader-nav-sheet');
    const notice = within(sheet).getByTestId('reader-nav-notice');
    expect(within(notice).getByText('Something went wrong')).toBeOnTheScreen();
    expect(within(notice).getByText('Try again')).toBeOnTheScreen();
    expect(reportError).toHaveBeenCalledTimes(1);
    await act(async () => fireEvent.press(within(sheet).getByTestId('reader-nav-notice-action')));
    expect(getRepositories().bookmarks.listForFile(file.id)).toEqual([]);
    expect(within(sheet).getByText('Bookmark removed from page 3')).toBeOnTheScreen();
    remove.mockRestore();
  });

  it('removes the bookmark of the current page with the toggle', async () => {
    const file = addFile();
    getRepositories().bookmarks.add(file.id, 0, null, 1);
    await renderReader(file.id);
    await press('reader-bookmark');
    expect(getRepositories().bookmarks.listForFile(file.id)).toEqual([]);
    expect(screen.getByTestId('reader-bookmark').props.accessibilityState).toMatchObject({
      checked: false,
    });
  });

  it('shows a failed save with Try again', async () => {
    const file = addFile();
    await renderReader(file.id);
    const add = jest.spyOn(getRepositories().bookmarks, 'add').mockImplementationOnce(() => {
      throw new Error('SQLITE_FULL');
    });
    await press('reader-bookmark');
    const shown = useToastStore.getState().current;
    expect(shown?.message).toBe('Something went wrong. Please try again.');
    expect(reportError).toHaveBeenCalledTimes(1);
    await act(async () => shown?.onAction?.());
    expect(
      getRepositories()
        .bookmarks.listForFile(file.id)
        .map((b) => b.page),
    ).toEqual([0]);
    add.mockRestore();
  });
});
