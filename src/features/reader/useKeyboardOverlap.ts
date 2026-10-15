import { useEffect, useState } from 'react';
import { Keyboard } from 'react-native';

/** Measures a view in window coordinates: callback(x, y, width, height). */
export type MeasureInWindow = (
  callback: (x: number, y: number, width: number, height: number) => void,
) => void;

/**
 * How much of a view the keyboard covers, dp: the view's bottom edge minus
 * the keyboard's top edge, never negative.
 */
export function keyboardOverlap(viewBottom: number, keyboardTop: number): number {
  return Math.max(0, Math.round(viewBottom - keyboardTop));
}

/**
 * How many dp at the bottom of a view the on-screen keyboard covers; 0 while
 * it is hidden. The app draws edge to edge (Android 15+), where the window no
 * longer shrinks for the keyboard (adjustResize), so a form must make room
 * itself. The view is measured against the keyboard's top edge (`screenY` of
 * the keyboard events, the bottom of the visible display frame on Android):
 * when the window did shrink, the view already ends above the keyboard and the
 * overlap is 0, so the room is never added twice.
 *
 * `measure` must measure a view whose frame does not change with the room
 * added (pad inside it, not around it).
 */
export function useKeyboardOverlap(measure: MeasureInWindow): number {
  const [overlap, setOverlap] = useState(0);

  useEffect(() => {
    let active = true;
    const show = Keyboard.addListener('keyboardDidShow', (event) => {
      const keyboardTop = event.endCoordinates.screenY;
      measure((_x, y, _width, height) => {
        if (active) setOverlap(keyboardOverlap(y + height, keyboardTop));
      });
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => setOverlap(0));
    return () => {
      active = false;
      show.remove();
      hide.remove();
    };
  }, [measure]);

  return overlap;
}
