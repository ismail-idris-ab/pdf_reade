import { memo, useCallback, useMemo } from 'react';
import {
  PixelRatio,
  Pressable,
  Text,
  View,
  type AccessibilityActionEvent,
  type AccessibilityActionInfo,
} from 'react-native';

import { MoreVertIcon } from '@/components/icons';
import { IconButton } from '@/components/ui';
import type { LibraryFile } from '@/db/repositories';
import { useTranslation } from '@/i18n';
import { useTheme } from '@/theme';

import { openFileActions } from '../../files/store';
import { useThumbnail, type ThumbnailState } from '../useThumbnail';
import { FileThumb } from './FileThumb';

/** "1.5 MB · Oct 4, 2026" for a file. */
export type FormatDetails = (file: LibraryFile) => string;

// List-row thumbnail box, dp (portrait, roughly A4).
const ROW_THUMB_WIDTH = 40;
const ROW_THUMB_HEIGHT = 52;

/** Grid and card thumbnails are portrait, 4:3. */
export function gridThumbHeight(width: number): number {
  return Math.round((width * 4) / 3);
}

function useFileThumbnail(file: LibraryFile, widthDp: number): ThumbnailState {
  // Only PDFs have engine thumbnails; other types show their icon.
  const isPdf = file.ext.toLowerCase() === 'pdf';
  return useThumbnail(isPdf ? file : null, Math.round(widthDp * PixelRatio.get()));
}

function useAccessibilityName(file: LibraryFile, details: string, state: ThumbnailState): string {
  const { t } = useTranslation();
  const parts = [file.name, details];
  if (state.kind === 'locked') parts.push(t('library.locked'));
  return parts.join(', ');
}

function useOpenActions(file: LibraryFile): () => void {
  return useCallback(() => openFileActions({ kind: 'file', file }), [file]);
}

export type LongPressA11y = {
  accessibilityActions: AccessibilityActionInfo[];
  onAccessibilityAction: (event: AccessibilityActionEvent) => void;
};

/**
 * The long-press as a named accessibility action ("More actions for …"), so
 * TalkBack lists it in its actions menu and runs the same handler.
 */
export function useLongPressA11y(name: string, onLongPress: () => void): LongPressA11y {
  const { t } = useTranslation();
  const label = t('fileActions.moreFor', { name });
  return useMemo(
    () => ({
      accessibilityActions: [{ name: 'longpress', label }],
      onAccessibilityAction: (event: AccessibilityActionEvent) => {
        if (event.nativeEvent.actionName === 'longpress') onLongPress();
      },
    }),
    [label, onLongPress],
  );
}

type MoreButtonProps = { name: string; onPress: () => void; testID?: string };

/** The ⋮ button that opens a file's or folder's actions sheet (48dp target). */
export function MoreButton({ name, onPress, testID }: MoreButtonProps) {
  const { t } = useTranslation();
  const { palette } = useTheme();
  return (
    <IconButton
      testID={testID}
      icon={<MoreVertIcon color={palette.muted} />}
      accessibilityLabel={t('fileActions.moreFor', { name })}
      onPress={onPress}
    />
  );
}

type FileListRowProps = { file: LibraryFile; formatDetails: FormatDetails };

/**
 * List view row. Opening a file arrives with the reader (T2.3); for now a
 * long-press or the ⋮ button opens the file's actions.
 */
export const FileListRow = memo(function FileListRow({ file, formatDetails }: FileListRowProps) {
  const { t } = useTranslation();
  const state = useFileThumbnail(file, ROW_THUMB_WIDTH);
  const details = formatDetails(file);
  const label = useAccessibilityName(file, details, state);
  const openActions = useOpenActions(file);
  const longPressA11y = useLongPressA11y(file.name, openActions);
  return (
    <View className="flex-row items-center pr-1">
      <Pressable
        testID={`library-row-${file.id}`}
        accessibilityLabel={label}
        accessibilityHint={t('fileActions.longPressHint')}
        onLongPress={openActions}
        {...longPressA11y}
        className="min-h-14 flex-1 flex-row items-center gap-3 py-2 pl-4 active:bg-surface"
      >
        <FileThumb ext={file.ext} state={state} width={ROW_THUMB_WIDTH} height={ROW_THUMB_HEIGHT} />
        <View className="flex-1">
          <Text numberOfLines={1} className="text-base text-foreground">
            {file.name}
          </Text>
          <Text numberOfLines={1} className="text-sm text-muted">
            {details}
          </Text>
        </View>
      </Pressable>
      <MoreButton testID={`library-more-${file.id}`} name={file.name} onPress={openActions} />
    </View>
  );
});

type FileTileProps = {
  file: LibraryFile;
  formatDetails: FormatDetails;
  /** Thumbnail width, dp. */
  width: number;
  testID?: string;
};

/**
 * Thumbnail with the name below: grid cells and the Recent/Favorites cards.
 * The ⋮ button sits on the thumbnail's corner; long-press does the same.
 */
export const FileTile = memo(function FileTile({
  file,
  formatDetails,
  width,
  testID,
}: FileTileProps) {
  const { t } = useTranslation();
  const state = useFileThumbnail(file, width);
  const label = useAccessibilityName(file, formatDetails(file), state);
  const nameStyle = useMemo(() => ({ width }), [width]);
  const openActions = useOpenActions(file);
  const longPressA11y = useLongPressA11y(file.name, openActions);
  return (
    <View className="p-2">
      <Pressable
        testID={testID}
        accessibilityLabel={label}
        accessibilityHint={t('fileActions.longPressHint')}
        onLongPress={openActions}
        {...longPressA11y}
        className="items-center"
      >
        <FileThumb ext={file.ext} state={state} width={width} height={gridThumbHeight(width)} />
        <Text
          numberOfLines={2}
          className="mt-1 text-center text-sm text-foreground"
          style={nameStyle}
        >
          {file.name}
        </Text>
      </Pressable>
      <View className="absolute right-1 top-1 rounded-full bg-background/80">
        <MoreButton
          testID={testID ? `more-${testID}` : undefined}
          name={file.name}
          onPress={openActions}
        />
      </View>
    </View>
  );
});
