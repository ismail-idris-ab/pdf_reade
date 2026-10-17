import { FlashList, type ListRenderItem } from '@shopify/flash-list';
import { memo, useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  Text,
  useWindowDimensions,
  View,
  type AccessibilityActionEvent,
} from 'react-native';

import { BookmarkIcon, ChevronRightIcon, DeleteIcon, ExpandMoreIcon } from '@/components/icons';
import { BottomSheet, Button, EmptyState, IconButton } from '@/components/ui';
import type { BookmarkRow } from '@/db/types';
import { useFormatDate, useTranslation } from '@/i18n';
import type { OutlineItem } from '@/lib/engine';
import { toAppError, toRecoveryLabel, toUserMessage, type AppErrorCode } from '@/lib/errors';
import { useTheme } from '@/theme';

import { currentSectionId, flattenOutline, initialExpanded, type OutlineRow } from '../outline';
import { useReaderStore } from '../store';
import type { OutlineLoad } from '../useOutline';

export type NavigationTab = 'contents' | 'bookmarks';

/** The most of the window height a list in the sheet takes; shorter lists fit their rows. */
const LIST_MAX_HEIGHT_FRACTION = 0.6;
/** Row heights the lists are sized by (rows with a two-line title scroll a little). */
const OUTLINE_ROW_HEIGHT = 48;
const BOOKMARK_ROW_HEIGHT = 56;
/** Indentation per outline level, dp; levels past MAX_INDENT_LEVELS stay put. */
const INDENT_STEP = 16;
const MAX_INDENT_LEVELS = 4;

/** Whether the Contents tab (and button) has anything to show. */
export function hasContents(outline: OutlineLoad): boolean {
  switch (outline.status) {
    case 'idle':
    case 'loading':
      return false;
    case 'ready':
      return outline.items.length > 0;
    case 'error':
      return true;
  }
}

export type NavigationSheetProps = {
  tab: NavigationTab | null;
  outline: OutlineLoad;
  onRetryOutline: () => void;
  onTabChange: (tab: NavigationTab) => void;
  onClose: () => void;
  /** Goes to a page (0-based) and closes the sheet. */
  onJump: (page: number) => void;
  /** Removes a bookmark, returning it for Undo; throws when the write fails. */
  onRemoveBookmark: (page: number) => BookmarkRow | null;
  /** Puts a removed bookmark back; throws when the write fails. */
  onRestoreBookmark: (row: BookmarkRow) => void;
};

/** A bookmark change made in the sheet that may need a second write. */
type BookmarkChange = { type: 'remove'; page: number } | { type: 'restore'; row: BookmarkRow };

/**
 * Feedback shown inside the sheet: toasts are drawn behind an open sheet,
 * so Undo and Try again would be out of reach there.
 */
type Notice =
  | { kind: 'removed'; row: BookmarkRow }
  | { kind: 'error'; code: AppErrorCode; retry: BookmarkChange };

/**
 * Contents (the document's outline) and Bookmarks, as two tabs of one sheet:
 * both answer "where do I go in this document", and one sheet keeps the top
 * bar to a single button for each. A document without an outline has only
 * the Bookmarks list.
 */
export function NavigationSheet({
  tab,
  outline,
  onRetryOutline,
  onTabChange,
  onClose,
  onJump,
  onRemoveBookmark,
  onRestoreBookmark,
}: NavigationSheetProps) {
  const { t } = useTranslation();
  const { height } = useWindowDimensions();
  const maxHeight = Math.round(height * LIST_MAX_HEIGHT_FRACTION);
  const [notice, setNotice] = useState<Notice | null>(null);

  const change = useCallback(
    (action: BookmarkChange) => {
      try {
        if (action.type === 'remove') {
          const row = onRemoveBookmark(action.page);
          setNotice(row ? { kind: 'removed', row } : null);
        } else {
          onRestoreBookmark(action.row);
          setNotice(null);
        }
      } catch (error) {
        setNotice({ kind: 'error', code: toAppError(error).code, retry: action });
      }
    },
    [onRemoveBookmark, onRestoreBookmark],
  );
  const removeBookmark = useCallback((page: number) => change({ type: 'remove', page }), [change]);
  const close = useCallback(() => {
    setNotice(null);
    onClose();
  }, [onClose]);
  const jump = useCallback(
    (page: number) => {
      setNotice(null);
      onJump(page);
    },
    [onJump],
  );
  const contents = hasContents(outline);
  const shown: NavigationTab | null = tab === 'contents' && !contents ? 'bookmarks' : tab;
  const tabs: { key: NavigationTab; label: string }[] = contents
    ? [
        { key: 'contents', label: t('reader.contents.open') },
        { key: 'bookmarks', label: t('reader.bookmarks.title') },
      ]
    : [{ key: 'bookmarks', label: t('reader.bookmarks.title') }];

  return (
    <BottomSheet testID="reader-nav-sheet" visible={shown !== null} onClose={close} scroll={false}>
      {tabs.length > 1 ? (
        <View accessibilityRole="tablist" className="mb-2 flex-row border-b border-border">
          {tabs.map(({ key, label }) => {
            const selected = key === shown;
            return (
              <Pressable
                key={key}
                testID={`reader-nav-tab-${key}`}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                onPress={() => onTabChange(key)}
                className={`min-h-12 flex-1 items-center justify-center border-b-2 ${
                  selected ? 'border-primary' : 'border-transparent'
                }`}
              >
                <Text
                  className={`text-base ${selected ? 'font-semibold text-primary' : 'text-muted'}`}
                >
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : (
        <Text accessibilityRole="header" className="mb-2 text-lg font-semibold text-foreground">
          {t('reader.bookmarks.title')}
        </Text>
      )}
      {shown === 'contents' ? (
        <ContentsTab
          outline={outline}
          maxHeight={maxHeight}
          onRetry={onRetryOutline}
          onJump={jump}
        />
      ) : shown === 'bookmarks' ? (
        <BookmarkList maxHeight={maxHeight} onJump={jump} onRemove={removeBookmark} />
      ) : null}
      {notice ? <NoticeBar notice={notice} onAction={change} /> : null}
    </BottomSheet>
  );
}

/** Undo after a removal, or the failure of a change with Try again, inside the sheet. */
function NoticeBar({
  notice,
  onAction,
}: {
  notice: Notice;
  onAction: (action: BookmarkChange) => void;
}) {
  const { t } = useTranslation();
  const text =
    notice.kind === 'removed'
      ? t('reader.bookmarks.removed', { page: notice.row.page + 1 })
      : toUserMessage(notice.code).title;
  const label = notice.kind === 'removed' ? t('reader.bookmarks.undo') : toRecoveryLabel('retry');
  const action: BookmarkChange =
    notice.kind === 'removed' ? { type: 'restore', row: notice.row } : notice.retry;
  return (
    <View
      testID="reader-nav-notice"
      className="mt-2 min-h-12 flex-row items-center gap-2 rounded-xl bg-surface pl-4"
    >
      <Text
        accessibilityLiveRegion="polite"
        className={`flex-1 text-sm ${notice.kind === 'error' ? 'text-danger' : 'text-foreground'}`}
      >
        {text}
      </Text>
      <Pressable
        testID="reader-nav-notice-action"
        accessibilityRole="button"
        onPress={() => onAction(action)}
        className="min-h-12 justify-center rounded-full px-4 active:bg-background"
      >
        <Text className="text-sm font-semibold text-primary">{label}</Text>
      </Pressable>
    </View>
  );
}

function ContentsTab({
  outline,
  maxHeight,
  onRetry,
  onJump,
}: {
  outline: OutlineLoad;
  maxHeight: number;
  onRetry: () => void;
  onJump: (page: number) => void;
}) {
  const { t } = useTranslation();
  const { palette } = useTheme();
  switch (outline.status) {
    case 'idle':
    case 'loading':
      return (
        <View className="items-center justify-center py-12">
          <ActivityIndicator
            testID="reader-contents-loading"
            accessibilityLabel={t('reader.contents.loading')}
            color={palette.primary}
            size="large"
          />
        </View>
      );
    case 'error': {
      const { title, message } = toUserMessage(outline.code);
      return (
        <View
          testID="reader-contents-error"
          className="items-center justify-center gap-3 px-6 py-8"
        >
          <Text
            accessibilityRole="header"
            className="w-full text-center text-lg font-semibold text-foreground"
          >
            {title}
          </Text>
          <Text className="w-full text-center text-base text-muted">{message}</Text>
          <Button
            testID="reader-contents-retry"
            label={toRecoveryLabel('retry')}
            onPress={onRetry}
          />
        </View>
      );
    }
    case 'ready':
      return <OutlineList items={outline.items} maxHeight={maxHeight} onJump={onJump} />;
  }
}

function OutlineList({
  items,
  maxHeight,
  onJump,
}: {
  items: readonly OutlineItem[];
  maxHeight: number;
  onJump: (page: number) => void;
}) {
  // The sheet is modal: the page does not change while it is open.
  const page = useReaderStore((state) => state.page);
  const currentId = useMemo(() => currentSectionId(items, page), [items, page]);
  const [expanded, setExpanded] = useState(() => initialExpanded(items, currentId));
  const rows = useMemo(() => flattenOutline(items, expanded), [items, expanded]);
  const toggle = useCallback((id: string) => {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const initialIndex = Math.max(
    0,
    rows.findIndex((row) => row.id === currentId),
  );

  const renderItem: ListRenderItem<OutlineRow> = useCallback(
    ({ item }) => (
      <OutlineRowView
        row={item}
        current={item.id === currentId}
        onJump={onJump}
        onToggle={toggle}
      />
    ),
    [currentId, onJump, toggle],
  );

  return (
    <View style={{ height: Math.min(maxHeight, rows.length * OUTLINE_ROW_HEIGHT) }}>
      <FlashList
        testID="reader-contents-list"
        data={rows}
        renderItem={renderItem}
        keyExtractor={outlineKey}
        extraData={renderItem}
        initialScrollIndex={initialIndex}
      />
    </View>
  );
}

const outlineKey = (row: OutlineRow) => row.id;

const OutlineRowView = memo(function OutlineRowView({
  row,
  current,
  onJump,
  onToggle,
}: {
  row: OutlineRow;
  current: boolean;
  onJump: (page: number) => void;
  onToggle: (id: string) => void;
}) {
  const { t } = useTranslation();
  const { palette } = useTheme();
  const { id, title, page, depth, hasChildren, expanded } = row;
  const indent = Math.min(depth, MAX_INDENT_LEVELS) * INDENT_STEP;

  return (
    <View className="min-h-12 flex-row items-center" style={{ paddingLeft: indent }}>
      {hasChildren ? (
        <Pressable
          testID={`reader-outline-toggle-${id}`}
          accessibilityRole="button"
          accessibilityLabel={t(expanded ? 'reader.contents.collapse' : 'reader.contents.expand', {
            title,
          })}
          accessibilityState={{ expanded }}
          onPress={() => onToggle(id)}
          className="h-12 w-12 items-center justify-center rounded-full active:bg-surface"
        >
          {expanded ? (
            <ExpandMoreIcon color={palette.muted} />
          ) : (
            <ChevronRightIcon color={palette.muted} />
          )}
        </Pressable>
      ) : (
        <View className="w-12" />
      )}
      {page !== null ? (
        <Pressable
          testID={`reader-outline-item-${id}`}
          accessibilityRole="button"
          accessibilityLabel={[
            title,
            t('reader.contents.itemPage', { page: page + 1 }),
            current ? t('reader.contents.current') : null,
          ]
            .filter((part) => part !== null)
            .join(', ')}
          accessibilityState={{ selected: current }}
          onPress={() => onJump(page)}
          className={`min-h-12 flex-1 flex-row items-center gap-2 rounded-lg px-2 active:bg-surface ${
            current ? 'bg-surface' : ''
          }`}
        >
          <Text
            numberOfLines={2}
            className={`flex-1 text-base ${current ? 'font-semibold text-primary' : 'text-foreground'}`}
          >
            {title}
          </Text>
          <Text className="text-sm text-muted">{page + 1}</Text>
        </Pressable>
      ) : (
        // No destination in this document (e.g. a web link): shown for the
        // structure, but not a button, so nothing pretends to be tappable.
        <View
          testID={`reader-outline-item-${id}`}
          accessible
          accessibilityLabel={`${title}, ${t('reader.contents.noPage')}`}
          className="min-h-12 flex-1 justify-center px-2"
        >
          <Text numberOfLines={2} className="text-base text-muted">
            {title}
          </Text>
        </View>
      )}
    </View>
  );
});

function BookmarkList({
  maxHeight,
  onJump,
  onRemove,
}: {
  maxHeight: number;
  onJump: (page: number) => void;
  onRemove: (page: number) => void;
}) {
  const { t } = useTranslation();
  const { palette } = useTheme();
  const bookmarks = useReaderStore((state) => state.bookmarks);

  const renderItem: ListRenderItem<BookmarkRow> = useCallback(
    ({ item }) => <BookmarkRowView bookmark={item} onJump={onJump} onRemove={onRemove} />,
    [onJump, onRemove],
  );

  if (bookmarks.length === 0) {
    return (
      <EmptyState
        testID="reader-bookmarks-empty"
        icon={<BookmarkIcon color={palette.muted} size={40} />}
        title={t('reader.bookmarks.emptyTitle')}
        message={t('reader.bookmarks.emptyMessage')}
      />
    );
  }
  return (
    <View style={{ height: Math.min(maxHeight, bookmarks.length * BOOKMARK_ROW_HEIGHT) }}>
      <FlashList
        testID="reader-bookmarks-list"
        data={bookmarks}
        renderItem={renderItem}
        keyExtractor={bookmarkKey}
        extraData={renderItem}
      />
    </View>
  );
}

const bookmarkKey = (bookmark: BookmarkRow) => String(bookmark.page);

const BookmarkRowView = memo(function BookmarkRowView({
  bookmark,
  onJump,
  onRemove,
}: {
  bookmark: BookmarkRow;
  onJump: (page: number) => void;
  onRemove: (page: number) => void;
}) {
  const { t } = useTranslation();
  const { palette } = useTheme();
  const formatDate = useFormatDate();
  const { page, label, createdAt } = bookmark;
  const title = t('reader.bookmarks.page', { page: page + 1 });
  const subtitle = label ?? t('reader.bookmarks.addedOn', { date: formatDate(createdAt) });
  const removeLabel = t('reader.bookmarks.remove', { page: page + 1 });
  const actions = useMemo(() => [{ name: 'remove', label: removeLabel }], [removeLabel]);
  const onAction = useCallback(
    (event: AccessibilityActionEvent) => {
      if (event.nativeEvent.actionName === 'remove') onRemove(page);
    },
    [onRemove, page],
  );

  return (
    <View className="min-h-14 flex-row items-center">
      <Pressable
        testID={`reader-bookmark-item-${page}`}
        accessibilityRole="button"
        accessibilityLabel={`${title}, ${subtitle}`}
        accessibilityHint={t('reader.bookmarks.goHint')}
        accessibilityActions={actions}
        onAccessibilityAction={onAction}
        onPress={() => onJump(page)}
        className="min-h-14 flex-1 flex-row items-center gap-3 rounded-lg px-2 active:bg-surface"
      >
        <BookmarkIcon color={palette.primary} />
        <View className="flex-1">
          <Text numberOfLines={1} className="text-base text-foreground">
            {title}
          </Text>
          <Text numberOfLines={1} className="text-sm text-muted">
            {subtitle}
          </Text>
        </View>
      </Pressable>
      <IconButton
        testID={`reader-bookmark-remove-${page}`}
        icon={<DeleteIcon color={palette.muted} />}
        accessibilityLabel={removeLabel}
        onPress={() => onRemove(page)}
      />
    </View>
  );
});
