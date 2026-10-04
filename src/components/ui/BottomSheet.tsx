import type { ReactNode } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import Animated, { SlideInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FullScreenModal } from './FullScreenModal';

export type BottomSheetProps = {
  visible: boolean;
  /** Called on backdrop tap and Android back when the sheet is dismissible. */
  onClose: () => void;
  title?: string;
  /** False for sheets that must not be closed by the user (e.g. progress). */
  dismissible?: boolean;
  children: ReactNode;
  testID?: string;
};

export function BottomSheet({
  visible,
  onClose,
  title,
  dismissible = true,
  children,
  testID,
}: BottomSheetProps) {
  const insets = useSafeAreaInsets();
  const close = dismissible ? onClose : () => undefined;

  return (
    <FullScreenModal visible={visible} onRequestClose={close} className="justify-end">
      {/* Not focusable: TalkBack users close the sheet with the back gesture. */}
      <Pressable
        testID={testID ? `${testID}-backdrop` : undefined}
        accessible={false}
        onPress={close}
        className="absolute inset-0 bg-overlay/50"
      />
      <Animated.View
        entering={SlideInDown.duration(200)}
        testID={testID}
        accessibilityViewIsModal
        className="max-h-[90%] rounded-t-3xl bg-background px-4 pt-3"
        style={{ paddingBottom: Math.max(insets.bottom, 16) }}
      >
        <View className="mb-2 h-1 w-10 self-center rounded-full bg-border" />
        {title ? (
          <Text accessibilityRole="header" className="mb-2 text-lg font-semibold text-foreground">
            {title}
          </Text>
        ) : null}
        {/* Long content (many actions, large font scale) scrolls inside the sheet. */}
        <ScrollView bounces={false} style={{ flexGrow: 0 }}>
          {children}
        </ScrollView>
      </Animated.View>
    </FullScreenModal>
  );
}
