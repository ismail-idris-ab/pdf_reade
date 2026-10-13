// Dev-only check of the native page view (T2.2): every page of a picked PDF in
// a recycling FlashList, for fling / recycling / memory checks on a device.
// Copy here is developer-facing and intentionally not translated; the route
// redirects home in release builds.
import { FlashList, type ListRenderItem } from '@shopify/flash-list';
import { Redirect } from 'expo-router';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { PixelRatio, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { create } from 'zustand';

import { Button } from '@/components/ui';
import {
  closeDocument,
  openDocument,
  PageView,
  type OpenedDocument,
  type PageInfo,
  type PageRenderedEvent,
} from '@/lib/engine';
import { AppError, toAppError } from '@/lib/errors';
import { pickDocuments } from '@/lib/files';

const PAGE_GAP = 8;
const SCALE_MULTIPLIERS = [1, 2] as const;
type ScaleMultiplier = (typeof SCALE_MULTIPLIERS)[number];

type RenderStats = {
  renders: number;
  totalMs: number;
  errors: number;
  record: (ms: number) => void;
  recordError: () => void;
  reset: () => void;
};

// Kept outside the list's props so a render event re-renders only the
// overlay, never the cells being measured.
const useRenderStats = create<RenderStats>((set) => ({
  renders: 0,
  totalMs: 0,
  errors: 0,
  record: (ms) => set((state) => ({ renders: state.renders + 1, totalMs: state.totalMs + ms })),
  recordError: () => set((state) => ({ errors: state.errors + 1 })),
  reset: () => set({ renders: 0, totalMs: 0, errors: 0 }),
}));

export default function DevPages() {
  if (!__DEV__) return <Redirect href="/" />;
  return <Pages />;
}

type PasswordPrompt = { uri: string; code: 'PASSWORD_REQUIRED' | 'WRONG_PASSWORD' };

function Pages() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [doc, setDoc] = useState<OpenedDocument | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<PasswordPrompt | null>(null);
  const [password, setPassword] = useState('');
  const [nightMode, setNightMode] = useState(false);
  const [sepia, setSepia] = useState(false);
  const [multiplier, setMultiplier] = useState<ScaleMultiplier>(1);
  const docIdRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const releaseCurrent = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    const docId = docIdRef.current;
    docIdRef.current = null;
    if (docId !== null) void closeDocument(docId);
  }, []);

  // Leaving the screen stops a running open and closes the document.
  useEffect(() => releaseCurrent, [releaseCurrent]);

  const open = async (uri: string, withPassword?: string) => {
    releaseCurrent();
    const controller = new AbortController();
    abortRef.current = controller;
    setDoc(null);
    setError(null);
    setPrompt(null);
    setBusy(true);
    useRenderStats.getState().reset();
    try {
      const opened = await openDocument(uri, { password: withPassword, signal: controller.signal });
      if (controller.signal.aborted) {
        void closeDocument(opened.docId);
        return;
      }
      docIdRef.current = opened.docId;
      setDoc(opened);
    } catch (e) {
      const appError = toAppError(e);
      if (appError.code === 'CANCELLED') return;
      if (appError.code === 'PASSWORD_REQUIRED' || appError.code === 'WRONG_PASSWORD') {
        setPrompt({ uri, code: appError.code });
      } else {
        setError(appError.code);
      }
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setBusy(false);
      }
    }
  };

  const pick = async () => {
    try {
      const [picked] = await pickDocuments({
        mimeTypes: ['application/pdf'],
        multiple: false,
        persist: false,
      });
      if (!picked) return;
      setName(picked.name ?? picked.uri);
      setPassword('');
      await open(picked.uri);
    } catch (e) {
      setError(toAppError(e).code);
    }
  };

  const renderScale = PixelRatio.get() * multiplier;
  const docId = doc?.docId ?? null;

  const renderItem: ListRenderItem<PageInfo> = useCallback(
    ({ item, index }) =>
      docId === null ? null : (
        <PageCell
          docId={docId}
          page={index}
          info={item}
          width={width}
          renderScale={renderScale}
          nightMode={nightMode}
          sepia={sepia}
        />
      ),
    [docId, width, renderScale, nightMode, sepia],
  );

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <View className="gap-2 border-b border-border px-4 py-2">
        <Text className="text-xs text-muted" numberOfLines={1}>
          {doc
            ? `${name ?? ''} · ${doc.pageCount} pages${doc.isEncrypted ? ' · encrypted' : ''} · scale ${renderScale.toFixed(2)}`
            : (name ?? 'No document')}
        </Text>
        <View className="flex-row flex-wrap gap-2">
          <Button label="Pick PDF" loading={busy} onPress={() => void pick()} />
          <Button
            label={`Night ${nightMode ? 'on' : 'off'}`}
            variant={nightMode ? 'primary' : 'secondary'}
            onPress={() => setNightMode((value) => !value)}
          />
          <Button
            label={`Sepia ${sepia ? 'on' : 'off'}`}
            variant={sepia ? 'primary' : 'secondary'}
            onPress={() => setSepia((value) => !value)}
          />
          {SCALE_MULTIPLIERS.map((option) => (
            <Button
              key={option}
              label={`${option}×`}
              variant={option === multiplier ? 'primary' : 'secondary'}
              onPress={() => setMultiplier(option)}
            />
          ))}
        </View>
        {prompt ? (
          <View className="gap-2">
            <Text className="text-sm text-foreground">
              {prompt.code === 'WRONG_PASSWORD' ? 'Wrong password, try again' : 'Password required'}
            </Text>
            <View className="flex-row items-center gap-2">
              <TextInput
                className="flex-1 rounded border border-border px-2 py-1 text-foreground"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="Password"
                testID="dev-pages-password"
              />
              <Button label="Open" onPress={() => void open(prompt.uri, password)} />
            </View>
          </View>
        ) : null}
        {error ? <Text className="text-sm text-danger">{`Error: ${error}`}</Text> : null}
      </View>

      <View className="flex-1">
        {doc ? (
          <FlashList
            data={doc.pages}
            renderItem={renderItem}
            keyExtractor={(_, index) => String(index)}
            extraData={renderItem}
            contentContainerStyle={{ paddingBottom: insets.bottom + PAGE_GAP }}
          />
        ) : null}
        {doc ? <StatsOverlay /> : null}
      </View>
    </View>
  );
}

type PageCellProps = {
  docId: string;
  page: number;
  info: PageInfo;
  width: number;
  renderScale: number;
  nightMode: boolean;
  sepia: boolean;
};

type CellStat = { page: number; text: string; failed: boolean };

function describeRender(event: PageRenderedEvent): string {
  return `${event.ms} ms · ${event.widthPx}×${event.heightPx}px`;
}

const PageCell = memo(function PageCell({
  docId,
  page,
  info,
  width,
  renderScale,
  nightMode,
  sepia,
}: PageCellProps) {
  // FlashList recycles this component across pages, so a stat is shown only
  // while it belongs to the page the cell currently holds.
  const [stat, setStat] = useState<CellStat | null>(null);
  const height = (width * info.height) / info.width;

  const onRendered = useCallback((event: PageRenderedEvent) => {
    useRenderStats.getState().record(event.ms);
    setStat({ page: event.page, text: describeRender(event), failed: false });
  }, []);

  const onRenderError = useCallback((renderError: AppError, failedPage: number) => {
    useRenderStats.getState().recordError();
    setStat({
      page: failedPage,
      text: `${renderError.code} (${renderError.message})`,
      failed: true,
    });
  }, []);

  const current = stat?.page === page ? stat : null;

  return (
    <View style={{ marginTop: PAGE_GAP }}>
      <PageView
        docId={docId}
        page={page}
        renderScale={renderScale}
        nightMode={nightMode}
        sepia={sepia}
        onRendered={onRendered}
        onRenderError={onRenderError}
        style={{ width, height }}
      />
      <View className="absolute left-2 top-2 rounded bg-surface px-2 py-1 opacity-80">
        <Text className={`text-xs ${current?.failed ? 'text-danger' : 'text-foreground'}`}>
          {`p${page + 1} · ${current ? current.text : 'rendering…'}`}
        </Text>
      </View>
    </View>
  );
});

function StatsOverlay() {
  const renders = useRenderStats((state) => state.renders);
  const totalMs = useRenderStats((state) => state.totalMs);
  const errors = useRenderStats((state) => state.errors);
  const average = renders === 0 ? '–' : `${(totalMs / renders).toFixed(1)} ms`;

  return (
    <View
      pointerEvents="none"
      className="absolute bottom-4 right-4 rounded bg-surface px-3 py-2 opacity-90"
    >
      <Text className="text-xs text-foreground">{`avg ${average} · ${renders} renders · ${errors} errors`}</Text>
    </View>
  );
}
