import { FlashList, type ListRenderItem } from '@shopify/flash-list';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { BackHandler, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AccessBanner } from '@/components/AccessBanner';
import {
  CloseIcon,
  DevIcon,
  FileIcon,
  FolderIcon,
  GridIcon,
  ListIcon,
  SearchIcon,
  SortIcon,
} from '@/components/icons';
import { EmptyState, IconButton } from '@/components/ui';
import type { LibraryFile } from '@/db/repositories';
import { useFormatDate, useFormatFileSize, useTranslation } from '@/i18n';
import { toRecoveryLabel, toUserMessage } from '@/lib/errors';
import type { FolderEntry } from '@/lib/files';
import { bumpLibraryVersion } from '@/lib/library/version';
import { useTheme } from '@/theme';

import { parentDir } from '../files/actions';
import { FileActionsHost } from '../files/FileActionsHost';
import { MyFilesHeader } from '../files/components/MyFilesHeader';
import { useMyFilesStore } from '../files/store';
import { useMyFilesFolder, useMyFilesRoot, type MyFilesFolder } from '../files/useMyFilesFolder';
import { LibraryTabs, SourceChips } from './components/Filters';
import { FileListRow, FileTile, type FormatDetails } from './components/FileItems';
import { FileShelf } from './components/FileShelf';
import { FolderListRow, FolderTile } from './components/FolderItems';
import { SortSheet } from './components/SortSheet';
import { useLibraryPrefsStore } from './store';
import { showsShelves } from './filters';
import { useDebouncedValue, useLibraryData, type LibraryData } from './useLibraryData';
import { usePickFiles } from './usePickFiles';

const SEARCH_DEBOUNCE_MS = 150;
// Grid: side padding of the list and the narrowest column, dp.
const GRID_PADDING = 8;
const MIN_COLUMN_WIDTH = 112;
// Horizontal padding inside a grid cell (FileTile's p-2 on both sides), dp.
const CELL_INSET = 16;

/** A list entry: a library file, or a folder while browsing My Files. */
type LibraryEntry = LibraryFile | FolderEntry;

const isFolder = (entry: LibraryEntry): entry is FolderEntry => 'isDirectory' in entry;

const keyExtractor = (entry: LibraryEntry) =>
  isFolder(entry) ? `folder:${entry.path}` : String(entry.id);
const GRID_CONTENT = { paddingHorizontal: GRID_PADDING };

function useFormatDetails(): FormatDetails {
  const { t } = useTranslation();
  const formatSize = useFormatFileSize();
  const formatDate = useFormatDate();
  return useCallback(
    (file: LibraryFile) =>
      t('library.fileDetails', { size: formatSize(file.size), date: formatDate(file.mtime) }),
    [t, formatSize, formatDate],
  );
}

/**
 * The library (home screen): every indexed and picked document, filtered by
 * type tab and source chip, searchable by name, as a list or a grid. With
 * the My Files chip (and no search) it browses the My Files folder tree:
 * folders first, then files, with a breadcrumb, New folder and Import.
 * Files open their actions sheet from ⋮ or a long-press; opening a file for
 * reading arrives with the reader (T2.3).
 */
export function LibraryScreen() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const view = useLibraryPrefsStore((state) => state.view);
  const sort = useLibraryPrefsStore((state) => state.sort);
  const sortDir = useLibraryPrefsStore((state) => state.sortDir);
  const tab = useLibraryPrefsStore((state) => state.tab);
  const chip = useLibraryPrefsStore((state) => state.chip);
  const setTab = useLibraryPrefsStore((state) => state.setTab);
  const setChip = useLibraryPrefsStore((state) => state.setChip);

  const [search, setSearch] = useState('');
  const debounced = useDebouncedValue(search, SEARCH_DEBOUNCE_MS);
  // Clearing applies at once; typing waits for a pause.
  const query = search.trim() === '' ? '' : debounced;
  const filters = { tab, chip, sort, sortDir, query };
  const { i18n } = useTranslation();
  const data = useLibraryData(filters, i18n.language);
  const shelves = showsShelves(filters);
  const [sortOpen, setSortOpen] = useState(false);
  const formatDetails = useFormatDetails();

  // My Files browsing (a search searches the whole of My Files instead).
  const browsing = chip === 'myfiles' && query === '';
  const root = useMyFilesRoot();
  const browsedDir = useMyFilesStore((state) => state.dir);
  const setBrowsedDir = useMyFilesStore((state) => state.setDir);
  const currentDir = browsedDir ?? root;
  const folder = useMyFilesFolder(
    currentDir,
    { tab, sort, sortDir, locale: i18n.language },
    browsing,
  );
  const atRoot = currentDir === null || currentDir === root;

  // Hardware back goes up one folder while browsing below the root.
  useEffect(() => {
    if (!browsing || atRoot || currentDir === null) return undefined;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      setBrowsedDir(parentDir(currentDir));
      return true;
    });
    return () => subscription.remove();
  }, [browsing, atRoot, currentDir, setBrowsedDir]);

  const openFolder = useCallback(
    (entry: FolderEntry) => setBrowsedDir(entry.path),
    [setBrowsedDir],
  );

  const columns = Math.min(
    6,
    Math.max(2, Math.floor((width - GRID_PADDING * 2) / MIN_COLUMN_WIDTH)),
  );
  const tileWidth = Math.floor((width - GRID_PADDING * 2) / columns) - CELL_INSET;

  const renderItem: ListRenderItem<LibraryEntry> = useCallback(
    ({ item }) => {
      if (isFolder(item)) {
        return view === 'grid' ? (
          <FolderTile folder={item} onOpen={openFolder} width={tileWidth} />
        ) : (
          <FolderListRow folder={item} onOpen={openFolder} />
        );
      }
      return view === 'grid' ? (
        <FileTile
          testID={`library-cell-${item.id}`}
          file={item}
          formatDetails={formatDetails}
          width={tileWidth}
        />
      ) : (
        <FileListRow file={item} formatDetails={formatDetails} />
      );
    },
    [view, formatDetails, tileWidth, openFolder],
  );
  const getItemType = useCallback(
    (entry: LibraryEntry) => `${view}-${isFolder(entry) ? 'folder' : 'file'}`,
    [view],
  );

  const folderEntries = useMemo<readonly LibraryEntry[]>(
    () => (folder.status === 'ready' ? [...folder.folders, ...folder.files] : EMPTY),
    [folder],
  );
  const items: readonly LibraryEntry[] = browsing
    ? folderEntries
    : data.status === 'ready'
      ? data.items
      : EMPTY;

  const recent = data.status === 'ready' ? data.recent : EMPTY_FILES;
  const favorites = data.status === 'ready' ? data.favorites : EMPTY_FILES;
  const header = useMemo(
    () =>
      browsing ? (
        <View className="pb-2">
          <MyFilesHeader root={root} dir={currentDir} onNavigate={setBrowsedDir} />
        </View>
      ) : (
        <ListHeader
          shelves={shelves}
          recent={recent}
          favorites={favorites}
          formatDetails={formatDetails}
        />
      ),
    [browsing, root, currentDir, setBrowsedDir, shelves, recent, favorites, formatDetails],
  );

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <TopBar search={search} onSearch={setSearch} onOpenSort={() => setSortOpen(true)} />
      <LibraryTabs value={tab} onChange={setTab} />
      <SourceChips value={chip} onChange={setChip} />
      <FlashList
        // Switching between list and grid (or the column count) remounts
        // the list so no recycled cell of the other layout is reused.
        key={view === 'grid' ? `grid-${columns}` : 'list'}
        testID="library-list"
        data={items}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        getItemType={getItemType}
        numColumns={view === 'grid' ? columns : 1}
        contentContainerStyle={view === 'grid' ? GRID_CONTENT : undefined}
        ListHeaderComponent={header}
        ListEmptyComponent={
          browsing ? (
            <FolderEmpty folder={folder} />
          ) : (
            <LibraryEmpty data={data} searching={query !== ''} />
          )
        }
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      />
      <SortSheet visible={sortOpen} onClose={() => setSortOpen(false)} />
      <FileActionsHost />
    </View>
  );
}

const EMPTY: readonly LibraryEntry[] = [];
const EMPTY_FILES: readonly LibraryFile[] = [];

type TopBarProps = {
  search: string;
  onSearch: (text: string) => void;
  onOpenSort: () => void;
};

function TopBar({ search, onSearch, onOpenSort }: TopBarProps) {
  const { t } = useTranslation();
  const { palette } = useTheme();
  const view = useLibraryPrefsStore((state) => state.view);
  const setView = useLibraryPrefsStore((state) => state.setView);
  const appName = Constants.expoConfig?.name ?? '';

  return (
    <View className="gap-2 px-2 pb-2">
      <View className="flex-row items-center">
        <Text
          accessibilityRole="header"
          numberOfLines={1}
          className="flex-1 px-2 text-2xl font-semibold text-foreground"
        >
          {appName}
        </Text>
        {__DEV__ ? (
          <IconButton
            testID="library-dev"
            icon={<DevIcon color={palette.foreground} />}
            accessibilityLabel={t('library.devTools')}
            onPress={() => router.push('/dev')}
          />
        ) : null}
        <IconButton
          testID="library-view-toggle"
          icon={
            view === 'list' ? (
              <GridIcon color={palette.foreground} />
            ) : (
              <ListIcon color={palette.foreground} />
            )
          }
          accessibilityLabel={view === 'list' ? t('library.showGrid') : t('library.showList')}
          onPress={() => setView(view === 'list' ? 'grid' : 'list')}
        />
        <IconButton
          testID="library-sort"
          icon={<SortIcon color={palette.foreground} />}
          accessibilityLabel={t('library.sort')}
          onPress={onOpenSort}
        />
      </View>
      <View className="mx-2 min-h-12 flex-row items-center rounded-xl border border-border bg-surface pl-3">
        <SearchIcon color={palette.muted} size={20} />
        <TextInput
          testID="library-search"
          value={search}
          onChangeText={onSearch}
          placeholder={t('library.searchPlaceholder')}
          placeholderTextColor={palette.muted}
          accessibilityLabel={t('library.searchPlaceholder')}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          className="min-h-12 flex-1 px-2 text-base text-foreground"
        />
        {search !== '' ? (
          <IconButton
            testID="library-search-clear"
            icon={<CloseIcon color={palette.muted} size={20} />}
            accessibilityLabel={t('library.clearSearch')}
            onPress={() => onSearch('')}
          />
        ) : null}
      </View>
    </View>
  );
}

type ListHeaderProps = {
  shelves: boolean;
  recent: readonly LibraryFile[];
  favorites: readonly LibraryFile[];
  formatDetails: FormatDetails;
};

const ListHeader = memo(function ListHeader({
  shelves,
  recent,
  favorites,
  formatDetails,
}: ListHeaderProps) {
  const { t } = useTranslation();
  return (
    <View className="pb-2">
      <View className="px-4 pt-2">
        <AccessBanner />
      </View>
      {shelves ? (
        <>
          <FileShelf
            testID="library-recent"
            title={t('library.recent')}
            files={recent}
            formatDetails={formatDetails}
          />
          <FileShelf
            testID="library-favorites"
            title={t('library.favorites')}
            files={favorites}
            formatDetails={formatDetails}
          />
        </>
      ) : null}
    </View>
  );
});

function FolderEmpty({ folder }: { folder: MyFilesFolder }) {
  const { t } = useTranslation();
  const { palette } = useTheme();
  const icon = <FolderIcon color={palette.muted} size={48} />;
  if (folder.status === 'loading') return null;
  if (folder.status === 'error') {
    const message = toUserMessage(folder.error.code);
    return (
      <EmptyState
        testID="myfiles-error"
        icon={icon}
        title={t('folders.loadErrorTitle')}
        message={message.message}
        action={{ label: toRecoveryLabel('retry'), onPress: bumpLibraryVersion }}
      />
    );
  }
  return (
    <EmptyState
      testID="myfiles-empty"
      icon={icon}
      title={t('folders.emptyTitle')}
      message={t('folders.emptyMessage')}
    />
  );
}

function LibraryEmpty({ data, searching }: { data: LibraryData; searching: boolean }) {
  const { t } = useTranslation();
  const { palette } = useTheme();
  const { pick } = usePickFiles();
  const icon = <FileIcon color={palette.muted} size={48} />;

  if (data.status === 'error') {
    const message = toUserMessage(data.error.code);
    return (
      <EmptyState
        testID="library-error"
        icon={icon}
        title={message.title}
        message={message.message}
        action={{ label: toRecoveryLabel('retry'), onPress: bumpLibraryVersion }}
      />
    );
  }
  if (data.total === 0 && !searching) {
    return (
      <EmptyState
        testID="library-empty"
        icon={icon}
        title={t('library.empty.noFilesTitle')}
        message={t('library.empty.noFilesMessage')}
        action={{ label: t('library.empty.pickFiles'), onPress: pick }}
      />
    );
  }
  if (searching) {
    return (
      <EmptyState
        testID="library-no-matches"
        icon={<SearchIcon color={palette.muted} size={48} />}
        title={t('library.empty.noMatchesTitle')}
        message={t('library.empty.noMatchesMessage')}
      />
    );
  }
  return (
    <EmptyState
      testID="library-filter-empty"
      icon={icon}
      title={t('library.empty.noFilesHereTitle')}
      message={t('library.empty.noFilesHereMessage')}
    />
  );
}
