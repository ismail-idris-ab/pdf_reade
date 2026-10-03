import { and, eq, sql } from 'drizzle-orm';

import { usage } from '../schema';
import type { AppDatabase } from '../types';

export function createUsageRepository(db: AppDatabase) {
  return {
    /** Atomically adds `by` to the feature's count for the day; returns the new count. */
    increment(feature: string, day: string, by = 1): number {
      const row = db
        .insert(usage)
        .values({ feature, day, count: by })
        .onConflictDoUpdate({
          target: [usage.feature, usage.day],
          set: { count: sql`${usage.count} + ${by}` },
        })
        .returning({ count: usage.count })
        .get();
      return row.count;
    },

    /** Count for the feature on the day, 0 when nothing was recorded. */
    get(feature: string, day: string): number {
      const row = db
        .select({ count: usage.count })
        .from(usage)
        .where(and(eq(usage.feature, feature), eq(usage.day, day)))
        .get();
      return row?.count ?? 0;
    },
  };
}

export type UsageRepository = ReturnType<typeof createUsageRepository>;
