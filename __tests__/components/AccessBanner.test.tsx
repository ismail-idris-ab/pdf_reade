import { fireEvent, render, screen } from '@testing-library/react-native';
import { AppState } from 'react-native';

import FileIndexModule from '../../modules/file-index/src/FileIndexModule';
import type { FakeFileIndexModule } from '../files/fakeFileIndex';
import { AccessBanner } from '@/components/AccessBanner';
import { useOnboardingStore } from '@/features/onboarding/store';
import { useAllFilesAccessStore } from '@/lib/files';
import { ThemeProvider } from '@/theme';

jest.mock('../../modules/file-index/src/FileIndexModule', () =>
  jest.requireActual('../files/fakeFileIndex').createFakeFileIndexModule(),
);

const native = FileIndexModule as unknown as FakeFileIndexModule;

beforeEach(() => {
  jest.clearAllMocks();
  useAllFilesAccessStore.setState({ granted: null });
  jest.spyOn(AppState, 'addEventListener').mockImplementation(() => ({ remove: jest.fn() }));
});

afterEach(() => jest.restoreAllMocks());

const renderBanner = () =>
  render(
    <ThemeProvider>
      <AccessBanner />
    </ThemeProvider>,
  );

describe('AccessBanner', () => {
  it('shows after onboarding while access is missing, and requests access', async () => {
    useOnboardingStore.setState({ onboardingComplete: true });
    native.hasAllFilesAccess.mockImplementation(() => false);
    await renderBanner();
    expect(
      screen.getByText('Allow access so the app can find all your documents automatically.'),
    ).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Allow access' }));
    expect(native.openAllFilesAccessSettings).toHaveBeenCalledTimes(1);
  });

  it('is hidden when access is granted', async () => {
    useOnboardingStore.setState({ onboardingComplete: true });
    native.hasAllFilesAccess.mockImplementation(() => true);
    await renderBanner();
    expect(screen.queryByTestId('access-banner')).toBeNull();
  });

  it('is hidden before onboarding is complete', async () => {
    useOnboardingStore.setState({ onboardingComplete: false });
    native.hasAllFilesAccess.mockImplementation(() => false);
    await renderBanner();
    expect(screen.queryByTestId('access-banner')).toBeNull();
  });
});
