import type { PageText } from './selection';

/**
 * Pages whose text and boxes stay cached per reader: each character costs
 * about 32 bytes of boxes (four numbers) plus the string itself.
 */
export const TEXT_RECTS_CACHE_PAGES = 4;

export type TextRectsCache = {
  /** The page's text and boxes: from the cache, a load already running, or a new load. */
  get: (page: number) => Promise<PageText>;
  /** Pages cached now, least recently used first. */
  pages: () => number[];
  clear: () => void;
};

/**
 * getTextRects results for the last few pages a selection was made on, least
 * recently used evicted first. Concurrent requests for one page share a
 * load; a failed load is not kept, so the next request tries again.
 */
export function createTextRectsCache(
  load: (page: number) => Promise<PageText>,
  capacity = TEXT_RECTS_CACHE_PAGES,
): TextRectsCache {
  const entries = new Map<number, Promise<PageText>>();

  return {
    get: (page) => {
      const cached = entries.get(page);
      if (cached) {
        // Most recently used now.
        entries.delete(page);
        entries.set(page, cached);
        return cached;
      }
      const loading = load(page);
      entries.set(page, loading);
      while (entries.size > capacity) {
        const oldest = entries.keys().next();
        if (oldest.done) break;
        entries.delete(oldest.value);
      }
      loading.catch(() => {
        if (entries.get(page) === loading) entries.delete(page);
      });
      return loading;
    },
    pages: () => [...entries.keys()],
    clear: () => entries.clear(),
  };
}
