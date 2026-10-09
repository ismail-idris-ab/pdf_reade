import { useCallback } from 'react';

import { toast } from '@/components/ui';
import { getRepositories } from '@/db/client';
import { i18n } from '@/i18n';
import { isErrorCode, toUserMessage } from '@/lib/errors';
import { DEFAULT_PICK_MIME_TYPES, pickDocuments } from '@/lib/files';

import { importIntoMyFiles, type ImportOutcome } from './actions';
import { showFileActionError } from './errors';
import { useInFlight } from './useInFlight';

/**
 * The toast text for an import: how many were added, or how many failed;
 * when every failure has the same shared error code, its explanation
 * (e.g. out of storage) follows.
 */
export function importSummary({ imported, failed }: ImportOutcome): string {
  if (failed.length === 0) return i18n.t('folders.imported', { count: imported.length });
  const total = imported.length + failed.length;
  const summary = i18n.t('folders.importFailed', { count: failed.length, total });
  const codes = new Set(failed.map((failure) => failure.code));
  const [code] = [...codes];
  if (codes.size === 1 && code !== undefined && isErrorCode(code)) {
    return `${summary} ${toUserMessage(code).message}`;
  }
  return summary;
}

/**
 * "Import" in My Files: opens the system picker, copies the chosen documents
 * into `destDir` and reports the result (per-item failures included) in a
 * toast. Double taps are ignored while an import runs.
 */
export function useImportToMyFiles(destDir: string | null): {
  importFiles: () => void;
  importing: boolean;
} {
  const { busy, run } = useInFlight();

  const importFiles = useCallback(() => {
    if (destDir === null) return;
    const attempt = () => {
      void run(async () => {
        try {
          const picked = await pickDocuments({
            mimeTypes: DEFAULT_PICK_MIME_TYPES,
            multiple: true,
            // The copies are stored by path: no lasting grant is needed.
            persist: false,
          });
          if (picked.length === 0) return;
          const outcome = await importIntoMyFiles(getRepositories(), picked, destDir);
          toast(importSummary(outcome));
        } catch (error) {
          showFileActionError(error, { onRetry: attempt });
        }
      });
    };
    attempt();
  }, [destDir, run]);

  return { importFiles, importing: busy };
}
