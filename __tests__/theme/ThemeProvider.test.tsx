import { act, render, screen } from '@testing-library/react-native';
import Storage from 'expo-sqlite/kv-store';
import { Text } from 'react-native';

import { palettes, ThemeProvider, useTheme, useThemeStore } from '@/theme';

function Probe() {
  const { theme, palette } = useTheme();
  return <Text testID="probe">{`${theme} ${palette.background}`}</Text>;
}

describe('ThemeProvider', () => {
  beforeEach(async () => {
    (Storage as unknown as { clearSync: () => boolean }).clearSync();
    await act(() => useThemeStore.getState().setPreference('system'));
  });

  it('provides the palette for the chosen preference and reacts to changes', async () => {
    await render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );

    await act(() => useThemeStore.getState().setPreference('sepia'));
    expect(screen.getByTestId('probe')).toHaveTextContent(`sepia ${palettes.sepia.background}`);

    await act(() => useThemeStore.getState().setPreference('dark'));
    expect(screen.getByTestId('probe')).toHaveTextContent(`dark ${palettes.dark.background}`);
  });

  it('throws a clear error when used outside the provider', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(render(<Probe />)).rejects.toThrow('useTheme must be used inside ThemeProvider');
    spy.mockRestore();
  });
});
