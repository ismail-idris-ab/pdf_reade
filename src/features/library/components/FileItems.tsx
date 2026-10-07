import { memo, useMemo } from 'react';
import { PixelRatio, Text, View } from 'react-native';

import { ListItem } from '@/components/ui';
import type { LibraryFile } from '@/db/repositories';
import { useTranslation } from '@/i18n';

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

type FileListRowProps = { file: LibraryFile; formatDetails: FormatDetails };

/** List view row. Not pressable until the reader exists (T2.3). */
export const FileListRow = memo(function FileListRow({ file, formatDetails }: FileListRowProps) {
  const state = useFileThumbnail(file, ROW_THUMB_WIDTH);
  const details = formatDetails(file);
  const label = useAccessibilityName(file, details, state);
  return (
    <ListItem
      testID={`library-row-${file.id}`}
      title={file.name}
      subtitle={details}
      accessibilityLabel={label}
      leading={
        <FileThumb ext={file.ext} state={state} width={ROW_THUMB_WIDTH} height={ROW_THUMB_HEIGHT} />
      }
    />
  );
});

type FileTileProps = {
  file: LibraryFile;
  formatDetails: FormatDetails;
  /** Thumbnail width, dp. */
  width: number;
  testID?: string;
};

/** Thumbnail with the name below: grid cells and the Recent/Favorites cards. */
export const FileTile = memo(function FileTile({
  file,
  formatDetails,
  width,
  testID,
}: FileTileProps) {
  const state = useFileThumbnail(file, width);
  const label = useAccessibilityName(file, formatDetails(file), state);
  const nameStyle = useMemo(() => ({ width }), [width]);
  return (
    <View testID={testID} accessible accessibilityLabel={label} className="items-center p-2">
      <FileThumb ext={file.ext} state={state} width={width} height={gridThumbHeight(width)} />
      <Text
        numberOfLines={2}
        className="mt-1 text-center text-sm text-foreground"
        style={nameStyle}
      >
        {file.name}
      </Text>
    </View>
  );
});
