import type { LibraryFile } from '@/db/repositories';

/** The list columns of any files row (search, Recent and Favorites return full rows). */
export function toLibraryFile(row: LibraryFile): LibraryFile {
  return {
    id: row.id,
    path: row.path,
    name: row.name,
    ext: row.ext,
    size: row.size,
    mtime: row.mtime,
    isFavorite: row.isFavorite,
    lastOpenedAt: row.lastOpenedAt,
    source: row.source,
  };
}

function sameFile(a: LibraryFile, b: LibraryFile): boolean {
  return (
    a.id === b.id &&
    a.path === b.path &&
    a.name === b.name &&
    a.ext === b.ext &&
    a.size === b.size &&
    a.mtime === b.mtime &&
    a.isFavorite === b.isFavorite &&
    a.lastOpenedAt === b.lastOpenedAt &&
    a.source === b.source
  );
}

/**
 * `next`, with every unchanged file replaced by its object from `previous`
 * (so memoised rows skip re-rendering), and `previous` itself returned when
 * nothing changed at all, order included (so the list does not re-render).
 */
export function reconcileFiles(
  previous: readonly LibraryFile[],
  next: readonly LibraryFile[],
): readonly LibraryFile[] {
  if (previous.length === 0 && next.length === 0) return previous;
  const byId = new Map(previous.map((file) => [file.id, file]));
  let identical = previous.length === next.length;
  const merged = next.map((file, index) => {
    const old = byId.get(file.id);
    const kept = old !== undefined && sameFile(old, file) ? old : file;
    if (identical && kept !== previous[index]) identical = false;
    return kept;
  });
  return identical ? previous : merged;
}
