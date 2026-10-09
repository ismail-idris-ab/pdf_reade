import { useCallback, useRef, useState } from 'react';

/**
 * Runs one task at a time: while a task is in flight, further calls are
 * ignored (resolve with undefined). Guards actions against double taps;
 * the ref blocks synchronously, before any state update lands.
 */
export function createInFlightGuard() {
  let busy = false;
  return {
    get busy() {
      return busy;
    },
    async run<T>(task: () => Promise<T>): Promise<T | undefined> {
      if (busy) return undefined;
      busy = true;
      try {
        return await task();
      } finally {
        busy = false;
      }
    },
  };
}

/** Hook form of createInFlightGuard, with `busy` as state for spinners. */
export function useInFlight(): {
  busy: boolean;
  run: <T>(task: () => Promise<T>) => Promise<T | undefined>;
} {
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const run = useCallback(async <T>(task: () => Promise<T>): Promise<T | undefined> => {
    if (inFlight.current) return undefined;
    inFlight.current = true;
    setBusy(true);
    try {
      return await task();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, []);
  return { busy, run };
}
