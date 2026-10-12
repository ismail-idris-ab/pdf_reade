// Dev-only tools: native module versions and a link to the design gallery.
// Copy here is developer-facing and intentionally not translated; the route
// redirects home in release builds.
import { Redirect, router } from 'expo-router';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui';
import { getPdfEngineApiVersion } from '@/lib/engine';
import { getFileIndexApiVersion } from '@/lib/files';
import { getSecureVaultApiVersion } from '@/lib/vault';

export default function DevTools() {
  if (!__DEV__) return <Redirect href="/" />;
  return <Tools />;
}

function Tools() {
  const insets = useSafeAreaInsets();

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="items-center px-4"
      contentContainerStyle={{ paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }}
    >
      <Text className="text-xs text-muted">
        {`pdf-engine v${getPdfEngineApiVersion()} · file-index v${getFileIndexApiVersion()} · secure-vault v${getSecureVaultApiVersion()}`}
      </Text>
      <View className="mt-4">
        <Button
          label="Design system"
          variant="secondary"
          onPress={() => router.push('/dev/design')}
        />
      </View>
    </ScrollView>
  );
}
