import { useEffect } from 'react';

import { getRepositories } from '@/db/client';
import { reportError } from '@/lib/crash';
import { useAllFilesAccess } from '@/lib/files';

import { indexLibrary, prunePickedDocuments } from './index';

/**
 * Keeps the library in step with storage once onboarding is done: drops
 * picked documents whose permission was lost, and runs a background scan
 * whenever all-files access is (or becomes) granted. Mount once, after
 * migrations have succeeded.
 *
 * Background runs have no screen to report to: expected outcomes (no
 * permission, cancelled) are results, and unexpected failures go to crash
 * reporting. The library keeps the rows it already has either way.
 */
export function useLibraryMaintenance(onboardingComplete: boolean): void {
  const { granted } = useAllFilesAccess();

  useEffect(() => {
    if (!onboardingComplete) return;
    try {
      prunePickedDocuments(getRepositories());
    } catch (error) {
      reportError(error);
    }
  }, [onboardingComplete]);

  useEffect(() => {
    if (!onboardingComplete || granted !== true) return;
    indexLibrary(getRepositories()).catch(reportError);
  }, [onboardingComplete, granted]);
}
