import { act, renderHook } from '@testing-library/react-native';
import { Keyboard, type KeyboardEvent } from 'react-native';

import {
  keyboardOverlap,
  useKeyboardOverlap,
  type MeasureInWindow,
} from '@/features/reader/useKeyboardOverlap';

type Listener = (event: KeyboardEvent) => void;

let listeners: Map<string, Listener>;

beforeEach(() => {
  listeners = new Map();
  jest.spyOn(Keyboard, 'addListener').mockImplementation((name, listener) => {
    listeners.set(name, listener as Listener);
    return {
      remove: () => listeners.delete(name),
    } as unknown as ReturnType<typeof Keyboard.addListener>;
  });
});

afterEach(() => jest.restoreAllMocks());

function keyboardEvent(screenY: number, height: number): KeyboardEvent {
  return {
    duration: 0,
    easing: 'keyboard',
    endCoordinates: { screenX: 0, screenY, width: 400, height },
  } as KeyboardEvent;
}

// A view from y = 80 to y = 760 in the window (an edge-to-edge 800dp screen
// with the top bar above and the navigation bar below).
const measure: MeasureInWindow = (callback) => callback(0, 80, 400, 680);

describe('keyboardOverlap', () => {
  it('is the part of the view below the keyboard top, never negative', () => {
    expect(keyboardOverlap(760, 500)).toBe(260);
    expect(keyboardOverlap(480, 500)).toBe(0);
  });
});

describe('useKeyboardOverlap', () => {
  it('makes room for a keyboard over the view and none once it hides', async () => {
    const { result } = await renderHook(() => useKeyboardOverlap(measure));
    expect(result.current).toBe(0);

    await act(async () => listeners.get('keyboardDidShow')?.(keyboardEvent(500, 300)));
    expect(result.current).toBe(260);

    // A taller panel (e.g. emoji) re-emits keyboardDidShow.
    await act(async () => listeners.get('keyboardDidShow')?.(keyboardEvent(420, 380)));
    expect(result.current).toBe(340);

    await act(async () => listeners.get('keyboardDidHide')?.(keyboardEvent(800, 0)));
    expect(result.current).toBe(0);
  });

  it('adds nothing when the window already shrank above the keyboard', async () => {
    const resized: MeasureInWindow = (callback) => callback(0, 80, 400, 400);
    const { result } = await renderHook(() => useKeyboardOverlap(resized));
    await act(async () => listeners.get('keyboardDidShow')?.(keyboardEvent(500, 300)));
    expect(result.current).toBe(0);
  });

  it('stops listening when unmounted', async () => {
    const { unmount } = await renderHook(() => useKeyboardOverlap(measure));
    expect(listeners.size).toBe(2);
    await unmount();
    expect(listeners.size).toBe(0);
  });
});
