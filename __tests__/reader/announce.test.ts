import { createThrottledAnnouncer } from '@/features/reader/announce';

describe('createThrottledAnnouncer', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('announces at most once per interval, the latest message winning', () => {
    const announce = jest.fn();
    const announcer = createThrottledAnnouncer(announce, 1000);
    announcer.say('1 result so far');
    announcer.say('2 results so far');
    announcer.say('3 results so far');
    expect(announce.mock.calls).toEqual([['1 result so far']]);
    jest.advanceTimersByTime(1000);
    expect(announce.mock.calls).toEqual([['1 result so far'], ['3 results so far']]);
  });

  it('announces a final message at once and drops the waiting one', () => {
    const announce = jest.fn();
    const announcer = createThrottledAnnouncer(announce, 1000);
    announcer.say('1 result so far');
    announcer.say('2 results so far');
    announcer.sayNow('5 results');
    jest.advanceTimersByTime(5000);
    expect(announce.mock.calls).toEqual([['1 result so far'], ['5 results']]);
  });

  it('does not repeat a progress message and stops when disposed', () => {
    const announce = jest.fn();
    const announcer = createThrottledAnnouncer(announce, 1000);
    announcer.sayNow('No results');
    jest.advanceTimersByTime(1000);
    announcer.say('No results');
    announcer.say('later');
    announcer.say('waiting');
    announcer.dispose();
    jest.advanceTimersByTime(5000);
    expect(announce.mock.calls).toEqual([['No results'], ['later']]);
  });
});

describe('createThrottledAnnouncer — final messages and new searches', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('always says a final message, even the same text again', () => {
    const announce = jest.fn();
    const announcer = createThrottledAnnouncer(announce, 1000);
    announcer.sayNow('Result 1 of 1');
    announcer.sayNow('Result 1 of 1');
    expect(announce.mock.calls).toEqual([['Result 1 of 1'], ['Result 1 of 1']]);
  });

  it('repeats a progress message once reset for a new search', () => {
    const announce = jest.fn();
    const announcer = createThrottledAnnouncer(announce, 1000);
    announcer.say('2 results so far');
    jest.advanceTimersByTime(1000);
    announcer.say('2 results so far');
    expect(announce).toHaveBeenCalledTimes(1);
    announcer.reset();
    announcer.say('2 results so far');
    expect(announce).toHaveBeenCalledTimes(2);
  });
});
