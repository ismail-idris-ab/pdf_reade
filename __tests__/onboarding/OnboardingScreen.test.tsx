import { act, fireEvent, render, screen } from '@testing-library/react-native';
import Storage from 'expo-sqlite/kv-store';
import { AppState, Linking, Platform, type AppStateStatus } from 'react-native';

import OnboardingScreen from '../../app/onboarding';
import FileIndexModule from '../../modules/file-index/src/FileIndexModule';
import type { FakeFileIndexModule } from '../files/fakeFileIndex';
import { ToastHost, useToastStore } from '@/components/ui';
import { getRepositories } from '@/db/client';
import { useOnboardingStore } from '@/features/onboarding/store';
import { useAllFilesAccessStore } from '@/lib/files';
import { ThemeProvider } from '@/theme';

jest.mock('../../modules/file-index/src/FileIndexModule', () =>
  jest.requireActual('../files/fakeFileIndex').createFakeFileIndexModule(),
);

// The real client opens expo-sqlite; tests use an in-memory better-sqlite3 database.
jest.mock('@/db/client', () => {
  const { createTestDatabase } =
    jest.requireActual<typeof import('../db/testDatabase')>('../db/testDatabase');
  const { createRepositories } =
    jest.requireActual<typeof import('@/db/repositories')>('@/db/repositories');
  const repositories = createRepositories(createTestDatabase().db);
  return { getRepositories: () => repositories, getDatabase: jest.fn() };
});

const native = FileIndexModule as unknown as FakeFileIndexModule;
const PICKED = {
  uri: 'content://com.android.providers.downloads.documents/document/7',
  name: null,
  size: 10,
  mime: 'application/pdf',
  mtime: 1_000,
  persisted: true,
};

let appStateListeners: ((state: AppStateStatus) => void)[] = [];

beforeEach(() => {
  jest.clearAllMocks();
  (Storage as unknown as { clearSync: () => boolean }).clearSync();
  useOnboardingStore.setState({ onboardingComplete: false });
  useAllFilesAccessStore.setState({ granted: null });
  useToastStore.setState({ current: null });
  native.hasAllFilesAccess.mockImplementation(() => false);
  native.pickDocuments.mockImplementation(() => Promise.resolve([]));
  for (const row of getRepositories().files.listIndexEntries()) {
    getRepositories().files.remove(row.id);
  }
  appStateListeners = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation((type, listener) => {
    if (type === 'change') appStateListeners.push(listener as (state: AppStateStatus) => void);
    return { remove: jest.fn() };
  });
});

afterEach(() => jest.restoreAllMocks());

function renderScreen() {
  return render(
    <ThemeProvider>
      <OnboardingScreen />
      <ToastHost />
    </ThemeProvider>,
  );
}

describe('OnboardingScreen', () => {
  it('shows the value points and both choices', async () => {
    await renderScreen();
    expect(screen.getByText('Your documents, ready when you are')).toBeOnTheScreen();
    expect(screen.getByText('Read, scan and compress PDFs in one app')).toBeOnTheScreen();
    expect(screen.getByText('Works offline. Your files stay on your phone')).toBeOnTheScreen();
    expect(screen.getByText('No ads while you read')).toBeOnTheScreen();
    expect(
      screen.getByRole('button', { name: 'Allow access to find all documents' }),
    ).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Pick files manually' })).toBeOnTheScreen();
  });

  it('picking files adds them to the library and completes onboarding', async () => {
    native.pickDocuments.mockResolvedValueOnce([PICKED]);
    await renderScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Pick files manually' }));

    expect(native.pickDocuments).toHaveBeenCalledWith({
      mimeTypes: expect.arrayContaining(['application/pdf', 'text/csv']),
      multiple: true,
    });
    expect(getRepositories().files.getByPath(PICKED.uri)).toMatchObject({
      name: 'Untitled document',
      ext: 'pdf',
      source: 'device',
    });
    // Completing onboarding flips the route guard, which navigates home.
    expect(useOnboardingStore.getState().onboardingComplete).toBe(true);
  });

  it('stays on onboarding when the picker is cancelled', async () => {
    await renderScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Pick files manually' }));
    expect(native.pickDocuments).toHaveBeenCalledTimes(1);
    expect(useOnboardingStore.getState().onboardingComplete).toBe(false);
    expect(getRepositories().files.listIndexEntries()).toHaveLength(0);
    expect(useToastStore.getState().current).toBeNull();
  });

  it('shows a toast and stays when the picker fails', async () => {
    native.pickDocuments.mockRejectedValueOnce(
      Object.assign(new Error('busy'), { code: 'ERR_PICK_IN_PROGRESS' }),
    );
    await renderScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Pick files manually' }));
    expect(useOnboardingStore.getState().onboardingComplete).toBe(false);
    expect(screen.getByText('Something went wrong. Please try again.')).toBeOnTheScreen();

    native.pickDocuments.mockResolvedValueOnce([PICKED]);
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(native.pickDocuments).toHaveBeenCalledTimes(2);
    expect(useOnboardingStore.getState().onboardingComplete).toBe(true);
  });

  it('offers Open Settings (app settings) for PERMISSION_DENIED', async () => {
    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    native.pickDocuments.mockRejectedValueOnce(
      Object.assign(new Error('denied'), { code: 'PERMISSION_DENIED' }),
    );
    await renderScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Pick files manually' }));
    expect(
      screen.getByText(
        'Permission needed. Allow access in Settings so the app can open your documents.',
      ),
    ).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Open Settings' }));
    expect(openSettings).toHaveBeenCalledTimes(1);
    expect(native.openAllFilesAccessSettings).not.toHaveBeenCalled();
  });

  it('does not store or complete when no picked grant could be kept', async () => {
    native.pickDocuments.mockResolvedValueOnce([{ ...PICKED, persisted: false }]);
    await renderScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Pick files manually' }));
    expect(getRepositories().files.listIndexEntries()).toHaveLength(0);
    expect(useOnboardingStore.getState().onboardingComplete).toBe(false);
    expect(
      screen.getByText(
        'Some files couldn’t be added: their source app doesn’t allow lasting access. Try saving them to your phone first.',
      ),
    ).toBeOnTheScreen();
  });

  it('completes with the kept files and tells the user about the others', async () => {
    native.pickDocuments.mockResolvedValueOnce([
      PICKED,
      { ...PICKED, uri: 'content://p/temporary', persisted: false },
    ]);
    await renderScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Pick files manually' }));
    expect(
      getRepositories()
        .files.listIndexEntries()
        .map((row) => row.path),
    ).toEqual([PICKED.uri]);
    expect(useOnboardingStore.getState().onboardingComplete).toBe(true);
    expect(useToastStore.getState().current?.message).toMatch(/couldn’t be added/);
  });

  it('tells the user when older picks were evicted for the grant cap', async () => {
    jest.spyOn(Platform, 'Version', 'get').mockReturnValue(29);
    const old = Array.from({ length: 120 }, (_, i) => `content://p/old-${i}`);
    getRepositories().files.upsertMany(
      old.map((uri, i) => ({
        path: uri,
        uri,
        name: `old-${i}.pdf`,
        ext: 'pdf',
        mime: 'application/pdf',
        size: 1,
        mtime: i,
        source: 'device' as const,
      })),
    );
    native.listPersistedUris.mockImplementation(() => old);
    native.pickDocuments.mockResolvedValueOnce([PICKED]);
    await renderScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Pick files manually' }));
    expect(native.releasePersistedUri).toHaveBeenCalledWith('content://p/old-0');
    expect(getRepositories().files.getByPath('content://p/old-0')).toBeUndefined();
    expect(useOnboardingStore.getState().onboardingComplete).toBe(true);
    expect(
      screen.getByText(
        'To make room, older picked files were removed from your library (1). Pick them again to get them back.',
      ),
    ).toBeOnTheScreen();
  });

  it('releases the new grants when storing the picked files fails', async () => {
    getRepositories().files.upsert({
      path: 'content://p/already',
      uri: 'content://p/already',
      name: 'already.pdf',
      ext: 'pdf',
      mime: 'application/pdf',
      size: 1,
      mtime: 1,
      source: 'device',
    });
    jest.spyOn(getRepositories().files, 'upsertMany').mockImplementationOnce(() => {
      throw new Error('disk I/O error');
    });
    native.pickDocuments.mockResolvedValueOnce([PICKED, { ...PICKED, uri: 'content://p/already' }]);
    await renderScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Pick files manually' }));
    // Only the grant the library did not already rely on is released.
    expect(native.releasePersistedUri.mock.calls).toEqual([[PICKED.uri]]);
    expect(useOnboardingStore.getState().onboardingComplete).toBe(false);
    expect(screen.getByText('Something went wrong. Please try again.')).toBeOnTheScreen();
  });

  it('allow access opens Settings and completes once access is granted on return', async () => {
    await renderScreen();
    await fireEvent.press(
      screen.getByRole('button', { name: 'Allow access to find all documents' }),
    );
    expect(native.openAllFilesAccessSettings).toHaveBeenCalledTimes(1);
    expect(useOnboardingStore.getState().onboardingComplete).toBe(false);

    native.hasAllFilesAccess.mockImplementation(() => true);
    await act(async () => {
      for (const listener of appStateListeners) listener('active');
    });
    expect(useOnboardingStore.getState().onboardingComplete).toBe(true);
  });

  it('stays on onboarding when the user returns without granting access', async () => {
    await renderScreen();
    await fireEvent.press(
      screen.getByRole('button', { name: 'Allow access to find all documents' }),
    );
    await act(async () => {
      for (const listener of appStateListeners) listener('active');
    });
    expect(useOnboardingStore.getState().onboardingComplete).toBe(false);
    expect(screen.getByRole('button', { name: 'Pick files manually' })).toBeOnTheScreen();
  });

  it('completes immediately when access is already granted', async () => {
    native.hasAllFilesAccess.mockImplementation(() => true);
    await renderScreen();
    await fireEvent.press(
      screen.getByRole('button', { name: 'Allow access to find all documents' }),
    );
    expect(native.openAllFilesAccessSettings).not.toHaveBeenCalled();
    expect(useOnboardingStore.getState().onboardingComplete).toBe(true);
  });
});
