import { useEffect, useMemo, useState, type ReactNode } from 'react';

import {
  CopyIcon,
  DeleteIcon,
  InfoIcon,
  MoveIcon,
  PrintIcon,
  RenameIcon,
  ShareIcon,
  StarIcon,
  StarOutlineIcon,
} from '@/components/icons';
import { BottomSheet, ListItem } from '@/components/ui';
import type { LibraryFile } from '@/db/repositories';
import { useTranslation } from '@/i18n';
import {
  documentCapabilities,
  isInMyFiles,
  tryGetMyFilesRoot,
  useAllFilesAccess,
  type DocumentCapabilities,
  type FolderEntry,
} from '@/lib/files';
import { useTheme } from '@/theme';

import { canChangeSharedStorage, isContentPath } from '../actions';

export type FileAction =
  | 'favorite'
  | 'rename'
  | 'move'
  | 'copyToMyFiles'
  | 'duplicate'
  | 'details'
  | 'share'
  | 'print'
  | 'delete';

export type FolderAction = 'rename' | 'delete';

export type ActionContext = {
  /** What the provider allows for a picked document; null while unknown. */
  capabilities: DocumentCapabilities | null;
  /**
   * Whether the app may change files in shared storage right now (see
   * canChangeSharedStorage). False hides rename, move, duplicate and delete
   * for files outside My Files that were not picked.
   */
  sharedStorageWritable: boolean;
  /** The My Files root (files under it are always app-writable). */
  myFilesRoot: string | null;
};

/**
 * Actions a file offers, in sheet order. Picked (content://) documents can
 * be renamed / deleted only when their provider allows it, are copied into
 * My Files instead of moved, and are not duplicated in place. Files in
 * shared storage can be changed only when shared storage is writable;
 * otherwise only the read-only actions show. Print is for PDFs only.
 */
export function availableFileActions(
  file: Pick<LibraryFile, 'path' | 'ext'>,
  { capabilities, sharedStorageWritable, myFilesRoot }: ActionContext,
): FileAction[] {
  const picked = isContentPath(file.path);
  const writable = picked || sharedStorageWritable || isInMyFiles(file.path, myFilesRoot);
  const canRename = picked ? capabilities?.canRename === true : writable;
  const canDelete = picked ? capabilities?.canDelete === true : writable;
  const actions: (FileAction | null)[] = [
    'favorite',
    canRename ? 'rename' : null,
    picked ? 'copyToMyFiles' : writable ? 'move' : null,
    picked || !writable ? null : 'duplicate',
    'details',
    'share',
    file.ext.toLowerCase() === 'pdf' ? 'print' : null,
    canDelete ? 'delete' : null,
  ];
  return actions.filter((action): action is FileAction => action !== null);
}

const FILE_ACTION_LABEL = {
  rename: 'fileActions.rename',
  move: 'fileActions.move',
  copyToMyFiles: 'fileActions.copyToMyFiles',
  duplicate: 'fileActions.duplicate',
  details: 'fileActions.details',
  share: 'fileActions.share',
  print: 'fileActions.print',
  delete: 'fileActions.delete',
} as const satisfies Record<Exclude<FileAction, 'favorite'>, string>;

type FileActionsSheetProps = {
  visible: boolean;
  file: LibraryFile;
  onSelect: (action: FileAction) => void;
  onClose: () => void;
};

/** Actions sheet for one file (⋮ button or long-press). */
export function FileActionsSheet({ visible, file, onSelect, onClose }: FileActionsSheetProps) {
  const { t } = useTranslation();
  const { palette } = useTheme();
  const picked = isContentPath(file.path);
  // Asked each time the sheet opens; until the answer arrives, rename and
  // delete stay hidden for picked documents.
  const [answer, setAnswer] = useState<{ uri: string; value: DocumentCapabilities } | null>(null);
  const capabilities = answer !== null && answer.uri === file.path ? answer.value : null;
  const { granted } = useAllFilesAccess();
  const myFilesRoot = useMemo(() => tryGetMyFilesRoot(), []);
  const actions = availableFileActions(file, {
    capabilities,
    sharedStorageWritable: canChangeSharedStorage(granted === true),
    myFilesRoot,
  });

  useEffect(() => {
    if (!visible || !picked) return undefined;
    let live = true;
    void documentCapabilities(file.path).then((value) => {
      if (live) setAnswer({ uri: file.path, value });
    });
    return () => {
      live = false;
    };
  }, [visible, picked, file.path]);

  const icons: Record<FileAction, ReactNode> = {
    favorite: file.isFavorite ? (
      <StarIcon color={palette.primary} />
    ) : (
      <StarOutlineIcon color={palette.foreground} />
    ),
    rename: <RenameIcon color={palette.foreground} />,
    move: <MoveIcon color={palette.foreground} />,
    copyToMyFiles: <CopyIcon color={palette.foreground} />,
    duplicate: <CopyIcon color={palette.foreground} />,
    details: <InfoIcon color={palette.foreground} />,
    share: <ShareIcon color={palette.foreground} />,
    print: <PrintIcon color={palette.foreground} />,
    delete: <DeleteIcon color={palette.danger} />,
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} title={file.name} testID="file-actions-sheet">
      {actions.map((action) => (
        <ListItem
          key={action}
          testID={`file-action-${action}`}
          title={
            action === 'favorite'
              ? t(file.isFavorite ? 'fileActions.unfavorite' : 'fileActions.favorite')
              : t(FILE_ACTION_LABEL[action])
          }
          leading={icons[action]}
          onPress={() => onSelect(action)}
        />
      ))}
    </BottomSheet>
  );
}

type FolderActionsSheetProps = {
  visible: boolean;
  folder: FolderEntry;
  onSelect: (action: FolderAction) => void;
  onClose: () => void;
};

/** Actions sheet for a My Files folder: Rename, Delete. */
export function FolderActionsSheet({
  visible,
  folder,
  onSelect,
  onClose,
}: FolderActionsSheetProps) {
  const { t } = useTranslation();
  const { palette } = useTheme();
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={folder.name}
      testID="folder-actions-sheet"
    >
      <ListItem
        testID="folder-action-rename"
        title={t('fileActions.rename')}
        leading={<RenameIcon color={palette.foreground} />}
        onPress={() => onSelect('rename')}
      />
      <ListItem
        testID="folder-action-delete"
        title={t('fileActions.delete')}
        leading={<DeleteIcon color={palette.danger} />}
        onPress={() => onSelect('delete')}
      />
    </BottomSheet>
  );
}
