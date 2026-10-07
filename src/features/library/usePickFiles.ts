import { useCallback, useRef, useState } from 'react';

import { showErrorToast } from '@/components/errorToast';
import { toast } from '@/components/ui';
import { getRepositories } from '@/db/client';
import { useTranslation } from '@/i18n';
import { pickIntoLibrary } from '@/lib/library/pickIntoLibrary';

/**
 * Opens the system picker and adds the chosen documents to the library
 * (works without all-files access). Cancelling does nothing; partial
 * results and errors are reported as toasts, with a retry where it helps.
 */
export function usePickFiles(): { pick: () => void; picking: boolean } {
  const { t } = useTranslation();
  const [picking, setPicking] = useState(false);
  // State updates are async; the ref blocks a double tap opening two pickers.
  const inFlight = useRef(false);

  const pick = useCallback(() => {
    const attempt = async (): Promise<void> => {
      if (inFlight.current) return;
      inFlight.current = true;
      setPicking(true);
      try {
        const result = await pickIntoLibrary(getRepositories(), {
          now: Date.now,
          fallbackName: t('library.untitled'),
        });
        if (result === null) return;
        if (result.notPersisted > 0) toast(t('library.cannotKeepAccess'));
        else if (result.evicted > 0) toast(t('library.evictedOldPicks', { count: result.evicted }));
      } catch (error) {
        showErrorToast(error, { onRetry: () => void attempt() });
      } finally {
        inFlight.current = false;
        setPicking(false);
      }
    };
    void attempt();
  }, [t]);

  return { pick, picking };
}
