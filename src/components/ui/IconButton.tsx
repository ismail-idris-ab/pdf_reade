import type { ReactNode } from 'react';
import { Pressable } from 'react-native';

export type IconButtonProps = {
  icon: ReactNode;
  /** Required: icon-only controls have no visible text for screen readers. */
  accessibilityLabel: string;
  onPress: () => void;
  disabled?: boolean;
  testID?: string;
};

export function IconButton({
  icon,
  accessibilityLabel,
  onPress,
  disabled = false,
  testID,
}: IconButtonProps) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      // h-12 w-12 = 48dp square touch target.
      className={`h-12 w-12 items-center justify-center rounded-full active:bg-surface ${disabled ? 'opacity-50' : ''}`}
    >
      {icon}
    </Pressable>
  );
}
