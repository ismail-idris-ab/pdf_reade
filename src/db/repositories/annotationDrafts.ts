import { eq } from 'drizzle-orm';

import { annotationDrafts } from '../schema';
import type { AnnotationDraftRow, AppDatabase } from '../types';

export function createAnnotationDraftsRepository(db: AppDatabase) {
  return {
    get(fileId: number): AnnotationDraftRow | undefined {
      return db.select().from(annotationDrafts).where(eq(annotationDrafts.fileId, fileId)).get();
    },

    save(fileId: number, json: string, updatedAt: number): void {
      db.insert(annotationDrafts)
        .values({ fileId, json, updatedAt })
        .onConflictDoUpdate({ target: annotationDrafts.fileId, set: { json, updatedAt } })
        .run();
    },

    remove(fileId: number): void {
      db.delete(annotationDrafts).where(eq(annotationDrafts.fileId, fileId)).run();
    },
  };
}

export type AnnotationDraftsRepository = ReturnType<typeof createAnnotationDraftsRepository>;
