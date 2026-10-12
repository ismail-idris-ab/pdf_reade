import { useMemo } from 'react';
import { Text, View } from 'react-native';

import { BottomSheet } from '@/components/ui';
import type { LibraryFile } from '@/db/repositories';
import type { FileRow } from '@/db/types';
import {
  formatNumber,
  useFormatDate,
  useFormatFileSize,
  useTranslation,
  type Locale,
} from '@/i18n';
import { tryGetMyFilesRoot } from '@/lib/files';

import { describeLocation } from '../location';

type DetailsSheetProps = {
  visible: boolean;
  file: LibraryFile;
  /** The full row (for the page count), if the library still has it. */
  row: FileRow | undefined;
  onClose: () => void;
};

function DetailRow({ label, value, testID }: { label: string; value: string; testID: string }) {
  return (
    <View
      testID={testID}
      accessible
      accessibilityLabel={`${label}, ${value}`}
      className="min-h-12 justify-center py-2"
    >
      <Text className="text-sm text-muted">{label}</Text>
      <Text className="text-base text-foreground">{value}</Text>
    </View>
  );
}

/**
 * Name, type, size, modified date, a friendly location (never a raw
 * content:// URI or full path) and, when known, the page count.
 */
export function DetailsSheet({ visible, file, row, onClose }: DetailsSheetProps) {
  const { t, i18n } = useTranslation();
  const formatSize = useFormatFileSize();
  const formatDate = useFormatDate();
  const location = useMemo(
    () =>
      describeLocation(file.path, file.source, tryGetMyFilesRoot(), {
        pickedFile: t('details.pickedFile'),
        phoneStorage: t('details.phoneStorage'),
        sdCard: t('details.sdCard'),
        myFiles: t('folders.root'),
        downloads: t('library.chips.downloads'),
        whatsapp: t('library.chips.whatsapp'),
        scans: t('library.chips.scans'),
      }),
    [file.path, file.source, t],
  );
  const pageCount = row?.pageCount ?? null;

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={t('details.title')}
      testID="details-sheet"
    >
      <DetailRow testID="details-name" label={t('fileActions.nameLabel')} value={file.name} />
      <DetailRow
        testID="details-type"
        label={t('details.type')}
        value={
          file.ext === ''
            ? t('details.unknownType')
            : t('details.typeValue', { ext: file.ext.toUpperCase() })
        }
      />
      <DetailRow testID="details-size" label={t('details.size')} value={formatSize(file.size)} />
      <DetailRow
        testID="details-modified"
        label={t('details.modified')}
        value={formatDate(file.mtime)}
      />
      <DetailRow testID="details-location" label={t('details.location')} value={location} />
      {pageCount !== null ? (
        <DetailRow
          testID="details-pages"
          label={t('details.pages')}
          value={formatNumber(pageCount, i18n.language as Locale)}
        />
      ) : null}
    </BottomSheet>
  );
}
