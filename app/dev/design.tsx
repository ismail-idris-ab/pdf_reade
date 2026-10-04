// Dev-only gallery of the design system primitives (T0.3). Copy here is
// developer-facing and intentionally not translated; the route redirects
// home in release builds.
import { Redirect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, ScrollView, Text, View } from 'react-native';
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
import { LanguagePicker } from '@/components/LanguagePicker';
import { useFormatFileSize, useLocaleStore, useTranslation } from '@/i18n';
import { toAppError } from '@/lib/errors';
import {
  DEFAULT_SCAN_EXTS,
  hasAllFilesAccess,
  openAllFilesAccessSettings,
  scanDocuments,
  type ScanHandle,
  type ScanSummary,
} from '@/lib/files';
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
  const [crash, setCrash] = useState(false);
  const [languages, setLanguages] = useState(false);
  const { i18n } = useTranslation();
  const localePreference = useLocaleStore((state) => state.preference);
  const formatFileSize = useFormatFileSize();

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

  // Throwing during render exercises the root ErrorBoundary.
  if (crash) throw new Error('Test error from the design gallery');

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

      <Section title={`Language: ${i18n.language} (preference: ${localePreference})`}>
        <View className="flex-row flex-wrap items-center gap-3 px-4">
          <Button label="Choose language" variant="secondary" onPress={() => setLanguages(true)} />
          <Text className="text-base text-foreground">
            {[0, 950, 180_000, 1_536_000, 2_400_000_000].map(formatFileSize).join(' · ')}
          </Text>
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

      <FileIndexSection />

      <Section title="Error boundary">
        <View className="px-4">
          <Button label="Throw test error" variant="danger" onPress={() => setCrash(true)} />
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

      <LanguagePicker visible={languages} onClose={() => setLanguages(false)} />

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

type ScanProgress = { batches: number; files: number };

function readAccess(): string {
  try {
    return hasAllFilesAccess() ? 'granted' : 'denied';
  } catch (e) {
    return `error (${toAppError(e).code})`;
  }
}

// Exercises the file-index module: all-files access and incremental scans.
// The previous run's path → mtime map is kept so a second scan only reports
// new or changed files plus deletions.
function FileIndexSection() {
  const [access, setAccess] = useState(readAccess);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<ScanProgress>({ batches: 0, files: 0 });
  const [summary, setSummary] = useState<ScanSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [known, setKnown] = useState<Record<string, number>>({});
  const handleRef = useRef<ScanHandle | null>(null);

  const refreshAccess = useCallback(() => setAccess(readAccess()), []);

  // Re-check when returning from the system settings screen.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') refreshAccess();
    });
    return () => subscription.remove();
  }, [refreshAccess]);

  // Leaving the screen stops a running scan.
  useEffect(() => () => handleRef.current?.cancel(), []);

  const openSettings = () => {
    openAllFilesAccessSettings().catch((e: unknown) => {
      toast(`Could not open settings (${toAppError(e).code})`);
    });
  };

  const scan = () => {
    const nextKnown = new Map(Object.entries(known));
    let batches = 0;
    let files = 0;
    setProgress({ batches, files });
    setSummary(null);
    setError(null);
    setRunning(true);
    const handle = scanDocuments({
      exts: DEFAULT_SCAN_EXTS,
      knownMtimes: known,
      onBatch: (batch) => {
        batches += 1;
        files += batch.length;
        for (const file of batch) nextKnown.set(file.path, file.mtime);
        setProgress({ batches, files });
      },
    });
    handleRef.current = handle;
    handle.result
      .then(
        (result) => {
          if (!result.cancelled) for (const path of result.deleted) nextKnown.delete(path);
          setKnown(Object.fromEntries(nextKnown));
          setSummary(result);
        },
        (e: unknown) => setError(toAppError(e).code),
      )
      .finally(() => {
        handleRef.current = null;
        setRunning(false);
      });
  };

  const lines = [
    `All-files access: ${access}`,
    `Known files (input to next scan): ${Object.keys(known).length}`,
    `Batches: ${progress.batches} · Files received: ${progress.files}`,
  ];
  if (summary) {
    lines.push(
      `${summary.cancelled ? 'Cancelled' : 'Completed'} in ${summary.durationMs} ms`,
      `Scanned: ${summary.scanned} · Emitted: ${summary.emitted} · Deleted: ${summary.deleted.length} · Skipped dirs: ${summary.skippedDirs}`,
    );
  }
  if (error) lines.push(`Error: ${error}`);

  return (
    <Section title="File index">
      <View className="gap-1 px-4">
        {lines.map((line) => (
          <Text key={line} className="text-base text-foreground">
            {line}
          </Text>
        ))}
      </View>
      <View className="flex-row flex-wrap gap-2 px-4">
        <Button label="Open access settings" variant="secondary" onPress={openSettings} />
        <Button label="Refresh access" variant="secondary" onPress={refreshAccess} />
        <Button label="Scan" loading={running} onPress={scan} />
        {running ? (
          <Button label="Cancel" variant="danger" onPress={() => handleRef.current?.cancel()} />
        ) : null}
      </View>
    </Section>
  );
}
