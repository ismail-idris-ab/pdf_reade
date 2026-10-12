import { memo, useCallback, useMemo, useState } from 'react';
import { Image, View } from 'react-native';

import { FileIcon, LockIcon, PdfIcon, SheetIcon, WordIcon } from '@/components/icons';
import { extGroupOf, type ExtGroup } from '@/lib/files/extGroups';
import { useTheme } from '@/theme';

import { markThumbnailBroken, type ThumbnailState } from '../useThumbnail';

const TYPE_ICONS: Record<ExtGroup, typeof FileIcon> = {
  pdf: PdfIcon,
  word: WordIcon,
  excel: SheetIcon,
  other: FileIcon,
};

export type FileThumbProps = {
  ext: string;
  state: ThumbnailState;
  /** dp */
  width: number;
  /** dp */
  height: number;
};

/**
 * A file's first-page thumbnail when one is ready, a lock for a
 * password-protected PDF, and the file-type icon otherwise (non-PDFs, while
 * loading, or when rendering failed). Purely visual: the row carries the
 * accessibility label.
 */
export const FileThumb = memo(function FileThumb({ ext, state, width, height }: FileThumbProps) {
  const { palette } = useTheme();
  // A ready URI whose image failed to load shows the type icon instead.
  const [brokenUri, setBrokenUri] = useState<string | null>(null);
  const ready = state.kind === 'ready' && state.uri !== brokenUri ? state : null;
  const uri = ready?.uri ?? null;
  const readyKey = ready?.key ?? null;
  const source = useMemo(() => (uri === null ? null : { uri }), [uri]);
  const box = useMemo(() => ({ width, height }), [width, height]);
  const onError = useCallback(() => {
    if (uri === null || readyKey === null) return;
    markThumbnailBroken(readyKey);
    setBrokenUri(uri);
  }, [uri, readyKey]);
  const iconSize = Math.min(32, Math.round(width * 0.55));

  if (source !== null) {
    return (
      <Image
        testID="file-thumb-image"
        source={source}
        style={box}
        className="rounded-md border border-border bg-surface"
        resizeMode="cover"
        fadeDuration={0}
        accessible={false}
        onError={onError}
      />
    );
  }

  const Icon = state.kind === 'locked' ? LockIcon : TYPE_ICONS[extGroupOf(ext)];
  return (
    <View
      style={box}
      className="items-center justify-center rounded-md border border-border bg-surface"
    >
      <Icon color={palette.muted} size={iconSize} />
    </View>
  );
});
