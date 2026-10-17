import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import Storage from 'expo-sqlite/kv-store';
import { router } from 'expo-router';
import {
  AccessibilityInfo,
  AppState,
  Keyboard,
  TextInput,
  type AppStateStatus,
} from 'react-native';

import PdfEngineModule from '../../modules/pdf-engine/src/PdfEngineModule';
import { codedError, type FakePdfEngineModule } from '../engine/fakePdfEngine';
import { getRepositories } from '@/db/client';
import type { NewFile } from '@/db/types';
import { REFOCUS_DELAY_MS } from '@/features/reader/components/PasswordPrompt';
import { ReaderScreen } from '@/features/reader/ReaderScreen';
import { CLOSE_DELAY_MS } from '@/features/reader/useReaderDocument';
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
jest.mock('expo-router', () => ({
  router: { back: jest.fn(), canGoBack: jest.fn(() => true), replace: jest.fn() },
}));
// The raw SQLite handle is kept so a test can read every row of every table.
jest.mock('@/db/client', () => {
  const { createTestDatabase } =
    jest.requireActual<typeof import('../db/testDatabase')>('../db/testDatabase');
  const { createRepositories } =
    jest.requireActual<typeof import('@/db/repositories')>('@/db/repositories');
  const { db, sqlite } = createTestDatabase();
  const repositories = createRepositories(db);
  return { getRepositories: () => repositories, getDatabase: jest.fn(), testSqlite: sqlite };
});

type SqliteHandle = {
  prepare: (sql: string) => { all: () => Record<string, unknown>[] };
};

const engine = PdfEngineModule as unknown as FakePdfEngineModule;
const SECRET = 'S3cret-pass!';

function addFile(overrides: Partial<NewFile> = {}) {
  return getRepositories().files.upsert({
    path: '/storage/emulated/0/Download/locked.pdf',
    uri: null,
    name: 'locked.pdf',
    ext: 'pdf',
    mime: 'application/pdf',
    size: 100,
    mtime: 1,
    source: 'downloads',
    ...overrides,
  });
}

const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

async function renderReader(fileId: number) {
  const result = await render(
    <ThemeProvider>
      <ReaderScreen fileId={fileId} />
    </ThemeProvider>,
  );
  await settle();
  return result;
}

const input = () => screen.getByTestId('reader-password-input');

async function typePassword(value: string) {
  await act(async () => fireEvent.changeText(input(), value));
}

async function pressOpen() {
  await act(async () => fireEvent.press(screen.getByTestId('reader-password-open')));
  await settle();
}

/** Every value in every table of the app database, as one string. */
function dumpDatabase(): string {
  const sqlite = jest.requireMock<{ testSqlite: SqliteHandle }>('@/db/client').testSqlite;
  const tables = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map((row) => String(row.name));
  return JSON.stringify(tables.map((table) => sqlite.prepare(`SELECT * FROM "${table}"`).all()));
}

// Spies on real modules, restored after each test.
const spies: { mockRestore: () => void }[] = [];
function track<T extends { mockRestore: () => void }>(spy: T): T {
  spies.push(spy);
  return spy;
}

afterEach(async () => {
  cleanup();
  // Only this file's spies: restoreAllMocks would also strip the fake engine.
  for (const spy of spies.splice(0)) spy.mockRestore();
  await act(() => new Promise<void>((resolve) => setTimeout(resolve, CLOSE_DELAY_MS + 20)));
});

beforeEach(() => {
  jest.clearAllMocks();
  engine.reset();
  useThemeStore.setState({ preference: 'light' });
  for (const row of getRepositories().files.listIndexEntries()) {
    getRepositories().files.remove(row.id);
  }
});

describe('ReaderScreen — password-protected PDF (T2.5)', () => {
  it('asks for the password in a secure field, with a show/hide toggle', async () => {
    const file = addFile();
    engine.open.mockRejectedValueOnce(codedError('PASSWORD_REQUIRED'));
    await renderReader(file.id);

    expect(screen.getByText('locked.pdf')).toBeOnTheScreen();
    expect(screen.getByText('This file is password-protected')).toBeOnTheScreen();
    expect(screen.getByText('Enter the password to open it.')).toBeOnTheScreen();
    const field = input();
    expect(field.props).toMatchObject({
      accessibilityLabel: 'Password',
      secureTextEntry: true,
      autoFocus: true,
      autoCorrect: false,
      autoCapitalize: 'none',
      autoComplete: 'off',
      importantForAutofill: 'no',
      returnKeyType: 'go',
    });

    const toggle = screen.getByTestId('reader-password-toggle');
    expect(toggle.props.accessibilityLabel).toBe('Show password');
    await act(async () => fireEvent.press(toggle));
    expect(screen.getByTestId('reader-password-toggle').props.accessibilityLabel).toBe(
      'Hide password',
    );
    expect(input().props.secureTextEntry).toBe(false);
    // A shown password still keeps the keyboard from learning it.
    expect(input().props.keyboardType).toBe('visible-password');
  });

  it('disables Open while the field is empty', async () => {
    const file = addFile();
    engine.open.mockRejectedValueOnce(codedError('PASSWORD_REQUIRED'));
    await renderReader(file.id);

    expect(screen.getByTestId('reader-password-open')).toBeDisabled();
    await act(async () => fireEvent(input(), 'submitEditing'));
    expect(engine.open).toHaveBeenCalledTimes(1);

    await typePassword(SECRET);
    expect(screen.getByTestId('reader-password-open')).toBeEnabled();
    await typePassword('');
    expect(screen.getByTestId('reader-password-open')).toBeDisabled();
  });

  it('opens with the password and reads like any PDF, restoring page, mode and zoom', async () => {
    const file = addFile();
    getRepositories().readingState.save({
      fileId: file.id,
      page: 1,
      mode: 'horizontal',
      zoom: 2,
    });
    engine.open.mockRejectedValueOnce(codedError('PASSWORD_REQUIRED'));
    const { unmount } = await renderReader(file.id);

    await typePassword(SECRET);
    await pressOpen();

    expect(engine.open).toHaveBeenLastCalledWith(file.path, SECRET, expect.any(String));
    expect(screen.queryByTestId('reader-password')).toBeNull();
    expect(screen.getByTestId('reader-page-0')).toBeOnTheScreen();
    expect(screen.getByText('2 / 3')).toBeOnTheScreen();
    await act(async () => fireEvent.press(screen.getByTestId('reader-more')));
    expect(screen.getByTestId('reader-mode').props.accessibilityLabel).toBe(
      'Switch to continuous scrolling',
    );
    expect(getRepositories().readingState.get(file.id)).toMatchObject({ zoom: 2 });

    const [docId] = engine.openDocIds();
    await unmount();
    await waitFor(() => expect(engine.close).toHaveBeenCalledWith(docId), {
      timeout: CLOSE_DELAY_MS * 8,
    });
    expect(engine.openDocIds()).toEqual([]);
  });

  it('shows the checking state, then an inline error for a wrong password, and retries from the keyboard', async () => {
    engine.setHoldOpens(true);
    const file = addFile();
    await renderReader(file.id);
    await act(async () => engine.rejectOpen(engine.pendingOpenIds()[0] ?? '', 'PASSWORD_REQUIRED'));

    await typePassword('wrong');
    await pressOpen();
    const open = screen.getByTestId('reader-password-open');
    expect(open).toBeDisabled();
    expect(open.props.accessibilityState).toMatchObject({ busy: true });
    expect(screen.getByText('Checking the password…')).toBeOnTheScreen();

    await act(async () => engine.rejectOpen(engine.pendingOpenIds()[0] ?? '', 'WRONG_PASSWORD'));
    expect(screen.getByTestId('reader-password')).toBeOnTheScreen();
    expect(
      screen.getByText('That password did not work. Check it and try again.'),
    ).toBeOnTheScreen();
    expect(input().props.value).toBe('');
    expect(screen.getByTestId('reader-password-open')).toBeDisabled();

    // Again, wrong; then right, from the keyboard's Go key.
    await typePassword('still wrong');
    await act(async () => fireEvent(input(), 'submitEditing'));
    await act(async () => engine.rejectOpen(engine.pendingOpenIds()[0] ?? '', 'WRONG_PASSWORD'));
    expect(input().props.value).toBe('');

    await typePassword(SECRET);
    await act(async () => fireEvent(input(), 'submitEditing'));
    expect(engine.open).toHaveBeenLastCalledWith(file.path, SECRET, expect.any(String));
    await act(async () => {
      engine.resolveOpen(engine.pendingOpenIds()[0] ?? '');
    });
    await settle();
    expect(screen.getByTestId('reader')).toBeOnTheScreen();
    expect(reportError).not.toHaveBeenCalled();
  });

  it('brings the keyboard back after a wrong password sent from the Go key', async () => {
    const focus = track(jest.spyOn(TextInput.prototype, 'focus'));
    const blur = track(jest.spyOn(TextInput.prototype, 'blur'));
    // Android closed the keyboard but the field still holds focus.
    track(jest.spyOn(TextInput.prototype, 'isFocused').mockReturnValue(true));
    engine.setHoldOpens(true);
    const file = addFile();
    await renderReader(file.id);
    await act(async () => engine.rejectOpen(engine.pendingOpenIds()[0] ?? '', 'PASSWORD_REQUIRED'));
    await typePassword('wrong');
    await act(async () => fireEvent(input(), 'submitEditing'));
    focus.mockClear();
    blur.mockClear();

    await act(async () => engine.rejectOpen(engine.pendingOpenIds()[0] ?? '', 'WRONG_PASSWORD'));
    expect(focus).not.toHaveBeenCalled();
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, REFOCUS_DELAY_MS + 20)));
    expect(blur).toHaveBeenCalledTimes(1);
    expect(focus).toHaveBeenCalledTimes(1);
    expect(blur.mock.invocationCallOrder[0]).toBeLessThan(focus.mock.invocationCallOrder[0] ?? 0);
  });

  it('Cancel leaves the reader', async () => {
    const file = addFile();
    engine.open.mockRejectedValueOnce(codedError('PASSWORD_REQUIRED'));
    await renderReader(file.id);
    await act(async () => fireEvent.press(screen.getByTestId('reader-password-cancel')));
    expect(router.back).toHaveBeenCalled();
    expect(engine.open).toHaveBeenCalledTimes(1);
  });

  it('shows another failure on the error screen; Try again asks for the password again', async () => {
    const file = addFile();
    engine.open
      .mockRejectedValueOnce(codedError('PASSWORD_REQUIRED'))
      .mockRejectedValueOnce(codedError('OUT_OF_MEMORY'))
      .mockRejectedValueOnce(codedError('PASSWORD_REQUIRED'));
    await renderReader(file.id);
    await typePassword(SECRET);
    await pressOpen();

    expect(screen.getByTestId('reader-error-OUT_OF_MEMORY')).toBeOnTheScreen();
    await act(async () => fireEvent.press(screen.getByTestId('reader-action-retry')));
    await settle();
    expect(engine.open).toHaveBeenLastCalledWith(file.path, null, expect.any(String));
    expect(screen.getByTestId('reader-password')).toBeOnTheScreen();
    expect(input().props.value).toBe('');
    expect(screen.queryByText('That password did not work. Check it and try again.')).toBeNull();
  });

  it('CORRUPT_FILE after a password: the error screen with its recovery', async () => {
    const file = addFile();
    engine.open
      .mockRejectedValueOnce(codedError('PASSWORD_REQUIRED'))
      .mockRejectedValueOnce(codedError('CORRUPT_FILE'));
    await renderReader(file.id);
    await typePassword(SECRET);
    await pressOpen();
    expect(screen.getByText('This file is damaged')).toBeOnTheScreen();
    expect(screen.getByTestId('reader-action-pickAnotherFile')).toBeOnTheScreen();
  });

  it('aborts a password open still running when the reader closes', async () => {
    engine.setHoldOpens(true);
    const file = addFile();
    const { unmount } = await renderReader(file.id);
    await act(async () => engine.rejectOpen(engine.pendingOpenIds()[0] ?? '', 'PASSWORD_REQUIRED'));
    await typePassword(SECRET);
    await pressOpen();
    const [openId] = engine.pendingOpenIds();
    await unmount();
    expect(engine.cancelOpen).toHaveBeenCalledWith(openId);
    expect(engine.openDocIds()).toEqual([]);
  });

  it('asks again when the file is opened again', async () => {
    const file = addFile();
    engine.open.mockRejectedValueOnce(codedError('PASSWORD_REQUIRED'));
    const first = await renderReader(file.id);
    await typePassword(SECRET);
    await pressOpen();
    expect(screen.getByTestId('reader')).toBeOnTheScreen();
    await first.unmount();

    engine.open.mockRejectedValueOnce(codedError('PASSWORD_REQUIRED'));
    await renderReader(file.id);
    expect(engine.open).toHaveBeenLastCalledWith(file.path, null, expect.any(String));
    expect(screen.getByTestId('reader-password')).toBeOnTheScreen();
    expect(input().props.value).toBe('');
  });

  it('never writes the password to the database, the key-value store, logs or crash reports', async () => {
    // Every way of writing to the key-value store, sync and async.
    const kvWrites = (
      ['setItemSync', 'setItem', 'setItemAsync', 'mergeItem', 'multiSet', 'multiMerge'] as const
    ).map((method) => track(jest.spyOn(Storage, method)));
    const consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
      track(jest.spyOn(console, method).mockImplementation(() => undefined)),
    );
    const file = addFile();
    engine.open
      .mockRejectedValueOnce(codedError('PASSWORD_REQUIRED'))
      .mockRejectedValueOnce(codedError('WRONG_PASSWORD'))
      .mockRejectedValueOnce(codedError('ERR_BRIDGE', `bad argument ${SECRET}x`))
      .mockRejectedValueOnce(codedError('PASSWORD_REQUIRED'));
    const { unmount } = await renderReader(file.id);

    await typePassword(`${SECRET}x`);
    await pressOpen();
    await typePassword(`${SECRET}x`);
    await pressOpen();
    // The unexpected failure is reported, without the password.
    expect(reportError).toHaveBeenCalledTimes(1);
    await act(async () => fireEvent.press(screen.getByTestId('reader-action-retry')));
    await settle();
    await typePassword(SECRET);
    await pressOpen();
    expect(screen.getByTestId('reader')).toBeOnTheScreen();
    // Reading (mode switch) writes reading_state; the reader then closes.
    await act(async () => fireEvent.press(screen.getByTestId('reader-more')));
    await act(async () => fireEvent.press(screen.getByTestId('reader-mode')));
    await unmount();
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, CLOSE_DELAY_MS + 20)));

    expect(getRepositories().readingState.get(file.id)).toBeDefined();
    const leaks = (text: string) => text.includes(SECRET);
    expect(leaks(dumpDatabase())).toBe(false);
    for (const spy of kvWrites) expect(leaks(JSON.stringify(spy.mock.calls))).toBe(false);
    const kvContents = Storage.getAllKeysSync().map((key) => [key, Storage.getItemSync(key)]);
    expect(leaks(JSON.stringify(kvContents))).toBe(false);
    for (const spy of consoleSpies) expect(leaks(JSON.stringify(spy.mock.calls))).toBe(false);
    for (const [reported] of jest.mocked(reportError).mock.calls) {
      const error = reported as Error & { cause?: unknown };
      expect(leaks(`${error.message} ${error.stack ?? ''} ${String(error.cause)}`)).toBe(false);
      expect(error.cause).toBeUndefined();
    }
  });

  it('keeps a password typed while the previous one was checked', async () => {
    engine.setHoldOpens(true);
    const file = addFile();
    await renderReader(file.id);
    await act(async () => engine.rejectOpen(engine.pendingOpenIds()[0] ?? '', 'PASSWORD_REQUIRED'));
    await typePassword('first');
    await pressOpen();
    await typePassword('second');
    await act(async () => engine.rejectOpen(engine.pendingOpenIds()[0] ?? '', 'WRONG_PASSWORD'));
    expect(input().props.value).toBe('second');
  });

  it('dismisses the keyboard once the document opens', async () => {
    const dismiss = track(jest.spyOn(Keyboard, 'dismiss'));
    const file = addFile();
    engine.open.mockRejectedValueOnce(codedError('PASSWORD_REQUIRED'));
    await renderReader(file.id);
    expect(dismiss).not.toHaveBeenCalled();
    await typePassword(SECRET);
    await pressOpen();
    expect(screen.getByTestId('reader')).toBeOnTheScreen();
    expect(dismiss).toHaveBeenCalled();
  });

  it('hides a shown password when the app leaves the foreground', async () => {
    const file = addFile();
    engine.open.mockRejectedValueOnce(codedError('PASSWORD_REQUIRED'));
    await renderReader(file.id);
    await act(async () => fireEvent.press(screen.getByTestId('reader-password-toggle')));
    expect(input().props.secureTextEntry).toBe(false);

    // AppState is a Jest mock (react-native preset): the prompt's listener is
    // the last one registered.
    const listener = jest.mocked(AppState.addEventListener).mock.calls.at(-1)?.[1] as
      ((state: AppStateStatus) => void) | undefined;
    await act(async () => listener?.('background'));
    expect(input().props.secureTextEntry).toBe(true);
    expect(screen.getByTestId('reader-password-toggle').props.accessibilityLabel).toBe(
      'Show password',
    );
  });

  it('with a screen reader: the wrong-password error is also the field hint', async () => {
    // A Jest mock (react-native preset): a one-off answer leaves it intact.
    jest.mocked(AccessibilityInfo.isScreenReaderEnabled).mockResolvedValueOnce(true);
    const file = addFile();
    engine.open
      .mockRejectedValueOnce(codedError('PASSWORD_REQUIRED'))
      .mockRejectedValueOnce(codedError('WRONG_PASSWORD'));
    await renderReader(file.id);
    expect(input().props.accessibilityHint).toBeUndefined();

    const focus = track(jest.spyOn(TextInput.prototype, 'focus'));
    await typePassword('wrong');
    focus.mockClear();
    await pressOpen();
    expect(input().props.accessibilityHint).toBe(
      'That password did not work. Check it and try again.',
    );
    // Focus stays where TalkBack put it.
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, REFOCUS_DELAY_MS + 20)));
    expect(focus).not.toHaveBeenCalled();
  });
});
