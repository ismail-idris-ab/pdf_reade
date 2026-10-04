import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';

export type ListItemProps = {
  title: string;
  subtitle?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  /**
   * Makes the row an option in a single-choice list: announced by TalkBack as
   * a radio button, checked when true.
   */
  selected?: boolean;
  /** Defaults to the title and subtitle. */
  accessibilityLabel?: string;
  testID?: string;
};

export function ListItem({
  title,
  subtitle,
  leading,
  trailing,
  onPress,
  onLongPress,
  selected,
  accessibilityLabel,
  testID,
}: ListItemProps) {
  const label = accessibilityLabel ?? (subtitle ? `${title}, ${subtitle}` : title);
  const rowClass = 'min-h-14 flex-row items-center gap-3 px-4 py-2';

  // A Pressable with disabled=true would be announced as "disabled", so rows
  // without handlers render as a plain accessible View.
  if (onPress === undefined && onLongPress === undefined) {
    return (
      <View testID={testID} accessible accessibilityLabel={label} className={rowClass}>
        <ListItemContent title={title} subtitle={subtitle} leading={leading} trailing={trailing} />
      </View>
    );
  }

  return (
    <Pressable
      testID={testID}
      accessibilityRole={selected === undefined ? 'button' : 'radio'}
      accessibilityLabel={label}
      accessibilityState={selected === undefined ? undefined : { checked: selected }}
      onPress={onPress}
      onLongPress={onLongPress}
      className={`${rowClass} active:bg-surface`}
    >
      <ListItemContent title={title} subtitle={subtitle} leading={leading} trailing={trailing} />
    </Pressable>
  );
}

function ListItemContent({
  title,
  subtitle,
  leading,
  trailing,
}: Pick<ListItemProps, 'title' | 'subtitle' | 'leading' | 'trailing'>) {
  return (
    <>
      {leading}
      <View className="flex-1">
        <Text numberOfLines={1} className="text-base text-foreground">
          {title}
        </Text>
        {subtitle ? (
          <Text numberOfLines={1} className="text-sm text-muted">
            {subtitle}
          </Text>
        ) : null}
      </View>
      {trailing}
    </>
  );
}
