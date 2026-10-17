import {
  BookmarksIcon,
  HorizontalPagesIcon,
  MoveDownIcon,
  VerticalPagesIcon,
} from '@/components/icons';
import { BottomSheet, ListItem } from '@/components/ui';
import type { ReadingMode } from '@/db/schema';
import { useTranslation } from '@/i18n';
import { useTheme } from '@/theme';

export type ReaderMenuProps = {
  visible: boolean;
  mode: ReadingMode;
  onClose: () => void;
  onOpenBookmarks: () => void;
  onOpenJump: () => void;
  onToggleMode: () => void;
};

/**
 * The reader's less-used actions, behind "More options" so the top bar fits
 * a 360 dp phone: the bookmarks list, Go to page (also on the page
 * indicator) and the reading mode.
 */
export function ReaderMenu({
  visible,
  mode,
  onClose,
  onOpenBookmarks,
  onOpenJump,
  onToggleMode,
}: ReaderMenuProps) {
  const { t } = useTranslation();
  const { palette } = useTheme();

  return (
    <BottomSheet
      testID="reader-menu"
      visible={visible}
      onClose={onClose}
      title={t('reader.menu.title')}
    >
      <ListItem
        testID="reader-menu-bookmarks"
        title={t('reader.bookmarks.title')}
        leading={<BookmarksIcon color={palette.foreground} />}
        onPress={onOpenBookmarks}
      />
      <ListItem
        testID="reader-menu-jump"
        title={t('reader.jumpTitle')}
        leading={<MoveDownIcon color={palette.foreground} />}
        onPress={onOpenJump}
      />
      <ListItem
        testID="reader-mode"
        title={t(mode === 'vertical' ? 'reader.switchToHorizontal' : 'reader.switchToVertical')}
        leading={
          mode === 'vertical' ? (
            <HorizontalPagesIcon color={palette.foreground} />
          ) : (
            <VerticalPagesIcon color={palette.foreground} />
          )
        }
        onPress={onToggleMode}
      />
    </BottomSheet>
  );
}
