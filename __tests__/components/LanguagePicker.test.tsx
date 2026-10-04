import { fireEvent, render, screen } from '@testing-library/react-native';
import Storage from 'expo-sqlite/kv-store';

import { LanguagePicker } from '@/components/LanguagePicker';
import { useLocaleStore } from '@/i18n';
import { ThemeProvider } from '@/theme';

// Jest has no app config, so getEnabledLocales() returns the default ['en'].
describe('LanguagePicker', () => {
  beforeEach(() => {
    (Storage as unknown as { clearSync: () => boolean }).clearSync();
    useLocaleStore.setState({ preference: 'system' });
  });

  function renderPicker(onClose = jest.fn()) {
    return render(
      <ThemeProvider>
        <LanguagePicker visible onClose={onClose} />
      </ThemeProvider>,
    );
  }

  it('lists only the phone language option and enabled locales, as radio buttons', async () => {
    await renderPicker();
    const options = screen.getAllByRole('radio');
    expect(options.map((option) => option.props.accessibilityLabel)).toEqual([
      'Use phone language',
      'English',
    ]);
    expect(screen.queryByText('Hausa')).toBeNull();
    expect(screen.queryByText('Français')).toBeNull();
    expect(screen.getByRole('radio', { name: 'Use phone language' })).toBeChecked();
  });

  it('saves the choice and closes', async () => {
    const onClose = jest.fn();
    await renderPicker(onClose);
    await fireEvent.press(screen.getByRole('radio', { name: 'English' }));
    expect(useLocaleStore.getState().preference).toBe('en');
    expect(onClose).toHaveBeenCalled();
  });

  it('shows "phone language" as current when the saved locale is disabled', async () => {
    useLocaleStore.setState({ preference: 'fr' });
    await renderPicker();
    expect(screen.getByRole('radio', { name: 'Use phone language' })).toBeChecked();
  });
});
