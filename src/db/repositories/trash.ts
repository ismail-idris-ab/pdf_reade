import { desc, eq, lt } from 'drizzle-orm';

import { trash } from '../schema';
import type { AppDatabase, NewTrash, TrashRow } from '../types';

export function createTrashRepository(db: AppDatabase) {
  return {
    add(entry: NewTrash): TrashRow {
      return db.insert(trash).values(entry).returning().get();
    },

    get(id: number): TrashRow | undefined {
      return db.select().from(trash).where(eq(trash.id, id)).get();
    },

    /** Most recently deleted first. */
    list(): TrashRow[] {
      return db.select().from(trash).orderBy(desc(trash.deletedAt), desc(trash.id)).all();
    },

    /** Entries deleted before the cutoff, for the 30-day auto-purge. */
    listDeletedBefore(cutoff: number): TrashRow[] {
      return db.select().from(trash).where(lt(trash.deletedAt, cutoff)).all();
    },

    remove(id: number): void {
      db.delete(trash).where(eq(trash.id, id)).run();
    },
  };
}

export type TrashRepository = ReturnType<typeof createTrashRepository>;
