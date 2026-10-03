import '../global.css';

import { useMigrations } from 'drizzle-orm/expo-sqlite/migrator';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';

import { getDatabase, getRepositories } from '@/db/client';
import migrations from '@/db/migrations/migrations';

// Keep the splash screen up until the database is migrated.
void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const { success, error } = useMigrations(getDatabase(), migrations);

  useEffect(() => {
    if (success) {
      // Switches foreign keys on now that migrations are done.
      getRepositories();
    }
    if (success || error) {
      void SplashScreen.hideAsync();
    }
  }, [success, error]);

  // Surface migration failures to the error boundary (T0.4) instead of
  // running the app against a half-migrated database.
  if (error) throw error;
  if (!success) return null;

  return (
    <>
      <Stack screenOptions={{ headerShown: false }} />
      <StatusBar style="auto" />
    </>
  );
}
