import { Fragment, useEffect, useRef } from 'react';
import { Pressable, ScrollView, Text } from 'react-native';

import { ChevronRightIcon } from '@/components/icons';
import { useTranslation } from '@/i18n';
import { useTheme } from '@/theme';

import type { Crumb } from '../location';

type BreadcrumbsProps = {
  trail: readonly Crumb[];
  onNavigate: (path: string | null) => void;
  testID: string;
};

/**
 * "My Files › a › b": every folder above the current one is a button that
 * goes there; the current folder is plain text. Scrolls sideways and keeps
 * the current folder in view.
 */
export function Breadcrumbs({ trail, onNavigate, testID }: BreadcrumbsProps) {
  const { t } = useTranslation();
  const { palette } = useTheme();
  const scroll = useRef<ScrollView>(null);

  // Keyed on the folder paths, not the array: callers rebuild the trail on
  // every render, and only a real change of folder should scroll.
  const trailKey = trail.map((crumb) => crumb.path ?? '').join('\u0000');
  useEffect(() => {
    scroll.current?.scrollToEnd({ animated: false });
  }, [trailKey]);

  return (
    <ScrollView
      ref={scroll}
      testID={testID}
      horizontal
      showsHorizontalScrollIndicator={false}
      accessibilityLabel={t('folders.pathLabel')}
      contentContainerClassName="items-center px-2"
      className="flex-grow-0"
    >
      {trail.map((crumb, index) => {
        const last = index === trail.length - 1;
        return (
          <Fragment key={crumb.path ?? ''}>
            {index > 0 ? <ChevronRightIcon color={palette.muted} size={20} /> : null}
            {last ? (
              <Text
                accessibilityRole="header"
                numberOfLines={1}
                className="px-2 py-3 text-base font-semibold text-foreground"
              >
                {crumb.name}
              </Text>
            ) : (
              <Pressable
                testID={`${testID}-${index}`}
                accessibilityRole="button"
                accessibilityLabel={crumb.name}
                onPress={() => onNavigate(crumb.path)}
                className="min-h-12 min-w-12 items-center justify-center rounded-lg px-2 active:bg-surface"
              >
                <Text numberOfLines={1} className="text-base text-primary">
                  {crumb.name}
                </Text>
              </Pressable>
            )}
          </Fragment>
        );
      })}
    </ScrollView>
  );
}
