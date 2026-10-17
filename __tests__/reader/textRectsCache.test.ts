import type { PageText } from '@/features/reader/selection';
import { createTextRectsCache } from '@/features/reader/textRectsCache';

const textOf = (page: number): PageText => ({ text: `page ${page}`, boxes: [], rotation: 0 });

describe('createTextRectsCache', () => {
  it('loads a page once and shares a load in flight', async () => {
    const load = jest.fn((page: number) => Promise.resolve(textOf(page)));
    const cache = createTextRectsCache(load, 3);
    const [a, b] = await Promise.all([cache.get(1), cache.get(1)]);
    await cache.get(1);
    expect(a).toBe(b);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('evicts the least recently used page beyond its capacity', async () => {
    const load = jest.fn((page: number) => Promise.resolve(textOf(page)));
    const cache = createTextRectsCache(load, 2);
    await cache.get(1);
    await cache.get(2);
    // Page 1 is used again, so page 2 is the oldest when page 3 arrives.
    await cache.get(1);
    await cache.get(3);
    expect(cache.pages()).toEqual([1, 3]);
    await cache.get(2);
    expect(load).toHaveBeenCalledTimes(4);
  });

  it('forgets a failed load so the next request tries again', async () => {
    const load = jest
      .fn<Promise<PageText>, [number]>()
      .mockRejectedValueOnce(new Error('read failed'))
      .mockResolvedValueOnce(textOf(1));
    const cache = createTextRectsCache(load);
    await expect(cache.get(1)).rejects.toThrow('read failed');
    expect(cache.pages()).toEqual([]);
    await expect(cache.get(1)).resolves.toEqual(textOf(1));
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('empties on clear', async () => {
    const cache = createTextRectsCache((page) => Promise.resolve(textOf(page)));
    await cache.get(1);
    cache.clear();
    expect(cache.pages()).toEqual([]);
  });
});
