import { Text } from 'react-native';

import { BottomSheet, ListItem } from '@/components/ui';
import type { SortDir } from '@/db/repositories';
import { useTranslation } from '@/i18n';

import { LIBRARY_SORTS, useLibraryPrefsStore } from '../store';

const DIRS: readonly SortDir[] = ['asc', 'desc'];

type SortSheetProps = { visible: boolean; onClose: () => void };

/**
 * Sort field (name / date / size) and direction, as single-choice rows.
 * Picking a field applies it with that field's natural direction; the sheet
 * stays open so the direction can be flipped right away.
 */
export function SortSheet({ visible, onClose }: SortSheetProps) {
  const { t } = useTranslation();
  const sort = useLibraryPrefsStore((state) => state.sort);
  const sortDir = useLibraryPrefsStore((state) => state.sortDir);
  const setSort = useLibraryPrefsStore((state) => state.setSort);
  const setSortDir = useLibraryPrefsStore((state) => state.setSortDir);

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={t('library.sortBy')}
      testID="library-sort-sheet"
    >
      {LIBRARY_SORTS.map((field) => (
        <ListItem
          key={field}
          testID={`library-sort-${field}`}
          title={t(`library.sortField.${field}`)}
          selected={field === sort}
          onPress={() => {
            if (field !== sort) setSort(field);
          }}
        />
      ))}
      <Text
        accessibilityRole="header"
        className="mb-1 mt-4 text-base font-semibold text-foreground"
      >
        {t('library.order')}
      </Text>
      {DIRS.map((dir) => (
        <ListItem
          key={dir}
          testID={`library-sort-dir-${dir}`}
          title={t(`library.sortDir.${sort}.${dir}`)}
          selected={dir === sortDir}
          onPress={() => setSortDir(dir)}
        />
      ))}
    </BottomSheet>
  );
}
