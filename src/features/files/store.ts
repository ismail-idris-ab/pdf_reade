import { create } from 'zustand';

import type { LibraryFile } from '@/db/repositories';
import type { FolderEntry } from '@/lib/files';

/** What the actions sheet was opened for. */
export type ActionTarget =
  { kind: 'file'; file: LibraryFile } | { kind: 'folder'; folder: FolderEntry };

/** The overlay currently shown for the target. */
export type ActionOverlay = 'actions' | 'rename' | 'move' | 'details' | 'delete';

type FileActionsState = {
  target: ActionTarget | null;
  overlay: ActionOverlay | null;
};

/** Session-only state of the file actions UI (FileActionsHost renders it). */
export const useFileActionsStore = create<FileActionsState>()(() => ({
  target: null,
  overlay: null,
}));

/** Opens the actions sheet for a file or a My Files folder. */
export function openFileActions(target: ActionTarget): void {
  useFileActionsStore.setState({ target, overlay: 'actions' });
}

/** Switches the open target to another overlay (rename, move, …). */
export function showActionOverlay(overlay: ActionOverlay): void {
  useFileActionsStore.setState({ overlay });
}

/** Closes whatever overlay is open; the target is kept until the next open. */
export function closeFileActions(): void {
  useFileActionsStore.setState({ overlay: null });
}

type MyFilesState = {
  /** Folder shown when the My Files chip is selected; null for the root. */
  dir: string | null;
  setDir: (dir: string | null) => void;
};

/** The My Files folder being browsed (session only: every launch starts at the root). */
export const useMyFilesStore = create<MyFilesState>()((set) => ({
  dir: null,
  setDir: (dir) => set({ dir }),
}));
