import { ActivityIndicator, Text, View } from 'react-native';

import { useTheme } from '@/theme';

import { BottomSheet } from './BottomSheet';
import { Button } from './Button';

export type ProgressSheetProps = {
  visible: boolean;
  title: string;
  message?: string;
  /** 0..1; omit for indeterminate work. */
  progress?: number;
  cancelLabel: string;
  onCancel: () => void;
  /** Set once cancellation was requested, until the operation stops. */
  cancelling?: boolean;
  testID?: string;
};

/**
 * Long-running operation sheet. Not dismissible by backdrop or Android back:
 * the only way out is the explicit cancel button, so work is never abandoned
 * silently.
 */
export function ProgressSheet({
  visible,
  title,
  message,
  progress,
  cancelLabel,
  onCancel,
  cancelling = false,
  testID,
}: ProgressSheetProps) {
  const { palette } = useTheme();
  const percent =
    progress === undefined ? undefined : Math.round(Math.min(Math.max(progress, 0), 1) * 100);

  return (
    <BottomSheet
      visible={visible}
      onClose={onCancel}
      dismissible={false}
      title={title}
      testID={testID}
    >
      {message ? <Text className="mb-3 text-base text-muted">{message}</Text> : null}
      {percent === undefined ? (
        <View
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel={title}
          className="my-2"
        >
          <ActivityIndicator color={palette.primary} />
        </View>
      ) : (
        <View
          accessible
          accessibilityRole="progressbar"
          accessibilityValue={{ min: 0, max: 100, now: percent }}
          className="my-2 h-2 overflow-hidden rounded-full bg-border"
        >
          <View className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
        </View>
      )}
      <View className="mt-4">
        <Button label={cancelLabel} variant="secondary" onPress={onCancel} loading={cancelling} />
      </View>
    </BottomSheet>
  );
}
