import { useState } from 'react';
import { Text, View } from 'react-native';

import { ImportIcon, NewFolderIcon } from '@/components/icons';
import { Button, toast } from '@/components/ui';
import { useTranslation } from '@/i18n';
import { useTheme } from '@/theme';

import { createMyFilesFolder } from '../actions';
import { showFileActionError } from '../errors';
import { folderTrail } from '../location';
import { useImportToMyFiles } from '../useImportToMyFiles';
import { Breadcrumbs } from './Breadcrumbs';
import { NameDialog } from './NameDialog';

type MyFilesHeaderProps = {
  root: string | null;
  /** Folder being shown (the root when browsing the top level). */
  dir: string | null;
  onNavigate: (dir: string | null) => void;
};

/**
 * Top of the My Files list: breadcrumb, "New folder" and "Import", and the
 * note that My Files lives in app storage (gone if the app is uninstalled).
 */
export function MyFilesHeader({ root, dir, onNavigate }: MyFilesHeaderProps) {
  const { t } = useTranslation();
  const { palette } = useTheme();
  const [creating, setCreating] = useState(false);
  const { importFiles, importing } = useImportToMyFiles(dir);
  const trail = root !== null ? folderTrail(root, dir, t('folders.root')) : [];

  return (
    <View testID="myfiles-header" className="gap-2 pb-2">
      <Breadcrumbs testID="myfiles-crumbs" trail={trail} onNavigate={(path) => onNavigate(path)} />
      <View className="flex-row gap-2 px-4">
        <View className="flex-1">
          <Button
            testID="myfiles-new-folder"
            label={t('folders.newFolder')}
            variant="secondary"
            icon={<NewFolderIcon color={palette.foreground} size={20} />}
            disabled={dir === null}
            onPress={() => setCreating(true)}
          />
        </View>
        <View className="flex-1">
          <Button
            testID="myfiles-import"
            label={t('folders.import')}
            variant="secondary"
            icon={<ImportIcon color={palette.foreground} size={20} />}
            disabled={dir === null}
            loading={importing}
            onPress={importFiles}
          />
        </View>
      </View>
      <Text testID="myfiles-note" className="px-4 text-sm text-muted">
        {t('folders.uninstallNote')}
      </Text>
      {creating && dir !== null ? (
        <NameDialog
          testID="new-folder-dialog"
          title={t('folders.newFolder')}
          initialName=""
          confirmLabel={t('folders.create')}
          onSubmit={async (name) => {
            await createMyFilesFolder(dir, name);
            setCreating(false);
            toast(t('folders.created'));
          }}
          onError={(error) => {
            setCreating(false);
            showFileActionError(error, { onRetry: () => setCreating(true) });
          }}
          onDismiss={() => setCreating(false)}
        />
      ) : null}
    </View>
  );
}
