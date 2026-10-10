import { Linking, Platform } from 'react-native';
import { create } from 'zustand';

import { toast } from '@/components/ui';
import { i18n } from '@/i18n';
import { reportError } from '@/lib/crash';
import { toRecoveryLabel } from '@/lib/errors';
import { hasSharedWriteAccess, requestSharedWriteAccess } from '@/lib/files';

import { usesLegacyWritePermission } from './actions';

// Android 8–10 gate for file actions on shared storage (rename, move into My
// Files, duplicate, delete): those need the legacy storage write permission,
// asked for on first use after a short explanation. Android 11+ never prompts
// here: shared-storage actions show only with all-files access there.
//
// The gate runs before an operation is queued (exclusive()), never inside
// it, so a pending system prompt never holds up other library work.

/**
 * - granted: go ahead (also on Android 11+, where nothing is asked);
 * - denied: the user declined the system prompt (it can be asked again);
 * - blocked: declined with "don't ask again" (only Settings can grant it);
 * - cancelled: the user cancelled the explanation; nothing was asked.
 */
export type SharedWriteGateOutcome = 'granted' | 'denied' | 'blocked' | 'cancelled';

type ExplainerState = {
  /** Answers the explanation that is open now; null when none is. */
  resolve: ((proceed: boolean) => void) | null;
};

/** The explanation dialog's state (WriteAccessDialog renders it). */
export const useWriteAccessExplainerStore = create<ExplainerState>()(() => ({ resolve: null }));

/**
 * Shows the explanation dialog. Resolves true on Continue, false on Cancel
 * or dismissal. A newer explanation replaces (cancels) an open one.
 */
export function explainSharedWriteAccess(): Promise<boolean> {
  return new Promise((resolve) => {
    const previous = useWriteAccessExplainerStore.getState().resolve;
    useWriteAccessExplainerStore.setState({ resolve });
    previous?.(false);
  });
}

/** Answers the open explanation, if any (only the first answer counts). */
export function answerWriteAccessExplainer(proceed: boolean): void {
  const { resolve } = useWriteAccessExplainerStore.getState();
  if (resolve === null) return;
  useWriteAccessExplainerStore.setState({ resolve: null });
  resolve(proceed);
}

// A failed check counts as "not granted": the user is then asked, which is
// harmless when the permission is in fact held (the system answers at once).
function holdsSharedWriteAccess(): boolean {
  try {
    return hasSharedWriteAccess();
  } catch (error) {
    reportError(error);
    return false;
  }
}

/**
 * Makes sure a shared-storage write may run. Android 8–10 without the
 * permission: explains (`explain`), then shows the system prompt. Already
 * granted, or Android 11+: 'granted' at once, without asking anything.
 * Rejects with an AppError only if the system prompt cannot be shown.
 */
export async function ensureSharedWriteAccess(
  explain: () => Promise<boolean> = explainSharedWriteAccess,
  apiLevel: number | string = Platform.Version,
): Promise<SharedWriteGateOutcome> {
  if (!usesLegacyWritePermission(apiLevel)) return 'granted';
  if (holdsSharedWriteAccess()) return 'granted';
  if (!(await explain())) return 'cancelled';
  return requestSharedWriteAccess();
}

function openAppSettings(): void {
  Linking.openSettings().catch(reportError);
}

/**
 * Explains a refused storage permission (Android 8–10): 'denied' offers
 * "Try again" (`onRetry` re-runs the gate and then the action), 'blocked'
 * offers the app's Settings page, the only place left to grant it.
 */
export function showSharedWriteRefused(outcome: 'denied' | 'blocked', onRetry: () => void): void {
  if (outcome === 'blocked') {
    toast(i18n.t('fileActions.writeAccessBlocked'), {
      actionLabel: toRecoveryLabel('openSettings'),
      onAction: openAppSettings,
    });
    return;
  }
  toast(i18n.t('fileActions.writeAccessDenied'), {
    actionLabel: toRecoveryLabel('retry'),
    onAction: onRetry,
  });
}
