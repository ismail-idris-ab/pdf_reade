import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui';
import { useTranslation } from '@/i18n';
import { reportError } from '@/lib/crash';
import { toAppError, toRecoveryLabel, toUserMessage } from '@/lib/errors';
import { ThemeProvider } from '@/theme';

export type ErrorScreenProps = {
  error: Error;
  retry: () => Promise<void> | void;
};

/**
 * App-wide fallback rendered by the root layout's ErrorBoundary. It brings its
 * own ThemeProvider because the failure may have happened above the app's.
 * Retry remounts the layout, which also reruns database migrations.
 */
export function ErrorScreen({ error, retry }: ErrorScreenProps) {
  // Subscribes to language changes so the copy below re-renders.
  useTranslation();

  useEffect(() => {
    reportError(error);
    // The layout threw before it could hide the splash screen.
    void SplashScreen.hideAsync();
  }, [error]);

  // The only action here is Retry, so codes whose recovery is something else
  // (enter password, open Settings, ...) get the generic message instead.
  const coded = toUserMessage(toAppError(error).code);
  const { title, message } = coded.recovery === 'retry' ? coded : toUserMessage('UNKNOWN');

  return (
    <ThemeProvider>
      <ErrorContent title={title} message={message} onRetry={() => void retry()} />
    </ThemeProvider>
  );
}

function ErrorContent({
  title,
  message,
  onRetry,
}: {
  title: string;
  message: string;
  onRetry: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View
      className="flex-1 items-center justify-center gap-3 bg-background px-8"
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
    >
      <Text
        accessibilityRole="header"
        className="text-center text-xl font-semibold text-foreground"
      >
        {title}
      </Text>
      <Text className="text-center text-base text-muted">{message}</Text>
      <View className="mt-4">
        <Button label={toRecoveryLabel('retry')} onPress={onRetry} />
      </View>
    </View>
  );
}
