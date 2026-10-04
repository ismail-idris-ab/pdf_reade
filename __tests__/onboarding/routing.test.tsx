import Storage from 'expo-sqlite/kv-store';
import { act, renderRouter, screen } from 'expo-router/testing-library';
import { Text } from 'react-native';

import RootLayout from '../../app/_layout';
import OnboardingScreen from '../../app/onboarding';
import FileIndexModule from '../../modules/file-index/src/FileIndexModule';
import type { FakeFileIndexModule } from '../files/fakeFileIndex';
import { useOnboardingStore } from '@/features/onboarding/store';
import { useAllFilesAccessStore } from '@/lib/files';
import { isIndexing } from '@/lib/library';

jest.mock('../../modules/file-index/src/FileIndexModule', () =>
  jest.requireActual('../files/fakeFileIndex').createFakeFileIndexModule(),
);
jest.mock('../../global.css', () => ({}));
jest.mock('drizzle-orm/expo-sqlite/migrator', () => ({
  useMigrations: () => ({ success: true, error: undefined }),
}));
jest.mock('@/db/client', () => {
  const { createTestDatabase } =
    jest.requireActual<typeof import('../db/testDatabase')>('../db/testDatabase');
  const { createRepositories } =
    jest.requireActual<typeof import('@/db/repositories')>('@/db/repositories');
  const repositories = createRepositories(createTestDatabase().db);
  return { getRepositories: () => repositories, getDatabase: jest.fn() };
});

const native = FileIndexModule as unknown as FakeFileIndexModule;

// The real home screen runs native spikes in dev; a stand-in keeps this test
// about the route guard.
function Home() {
  return <Text>home</Text>;
}

const routes = { _layout: RootLayout, index: Home, onboarding: OnboardingScreen };

// renderRouter attaches its helpers to the value render() returns, which is
// a promise in RNTL 14: keep that object (returning it from an async function
// would unwrap it), and await it for the render.
async function launch(initialUrl: string) {
  const result = renderRouter(routes, { initialUrl });
  await result;
  return { getPathname: () => result.getPathname() };
}

beforeEach(() => {
  jest.clearAllMocks();
  (Storage as unknown as { clearSync: () => boolean }).clearSync();
  useAllFilesAccessStore.setState({ granted: null });
  native.hasAllFilesAccess.mockImplementation(() => false);
});

// renderRouter switches to fake timers.
afterEach(() => jest.useRealTimers());

describe('onboarding route guard', () => {
  it('opens onboarding on first launch, then lands home once completed', async () => {
    useOnboardingStore.setState({ onboardingComplete: false });
    const app = await launch('/');
    expect(app.getPathname()).toBe('/onboarding');
    expect(screen.getByText('Pick files manually')).toBeOnTheScreen();

    await act(async () => useOnboardingStore.getState().completeOnboarding());
    expect(app.getPathname()).toBe('/');
    expect(screen.getByText('home')).toBeOnTheScreen();
  });

  it('sends a deep link to / before onboarding to /onboarding', async () => {
    useOnboardingStore.setState({ onboardingComplete: false });
    const app = await launch('/');
    expect(app.getPathname()).toBe('/onboarding');
    expect(screen.queryByText('home')).toBeNull();
  });

  it('opens home directly when onboarding is complete and blocks /onboarding', async () => {
    useOnboardingStore.setState({ onboardingComplete: true });
    const app = await launch('/onboarding');
    expect(app.getPathname()).toBe('/');
    expect(screen.getByText('home')).toBeOnTheScreen();
  });

  it('starts a background scan on launch when access is granted', async () => {
    useOnboardingStore.setState({ onboardingComplete: true });
    native.hasAllFilesAccess.mockImplementation(() => true);
    await launch('/');
    expect(native.listPersistedUris).toHaveBeenCalled();
    expect(native.startScan).toHaveBeenCalledTimes(1);
    // Finish the scan so the next test starts with no run in progress.
    await act(async () => {
      native.emitComplete({
        scanId: 'scan-1',
        scanned: 0,
        emitted: 0,
        deleted: [],
        skippedDirs: 0,
        durationMs: 1,
        cancelled: false,
      });
    });
    expect(isIndexing()).toBe(false);
  });

  it('prunes picked files but does not scan without access', async () => {
    useOnboardingStore.setState({ onboardingComplete: true });
    await launch('/');
    expect(native.listPersistedUris).toHaveBeenCalled();
    expect(native.startScan).not.toHaveBeenCalled();
  });
});
