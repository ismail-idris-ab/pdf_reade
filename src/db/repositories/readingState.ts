import { eq } from 'drizzle-orm';

import { readingState } from '../schema';
import type { AppDatabase, ReadingStateRow } from '../types';

export function createReadingStateRepository(db: AppDatabase) {
  return {
    get(fileId: number): ReadingStateRow | undefined {
      return db.select().from(readingState).where(eq(readingState.fileId, fileId)).get();
    },

    save(state: ReadingStateRow): void {
      const { fileId, ...rest } = state;
      db.insert(readingState)
        .values(state)
        .onConflictDoUpdate({ target: readingState.fileId, set: rest })
        .run();
    },
  };
}

export type ReadingStateRepository = ReturnType<typeof createReadingStateRepository>;
