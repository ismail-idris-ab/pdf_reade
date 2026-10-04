import { useEffect } from 'react';
import { AccessibilityInfo, Pressable, Text, View } from 'react-native';
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { create } from 'zustand';

export type ToastOptions = {
  actionLabel?: string;
  onAction?: () => void;
  /** Milliseconds; defaults to 4s, or 6s when there is an action. */
  duration?: number;
};

type Toast = ToastOptions & { id: number; message: string };

type ToastState = {
  current: Toast | null;
  show: (message: string, options?: ToastOptions) => void;
  dismiss: (id?: number) => void;
};

let nextId = 1;

/** One toast at a time; a new toast replaces the current one. */
export const useToastStore = create<ToastState>()((set, get) => ({
  current: null,
  show: (message, options = {}) => set({ current: { id: nextId++, message, ...options } }),
  dismiss: (id) => {
    if (id === undefined || get().current?.id === id) set({ current: null });
  },
}));

/** Show a toast from anywhere: `toast('Saved')`. */
export function toast(message: string, options?: ToastOptions): void {
  useToastStore.getState().show(message, options);
}

/**
 * Renders the current toast; mount once near the root, above screens.
 * Toasts render in the main window, so they are hidden behind an open
 * BottomSheet, Dialog or ProgressSheet: close the overlay before toasting.
 */
export function ToastHost() {
  const current = useToastStore((state) => state.current);
  const dismiss = useToastStore((state) => state.dismiss);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (!current) return;
    // Live regions on newly mounted views are announced unreliably on
    // Android, so announce explicitly.
    AccessibilityInfo.announceForAccessibility(current.message);

    const base = current.duration ?? (current.actionLabel ? 6000 : 4000);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    // Honours Android's "time to take action" accessibility setting, so
    // screen-reader users can reach the action before the toast closes.
    void Promise.resolve(AccessibilityInfo.getRecommendedTimeoutMillis(base))
      .catch(() => base)
      .then((recommended) => {
        const duration = typeof recommended === 'number' && recommended > 0 ? recommended : base;
        if (!cancelled) timer = setTimeout(() => dismiss(current.id), duration);
      });
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [current, dismiss]);

  if (!current) return null;

  return (
    <View
      pointerEvents="box-none"
      className="absolute inset-x-0 bottom-0 px-4"
      style={{ paddingBottom: insets.bottom + 16 }}
    >
      <Animated.View
        key={current.id}
        entering={FadeInDown.duration(150)}
        exiting={FadeOutDown.duration(150)}
        accessibilityLiveRegion="polite"
        accessibilityRole="alert"
        className="min-h-12 flex-row items-center gap-3 rounded-xl bg-foreground px-4 py-2"
      >
        <Text className="flex-1 text-base text-background">{current.message}</Text>
        {current.actionLabel ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              current.onAction?.();
              dismiss(current.id);
            }}
            className="min-h-12 min-w-12 items-center justify-center px-2"
          >
            <Text className="text-base font-semibold text-background">{current.actionLabel}</Text>
          </Pressable>
        ) : null}
      </Animated.View>
    </View>
  );
}
