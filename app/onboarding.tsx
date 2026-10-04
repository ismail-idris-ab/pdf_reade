import { useEffect, useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { showErrorToast } from '@/components/errorToast';
import { Button, toast } from '@/components/ui';
import { getRepositories } from '@/db/client';
import { useOnboardingStore } from '@/features/onboarding/store';
import { useTranslation } from '@/i18n';
import { useAllFilesAccess } from '@/lib/files';
import { pickIntoLibrary } from '@/lib/library/pickIntoLibrary';

const VALUE_POINTS = ['valueTools', 'valuePrivate', 'valueNoAds'] as const;

/**
 * First-run screen. Completing onboarding (access granted, or at least one
 * file kept from the picker) flips the route guard in app/_layout.tsx, which
 * replaces this screen with the home screen; the background scan starts from
 * there too.
 */
export default function OnboardingScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const completeOnboarding = useOnboardingStore((state) => state.completeOnboarding);
  const { granted, requestAccess } = useAllFilesAccess();
  const [awaitingAccess, setAwaitingAccess] = useState(false);
  const [picking, setPicking] = useState(false);
  // State updates are async; these refs block a double tap from starting an
  // action twice (two pickers, or Settings opened twice).
  const pickInFlight = useRef(false);
  const accessInFlight = useRef(false);

  // The user grants access in Settings; it is picked up when the app becomes
  // active again.
  useEffect(() => {
    if (awaitingAccess && granted === true) completeOnboarding();
  }, [awaitingAccess, granted, completeOnboarding]);

  const allowAccess = async () => {
    if (accessInFlight.current) return;
    if (granted === true) {
      completeOnboarding();
      return;
    }
    accessInFlight.current = true;
    setAwaitingAccess(true);
    try {
      await requestAccess();
    } catch (error) {
      setAwaitingAccess(false);
      showErrorToast(error, { onRetry: () => void allowAccess() });
    } finally {
      accessInFlight.current = false;
    }
  };

  const pickFiles = async () => {
    if (pickInFlight.current) return;
    pickInFlight.current = true;
    setPicking(true);
    try {
      const result = await pickIntoLibrary(getRepositories(), {
        now: Date.now,
        fallbackName: t('library.untitled'),
      });
      // Cancelled: stay here so the user can choose again.
      if (result === null) return;
      if (result.notPersisted > 0) toast(t('library.cannotKeepAccess'));
      else if (result.evicted > 0) toast(t('library.evictedOldPicks', { count: result.evicted }));
      // Only documents the library can reopen later count as a finished setup.
      if (result.rows.length > 0) completeOnboarding();
    } catch (error) {
      showErrorToast(error, { onRetry: () => void pickFiles() });
    } finally {
      pickInFlight.current = false;
      setPicking(false);
    }
  };

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="flex-grow">
      <View
        className="flex-1 justify-between gap-8 px-6"
        style={{ paddingTop: insets.top + 48, paddingBottom: insets.bottom + 24 }}
      >
        <View className="gap-6">
          <Text accessibilityRole="header" className="text-3xl font-bold text-foreground">
            {t('onboarding.title')}
          </Text>
          <View className="gap-4">
            {VALUE_POINTS.map((key) => (
              <View key={key} className="flex-row items-start gap-3">
                <View className="mt-2 h-2 w-2 rounded-full bg-primary" />
                <Text className="flex-1 text-lg text-foreground">{t(`onboarding.${key}`)}</Text>
              </View>
            ))}
          </View>
        </View>
        <View className="gap-3">
          <Button
            testID="onboarding-allow-access"
            label={t('onboarding.allowAccess')}
            accessibilityHint={t('onboarding.allowAccessHint')}
            onPress={allowAccess}
          />
          <Button
            testID="onboarding-pick-files"
            label={t('onboarding.pickFiles')}
            variant="secondary"
            loading={picking}
            onPress={pickFiles}
          />
          <Text className="text-center text-sm text-muted">{t('onboarding.manualNote')}</Text>
        </View>
      </View>
    </ScrollView>
  );
}
