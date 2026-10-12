import { Text, View } from 'react-native';

import { BottomSheet, ListItem } from '@/components/ui';
import { useTranslation } from '@/i18n';
import { THEME_PREFERENCES, useTheme } from '@/theme';

export type ThemePickerProps = {
  visible: boolean;
  onClose: () => void;
};

/** Theme switcher: "use phone setting" plus every app theme, applied on tap. */
export function ThemePicker({ visible, onClose }: ThemePickerProps) {
  const { t } = useTranslation();
  const { palette, preference, setPreference } = useTheme();

  return (
    <BottomSheet visible={visible} onClose={onClose} title={t('settings.theme')}>
      <View accessibilityRole="radiogroup">
        {THEME_PREFERENCES.map((option) => {
          const selected = option === preference;
          return (
            <ListItem
              key={option}
              title={t(`settings.themeOptions.${option}`)}
              selected={selected}
              trailing={
                selected ? (
                  <Text accessible={false} style={{ color: palette.primary, fontSize: 18 }}>
                    ✓
                  </Text>
                ) : undefined
              }
              onPress={() => {
                setPreference(option);
                onClose();
              }}
            />
          );
        })}
      </View>
    </BottomSheet>
  );
}
