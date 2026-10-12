import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ArrowBackIcon, ChevronRightIcon } from '@/components/icons';
import { LanguagePicker } from '@/components/LanguagePicker';
import { IconButton, ListItem } from '@/components/ui';
import {
  effectiveLocalePreference,
  getEnabledLocales,
  LOCALE_NAMES,
  useLocaleStore,
  useTranslation,
} from '@/i18n';
import { useTheme } from '@/theme';

import { getAppVersion } from './appVersion';
import { ThemePicker } from './ThemePicker';

/**
 * App-wide settings, reached from the library header. Each setting applies
 * as soon as it is picked; its store persists it across restarts.
 */
export function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const { palette, preference: themePreference } = useTheme();
  const localePreference = useLocaleStore((state) => state.preference);
  const [picker, setPicker] = useState<'theme' | 'language' | null>(null);

  const locale = effectiveLocalePreference(localePreference, getEnabledLocales());
  const languageLabel = locale === 'system' ? t('language.system') : LOCALE_NAMES[locale];
  const appVersion = getAppVersion();
  const chevron = <ChevronRightIcon color={palette.muted} size={20} />;

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center px-2">
        <IconButton
          testID="settings-back"
          icon={<ArrowBackIcon color={palette.foreground} />}
          accessibilityLabel={t('common.back')}
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
        />
        <Text
          accessibilityRole="header"
          numberOfLines={1}
          className="flex-1 px-2 text-xl font-semibold text-foreground"
        >
          {t('settings.title')}
        </Text>
      </View>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}>
        <Section title={t('settings.appearance')}>
          <ListItem
            testID="settings-theme"
            title={t('settings.theme')}
            subtitle={t(`settings.themeOptions.${themePreference}`)}
            trailing={chevron}
            onPress={() => setPicker('theme')}
          />
          <ListItem
            testID="settings-language"
            title={t('language.title')}
            subtitle={languageLabel}
            trailing={chevron}
            onPress={() => setPicker('language')}
          />
        </Section>
        {appVersion ? (
          <Section title={t('settings.about')}>
            <ListItem
              testID="settings-version"
              title={t('settings.version')}
              subtitle={appVersion}
            />
          </Section>
        ) : null}
      </ScrollView>
      <ThemePicker visible={picker === 'theme'} onClose={() => setPicker(null)} />
      <LanguagePicker visible={picker === 'language'} onClose={() => setPicker(null)} />
    </View>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View className="border-b border-border py-2">
      <Text accessibilityRole="header" className="px-4 pb-1 pt-3 text-sm font-semibold text-muted">
        {title}
      </Text>
      {children}
    </View>
  );
}
