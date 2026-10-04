import { Text, View } from 'react-native';

import { BottomSheet, ListItem } from '@/components/ui';
import {
  getEnabledLocales,
  LOCALE_NAMES,
  useLocaleStore,
  useTranslation,
  type LocalePreference,
} from '@/i18n';
import { useTheme } from '@/theme';

export type LanguagePickerProps = {
  visible: boolean;
  onClose: () => void;
};

/**
 * In-app language switcher. Lists "use phone language" plus the enabled
 * locales only, so ha/fr stay hidden until they are enabled in config.
 */
export function LanguagePicker({ visible, onClose }: LanguagePickerProps) {
  const { t } = useTranslation();
  const { palette } = useTheme();
  const preference = useLocaleStore((state) => state.preference);
  const setPreference = useLocaleStore((state) => state.setPreference);

  const enabled = getEnabledLocales();
  const options: { value: LocalePreference; label: string }[] = [
    { value: 'system', label: t('language.system') },
    ...enabled.map((locale) => ({ value: locale, label: LOCALE_NAMES[locale] })),
  ];
  // A saved locale that has since been disabled behaves as "system".
  const effective: LocalePreference =
    preference === 'system' || enabled.includes(preference) ? preference : 'system';

  return (
    <BottomSheet visible={visible} onClose={onClose} title={t('language.title')}>
      <View accessibilityRole="radiogroup">
        {options.map((option) => {
          const selected = option.value === effective;
          return (
            <ListItem
              key={option.value}
              title={option.label}
              selected={selected}
              trailing={
                selected ? (
                  <Text accessible={false} style={{ color: palette.primary, fontSize: 18 }}>
                    ✓
                  </Text>
                ) : undefined
              }
              onPress={() => {
                setPreference(option.value);
                onClose();
              }}
            />
          );
        })}
      </View>
    </BottomSheet>
  );
}
