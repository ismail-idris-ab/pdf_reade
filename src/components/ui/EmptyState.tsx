import type { ReactNode } from 'react';
import { Text, View } from 'react-native';

import { Button } from './Button';

export type EmptyStateProps = {
  icon?: ReactNode;
  title: string;
  message?: string;
  action?: { label: string; onPress: () => void };
  testID?: string;
};

export function EmptyState({ icon, title, message, action, testID }: EmptyStateProps) {
  return (
    <View testID={testID} className="flex-1 items-center justify-center gap-3 px-8 py-12">
      {icon}
      <Text
        accessibilityRole="header"
        className="text-center text-lg font-semibold text-foreground"
      >
        {title}
      </Text>
      {message ? <Text className="text-center text-base text-muted">{message}</Text> : null}
      {action ? (
        <View className="mt-2">
          <Button label={action.label} onPress={action.onPress} />
        </View>
      ) : null}
    </View>
  );
}
