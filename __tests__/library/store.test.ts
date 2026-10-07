import Storage from 'expo-sqlite/kv-store';

type MockStorage = { clearSync: () => boolean };

function loadStore() {
  let store!: typeof import('@/features/library/store');
  jest.isolateModules(() => {
    store = jest.requireActual<typeof import('@/features/library/store')>(
      '@/features/library/store',
    );
  });
  return store.useLibraryPrefsStore;
}

const saved = () => JSON.parse(Storage.getItemSync('library-prefs') ?? '{}') as { state?: object };

describe('library prefs store', () => {
  beforeEach(() => {
    (Storage as unknown as MockStorage).clearSync();
  });

  it('defaults to a list of everything, newest first', () => {
    expect(loadStore().getState()).toMatchObject({
      view: 'list',
      sort: 'date',
      sortDir: 'desc',
      tab: 'all',
      chip: 'all',
    });
  });

  it('saves view, sort, direction, tab and chip synchronously', () => {
    const store = loadStore();
    store.getState().setView('grid');
    store.getState().setSort('name');
    store.getState().setTab('pdf');
    store.getState().setChip('whatsapp');
    expect(saved().state).toEqual({
      view: 'grid',
      sort: 'name',
      sortDir: 'asc',
      tab: 'pdf',
      chip: 'whatsapp',
    });
    store.getState().setSortDir('desc');
    expect(saved().state).toMatchObject({ sortDir: 'desc' });
  });

  it('picks each sort field’s natural direction', () => {
    const store = loadStore();
    store.getState().setSort('name');
    expect(store.getState().sortDir).toBe('asc');
    store.getState().setSort('size');
    expect(store.getState().sortDir).toBe('desc');
    store.getState().setSort('date');
    expect(store.getState().sortDir).toBe('desc');
  });

  it('restores saved prefs on the first read', () => {
    Storage.setItemSync(
      'library-prefs',
      JSON.stringify({
        state: { view: 'grid', sort: 'size', sortDir: 'asc', tab: 'excel', chip: 'myfiles' },
        version: 1,
      }),
    );
    expect(loadStore().getState()).toMatchObject({
      view: 'grid',
      sort: 'size',
      sortDir: 'asc',
      tab: 'excel',
      chip: 'myfiles',
    });
  });

  it('falls back field by field for unknown stored values', () => {
    Storage.setItemSync(
      'library-prefs',
      JSON.stringify({
        state: { view: 'cards', sort: 'name', sortDir: 'up', tab: 'video', chip: 'device' },
        version: 1,
      }),
    );
    expect(loadStore().getState()).toMatchObject({
      view: 'list',
      sort: 'name',
      sortDir: 'desc',
      tab: 'all',
      chip: 'all',
    });
  });

  it('never persists anything but the prefs', () => {
    loadStore().getState().setTab('word');
    expect(Object.keys(saved().state ?? {}).sort()).toEqual(
      ['chip', 'sort', 'sortDir', 'tab', 'view'].sort(),
    );
  });
});
