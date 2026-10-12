import { memo } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { useTranslation } from '@/i18n';

import { LIBRARY_CHIPS, LIBRARY_TABS, type LibraryChip, type LibraryTab } from '../store';

type TabsProps = { value: LibraryTab; onChange: (tab: LibraryTab) => void };

/** Document-type tabs: All / PDF / Word / Excel / Other. */
export const LibraryTabs = memo(function LibraryTabs({ value, onChange }: TabsProps) {
  const { t } = useTranslation();
  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={t('library.tabsLabel')}
      className="flex-row border-b border-border px-2"
    >
      {LIBRARY_TABS.map((tab) => {
        const selected = tab === value;
        return (
          <Pressable
            key={tab}
            testID={`library-tab-${tab}`}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onChange(tab)}
            className={`min-h-12 flex-1 items-center justify-center border-b-2 px-1 ${selected ? 'border-primary' : 'border-transparent'}`}
          >
            <Text
              numberOfLines={1}
              className={`text-sm font-semibold ${selected ? 'text-primary' : 'text-muted'}`}
            >
              {t(`library.tabs.${tab}`)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
});

type ChipsProps = { value: LibraryChip; onChange: (chip: LibraryChip) => void };

/** Source chips, horizontally scrollable: All / Downloads / WhatsApp / Scans / My Files. */
export const SourceChips = memo(function SourceChips({ value, onChange }: ChipsProps) {
  const { t } = useTranslation();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      accessibilityLabel={t('library.chipsLabel')}
      contentContainerClassName="gap-2 px-4 py-2"
      className="flex-grow-0"
    >
      {LIBRARY_CHIPS.map((chip) => {
        const selected = chip === value;
        return (
          <Pressable
            key={chip}
            testID={`library-chip-${chip}`}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            onPress={() => onChange(chip)}
            // min-h-12 keeps a 48dp touch target around the visual pill.
            className="min-h-12 justify-center"
          >
            <View
              className={`rounded-full border px-4 py-1.5 ${selected ? 'border-primary bg-primary' : 'border-border bg-surface'}`}
            >
              <Text
                className={`text-sm ${selected ? 'text-primary-foreground' : 'text-foreground'}`}
              >
                {t(`library.chips.${chip}`)}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </ScrollView>
  );
});
