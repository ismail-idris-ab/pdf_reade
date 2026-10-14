import type { DetailRenderedEvent } from '@/lib/engine';

type Stats = { count: number; totalSettleMs: number; maxSettleMs: number };

const stats: Stats = { count: 0, totalSettleMs: 0, maxSettleMs: 0 };

// When the page area last stopped moving (gesture committed, scroll or pan
// event); null before the first.
let settledAt: number | null = null;

/**
 * Dev builds only: notes that the page area just moved or a zoom was
 * committed. The last call before a tile arrives is the "settle" moment its
 * crispness is measured from.
 */
export function markMovement(now: number = Date.now()): void {
  if (!__DEV__) return;
  settledAt = now;
}

/**
 * Dev builds only: logs each detail tile with the time from the last
 * movement to the tile being on screen (the T2.4 target is a crisp page
 * within ~300 ms of a zoom settling; this includes the settle debounce, the
 * queue wait and the render), plus the native queue wait and render time,
 * and a running average and maximum. Does nothing in release builds.
 */
export function recordDetailRender(event: DetailRenderedEvent, now: number = Date.now()): void {
  if (!__DEV__) return;
  const sinceSettle = settledAt === null ? null : now - settledAt;
  if (sinceSettle !== null) {
    stats.count += 1;
    stats.totalSettleMs += sinceSettle;
    stats.maxSettleMs = Math.max(stats.maxSettleMs, sinceSettle);
  }
  const average = stats.count === 0 ? '–' : `${(stats.totalSettleMs / stats.count).toFixed(0)}`;
  console.info(
    `[reader] crisp p${event.page + 1} ${sinceSettle ?? '?'} ms after settle` +
      ` (wait ${event.waitMs} ms, render ${event.ms} ms, ${event.widthPx}x${event.heightPx}px;` +
      ` avg ${average} ms, max ${stats.maxSettleMs} ms, n=${stats.count})`,
  );
}

/** The aggregate so far (dev builds). */
export function detailRenderStats(): Readonly<Stats> {
  return { ...stats };
}

/** Clears the aggregate (tests). */
export function resetDetailRenderStats(): void {
  stats.count = 0;
  stats.totalSettleMs = 0;
  stats.maxSettleMs = 0;
  settledAt = null;
}
