// Dev-only gallery of the design system primitives (T0.3). Copy here is
// developer-facing and intentionally not translated; the route redirects
// home in release builds.
import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  BottomSheet,
  Button,
  Dialog,
  EmptyState,
  IconButton,
  ListItem,
  ProgressSheet,
  toast,
} from '@/components/ui';
import { THEME_PREFERENCES, useTheme } from '@/theme';

export default function DesignGallery() {
  if (!__DEV__) return <Redirect href="/" />;
  return <Gallery />;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="gap-2 border-b border-border py-4">
      <Text accessibilityRole="header" className="px-4 text-sm font-semibold uppercase text-muted">
        {title}
      </Text>
      {children}
    </View>
  );
}

function Glyph({ char }: { char: string }) {
  const { palette } = useTheme();
  return <Text style={{ color: palette.foreground, fontSize: 22 }}>{char}</Text>;
}

function Gallery() {
  const { theme, preference, setPreference } = useTheme();
  const insets = useSafeAreaInsets();
  const [sheet, setSheet] = useState(false);
  const [dialog, setDialog] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);

  // Simulated operation: +10% every 300ms, then close with a toast.
  useEffect(() => {
    if (progress === null) return;
    const timer = setTimeout(() => {
      const next = progress + 0.1;
      if (next >= 1) {
        setProgress(null);
        toast('Done');
      } else {
        setProgress(next);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [progress]);

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerStyle={{ paddingTop: insets.top, paddingBottom: insets.bottom + 80 }}
    >
      <Section title={`Theme: ${theme} (preference: ${preference})`}>
        <View className="flex-row flex-wrap gap-2 px-4">
          {THEME_PREFERENCES.map((option) => (
            <Button
              key={option}
              label={option}
              variant={option === preference ? 'primary' : 'secondary'}
              onPress={() => setPreference(option)}
            />
          ))}
        </View>
      </Section>

      <Section title="Button">
        <View className="flex-row flex-wrap gap-2 px-4">
          <Button label="Primary" onPress={() => toast('Primary')} />
          <Button label="Secondary" variant="secondary" onPress={() => toast('Secondary')} />
          <Button label="Ghost" variant="ghost" onPress={() => toast('Ghost')} />
          <Button label="Danger" variant="danger" onPress={() => toast('Danger')} />
          <Button label="Loading" loading onPress={() => undefined} />
          <Button label="Disabled" disabled onPress={() => undefined} />
        </View>
      </Section>

      <Section title="IconButton">
        <View className="flex-row gap-2 px-4">
          <IconButton
            icon={<Glyph char="★" />}
            accessibilityLabel="Favorite"
            onPress={() => toast('Favorite')}
          />
          <IconButton
            icon={<Glyph char="⋮" />}
            accessibilityLabel="More"
            onPress={() => toast('More')}
          />
          <IconButton
            icon={<Glyph char="✕" />}
            accessibilityLabel="Close"
            disabled
            onPress={() => undefined}
          />
        </View>
      </Section>

      <Section title="ListItem">
        <ListItem
          title="WhatsApp Image 2024-05-01 at 10.30.22.pdf"
          subtitle="2.4 MB · WhatsApp · Yesterday"
          leading={<Glyph char="📄" />}
          trailing={
            <IconButton
              icon={<Glyph char="⋮" />}
              accessibilityLabel="More"
              onPress={() => toast('More')}
            />
          }
          onPress={() => toast('Open')}
        />
        <ListItem
          title="JAMB result slip.pdf"
          subtitle="180 KB · Downloads"
          onPress={() => toast('Open')}
        />
      </Section>

      <Section title="Overlays">
        <View className="flex-row flex-wrap gap-2 px-4">
          <Button label="Bottom sheet" variant="secondary" onPress={() => setSheet(true)} />
          <Button label="Dialog" variant="secondary" onPress={() => setDialog(true)} />
          <Button label="Progress" variant="secondary" onPress={() => setProgress(0)} />
          <Button
            label="Toast"
            variant="secondary"
            onPress={() =>
              toast('File moved to trash', {
                actionLabel: 'Undo',
                onAction: () => toast('Restored'),
              })
            }
          />
        </View>
      </Section>

      <Section title="EmptyState">
        <View className="h-64">
          <EmptyState
            icon={<Glyph char="📂" />}
            title="No documents yet"
            message="Allow access to find PDFs on your phone, or pick files manually."
            action={{ label: 'Allow access', onPress: () => toast('Allow access') }}
          />
        </View>
      </Section>

      <BottomSheet visible={sheet} onClose={() => setSheet(false)} title="Share">
        <ListItem title="Send as PDF" onPress={() => setSheet(false)} />
        <ListItem title="Send as images" onPress={() => setSheet(false)} />
      </BottomSheet>

      <Dialog
        visible={dialog}
        title="Delete file?"
        message="This removes the file from your phone."
        onDismiss={() => setDialog(false)}
        actions={[
          { label: 'Cancel', onPress: () => setDialog(false) },
          { label: 'Delete', variant: 'danger', onPress: () => setDialog(false) },
        ]}
      />

      <ProgressSheet
        visible={progress !== null}
        title="Compressing…"
        message="report.pdf"
        progress={progress ?? undefined}
        cancelLabel="Cancel"
        onCancel={() => {
          setProgress(null);
          toast('Cancelled');
        }}
      />
    </ScrollView>
  );
}
