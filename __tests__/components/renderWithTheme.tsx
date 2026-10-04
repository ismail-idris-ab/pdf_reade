import { render } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { ThemeProvider } from '@/theme';

export function renderWithTheme(ui: ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}
