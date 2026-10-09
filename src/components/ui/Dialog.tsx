import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';

import { Button, type ButtonVariant } from './Button';
import { FullScreenModal } from './FullScreenModal';

export type DialogAction = {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  /** Shows a spinner and blocks presses while the action runs. */
  loading?: boolean;
  testID?: string;
};

export type DialogProps = {
  visible: boolean;
  title: string;
  message?: string;
  /** Rendered in order, aligned to the end; put the safe choice first. */
  actions: DialogAction[];
  /** Backdrop tap and Android back. */
  onDismiss: () => void;
  /** Extra content between the message and the actions (e.g. a text field). */
  children?: ReactNode;
  testID?: string;
};

export function Dialog({
  visible,
  title,
  message,
  actions,
  onDismiss,
  children,
  testID,
}: DialogProps) {
  return (
    <FullScreenModal
      visible={visible}
      onRequestClose={onDismiss}
      className="items-center justify-center px-6"
    >
      <Pressable
        onPress={onDismiss}
        accessible={false}
        className="absolute inset-0 bg-overlay/50"
      />
      <View
        testID={testID}
        accessibilityViewIsModal
        className="w-full max-w-md rounded-2xl bg-background p-5"
      >
        <Text accessibilityRole="header" className="text-lg font-semibold text-foreground">
          {title}
        </Text>
        {message ? <Text className="mt-2 text-base text-muted">{message}</Text> : null}
        {children}
        <View className="mt-5 flex-row flex-wrap justify-end gap-2">
          {actions.map((action, index) => (
            <Button
              // Index key: translated labels may collide.
              key={index}
              testID={action.testID}
              label={action.label}
              variant={action.variant ?? 'ghost'}
              disabled={action.disabled}
              loading={action.loading}
              onPress={action.onPress}
            />
          ))}
        </View>
      </View>
    </FullScreenModal>
  );
}
