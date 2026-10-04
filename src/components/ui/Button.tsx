import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, Text } from 'react-native';

import { useTheme } from '@/theme';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export type ButtonProps = {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  /** Shows a spinner and blocks presses while an action runs. */
  loading?: boolean;
  icon?: ReactNode;
  accessibilityHint?: string;
  testID?: string;
};

const containerClass: Record<ButtonVariant, string> = {
  primary: 'bg-primary',
  secondary: 'border border-border bg-surface',
  ghost: 'bg-transparent',
  danger: 'bg-danger',
};

const labelClass: Record<ButtonVariant, string> = {
  primary: 'text-primary-foreground',
  secondary: 'text-foreground',
  ghost: 'text-primary',
  danger: 'text-danger-foreground',
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  icon,
  accessibilityHint,
  testID,
}: ButtonProps) {
  const { palette } = useTheme();
  const inactive = disabled || loading;
  const spinnerColor =
    variant === 'primary'
      ? palette['primary-foreground']
      : variant === 'danger'
        ? palette['danger-foreground']
        : palette.foreground;

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      onPress={onPress}
      // min-h-12 = 48dp, the minimum accessible touch target.
      className={`min-h-12 flex-row items-center justify-center gap-2 rounded-xl px-5 active:opacity-80 ${containerClass[variant]} ${disabled ? 'opacity-50' : ''}`}
    >
      {loading ? <ActivityIndicator color={spinnerColor} /> : icon}
      <Text className={`text-base font-semibold ${labelClass[variant]}`}>{label}</Text>
    </Pressable>
  );
}
