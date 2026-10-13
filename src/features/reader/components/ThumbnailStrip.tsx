import { FlashList, type FlashListRef, type ListRenderItem } from '@shopify/flash-list';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { PixelRatio, Pressable, View } from 'react-native';

import { useTranslation } from '@/i18n';
import { reportError } from '@/lib/crash';
import { PageView, type PageInfo } from '@/lib/engine';

import { useReaderStore, useReaderStoreApi } from '../store';

/** Thumbnail width, dp. */
export const THUMB_WIDTH = 48;
/** Tallest thumbnail box, dp; very tall pages are fitted inside it. */
const THUMB_MAX_HEIGHT = 72;
/** Strip height: the box plus its padding, dp. */
export const THUMB_STRIP_HEIGHT = THUMB_MAX_HEIGHT + 16;
/** The strip follows the current page once it has stayed put this long, ms. */
export const THUMB_FOLLOW_DELAY_MS = 150;
// Thumbnails are tiny: render at screen density, never above 2× (memory).
const THUMB_RENDER_SCALE = Math.min(PixelRatio.get(), 2);

function thumbSize(info: PageInfo): { width: number; height: number } {
  const aspect = info.width > 0 && info.height > 0 ? info.height / info.width : Math.SQRT2;
  const height = Math.min(THUMB_MAX_HEIGHT, THUMB_WIDTH * aspect);
  return { width: height / aspect, height };
}

type ThumbProps = {
  docId: string;
  page: number;
  info: PageInfo;
  nightMode: boolean;
  sepia: boolean;
  onSelect: (page: number) => void;
};

const Thumb = memo(function Thumb({ docId, page, info, nightMode, sepia, onSelect }: ThumbProps) {
  const { t } = useTranslation();
  // Boolean selector: a page change re-renders only the old and new current thumbnails.
  const current = useReaderStore((state) => state.page === page);
  const size = thumbSize(info);
  return (
    <Pressable
      testID={`reader-thumb-${page}`}
      accessibilityRole="button"
      accessibilityLabel={t('reader.goToPage', { page: page + 1 })}
      accessibilityState={{ selected: current }}
      onPress={() => onSelect(page)}
      className="h-full items-center justify-center px-1"
      style={{ width: THUMB_WIDTH + 8 }}
    >
      <View className={`rounded-sm border-2 ${current ? 'border-primary' : 'border-transparent'}`}>
        <PageView
          docId={docId}
          page={page}
          renderScale={THUMB_RENDER_SCALE}
          nightMode={nightMode}
          sepia={sepia}
          style={size}
        />
      </View>
    </Pressable>
  );
});

export type ThumbnailStripProps = {
  docId: string;
  pages: readonly PageInfo[];
  nightMode: boolean;
  sepia: boolean;
  onSelect: (page: number) => void;
};

/**
 * Horizontal strip of small page renders; the current page is outlined and
 * kept in view, and a tap jumps to that page. Mounted only while the chrome
 * is shown, so it costs nothing in fullscreen.
 */
export const ThumbnailStrip = memo(function ThumbnailStrip({
  docId,
  pages,
  nightMode,
  sepia,
  onSelect,
}: ThumbnailStripProps) {
  const store = useReaderStoreApi();
  const listRef = useRef<FlashListRef<PageInfo>>(null);
  const [initialPage] = useState(() => store.getState().page);

  // Follows the current page without re-rendering the strip, once the page
  // settles: a fast fling through the document must not queue an animated
  // scroll per page.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = store.subscribe((state, previous) => {
      if (state.page === previous.page) return;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        listRef.current
          ?.scrollToIndex({ index: store.getState().page, animated: true, viewPosition: 0.5 })
          .catch(reportError);
      }, THUMB_FOLLOW_DELAY_MS);
    });
    return () => {
      unsubscribe();
      if (timer !== null) clearTimeout(timer);
    };
  }, [store]);

  // Opens with the current page centred (not at the left edge).
  const centreInitialPage = useCallback(() => {
    if (initialPage === 0) return;
    listRef.current
      ?.scrollToIndex({ index: initialPage, animated: false, viewPosition: 0.5 })
      .catch(reportError);
  }, [initialPage]);

  const renderItem: ListRenderItem<PageInfo> = useCallback(
    ({ item, index }) => (
      <Thumb
        docId={docId}
        page={index}
        info={item}
        nightMode={nightMode}
        sepia={sepia}
        onSelect={onSelect}
      />
    ),
    [docId, nightMode, sepia, onSelect],
  );

  return (
    <View testID="reader-thumbnails" style={{ height: THUMB_STRIP_HEIGHT }}>
      <FlashList
        ref={listRef}
        horizontal
        data={pages}
        renderItem={renderItem}
        keyExtractor={thumbKey}
        onLoad={centreInitialPage}
        showsHorizontalScrollIndicator={false}
        drawDistance={THUMB_WIDTH * 4}
      />
    </View>
  );
});

const thumbKey = (_: PageInfo, index: number) => String(index);
