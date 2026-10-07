import type { AppDatabase } from '../types';
import { createAnnotationDraftsRepository } from './annotationDrafts';
import { createBookmarksRepository } from './bookmarks';
import { createFilesRepository } from './files';
import { createReadingStateRepository } from './readingState';
import { createTrashRepository } from './trash';
import { createUsageRepository } from './usage';

export function createRepositories(db: AppDatabase) {
  return {
    files: createFilesRepository(db),
    bookmarks: createBookmarksRepository(db),
    readingState: createReadingStateRepository(db),
    trash: createTrashRepository(db),
    usage: createUsageRepository(db),
    annotationDrafts: createAnnotationDraftsRepository(db),
  };
}

export type Repositories = ReturnType<typeof createRepositories>;

export { toFtsQuery } from './files';
export { compareNames } from './files';
export type {
  GrantEntry,
  LibraryFile,
  LibraryQuery,
  LibrarySort,
  MergeContentResult,
  SortDir,
} from './files';
