import type { IncomingIntent } from '../../../modules/file-index/src/FileIndexModule';
import type { Repositories } from '@/db/repositories';

import { showErrorToast } from '@/components/errorToast';
import { i18n } from '@/i18n';

import { processIncomingIntent } from './processIncomingIntent';
import type { IntentRouteTarget } from './types';

/**
 * Processes a VIEW/SEND hand-off (cold or warm start) and reports a failure
 * as a toast with its recovery (NOT_FOUND, PERMISSION_DENIED, NO_SPACE,
 * CANCELLED, UNSUPPORTED — see showErrorToast), returning null instead of
 * throwing so the caller just does nothing further on failure.
 */
export async function handleIncomingIntent(
  repos: Repositories,
  intent: IncomingIntent,
): Promise<IntentRouteTarget | null> {
  try {
    return await processIncomingIntent(repos, intent, {
      now: Date.now,
      fallbackName: i18n.t('library.untitled'),
    });
  } catch (error) {
    showErrorToast(error);
    return null;
  }
}
