import { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ArrowBackIcon, CloseIcon, FolderIcon, NewFolderIcon } from '@/components/icons';
import { Button, IconButton, ListItem } from '@/components/ui';
import { FullScreenModal } from '@/components/ui/FullScreenModal';
import { useTranslation } from '@/i18n';
import { AppError, toAppError, toRecoveryLabel, toUserMessage } from '@/lib/errors';
import { listFolder, type FolderEntry } from '@/lib/files';
import { useTheme } from '@/theme';

import { createMyFilesFolder, parentDir } from '../actions';
import { folderTrail } from '../location';
import { useInFlight } from '../useInFlight';
import { sortFolders, useMyFilesRoot } from '../useMyFilesFolder';
import { Breadcrumbs } from './Breadcrumbs';
import { NameDialog } from './NameDialog';

export type FolderPickerProps = {
  title: string;
  confirmLabel: string;
  /** Folder the item is in now: confirming there would change nothing, so it is disabled. */
  currentParent: string | null;
  /** Rejections go to `onError` (the caller closes the picker and explains). */
  onConfirm: (destDir: string) => Promise<void>;
  onError: (error: unknown) => void;
  onDismiss: () => void;
};

type Listing =
  | { status: 'loading' }
  | { status: 'ready'; folders: FolderEntry[] }
  | { status: 'error'; error: AppError };

const ROOT_UNAVAILABLE = new AppError('UNKNOWN', 'My Files root unavailable');

/**
 * Full-screen browser of the My Files folder tree for choosing a move or
 * copy destination: breadcrumb, folders only, "New folder" (which opens
 * the new folder), and a confirm button. Back goes up one level, or closes
 * at the root. Mount it only while it is shown.
 */
export function FolderPicker({
  title,
  confirmLabel,
  currentParent,
  onConfirm,
  onError,
  onDismiss,
}: FolderPickerProps) {
  const { t, i18n } = useTranslation();
  const { palette } = useTheme();
  const insets = useSafeAreaInsets();
  const root = useMyFilesRoot();
  const [dir, setDir] = useState<string | null>(root);
  const [reload, setReload] = useState(0);
  // The last listing that arrived, with the request it answers.
  const [loaded, setLoaded] = useState<{ key: string; listing: Listing } | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<AppError | null>(null);
  const { busy, run } = useInFlight();

  const requestKey = `${dir ?? ''}\u0000${reload}\u0000${i18n.language}`;
  const listing: Listing =
    dir === null
      ? { status: 'error', error: ROOT_UNAVAILABLE }
      : loaded !== null && loaded.key === requestKey
        ? loaded.listing
        : { status: 'loading' };

  useEffect(() => {
    if (dir === null) return undefined;
    let live = true;
    listFolder(dir).then(
      (result) => {
        if (!live) return;
        setLoaded({
          key: requestKey,
          listing: { status: 'ready', folders: sortFolders(result.entries, i18n.language) },
        });
      },
      (error: unknown) => {
        if (live)
          setLoaded({ key: requestKey, listing: { status: 'error', error: toAppError(error) } });
      },
    );
    return () => {
      live = false;
    };
  }, [dir, requestKey, i18n.language]);

  const atRoot = dir === null || dir === root;
  const back = () => {
    if (busy) return;
    if (atRoot || dir === null) onDismiss();
    else setDir(parentDir(dir));
  };
  const trail = root !== null ? folderTrail(root, dir, t('folders.root')) : [];

  const confirm = () => {
    if (dir === null) return;
    void run(async () => {
      try {
        await onConfirm(dir);
      } catch (error) {
        onError(error);
      }
    });
  };

  const errorMessage = (error: AppError) => {
    const message = toUserMessage(error.code);
    return t('common.errorToast', { title: message.title, message: message.message });
  };

  return (
    <FullScreenModal visible onRequestClose={back} className="bg-background">
      <View
        testID="folder-picker"
        accessibilityViewIsModal
        className="flex-1"
        style={{ paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, 16) }}
      >
        <View className="flex-row items-center px-2">
          <IconButton
            testID="folder-picker-back"
            icon={
              atRoot ? (
                <CloseIcon color={palette.foreground} />
              ) : (
                <ArrowBackIcon color={palette.foreground} />
              )
            }
            accessibilityLabel={atRoot ? t('common.close') : t('folders.up')}
            onPress={back}
            disabled={busy}
          />
          <Text
            accessibilityRole="header"
            numberOfLines={1}
            className="flex-1 px-2 text-xl font-semibold text-foreground"
          >
            {title}
          </Text>
        </View>
        <Breadcrumbs
          testID="folder-picker-crumbs"
          trail={trail}
          onNavigate={(path) => {
            if (!busy) setDir(path ?? root);
          }}
        />
        <ScrollView className="flex-1">
          {listing.status === 'ready'
            ? listing.folders.map((folder) => (
                <ListItem
                  key={folder.path}
                  testID={`folder-picker-folder-${folder.name}`}
                  title={folder.name}
                  accessibilityLabel={t('folders.folderLabel', { name: folder.name })}
                  leading={<FolderIcon color={palette.muted} />}
                  onPress={() => {
                    if (!busy) setDir(folder.path);
                  }}
                />
              ))
            : null}
          {listing.status === 'ready' && listing.folders.length === 0 ? (
            <Text className="px-4 py-6 text-center text-base text-muted">
              {t('folders.emptyTitle')}
            </Text>
          ) : null}
          {listing.status === 'error' ? (
            <View className="items-center gap-3 px-6 py-6">
              <Text className="text-center text-base text-muted">
                {errorMessage(listing.error)}
              </Text>
              {dir !== null ? (
                <Button
                  label={toRecoveryLabel('retry')}
                  variant="secondary"
                  onPress={() => setReload((value) => value + 1)}
                />
              ) : null}
            </View>
          ) : null}
        </ScrollView>
        {createError !== null ? (
          <Text
            testID="folder-picker-error"
            accessibilityLiveRegion="polite"
            className="px-4 pb-2 text-sm text-danger"
          >
            {errorMessage(createError)}
          </Text>
        ) : null}
        <View className="flex-row gap-2 px-4 pt-2">
          <View className="flex-1">
            <Button
              testID="folder-picker-new"
              label={t('folders.newFolder')}
              variant="secondary"
              icon={<NewFolderIcon color={palette.foreground} size={20} />}
              disabled={busy || dir === null}
              onPress={() => {
                setCreateError(null);
                setCreating(true);
              }}
            />
          </View>
          <View className="flex-1">
            <Button
              testID="folder-picker-confirm"
              label={confirmLabel}
              disabled={dir === null || dir === currentParent || listing.status === 'error'}
              loading={busy}
              onPress={confirm}
            />
          </View>
        </View>
      </View>
      {creating && dir !== null ? (
        <NameDialog
          testID="new-folder-dialog"
          title={t('folders.newFolder')}
          initialName=""
          confirmLabel={t('folders.create')}
          onSubmit={async (name) => {
            const entry = await createMyFilesFolder(dir, name);
            setCreating(false);
            setDir(entry.path);
          }}
          onError={(error) => {
            setCreating(false);
            setCreateError(toAppError(error));
          }}
          onDismiss={() => setCreating(false)}
        />
      ) : null}
    </FullScreenModal>
  );
}
