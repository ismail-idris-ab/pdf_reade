import { act, renderHook } from '@testing-library/react-native';

import { getRepositories } from '@/db/client';
import type { LibraryFile } from '@/db/repositories';
import type { NewFile } from '@/db/types';
import type { LibraryFilters } from '@/features/library/filters';
import { reconcileFiles } from '@/features/library/reconcile';
import { readLibrary, useLibraryData, type LibraryData } from '@/features/library/useLibraryData';
import { bumpLibraryVersion } from '@/lib/library/version';

jest.mock('@/db/client', () => {
  const { createTestDatabase } =
    jest.requireActual<typeof import('../db/testDatabase')>('../db/testDatabase');
  const { createRepositories } =
    jest.requireActual<typeof import('@/db/repositories')>('@/db/repositories');
  const repositories = createRepositories(createTestDatabase().db);
  return { getRepositories: () => repositories, getDatabase: jest.fn() };
});

const file = (id: number, overrides: Partial<LibraryFile> = {}): LibraryFile => ({
  id,
  path: `/d/${id}.pdf`,
  name: `${id}.pdf`,
  ext: 'pdf',
  size: 10,
  mtime: 1,
  isFavorite: false,
  lastOpenedAt: null,
  source: 'downloads',
  ...overrides,
});

describe('reconcileFiles', () => {
  it('returns the previous array when nothing changed', () => {
    const previous = [file(1), file(2)];
    expect(reconcileFiles(previous, [file(1), file(2)])).toBe(previous);
  });

  it('reuses unchanged objects and replaces changed ones', () => {
    const previous = [file(1), file(2), file(3)];
    const next = reconcileFiles(previous, [file(1), file(2, { isFavorite: true }), file(4)]);
    expect(next).not.toBe(previous);
    expect(next[0]).toBe(previous[0]);
    expect(next[1]).toEqual(file(2, { isFavorite: true }));
    expect(next[1]).not.toBe(previous[1]);
    expect(next[2]).toEqual(file(4));
  });

  it('treats any list field as a change', () => {
    const base = file(1);
    for (const change of [
      { path: '/x.pdf' },
      { name: 'x.pdf' },
      { ext: 'docx' },
      { size: 11 },
      { mtime: 2 },
      { isFavorite: true },
      { lastOpenedAt: 5 },
      { source: 'whatsapp' as const },
    ]) {
      const [next] = reconcileFiles([base], [file(1, change)]);
      expect(next).not.toBe(base);
    }
  });

  it('a reorder keeps the objects but returns a new array', () => {
    const previous = [file(1), file(2)];
    const next = reconcileFiles(previous, [file(2), file(1)]);
    expect(next).not.toBe(previous);
    expect(next[0]).toBe(previous[1]);
    expect(next[1]).toBe(previous[0]);
  });
});

const row = (name: string, overrides: Partial<NewFile> = {}): NewFile => ({
  path: `/storage/emulated/0/Download/${name}`,
  uri: null,
  name,
  ext: 'pdf',
  mime: null,
  size: 10,
  mtime: 1,
  source: 'downloads',
  ...overrides,
});

const FILTERS: LibraryFilters = {
  tab: 'all',
  chip: 'all',
  sort: 'name',
  sortDir: 'asc',
  query: '',
};

const ready = (data: LibraryData) => {
  if (data.status !== 'ready') throw new Error('not ready');
  return data;
};

beforeEach(() => {
  for (const entry of getRepositories().files.listIndexEntries()) {
    getRepositories().files.remove(entry.id);
  }
});

afterEach(() => jest.restoreAllMocks());

describe('readLibrary', () => {
  it('keeps the whole result when a re-read finds no change', () => {
    getRepositories().files.upsertMany([row('a.pdf'), row('b.pdf')]);
    const first = readLibrary(FILTERS, 'en', null);
    expect(readLibrary(FILTERS, 'en', first)).toBe(first);
  });

  it('keeps unchanged rows when one file changed', () => {
    const [a, b] = getRepositories().files.upsertMany([row('a.pdf'), row('b.pdf')]);
    const first = ready(readLibrary(FILTERS, 'en', null));
    getRepositories().files.setFavorite(b?.id ?? 0, true);
    const second = ready(readLibrary(FILTERS, 'en', first));
    expect(second.items[0]).toBe(first.items[0]);
    expect(second.items[0]?.id).toBe(a?.id);
    expect(second.items[1]).not.toBe(first.items[1]);
    expect(second.favorites.map((f) => f.id)).toEqual([b?.id]);
  });
});

describe('useLibraryData', () => {
  // A controllable idle queue, installed as the runtime's requestIdleCallback.
  type IdleGlobals = {
    requestIdleCallback?: (task: () => void) => number;
    cancelIdleCallback?: (handle: number) => void;
  };
  const host = globalThis as IdleGlobals;
  let idle: Map<number, () => void>;

  beforeEach(() => {
    idle = new Map();
    let next = 0;
    host.requestIdleCallback = (task) => {
      next += 1;
      idle.set(next, task);
      return next;
    };
    host.cancelIdleCallback = (handle) => {
      idle.delete(handle);
    };
  });

  afterEach(() => {
    delete host.requestIdleCallback;
    delete host.cancelIdleCallback;
  });

  const runIdle = () =>
    act(async () => {
      const tasks = [...idle.values()];
      idle.clear();
      for (const task of tasks) task();
    });

  it('re-reads after a library change only once idle, not during render', async () => {
    getRepositories().files.upsertMany([row('a.pdf')]);
    const listLibrary = jest.spyOn(getRepositories().files, 'listLibrary');
    const { result } = await renderHook(() => useLibraryData(FILTERS, 'en'));
    expect(ready(result.current).items).toHaveLength(1);
    const reads = listLibrary.mock.calls.length;

    getRepositories().files.upsert(row('b.pdf'));
    await act(async () => bumpLibraryVersion());
    // The bump re-rendered without reading the database; the read is queued.
    expect(listLibrary.mock.calls.length).toBe(reads);
    expect(ready(result.current).items).toHaveLength(1);
    expect(idle.size).toBe(1);

    await runIdle();
    expect(ready(result.current).items).toHaveLength(2);
    expect(listLibrary.mock.calls.length).toBe(reads + 1);
  });

  it('coalesces several changes into one deferred read', async () => {
    const listLibrary = jest.spyOn(getRepositories().files, 'listLibrary');
    await renderHook(() => useLibraryData(FILTERS, 'en'));
    const reads = listLibrary.mock.calls.length;
    await act(async () => {
      bumpLibraryVersion();
      bumpLibraryVersion();
    });
    await act(async () => bumpLibraryVersion());
    await runIdle();
    expect(listLibrary.mock.calls.length).toBe(reads + 1);
  });

  it('keeps the same data object when a change did not affect the list', async () => {
    getRepositories().files.upsertMany([row('a.pdf')]);
    const { result } = await renderHook(() => useLibraryData(FILTERS, 'en'));
    const before = result.current;
    const listLibrary = jest.spyOn(getRepositories().files, 'listLibrary');
    await act(async () => bumpLibraryVersion());
    await runIdle();
    expect(listLibrary).toHaveBeenCalledTimes(1);
    expect(result.current).toBe(before);
  });

  it('applies filter changes in the same render', async () => {
    getRepositories().files.upsertMany([row('a.pdf'), row('b.docx', { ext: 'docx' })]);
    const { result, rerender } = await renderHook(
      ({ filters }: { filters: LibraryFilters }) => useLibraryData(filters, 'en'),
      { initialProps: { filters: FILTERS } },
    );
    expect(ready(result.current).items).toHaveLength(2);
    await rerender({ filters: { ...FILTERS, tab: 'word' } });
    expect(ready(result.current).items.map((f) => f.name)).toEqual(['b.docx']);
  });
});
