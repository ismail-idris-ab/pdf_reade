import { Text, View } from 'react-native';

import { useOnboardingStore } from '@/features/onboarding/store';
import { useTranslation } from '@/i18n';
import { useAllFilesAccess } from '@/lib/files';

import { showErrorToast } from './errorToast';
import { Button } from './ui';

/**
 * Inline prompt to grant all-files access, shown after onboarding while the
 * permission is missing. It never blocks the screen: manual picking keeps
 * working whether or not the user acts on it.
 */
export function AccessBanner() {
  const { t } = useTranslation();
  const onboardingComplete = useOnboardingStore((state) => state.onboardingComplete);
  const { granted, requestAccess } = useAllFilesAccess();

  if (!onboardingComplete || granted !== false) return null;

  const allow = () => {
    requestAccess().catch((error: unknown) => showErrorToast(error, { onRetry: allow }));
  };

  return (
    <View
      testID="access-banner"
      className="w-full gap-3 rounded-xl border border-border bg-surface p-4"
    >
      <Text className="text-base text-foreground">{t('access.bannerMessage')}</Text>
      <View className="self-start">
        <Button
          label={t('access.allow')}
          variant="secondary"
          accessibilityHint={t('onboarding.allowAccessHint')}
          onPress={allow}
        />
      </View>
    </View>
  );
}
