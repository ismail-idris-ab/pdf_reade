import Constants from 'expo-constants';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { Image, Pressable, Text, View } from 'react-native';

import { Button } from '@/components/ui';
import { getPdfEngineApiVersion, runSpikeMerge, runSpikeRender } from '@/lib/engine';
import { getFileIndexApiVersion } from '@/lib/files';
import { getSecureVaultApiVersion } from '@/lib/vault';

export default function HomeScreen() {
  const appName = Constants.expoConfig?.name ?? '';

  return (
    <View className="flex-1 items-center justify-center bg-background">
      <Text className="text-2xl font-semibold text-foreground">{appName}</Text>
      {__DEV__ ? (
        <>
          <Text className="mt-2 text-xs text-muted">
            {`pdf-engine v${getPdfEngineApiVersion()} · file-index v${getFileIndexApiVersion()} · secure-vault v${getSecureVaultApiVersion()}`}
          </Text>
          <EngineSpikePanel />
          <View className="mt-4">
            <Button
              label="Design system"
              variant="secondary"
              onPress={() => router.push('/dev/design')}
            />
          </View>
        </>
      ) : null}
    </View>
  );
}

// T0.1b spike, dev-only. Removed when T2.1 defines the engine API.
function EngineSpikePanel() {
  const [output, setOutput] = useState('');
  const [pngPath, setPngPath] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  // State updates are async, so a fast double tap could start two runs that
  // rewrite the same fixture files; the ref blocks re-entry synchronously.
  const inFlight = useRef(false);

  const run = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setRunning(true);
    setPngPath(null);
    try {
      const render = await runSpikeRender();
      const merge = await runSpikeMerge();
      setPngPath(render.pngPath);
      setOutput(JSON.stringify({ render, merge }, null, 1));
    } catch (error) {
      setOutput(`FAILED: ${String(error)}`);
    } finally {
      inFlight.current = false;
      setRunning(false);
    }
  };

  return (
    <View className="mt-6 w-full items-center px-4">
      <Pressable
        accessibilityRole="button"
        className="rounded-lg min-h-12 justify-center bg-primary px-4 py-3"
        disabled={running}
        onPress={run}
      >
        <Text className="text-primary-foreground">{running ? 'Running…' : 'Run engine spike'}</Text>
      </Pressable>
      {pngPath ? (
        <Image
          className="mt-4 h-40 w-28 border border-border"
          resizeMode="contain"
          source={{ uri: `file://${pngPath}` }}
        />
      ) : null}
      {output ? (
        <Text selectable className="mt-4 font-mono text-xs text-foreground">
          {output}
        </Text>
      ) : null}
    </View>
  );
}
