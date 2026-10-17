import type { OutlineItem } from '@/lib/engine';

/** Outlines with at most this many entries open fully expanded. */
export const EXPAND_ALL_LIMIT = 50;

/** One visible line of the outline sheet. */
export type OutlineRow = {
  /** Path of child indices from the root, e.g. "0.2.1"; stable for a document. */
  id: string;
  title: string;
  page: number | null;
  depth: number;
  hasChildren: boolean;
  expanded: boolean;
};

function walk(
  items: readonly OutlineItem[],
  visit: (item: OutlineItem, id: string, depth: number) => boolean,
  prefix = '',
  depth = 0,
): void {
  items.forEach((item, index) => {
    const id = prefix === '' ? String(index) : `${prefix}.${index}`;
    if (visit(item, id, depth) && item.children.length > 0) {
      walk(item.children, visit, id, depth + 1);
    }
  });
}

/** Number of entries in the whole tree. */
export function countOutline(items: readonly OutlineItem[]): number {
  let count = 0;
  walk(items, () => {
    count += 1;
    return true;
  });
  return count;
}

/** The visible rows: every top-level entry, and the children of expanded entries. */
export function flattenOutline(
  items: readonly OutlineItem[],
  expanded: ReadonlySet<string>,
): OutlineRow[] {
  const rows: OutlineRow[] = [];
  walk(items, (item, id, depth) => {
    const open = expanded.has(id);
    rows.push({
      id,
      title: item.title,
      page: item.page,
      depth,
      hasChildren: item.children.length > 0,
      expanded: open,
    });
    return open;
  });
  return rows;
}

/**
 * The section the reader is in: the entry with the highest target page not
 * after `page` (the later, deeper entry on a tie). Null when every entry
 * starts after it or has no page.
 */
export function currentSectionId(items: readonly OutlineItem[], page: number): string | null {
  const best: { id: string | null; page: number } = { id: null, page: -1 };
  walk(items, (item, id) => {
    if (item.page !== null && item.page <= page && item.page >= best.page) {
      best.id = id;
      best.page = item.page;
    }
    return true;
  });
  return best.id;
}

/** Ids of the entries containing `id`, outermost first. */
export function ancestorIds(id: string): string[] {
  const parts = id.split('.');
  return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join('.'));
}

/**
 * Entries expanded when the sheet first opens: all of a short outline;
 * for a long one only the path to the current section, so it is visible.
 */
export function initialExpanded(
  items: readonly OutlineItem[],
  currentId: string | null,
): Set<string> {
  if (countOutline(items) <= EXPAND_ALL_LIMIT) {
    const all = new Set<string>();
    walk(items, (item, id) => {
      if (item.children.length > 0) all.add(id);
      return true;
    });
    return all;
  }
  return new Set(currentId === null ? [] : ancestorIds(currentId));
}
