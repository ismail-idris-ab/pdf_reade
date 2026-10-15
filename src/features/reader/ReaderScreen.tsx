import { FlashList, type FlashListRef, type ListRenderItem } from '@shopify/flash-list';
import { useKeepAwake } from 'expo-keep-awake';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  ActivityIndicator,
  AppState,
  Linking,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { showErrorToast } from '@/components/errorToast';
import { ArrowBackIcon, HorizontalPagesIcon, VerticalPagesIcon } from '@/components/icons';
import { Button, IconButton, toast } from '@/components/ui';
import { getRepositories } from '@/db/client';
import type { ReadingMode } from '@/db/schema';
import type { FileRow } from '@/db/types';
import { useTranslation } from '@/i18n';
import { reportError } from '@/lib/crash';
import type { OpenedDocument, PageInfo } from '@/lib/engine';
import { toRecoveryLabel, toUserMessage, type AppError } from '@/lib/errors';
import { openAllFilesAccessSettings } from '@/lib/files';
import { pickIntoLibrary } from '@/lib/library/pickIntoLibrary';
import { useTheme } from '@/theme';
import { statusBarStyle } from '@/theme/palette';

import { shareLibraryFile } from '../files/actions';
import { JumpToPageDialog } from './components/JumpToPageDialog';
import { PasswordPrompt } from './components/PasswordPrompt';
import { ReaderPage, type RenderPageOverlay } from './components/ReaderPage';
import { THUMB_STRIP_HEIGHT, ThumbnailStrip } from './components/ThumbnailStrip';
import {
  readerErrorActions,
  type ReaderErrorAction,
  type ReaderOpenErrorCode,
} from './errorActions';
import { pageAtScroll, pageFrame, paperModeFor, type PageFrame, type Viewport } from './layout';
import { readerHref, readerOpened } from './navigation';
import {
  createReadingStateSaver,
  restoreReadingState,
  type ReadingStateSaver,
  type RestoredReadingState,
} from './readingState';
import { createReaderStore, ReaderStoreProvider, useReaderStore, type ReaderStore } from './store';
import { useReaderDocument } from './useReaderDocument';
import { useReaderZoom } from './useReaderZoom';
import { zoomFrame } from './zoom';

/** Top bar height below the status bar, dp. */
export const TOP_BAR_HEIGHT = 56;
/** Page indicator row above the thumbnail strip, dp. */
const INDICATOR_HEIGHT = 48;
/**
 * The list is shown at once if anchoring to the restored page has not
 * finished by then (never leaves the reader blank), ms.
 */
const ANCHOR_TIMEOUT_MS = 1000;
const STORAGE_SETTINGS_ACTION = 'android.settings.INTERNAL_STORAGE_SETTINGS';
/** Native render-error code for a page view whose document is already closed. */
const ERR_DOC_NOT_OPEN = 'ERR_DOC_NOT_OPEN';

/** Leaves the reader: back where the user came from, or to the library. */
function leaveReader(): void {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

function openAllFilesAccess(): void {
  openAllFilesAccessSettings().catch((error: unknown) => showErrorToast(error));
}

/** The phone's storage settings (to free up space); app settings if unavailable. */
function openStorageSettings(): void {
  Linking.sendIntent(STORAGE_SETTINGS_ACTION).catch(() =>
    Linking.openSettings().catch(reportError),
  );
}

export type ReaderScreenProps = {
  /** Library row to read; null when the route parameter is not a valid id. */
  fileId: number | null;
  /** Content drawn over each page (search highlights, selection: T2.6 / T2.8). */
  renderOverlay?: RenderPageOverlay;
};

/**
 * The PDF reader (T2.3): every page in a recycling list, continuous vertical
 * or paged horizontal, with a page indicator, jump-to-page, a thumbnail
 * strip and a tap that toggles fullscreen. Restores the last page and mode
 * from reading_state and keeps the screen on while open. A password-protected
 * file asks for its password first (T2.5), every time it is opened.
 */
export function ReaderScreen({ fileId, renderOverlay }: ReaderScreenProps) {
  useKeepAwake();
  // The push from the library has landed: another file may open from now on.
  useEffect(() => readerOpened(), []);
  const { state, retry, submitPassword } = useReaderDocument(fileId);

  switch (state.status) {
    case 'ready':
      return (
        <ReaderView file={state.file} document={state.document} renderOverlay={renderOverlay} />
      );
    case 'loading':
      return (
        <StatusFrame title={state.file.name}>
          <View testID="reader-loading" className="flex-1 items-center justify-center">
            <LoadingIndicator />
          </View>
        </StatusFrame>
      );
    case 'password':
      return (
        <StatusFrame title={state.file.name}>
          <PasswordPrompt
            checking={state.checking}
            failedAttempts={state.failedAttempts}
            onSubmit={submitPassword}
            onCancel={leaveReader}
          />
        </StatusFrame>
      );
    case 'unsupported':
      return (
        <StatusFrame title={state.file.name}>
          <UnsupportedFile file={state.file} />
        </StatusFrame>
      );
    case 'error':
      return (
        <StatusFrame title={state.file?.name ?? ''}>
          <OpenError
            fileId={state.file?.id ?? null}
            code={state.code}
            contentSource={state.contentSource}
            onRetry={retry}
          />
        </StatusFrame>
      );
  }
}

function LoadingIndicator() {
  const { palette } = useTheme();
  const { t } = useTranslation();
  return (
    <ActivityIndicator
      accessibilityLabel={t('reader.opening')}
      color={palette.primary}
      size="large"
    />
  );
}

/** Top bar with Back and the file name, over a status/loading/error body. */
function StatusFrame({ title, children }: { title: string; children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View
      className="flex-1 bg-background"
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
    >
      <TopBar title={title} />
      {children}
    </View>
  );
}

type TopBarProps = {
  title: string;
  mode?: ReadingMode;
  onToggleMode?: () => void;
};

function TopBar({ title, mode, onToggleMode }: TopBarProps) {
  const { t } = useTranslation();
  const { palette } = useTheme();
  return (
    <View className="flex-row items-center gap-1 px-1" style={{ height: TOP_BAR_HEIGHT }}>
      <IconButton
        testID="reader-back"
        icon={<ArrowBackIcon color={palette.foreground} />}
        accessibilityLabel={t('common.back')}
        onPress={leaveReader}
      />
      <Text
        accessibilityRole="header"
        numberOfLines={1}
        className="flex-1 text-lg font-semibold text-foreground"
      >
        {title}
      </Text>
      {mode && onToggleMode ? (
        <IconButton
          testID="reader-mode"
          icon={
            mode === 'vertical' ? (
              <HorizontalPagesIcon color={palette.foreground} />
            ) : (
              <VerticalPagesIcon color={palette.foreground} />
            )
          }
          accessibilityLabel={t(
            mode === 'vertical' ? 'reader.switchToHorizontal' : 'reader.switchToVertical',
          )}
          onPress={onToggleMode}
        />
      ) : null}
    </View>
  );
}

type MessageButton = { key: string; label: string; onPress: () => void };

function Message({
  title,
  message,
  buttons,
  testID,
}: {
  title: string;
  message: string;
  buttons: MessageButton[];
  testID: string;
}) {
  return (
    <View testID={testID} className="flex-1 items-center justify-center gap-3 px-8 py-12">
      <Text
        accessibilityRole="header"
        className="w-full text-center text-lg font-semibold text-foreground"
      >
        {title}
      </Text>
      <Text className="w-full text-center text-base text-muted">{message}</Text>
      <View className="mt-2 w-full items-center gap-2">
        {buttons.map((button, index) => (
          <Button
            key={button.key}
            testID={`reader-action-${button.key}`}
            label={button.label}
            variant={index === 0 ? 'primary' : 'ghost'}
            onPress={button.onPress}
          />
        ))}
      </View>
    </View>
  );
}

/**
 * The library row a fresh pick ended up in. The pick is stored under its
 * content:// URI, but the same call may fold it into the scanned row of the
 * same file (mergePickedDuplicates), which keeps the URI as its fallback.
 */
function rowForPickedUri(uri: string): FileRow | undefined {
  return getRepositories().files.getByUri(uri);
}

/** The place in the document follows the user to the row they now read from. */
function carryReadingState(fromId: number, toId: number): void {
  if (fromId === toId) return;
  try {
    const { readingState } = getRepositories();
    // reading_state has no timestamp, so a position the target already has
    // (e.g. read through its path) is kept: the dead row's is the less
    // trustworthy of the two.
    if (readingState.get(toId)) return;
    const state = readingState.get(fromId);
    if (state) readingState.save({ ...state, fileId: toId });
  } catch (error) {
    reportError(error);
  }
}

/**
 * Picks the PDF again through the system picker (its old grant is gone) and
 * reopens the reader on the row the pick resolved to, with the reading
 * position carried over. Nothing happens if this screen has gone meanwhile.
 */
function usePickAgain(fileId: number | null): () => void {
  const { t } = useTranslation();
  const busy = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  return useCallback(() => {
    const attempt = async (): Promise<void> => {
      if (busy.current) return;
      busy.current = true;
      try {
        const result = await pickIntoLibrary(getRepositories(), {
          now: Date.now,
          fallbackName: t('library.untitled'),
          mimeTypes: ['application/pdf'],
          multiple: false,
        });
        if (result === null || !mounted.current) return;
        const [stored] = result.rows;
        const target = stored ? rowForPickedUri(stored.uri ?? stored.path) : undefined;
        if (target) {
          if (fileId !== null) carryReadingState(fileId, target.id);
          router.replace(readerHref(target.id));
        } else if (result.notPersisted > 0) {
          toast(t('library.cannotKeepAccess'));
        }
      } catch (error) {
        if (mounted.current) showErrorToast(error, { onRetry: () => void attempt() });
      } finally {
        busy.current = false;
      }
    };
    void attempt();
  }, [t, fileId]);
}

function OpenError({
  fileId,
  code,
  contentSource,
  onRetry,
}: {
  fileId: number | null;
  code: ReaderOpenErrorCode;
  contentSource: boolean;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  const pickAgain = usePickAgain(fileId);
  const { title, message } = toUserMessage(code);

  const button = (action: ReaderErrorAction): MessageButton => {
    switch (action) {
      case 'retry':
        return { key: action, label: toRecoveryLabel('retry'), onPress: onRetry };
      case 'allFilesAccess':
        return { key: action, label: toRecoveryLabel('openSettings'), onPress: openAllFilesAccess };
      case 'freeSpace':
        return { key: action, label: toRecoveryLabel('freeSpace'), onPress: openStorageSettings };
      case 'pickAnotherFile':
        return { key: action, label: toRecoveryLabel('pickAnotherFile'), onPress: leaveReader };
      case 'pickAgain':
        return { key: action, label: toRecoveryLabel('pickAnotherFile'), onPress: pickAgain };
      case 'back':
        return { key: action, label: t('common.back'), onPress: leaveReader };
    }
  };

  return (
    <Message
      testID={`reader-error-${code}`}
      title={title}
      message={message}
      buttons={readerErrorActions(code, { contentSource }).map(button)}
    />
  );
}

function UnsupportedFile({ file }: { file: FileRow }) {
  const { t } = useTranslation();
  const share = () => {
    shareLibraryFile(getRepositories(), file.id).catch((error: unknown) =>
      showErrorToast(error, { onRetry: share }),
    );
  };
  return (
    <Message
      testID="reader-unsupported"
      title={toUserMessage('UNSUPPORTED').title}
      message={t('reader.unsupportedMessage')}
      buttons={[
        { key: 'share', label: t('reader.shareToApp'), onPress: share },
        { key: 'back', label: t('common.back'), onPress: leaveReader },
      ]}
    />
  );
}

function readStoredState(fileId: number, pageCount: number): RestoredReadingState {
  try {
    return restoreReadingState(getRepositories().readingState.get(fileId), pageCount);
  } catch (error) {
    reportError(error);
    return restoreReadingState(undefined, pageCount);
  }
}

/**
 * A failed reading_state write: when the file's library row is gone (merged
 * into another row, or deleted while open) every later write fails the same
 * way, so saving stops quietly. Anything else is reported once per reader.
 */
function readingStateErrorHandler(fileId: number): (error: unknown) => 'stop' | 'continue' {
  let reported = false;
  return (error) => {
    let rowExists = true;
    try {
      rowExists = getRepositories().files.getById(fileId) !== undefined;
    } catch {
      rowExists = false;
    }
    if (!rowExists) return 'stop';
    if (!reported) {
      reported = true;
      reportError(error);
    }
    return 'continue';
  };
}

/**
 * Keeps saving the reading state while mounted: the page debounced, the mode
 * at once, both flushed when the app leaves the foreground and when the
 * reader closes.
 */
function useReadingStatePersistence(fileId: number, restored: RestoredReadingState) {
  const saverRef = useRef<ReadingStateSaver | null>(null);

  useEffect(() => {
    const saver = createReadingStateSaver({
      fileId,
      initial: restored,
      save: (row) => getRepositories().readingState.save(row),
      onError: readingStateErrorHandler(fileId),
    });
    saverRef.current = saver;
    const subscription = AppState.addEventListener('change', (next) => {
      if (next !== 'active') saver.flush();
    });
    return () => {
      subscription.remove();
      saver.dispose();
      if (saverRef.current === saver) saverRef.current = null;
    };
  }, [fileId, restored]);

  return saverRef;
}

type ReaderViewProps = {
  file: FileRow;
  document: OpenedDocument;
  renderOverlay?: RenderPageOverlay;
};

function ReaderView({ file, document, renderOverlay }: ReaderViewProps) {
  const [restored] = useState(() => readStoredState(file.id, document.pageCount));
  const [store] = useState(() => createReaderStore(restored.page));
  return (
    <ReaderStoreProvider store={store}>
      <ReaderBody
        file={file}
        document={document}
        restored={restored}
        store={store}
        renderOverlay={renderOverlay}
      />
    </ReaderStoreProvider>
  );
}

type ReaderBodyProps = ReaderViewProps & {
  restored: RestoredReadingState;
  store: ReaderStore;
};

/**
 * The list instance on screen and the page it opens at. `instance` grows with
 * every rebuild, so a list that comes back to an earlier key (vertical →
 * horizontal → vertical) is still a new list that must anchor itself.
 */
type Anchor = { key: string; page: number; instance: number };

function ReaderBody({ file, document, restored, store, renderOverlay }: ReaderBodyProps) {
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const { theme } = useTheme();
  const paper = paperModeFor(theme);
  const { docId, pageCount, pages } = document;

  const saverRef = useReadingStatePersistence(file.id, restored);
  const [mode, setMode] = useState<ReadingMode>(restored.mode);
  const [jumpOpen, setJumpOpen] = useState(false);
  const [measured, setMeasured] = useState<Viewport | null>(null);
  const viewport = measured ?? window;
  const listRef = useRef<FlashListRef<PageInfo>>(null);
  const horizontal = mode === 'horizontal';

  // A new list instance per mode and viewport size (rotation, split screen):
  // every page's cell size changes, so the list is rebuilt and re-anchored to
  // the page being read instead of keeping a stale scroll offset.
  const listKey = `${mode}:${Math.round(viewport.width)}x${Math.round(viewport.height)}`;
  const [anchor, setAnchor] = useState<Anchor>({
    key: listKey,
    page: restored.page,
    instance: 0,
  });
  if (anchor.key !== listKey) {
    setAnchor({ key: listKey, page: store.getState().page, instance: anchor.instance + 1 });
  }
  // The list instance on screen now, for callbacks that outlive it.
  const currentInstanceRef = useRef(anchor.instance);
  useLayoutEffect(() => {
    currentInstanceRef.current = anchor.instance;
  }, [anchor.instance]);
  // The anchored list instance: until the list sits on its page it stays
  // hidden and its scroll events do not move the current page.
  const [anchoredInstance, setAnchoredInstance] = useState<number | null>(null);
  const anchoredInstanceRef = useRef<number | null>(null);
  const anchorFallbackRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A rebuilt or closed list stops its anchoring: a stale fallback must never
  // reveal (or hide) another list instance.
  useEffect(
    () => () => {
      if (anchorFallbackRef.current !== null) {
        clearTimeout(anchorFallbackRef.current);
        anchorFallbackRef.current = null;
      }
    },
    [anchor.instance],
  );

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setMeasured((previous) =>
      previous && previous.width === width && previous.height === height
        ? previous
        : { width, height },
    );
  }, []);

  const baseFrames = useMemo<PageFrame[]>(
    () =>
      pages.map((info) =>
        pageFrame(info, mode, viewport, { top: insets.top, bottom: insets.bottom }),
      ),
    [pages, mode, viewport, insets.top, insets.bottom],
  );
  const crossRef = useRef<ScrollView>(null);

  /**
   * Scrolls `page` into place without animation. In vertical mode with the
   * chrome shown, the page top lands just below the top bar (not under it).
   */
  const scrollToPage = useCallback(
    (page: number): Promise<void> => {
      const list = listRef.current;
      if (!list) return Promise.resolve();
      const chromeTop =
        !horizontal && store.getState().chromeVisible ? insets.top + TOP_BAR_HEIGHT : 0;
      return list.scrollToIndex({ index: page, animated: false, viewOffset: -chromeTop });
    },
    [horizontal, store, insets.top],
  );

  const toggleChrome = useCallback(() => store.getState().toggleChrome(), [store]);

  const {
    zoom,
    gesture,
    liveStyle,
    onMainScroll,
    onCrossScroll,
    resetOffsets,
    scheduleDetails,
    zoomStep,
  } = useReaderZoom({
    initialZoom: restored.zoom,
    viewport,
    horizontal,
    baseFrames,
    listRef,
    crossRef,
    store,
    saverRef,
    scrollToPage,
    onSingleTap: toggleChrome,
  });
  const frames = useMemo(
    () => baseFrames.map((frame) => zoomFrame(frame, zoom)),
    [baseFrames, zoom],
  );

  // First layout of a list instance: put it on its anchor page, then show it.
  const onLoad = useCallback(() => {
    const { instance, page } = anchor;
    if (anchoredInstanceRef.current === instance) return;
    resetOffsets();
    const reveal = () => {
      // Only the list on screen, once.
      if (currentInstanceRef.current !== instance) return;
      if (anchoredInstanceRef.current === instance) return;
      if (anchorFallbackRef.current !== null) {
        clearTimeout(anchorFallbackRef.current);
        anchorFallbackRef.current = null;
      }
      anchoredInstanceRef.current = instance;
      setAnchoredInstance(instance);
      scheduleDetails();
    };
    // Page 0 is already in place (top of the list, below the header).
    if (page === 0) {
      reveal();
      return;
    }
    if (anchorFallbackRef.current !== null) clearTimeout(anchorFallbackRef.current);
    anchorFallbackRef.current = setTimeout(reveal, ANCHOR_TIMEOUT_MS);
    scrollToPage(page).then(reveal, (error: unknown) => {
      reportError(error);
      reveal();
    });
  }, [anchor, scrollToPage, resetOffsets, scheduleDetails]);

  const showPage = useCallback(
    (page: number) => {
      store.getState().setPage(page);
      saverRef.current?.setPage(page);
    },
    [store, saverRef],
  );

  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const list = listRef.current;
      if (!list || anchoredInstanceRef.current !== anchor.instance) return;
      const { contentOffset, layoutMeasurement } = event.nativeEvent;
      const offset = horizontal ? contentOffset.x : contentOffset.y;
      onMainScroll(offset);
      // Only the list's own axis decides the page; the sideways pan of a
      // zoomed page (the outer scroll view) never reaches here.
      const page = pageAtScroll(
        list,
        offset,
        horizontal ? layoutMeasurement.width : layoutMeasurement.height,
        horizontal,
      );
      if (page !== null) showPage(page);
    },
    [anchor.instance, horizontal, showPage, onMainScroll],
  );

  const onOuterScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset } = event.nativeEvent;
      onCrossScroll(horizontal ? contentOffset.y : contentOffset.x);
    },
    [horizontal, onCrossScroll],
  );

  const jumpTo = useCallback(
    (page: number) => {
      showPage(page);
      scrollToPage(page).catch(reportError);
    },
    [showPage, scrollToPage],
  );

  const onJump = useCallback(
    (page: number) => {
      setJumpOpen(false);
      jumpTo(page);
    },
    [jumpTo],
  );

  const toggleMode = useCallback(() => {
    const next: ReadingMode = mode === 'vertical' ? 'horizontal' : 'vertical';
    // The list key changes, so a new list opens at the current page.
    setMode(next);
    saverRef.current?.setMode(next);
  }, [mode, saverRef]);

  // Set once this reader starts closing; its document closes shortly after.
  const closingRef = useRef(false);
  useEffect(
    () => () => {
      closingRef.current = true;
    },
    [],
  );
  const docNotOpenReported = useRef(false);
  const acceptRenderError = useCallback((error: AppError) => {
    if (error.message !== ERR_DOC_NOT_OPEN) return true;
    // Expected while closing: the views outlive the document for a moment.
    if (closingRef.current) return false;
    // Unexpected while reading: show it in the cell, report it once.
    if (!docNotOpenReported.current) {
      docNotOpenReported.current = true;
      reportError(error);
    }
    return true;
  }, []);

  const renderItem: ListRenderItem<PageInfo> = useCallback(
    ({ index }) => {
      const frame = frames[index];
      if (!frame) return null;
      return (
        <ReaderPage
          docId={docId}
          page={index}
          pageCount={pageCount}
          frame={frame}
          nightMode={paper.nightMode}
          sepia={paper.sepia}
          onTap={toggleChrome}
          acceptRenderError={acceptRenderError}
          onZoomStep={zoomStep}
          renderOverlay={renderOverlay}
        />
      );
    },
    [
      frames,
      docId,
      pageCount,
      paper.nightMode,
      paper.sepia,
      toggleChrome,
      acceptRenderError,
      zoomStep,
      renderOverlay,
    ],
  );

  const header = useMemo(
    () => (horizontal ? null : <View style={{ height: insets.top + TOP_BAR_HEIGHT }} />),
    [horizontal, insets.top],
  );
  const footer = useMemo(
    () =>
      horizontal ? null : (
        <View style={{ height: insets.bottom + INDICATOR_HEIGHT + THUMB_STRIP_HEIGHT }} />
      ),
    [horizontal, insets.bottom],
  );

  return (
    <View testID="reader" className="flex-1 bg-surface" onLayout={onLayout}>
      <View
        testID="reader-pages-frame"
        className="flex-1"
        style={{ opacity: anchoredInstance === anchor.instance ? 1 : 0 }}
      >
        {/* The detector sits on a plain, never-transformed view: RNGH reports
            focal points in the attached view's own coordinates with its
            transform inverted, so attaching it to the transformed view would
            feed the pinch's own pan back into the focal point. */}
        <GestureDetector gesture={gesture}>
          <View testID="reader-gesture-area" className="flex-1" collapsable={false}>
            <Animated.View testID="reader-zoom" className="flex-1" style={liveStyle}>
              {/* The sideways pan of a zoomed page: across the list's own axis
                (horizontal in vertical mode, vertical in paged mode). Its
                content is the list at zoom × the viewport. */}
              <ScrollView
                key={anchor.instance}
                ref={crossRef}
                testID="reader-pan"
                horizontal={!horizontal}
                scrollEnabled={zoom > 1}
                onScroll={onOuterScroll}
                scrollEventThrottle={32}
                showsHorizontalScrollIndicator={false}
                showsVerticalScrollIndicator={false}
                bounces={false}
                overScrollMode="never"
              >
                <View
                  style={{
                    width: horizontal ? viewport.width : viewport.width * zoom,
                    height: horizontal ? viewport.height * zoom : viewport.height,
                  }}
                >
                  <FlashList
                    key={anchor.instance}
                    ref={listRef}
                    testID="reader-pages"
                    data={pages}
                    renderItem={renderItem}
                    extraData={renderItem}
                    keyExtractor={pageKey}
                    horizontal={horizontal}
                    // Paging snaps whole pages; a zoomed page pans freely instead.
                    pagingEnabled={horizontal && zoom <= 1}
                    onLoad={onLoad}
                    onScroll={onScroll}
                    scrollEventThrottle={32}
                    ListHeaderComponent={header}
                    ListFooterComponent={footer}
                    showsHorizontalScrollIndicator={false}
                  />
                </View>
              </ScrollView>
            </Animated.View>
          </View>
        </GestureDetector>
      </View>
      <ReaderChrome
        title={file.name}
        docId={docId}
        pages={pages}
        pageCount={pageCount}
        mode={mode}
        nightMode={paper.nightMode}
        sepia={paper.sepia}
        onToggleMode={toggleMode}
        onOpenJump={() => setJumpOpen(true)}
        onSelectPage={jumpTo}
      />
      {jumpOpen ? (
        <JumpToPageDialog
          pageCount={pageCount}
          currentPage={store.getState().page}
          onJump={onJump}
          onDismiss={() => setJumpOpen(false)}
        />
      ) : null}
    </View>
  );
}

const pageKey = (_: PageInfo, index: number) => String(index);

type ReaderChromeProps = {
  title: string;
  docId: string;
  pages: readonly PageInfo[];
  pageCount: number;
  mode: ReadingMode;
  nightMode: boolean;
  sepia: boolean;
  onToggleMode: () => void;
  onOpenJump: () => void;
  onSelectPage: (page: number) => void;
};

/**
 * Top bar, page indicator and thumbnail strip, drawn over the pages. A tap on
 * a page hides them (fullscreen) together with the status bar; another tap
 * brings them back. Only this subtree re-renders on the toggle.
 */
const ReaderChrome = memo(function ReaderChrome({
  title,
  docId,
  pages,
  pageCount,
  mode,
  nightMode,
  sepia,
  onToggleMode,
  onOpenJump,
  onSelectPage,
}: ReaderChromeProps) {
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const visible = useReaderStore((state) => state.chromeVisible);

  return (
    <>
      <StatusBar hidden={!visible} style={statusBarStyle[theme]} animated />
      {visible ? (
        <>
          <View
            testID="reader-top-bar"
            className="absolute left-0 right-0 top-0 border-b border-border bg-background"
            style={{ paddingTop: insets.top }}
          >
            <TopBar title={title} mode={mode} onToggleMode={onToggleMode} />
          </View>
          <View
            testID="reader-bottom-bar"
            pointerEvents="box-none"
            className="absolute bottom-0 left-0 right-0"
            style={{ paddingBottom: insets.bottom }}
          >
            <View
              pointerEvents="box-none"
              className="items-center justify-center"
              style={{ height: INDICATOR_HEIGHT }}
            >
              <PageIndicator pageCount={pageCount} onPress={onOpenJump} />
            </View>
            <View className="border-t border-border bg-background">
              <ThumbnailStrip
                docId={docId}
                pages={pages}
                nightMode={nightMode}
                sepia={sepia}
                onSelect={onSelectPage}
              />
            </View>
          </View>
        </>
      ) : null}
    </>
  );
});

/** "12 / 300"; opens jump-to-page. Re-renders on page changes, alone. */
function PageIndicator({ pageCount, onPress }: { pageCount: number; onPress: () => void }) {
  const { t } = useTranslation();
  const page = useReaderStore((state) => state.page) + 1;
  return (
    <Pressable
      testID="reader-page-indicator"
      accessibilityRole="button"
      accessibilityLabel={t('reader.pageLabel', { page, total: pageCount })}
      accessibilityHint={t('reader.jumpHint')}
      onPress={onPress}
      className="min-h-12 justify-center rounded-full bg-background px-5 active:opacity-80"
    >
      <Text className="text-base font-semibold text-foreground">
        {t('reader.pageIndicator', { page, total: pageCount })}
      </Text>
    </Pressable>
  );
}
