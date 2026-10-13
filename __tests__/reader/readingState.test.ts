import { createTestDatabase } from '../db/testDatabase';
import { createRepositories } from '@/db/repositories';
import type { ReadingStateRow } from '@/db/types';
import {
  createReadingStateSaver,
  restoreReadingState,
  SAVE_PAGE_DELAY_MS,
} from '@/features/reader/readingState';

describe('restoreReadingState', () => {
  it('starts at page 0, vertical, 1× when nothing is stored', () => {
    expect(restoreReadingState(undefined, 10)).toEqual({ page: 0, mode: 'vertical', zoom: 1 });
  });

  it('restores page, mode and zoom', () => {
    const row: ReadingStateRow = { fileId: 1, page: 4, mode: 'horizontal', zoom: 2.5 };
    expect(restoreReadingState(row, 10)).toEqual({ page: 4, mode: 'horizontal', zoom: 2.5 });
  });

  it('clamps a page beyond a document that got shorter', () => {
    const row: ReadingStateRow = { fileId: 1, page: 40, mode: 'vertical', zoom: 1 };
    expect(restoreReadingState(row, 10).page).toBe(9);
  });
});

describe('createReadingStateSaver', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  function setup(initial = { page: 2, mode: 'vertical' as const, zoom: 3 }) {
    const save = jest.fn<void, [ReadingStateRow]>();
    const onError = jest.fn<'stop' | 'continue', [unknown]>(() => 'continue');
    const saver = createReadingStateSaver({ fileId: 7, initial, save, onError });
    return { save, onError, saver };
  }

  it('saves the page once it settles, keeping the stored zoom', () => {
    const { save, saver } = setup();
    saver.setPage(3);
    saver.setPage(4);
    saver.setPage(5);
    jest.advanceTimersByTime(SAVE_PAGE_DELAY_MS - 1);
    expect(save).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({ fileId: 7, page: 5, mode: 'vertical', zoom: 3 });
  });

  it('ignores an unchanged page', () => {
    const { save, saver } = setup();
    saver.setPage(2);
    jest.runAllTimers();
    expect(save).not.toHaveBeenCalled();
  });

  it('saves a mode change at once, with the current page', () => {
    const { save, saver } = setup();
    saver.setPage(6);
    saver.setMode('horizontal');
    expect(save).toHaveBeenCalledWith({ fileId: 7, page: 6, mode: 'horizontal', zoom: 3 });
    // The pending page write was folded into the mode write.
    jest.runAllTimers();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('flushes a pending page (app to background) and does nothing when idle', () => {
    const { save, saver } = setup();
    saver.flush();
    expect(save).not.toHaveBeenCalled();
    saver.setPage(8);
    saver.flush();
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ page: 8 }));
    jest.runAllTimers();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('saves a pending page on dispose, then ignores everything', () => {
    const { save, saver } = setup();
    saver.setPage(9);
    saver.dispose();
    expect(save).toHaveBeenCalledTimes(1);
    saver.setPage(1);
    saver.setMode('horizontal');
    saver.flush();
    jest.runAllTimers();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('skips a write that would store what is already stored', () => {
    const { save, saver } = setup();
    saver.setPage(4);
    jest.runAllTimers();
    saver.setPage(5);
    saver.setPage(4);
    jest.runAllTimers();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('reports a failing save instead of throwing', () => {
    const { save, onError, saver } = setup();
    const failure = new Error('disk');
    save.mockImplementationOnce(() => {
      throw failure;
    });
    saver.setMode('horizontal');
    expect(onError).toHaveBeenCalledWith(failure);
    // 'continue': the next change is written again.
    saver.setPage(3);
    jest.runAllTimers();
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("stops for good, without retrying, when onError answers 'stop'", () => {
    const { save, onError, saver } = setup();
    save.mockImplementation(() => {
      throw new Error('FOREIGN KEY constraint failed');
    });
    onError.mockReturnValue('stop');
    saver.setPage(3);
    saver.setPage(4);
    jest.runAllTimers();
    saver.setMode('horizontal');
    saver.setPage(6);
    saver.flush();
    saver.dispose();
    jest.runAllTimers();
    expect(save).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('fails on a deleted (or merged-away) file row, so the caller can stop quietly', () => {
    const repos = createRepositories(createTestDatabase().db);
    const file = repos.files.upsert({
      path: 'content://provider/doc/1',
      uri: null,
      name: 'a.pdf',
      ext: 'pdf',
      mime: 'application/pdf',
      size: 1,
      mtime: 1,
      source: 'device',
    });
    const onError = jest.fn<'stop' | 'continue', [unknown]>(() =>
      repos.files.getById(file.id) ? 'continue' : 'stop',
    );
    const saver = createReadingStateSaver({
      fileId: file.id,
      initial: restoreReadingState(undefined, 10),
      save: (row) => repos.readingState.save(row),
      onError,
    });
    repos.files.remove(file.id);
    saver.setMode('horizontal');
    saver.setPage(5);
    saver.dispose();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.results[0]?.value).toBe('stop');
    expect(repos.readingState.get(file.id)).toBeUndefined();
  });

  it('writes a row the repository round-trips, zoom included', () => {
    const repos = createRepositories(createTestDatabase().db);
    const file = repos.files.upsert({
      path: '/storage/emulated/0/Download/a.pdf',
      uri: null,
      name: 'a.pdf',
      ext: 'pdf',
      mime: 'application/pdf',
      size: 1,
      mtime: 1,
      source: 'downloads',
    });
    repos.readingState.save({ fileId: file.id, page: 1, mode: 'vertical', zoom: 2 });
    const restored = restoreReadingState(repos.readingState.get(file.id), 20);
    const saver = createReadingStateSaver({
      fileId: file.id,
      initial: restored,
      save: (row) => repos.readingState.save(row),
      onError: () => 'continue',
    });
    saver.setPage(12);
    saver.setMode('horizontal');
    expect(repos.readingState.get(file.id)).toEqual({
      fileId: file.id,
      page: 12,
      mode: 'horizontal',
      zoom: 2,
    });
  });
});
