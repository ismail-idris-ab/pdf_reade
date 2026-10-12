import { memo, useCallback, useMemo } from 'react';
import { Pressable, Text, View } from 'react-native';

import { FolderIcon } from '@/components/icons';
import { useTranslation } from '@/i18n';
import type { FolderEntry } from '@/lib/files';
import { useTheme } from '@/theme';

import { openFileActions } from '../../files/store';
import { gridThumbHeight, MoreButton, useLongPressA11y } from './FileItems';

type FolderItemProps = {
  folder: FolderEntry;
  onOpen: (folder: FolderEntry) => void;
};

function useFolderHandlers(folder: FolderEntry, onOpen: (folder: FolderEntry) => void) {
  const open = useCallback(() => onOpen(folder), [folder, onOpen]);
  const openActions = useCallback(() => openFileActions({ kind: 'folder', folder }), [folder]);
  return { open, openActions };
}

/** My Files folder in the list view: tap opens it, long-press or ⋮ for actions. */
export const FolderListRow = memo(function FolderListRow({ folder, onOpen }: FolderItemProps) {
  const { t } = useTranslation();
  const { palette } = useTheme();
  const { open, openActions } = useFolderHandlers(folder, onOpen);
  const longPressA11y = useLongPressA11y(folder.name, openActions);
  return (
    <View className="flex-row items-center pr-1">
      <Pressable
        testID={`myfiles-folder-${folder.name}`}
        accessibilityRole="button"
        accessibilityLabel={t('folders.folderLabel', { name: folder.name })}
        accessibilityHint={t('fileActions.longPressHint')}
        onPress={open}
        onLongPress={openActions}
        {...longPressA11y}
        className="min-h-14 flex-1 flex-row items-center gap-3 py-2 pl-4 active:bg-surface"
      >
        <View className="w-10 items-center">
          <FolderIcon color={palette.primary} size={32} />
        </View>
        <Text numberOfLines={1} className="flex-1 text-base text-foreground">
          {folder.name}
        </Text>
      </Pressable>
      <MoreButton
        testID={`myfiles-folder-more-${folder.name}`}
        name={folder.name}
        onPress={openActions}
      />
    </View>
  );
});

type FolderTileProps = FolderItemProps & { width: number };

/** My Files folder in the grid view. */
export const FolderTile = memo(function FolderTile({ folder, onOpen, width }: FolderTileProps) {
  const { t } = useTranslation();
  const { palette } = useTheme();
  const { open, openActions } = useFolderHandlers(folder, onOpen);
  const longPressA11y = useLongPressA11y(folder.name, openActions);
  const boxStyle = useMemo(() => ({ width, height: gridThumbHeight(width) }), [width]);
  const nameStyle = useMemo(() => ({ width }), [width]);
  return (
    <View className="p-2">
      <Pressable
        testID={`myfiles-folder-${folder.name}`}
        accessibilityRole="button"
        accessibilityLabel={t('folders.folderLabel', { name: folder.name })}
        accessibilityHint={t('fileActions.longPressHint')}
        onPress={open}
        onLongPress={openActions}
        {...longPressA11y}
        className="items-center"
      >
        <View className="items-center justify-center rounded-lg bg-surface" style={boxStyle}>
          <FolderIcon color={palette.primary} size={48} />
        </View>
        <Text
          numberOfLines={2}
          className="mt-1 text-center text-sm text-foreground"
          style={nameStyle}
        >
          {folder.name}
        </Text>
      </Pressable>
      <View className="absolute right-1 top-1 rounded-full bg-background/80">
        <MoreButton
          testID={`myfiles-folder-more-${folder.name}`}
          name={folder.name}
          onPress={openActions}
        />
      </View>
    </View>
  );
});
