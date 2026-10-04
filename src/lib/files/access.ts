import { useCallback, useEffect } from 'react';
import { AppState } from 'react-native';
import { create } from 'zustand';

import FileIndexModule from '../../../modules/file-index/src/FileIndexModule';
import { reportError } from '@/lib/crash';
import { toAppError } from '@/lib/errors';

export type AllFilesAccessState = {
  /** Whether MANAGE_EXTERNAL_STORAGE is held; null until first checked. */
  granted: boolean | null;
  /** Re-reads the permission from the system and returns it. */
  refresh: () => boolean;
};

// A failed check is treated as "not granted": the app then stays in manual
// (picker) mode, which works fully without the permission.
function readGranted(): boolean {
  try {
    return FileIndexModule.hasAllFilesAccess();
  } catch (error) {
    reportError(toAppError(error));
    return false;
  }
}

/** App-wide all-files-access status; use `useAllFilesAccess()` in components. */
export const useAllFilesAccessStore = create<AllFilesAccessState>()((set) => ({
  granted: null,
  refresh: () => {
    const granted = readGranted();
    set({ granted });
    return granted;
  },
}));

export type AllFilesAccess = {
  granted: boolean | null;
  refresh: () => boolean;
  /**
   * Opens the system all-files-access screen, then re-checks. The user
   * usually grants it after this resolves; the re-check when the app becomes
   * active again picks that up. Rejects with an AppError if Settings can't open.
   */
  requestAccess: () => Promise<boolean>;
};

/**
 * All-files-access status. Checks on mount and again whenever the app
 * returns to the foreground (e.g. back from Settings).
 */
export function useAllFilesAccess(): AllFilesAccess {
  const granted = useAllFilesAccessStore((state) => state.granted);
  const refresh = useAllFilesAccessStore((state) => state.refresh);

  useEffect(() => {
    refresh();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    return () => subscription.remove();
  }, [refresh]);

  const requestAccess = useCallback(async () => {
    try {
      await FileIndexModule.openAllFilesAccessSettings();
    } catch (error) {
      throw toAppError(error);
    }
    return refresh();
  }, [refresh]);

  return { granted, refresh, requestAccess };
}
