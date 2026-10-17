import { useCallback, useEffect, useState } from 'react';

import { reportError } from '@/lib/crash';
import { getOutline, type OutlineItem } from '@/lib/engine';
import { toAppError, type AppErrorCode } from '@/lib/errors';

export type OutlineLoad =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; items: OutlineItem[] }
  | { status: 'error'; code: AppErrorCode };

const IDLE: OutlineLoad = { status: 'idle' };
const LOADING: OutlineLoad = { status: 'loading' };

/**
 * The document's outline (table of contents), read once `enabled` turns
 * true (the reader shows its first page before this extra native call) and
 * again on `reload` after an error. A result that arrives after the reader
 * moved on is dropped.
 */
export function useOutline(
  docId: string,
  enabled: boolean,
): { outline: OutlineLoad; reload: () => void } {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; load: OutlineLoad } | null>(null);
  const key = `${docId}:${attempt}`;

  useEffect(() => {
    if (!enabled) return undefined;
    let active = true;
    getOutline(docId).then(
      (items) => {
        if (active) setResult({ key, load: { status: 'ready', items } });
      },
      (error: unknown) => {
        if (!active) return;
        const { code } = toAppError(error);
        if (code === 'UNKNOWN') reportError(error);
        setResult({ key, load: { status: 'error', code } });
      },
    );
    return () => {
      active = false;
    };
  }, [docId, enabled, key]);

  const reload = useCallback(() => setAttempt((value) => value + 1), []);
  const outline = !enabled ? IDLE : result?.key === key ? result.load : LOADING;
  return { outline, reload };
}
