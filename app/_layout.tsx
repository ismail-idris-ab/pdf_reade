// Must stay the first import: starts crash reporting before other modules load.
import '@/lib/crash/init';
// Initialises i18next (synchronously) before any screen renders.
import '@/i18n/i18n';
import '../global.css';

import { useMigrations } from 'drizzle-orm/expo-sqlite/migrator';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';

import { ErrorScreen } from '@/components/ErrorScreen';
import { ToastHost } from '@/components/ui';
import { getDatabase, getRepositories } from '@/db/client';
import migrations from '@/db/migrations/migrations';
import { useDeviceLocaleSync } from '@/i18n';
import { ThemeProvider, useTheme } from '@/theme';

// Keep the splash screen up until the database is migrated.
void SplashScreen.preventAutoHideAsync();

// expo-router wraps this layout (and every screen below it) in this boundary.
export { ErrorScreen as ErrorBoundary };

export default function RootLayout() {
  const { success, error } = useMigrations(getDatabase(), migrations);
  useDeviceLocaleSync();

  useEffect(() => {
    if (success) {
      // Switches foreign keys on now that migrations are done.
      getRepositories();
    }
    if (success || error) {
      void SplashScreen.hideAsync();
    }
  }, [success, error]);

  // Surface migration failures to the error boundary instead of running
  // the app against a half-migrated database.
  if (error) throw error;
  if (!success) return null;

  return (
    <ThemeProvider>
      <ThemedStack />
      <ToastHost />
    </ThemeProvider>
  );
}

function ThemedStack() {
  const { palette } = useTheme();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: palette.background },
      }}
    />
  );
}
