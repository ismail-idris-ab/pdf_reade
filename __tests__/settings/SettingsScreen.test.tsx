import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import Storage from 'expo-sqlite/kv-store';

import { SettingsScreen } from '@/features/settings/SettingsScreen';
import { i18n, useLocaleStore } from '@/i18n';
import { ThemeProvider, useThemeStore } from '@/theme';

jest.mock('expo-router', () => ({
  router: { back: jest.fn(), canGoBack: jest.fn(() => true), push: jest.fn(), replace: jest.fn() },
}));
// Jest has no app config; the version row reads this one. No extra.enabledLocales,
// so getEnabledLocales() stays at the launch default ['en'].
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { version: '1.2.3', android: { versionCode: 7 } } },
}));

const mockedRouter = router as jest.Mocked<typeof router>;

describe('SettingsScreen', () => {
  beforeEach(() => {
    (Storage as unknown as { clearSync: () => boolean }).clearSync();
    useThemeStore.setState({ preference: 'system' });
    useLocaleStore.setState({ preference: 'system' });
    jest.clearAllMocks();
  });

  function renderSettings() {
    return render(
      <ThemeProvider>
        <SettingsScreen />
      </ThemeProvider>,
    );
  }

  it('shows the current theme, language and app version', async () => {
    await renderSettings();
    expect(screen.getByRole('header', { name: 'Settings' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Theme, Use phone setting' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Language, Use phone language' })).toBeOnTheScreen();
    expect(screen.getByLabelText('Version, 1.2.3')).toBeOnTheScreen();
  });

  it('applies a theme as soon as it is picked', async () => {
    await renderSettings();
    await fireEvent.press(screen.getByTestId('settings-theme'));
    const options = screen.getAllByRole('radio');
    expect(options.map((option) => option.props.accessibilityLabel)).toEqual([
      'Use phone setting',
      'Light',
      'Dark',
      'Sepia',
    ]);
    expect(screen.getByRole('radio', { name: 'Use phone setting' })).toBeChecked();

    await fireEvent.press(screen.getByRole('radio', { name: 'Sepia' }));
    expect(useThemeStore.getState().preference).toBe('sepia');
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Theme, Sepia' })).toBeOnTheScreen();
  });

  it('lists only the phone language and English while only English is enabled', async () => {
    await renderSettings();
    await fireEvent.press(screen.getByTestId('settings-language'));
    const options = screen.getAllByRole('radio');
    expect(options.map((option) => option.props.accessibilityLabel)).toEqual([
      'Use phone language',
      'English',
    ]);

    await fireEvent.press(screen.getByRole('radio', { name: 'English' }));
    expect(useLocaleStore.getState().preference).toBe('en');
    expect(i18n.language).toBe('en');
    expect(screen.getByRole('button', { name: 'Language, English' })).toBeOnTheScreen();
  });

  it('shows a saved locale that is now disabled as the phone language', async () => {
    useLocaleStore.setState({ preference: 'ha' });
    await renderSettings();
    expect(screen.getByRole('button', { name: 'Language, Use phone language' })).toBeOnTheScreen();
  });

  it('goes back, or home when there is nothing to go back to', async () => {
    await renderSettings();
    await fireEvent.press(screen.getByRole('button', { name: 'Back' }));
    expect(mockedRouter.back).toHaveBeenCalled();

    mockedRouter.canGoBack.mockReturnValueOnce(false);
    await fireEvent.press(screen.getByRole('button', { name: 'Back' }));
    expect(mockedRouter.replace).toHaveBeenCalledWith('/');
  });
});
