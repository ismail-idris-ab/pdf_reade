// Temporary landing screen for a SEND/SEND_MULTIPLE of images (T1.6). The
// Image→PDF pipeline arrives in T3.4; until then this only lists what was
// received, read once from useReceivedImagesStore (populated by
// useIntentRouter right before navigating here).
import { useEffect } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EmptyState, ListItem } from '@/components/ui';
import { useReceivedImagesStore } from '@/features/intents';
import { useFormatFileSize, useTranslation } from '@/i18n';

export default function ImageToPdfScreen() {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const formatFileSize = useFormatFileSize();
  const images = useReceivedImagesStore((state) => state.images);

  // Cleared when the screen goes away, not when it opens: the list has to
  // stay readable while it is on screen, and a later direct navigation to
  // this route should show the empty state rather than an old share.
  useEffect(() => () => useReceivedImagesStore.getState().setImages([]), []);

  if (images.length === 0) {
    return (
      <View
        className="flex-1 bg-background"
        style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
      >
        <EmptyState title={t('intents.imageToPdfEmpty')} />
      </View>
    );
  }

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerStyle={{ paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }}
    >
      <View className="gap-1 px-6">
        <Text accessibilityRole="header" className="text-xl font-bold text-foreground">
          {t('intents.imageToPdfTitle')}
        </Text>
        <Text className="text-base text-muted">
          {t('intents.imageToPdfCount', { count: images.length })}
        </Text>
      </View>
      <View className="mt-4">
        {images.map((image, index) => (
          <ListItem
            key={`${image.path}-${index}`}
            title={image.name}
            subtitle={formatFileSize(image.size)}
          />
        ))}
      </View>
      <Text className="mt-6 px-6 text-base text-foreground">
        {t('intents.imageToPdfComingSoon')}
      </Text>
    </ScrollView>
  );
}
