// Temporary landing screen for a document handed to the app by another app
// (ACTION_VIEW, or an ACTION_SEND of one PDF-like file) — see T1.6. The real
// reader arrives in T2.3; until then this only confirms which file was
// received, so the hand-off is never silently dropped.
import { useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/ui';
import { getRepositories } from '@/db/client';
import { useFormatFileSize, useTranslation } from '@/i18n';

export default function OpenScreen() {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const formatFileSize = useFormatFileSize();
  const { fileId } = useLocalSearchParams<{ fileId: string }>();
  const id = Number(fileId);
  const file = Number.isFinite(id) ? getRepositories().files.getById(id) : undefined;

  if (!file) {
    return (
      <View
        className="flex-1 bg-background"
        style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
      >
        <EmptyState title={t('intents.openNotFound')} />
      </View>
    );
  }

  return (
    <View
      className="flex-1 bg-background px-6"
      style={{ paddingTop: insets.top + 32, paddingBottom: insets.bottom + 24 }}
    >
      <Text
        accessibilityRole="header"
        numberOfLines={2}
        className="text-xl font-bold text-foreground"
      >
        {file.name}
      </Text>
      <Text className="mt-2 text-base text-muted">{formatFileSize(file.size)}</Text>
      <Text className="mt-8 text-base text-foreground">{t('intents.readerComingSoon')}</Text>
    </View>
  );
}
