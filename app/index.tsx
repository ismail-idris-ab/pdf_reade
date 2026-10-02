import Constants from 'expo-constants';
import { Text, View } from 'react-native';

import { getPdfEngineApiVersion } from '@/lib/engine';
import { getFileIndexApiVersion } from '@/lib/files';
import { getSecureVaultApiVersion } from '@/lib/vault';

export default function HomeScreen() {
  const appName = Constants.expoConfig?.name ?? '';

  return (
    <View className="flex-1 items-center justify-center bg-white dark:bg-black">
      <Text className="text-2xl font-semibold text-black dark:text-white">{appName}</Text>
      {__DEV__ ? (
        <Text className="mt-2 text-xs text-neutral-500">
          {`pdf-engine v${getPdfEngineApiVersion()} · file-index v${getFileIndexApiVersion()} · secure-vault v${getSecureVaultApiVersion()}`}
        </Text>
      ) : null}
    </View>
  );
}
