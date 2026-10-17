import { memo, useEffect, useMemo, useState, type ReactNode } from 'react';
import { BackHandler, Pressable, Text, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import { CopyIcon, ShareIcon } from '@/components/icons';
import { useTranslation } from '@/i18n';
import { useTheme } from '@/theme';
import { textSelectionColors } from '@/theme/palette';

import { INDICATOR_HEIGHT, TOP_BAR_HEIGHT } from '../chrome';
import type { ViewPoint, ViewSize } from '../overlayGeometry';
import {
  actionBarPosition,
  boundsOf,
  handleGeometry,
  selectionViewRects,
  type SelectionHandle,
  type TextSelection,
} from '../selection';
import type { SelectionController } from '../selectionController';
import { useReaderStore, useReaderStoreApi } from '../store';
import { THUMB_STRIP_HEIGHT } from './ThumbnailStrip';

/** The drawn handle (a teardrop), dp. */
export const HANDLE_SIZE = 22;
/** The handle's touch target, dp (at least 44). */
export const HANDLE_TOUCH_SIZE = 48;
/** The bar's size before its first layout, dp. */
const ESTIMATED_BAR: ViewSize = { width: 220, height: 48 };

export type SelectionLayerProps = {
  controller: SelectionController;
  /** The page area, dp. */
  area: ViewSize;
  insets: { top: number; bottom: number };
};

/**
 * The selection's handles and its Copy / Share bar (T2.8), in a layer over
 * the page area (not inside the scrolling pages, so dragging a handle never
 * scrolls or zooms the page). Positions come from where the page was when
 * the selection was made; any scroll or zoom clears the selection first.
 * Android back clears the selection before anything else.
 */
export const SelectionLayer = memo(function SelectionLayer({
  controller,
  area,
  insets,
}: SelectionLayerProps) {
  const selection = useReaderStore((state) => state.selection);
  const chromeVisible = useReaderStore((state) => state.chromeVisible);
  const hasSelection = selection !== null;

  useEffect(() => {
    if (!hasSelection) return undefined;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      controller.clear();
      return true;
    });
    return () => subscription.remove();
  }, [hasSelection, controller]);

  if (selection === null) return null;
  const top = chromeVisible ? insets.top + TOP_BAR_HEIGHT : insets.top;
  const bottom = chromeVisible
    ? insets.bottom + INDICATOR_HEIGHT + THUMB_STRIP_HEIGHT
    : insets.bottom;

  return (
    <View
      testID="selection-layer"
      pointerEvents="box-none"
      className="absolute bottom-0 left-0 right-0 top-0"
    >
      <Handle handle="anchor" selection={selection} controller={controller} />
      <Handle handle="focus" selection={selection} controller={controller} />
      <ActionBar
        selection={selection}
        controller={controller}
        area={area}
        top={top}
        bottom={bottom}
      />
    </View>
  );
});

type HandleProps = {
  handle: SelectionHandle;
  selection: TextSelection;
  controller: SelectionController;
};

/**
 * One draggable end of the selection: a teardrop hanging below the line,
 * pointing at the start (left) or end (right) of the selected text, in a
 * 48 dp touch target. Hidden from screen readers (they use the action bar).
 */
function Handle({ handle, selection, controller }: HandleProps) {
  const { theme } = useTheme();
  const store = useReaderStoreApi();
  const geometry = handleGeometry(selection, handle);

  // Drags follow the finger's travel from where it started, applied to the
  // centre of the handle's character, so the finger can sit below the line.
  const gesture = useMemo(() => {
    const drag: { start: { x: number; y: number; centre: ViewPoint } | null } = { start: null };
    return Gesture.Pan()
      .withTestId(`selection-handle-${handle}`)
      .runOnJS(true)
      .minDistance(0)
      .onStart((event) => {
        const current = store.getState().selection;
        const at = current ? handleGeometry(current, handle) : null;
        drag.start = at ? { x: event.absoluteX, y: event.absoluteY, centre: at.centre } : null;
      })
      .onUpdate((event) => {
        const { start } = drag;
        if (start === null) return;
        controller.dragHandle(handle, {
          x: start.centre.x + event.absoluteX - start.x,
          y: start.centre.y + event.absoluteY - start.y,
        });
      })
      .onFinalize(() => {
        drag.start = null;
      });
  }, [handle, controller, store]);

  if (geometry === null) return null;
  const tipX = selection.origin.x + geometry.tip.x;
  const tipY = selection.origin.y + geometry.tip.y;
  // The teardrop's point touches the text: its top-right corner for the
  // start handle, its top-left corner for the end handle.
  const dropLeft = geometry.isStart ? tipX - HANDLE_SIZE : tipX;
  const inset = (HANDLE_TOUCH_SIZE - HANDLE_SIZE) / 2;

  return (
    <GestureDetector gesture={gesture}>
      <View
        testID={`selection-handle-${geometry.isStart ? 'start' : 'end'}`}
        accessible={false}
        importantForAccessibility="no-hide-descendants"
        collapsable={false}
        className="absolute items-center justify-center"
        style={{
          left: dropLeft - inset,
          top: tipY - inset,
          width: HANDLE_TOUCH_SIZE,
          height: HANDLE_TOUCH_SIZE,
        }}
      >
        <View
          className={`rounded-full ${geometry.isStart ? 'rounded-tr-none' : 'rounded-tl-none'}`}
          style={{
            width: HANDLE_SIZE,
            height: HANDLE_SIZE,
            backgroundColor: textSelectionColors[theme].handle,
          }}
        />
      </View>
    </GestureDetector>
  );
}

type ActionBarProps = {
  selection: TextSelection;
  controller: SelectionController;
  area: ViewSize;
  top: number;
  bottom: number;
};

/** Copy and Share, above the selection (below it when there is no room). */
function ActionBar({ selection, controller, area, top, bottom }: ActionBarProps) {
  const { t } = useTranslation();
  const { palette } = useTheme();
  const [bar, setBar] = useState<ViewSize>(ESTIMATED_BAR);
  const bounds = useMemo(() => boundsOf(selectionViewRects(selection)), [selection]);

  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setBar((previous) =>
      previous.width === width && previous.height === height ? previous : { width, height },
    );
  };

  if (bounds === null) return null;
  const position = actionBarPosition({
    selection: {
      x: selection.origin.x + bounds.x,
      y: selection.origin.y + bounds.y,
      width: bounds.width,
      height: bounds.height,
    },
    bar,
    area,
    top,
    bottom,
    handleSpace: HANDLE_SIZE + 4,
  });

  return (
    <View
      testID="selection-actions"
      accessibilityRole="toolbar"
      accessibilityLabel={t('reader.selection.actions')}
      onLayout={onLayout}
      className="absolute flex-row rounded-full border border-border bg-background px-1"
      style={{ left: position.x, top: position.y, elevation: 4 }}
    >
      <ActionButton
        testID="selection-copy"
        label={t('reader.selection.copy')}
        icon={<CopyIcon color={palette.foreground} size={20} />}
        onPress={() => void controller.copy()}
      />
      <ActionButton
        testID="selection-share"
        label={t('reader.selection.share')}
        icon={<ShareIcon color={palette.foreground} size={20} />}
        onPress={() => void controller.share()}
      />
    </View>
  );
}

function ActionButton({
  testID,
  label,
  icon,
  onPress,
}: {
  testID: string;
  label: string;
  icon: ReactNode;
  onPress: () => void;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      className="min-h-12 flex-row items-center gap-2 rounded-full px-4 active:bg-surface"
    >
      {icon}
      <Text className="text-base font-semibold text-foreground">{label}</Text>
    </Pressable>
  );
}
