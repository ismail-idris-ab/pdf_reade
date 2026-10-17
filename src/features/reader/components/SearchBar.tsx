import type { TFunction } from 'i18next';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Pressable, Text, TextInput, View } from 'react-native';

import {
  ArrowBackIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  CloseIcon,
  MatchCaseIcon,
  MatchWordIcon,
} from '@/components/icons';
import { IconButton } from '@/components/ui';
import { formatNumber, useTranslation, type Locale } from '@/i18n';
import { toRecoveryLabel, toUserMessage } from '@/lib/errors';
import { useTheme } from '@/theme';

import { createThrottledAnnouncer } from '../announce';
import { SEARCH_TOOLS_HEIGHT, TOP_BAR_HEIGHT } from '../chrome';
import { isCapped, summarizeSearch, type MatchRef, type SearchHeadline } from '../search';
import type { SearchController } from '../searchController';
import { useReaderStore, useReaderStoreApi } from '../store';

/** Count formatter for the current language ("10,000" / "10 000"). */
function useFormatCount(): (value: number) => string {
  const { i18n } = useTranslation();
  const locale = i18n.language as Locale;
  return useCallback((value: number) => formatNumber(value, locale), [locale]);
}

/** Text of the status line's main part. */
export function headlineText(
  headline: SearchHeadline,
  t: TFunction,
  format: (value: number) => string,
): string {
  switch (headline.kind) {
    case 'searching':
      return t('reader.search.searching');
    case 'noResults':
      return t('reader.search.noResults');
    case 'results':
      return headline.capped
        ? t('reader.search.resultsCapped', { value: format(headline.total) })
        : t('reader.search.results', { count: headline.total, value: format(headline.total) });
    case 'position':
      return t(headline.capped ? 'reader.search.positionCapped' : 'reader.search.position', {
        current: format(headline.ordinal),
        total: format(headline.total),
      });
    case 'error':
      return toUserMessage(headline.code).title;
  }
}

/** The search field that replaces the title while searching. */
export function SearchField({ controller }: { controller: SearchController }) {
  const { t } = useTranslation();
  const { palette } = useTheme();
  const query = useReaderStore((state) => state.searchQuery);
  const store = useReaderStoreApi();
  // Focus only right after the search was opened (see searchFocusPending).
  const [autoFocus] = useState(() => store.getState().searchFocusPending);
  useEffect(() => {
    if (autoFocus) store.getState().setSearch({ searchFocusPending: false });
  }, [autoFocus, store]);

  return (
    <View className="flex-row items-center gap-1 px-1" style={{ height: TOP_BAR_HEIGHT }}>
      <IconButton
        testID="reader-search-close"
        icon={<ArrowBackIcon color={palette.foreground} />}
        accessibilityLabel={t('reader.search.close')}
        onPress={controller.close}
      />
      <TextInput
        testID="reader-search-input"
        value={query}
        onChangeText={controller.setQuery}
        onSubmitEditing={controller.next}
        placeholder={t('reader.search.placeholder')}
        placeholderTextColor={palette.muted}
        accessibilityLabel={t('reader.search.fieldLabel')}
        autoFocus={autoFocus}
        autoCorrect={false}
        autoCapitalize="none"
        returnKeyType="search"
        className="min-h-12 flex-1 px-2 text-base text-foreground"
      />
      {query !== '' ? (
        <IconButton
          testID="reader-search-clear"
          icon={<CloseIcon color={palette.muted} size={20} />}
          accessibilityLabel={t('reader.search.clear')}
          onPress={() => controller.setQuery('')}
        />
      ) : null}
    </View>
  );
}

function OptionToggle({
  testID,
  label,
  checked,
  icon,
  onPress,
}: {
  testID: string;
  label: string;
  checked: boolean;
  icon: (color: string) => ReactNode;
  onPress: () => void;
}) {
  const { palette } = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="togglebutton"
      accessibilityLabel={label}
      accessibilityState={{ checked }}
      onPress={onPress}
      // On: tinted and outlined, so the state shows without relying on colour.
      className={`h-12 w-12 items-center justify-center rounded-full border-2 active:bg-surface ${
        checked ? 'border-primary bg-primary/15' : 'border-transparent'
      }`}
    >
      {icon(checked ? palette.primary : palette.muted)}
    </Pressable>
  );
}

/**
 * Under the search field: the status ("Result 3 of 12", "Searching… 40 of
 * 300", "No results", or the error with Try again), the match case and
 * whole word options, and previous / next.
 */
export function SearchToolsRow({ controller }: { controller: SearchController }) {
  const { t } = useTranslation();
  const { palette } = useTheme();
  const format = useFormatCount();
  const status = useReaderStore((state) => state.searchStatus);
  const results = useReaderStore((state) => state.searchResults);
  const current = useReaderStore((state) => state.currentMatch);
  const options = useReaderStore((state) => state.searchOptions);
  const { headline, progress } = useMemo(
    () => summarizeSearch(status, results, current),
    [status, results, current],
  );
  const hasMatches = results.total > 0;
  const progressText =
    progress && progress.pageCount > 0
      ? t('reader.search.progress', {
          page: format(progress.pagesSearched),
          total: format(progress.pageCount),
        })
      : null;
  // While nothing is found yet, the progress replaces "Searching…".
  const primary =
    headline?.kind === 'searching' && progressText !== null
      ? progressText
      : headline
        ? headlineText(headline, t, format)
        : null;
  const secondary = headline?.kind === 'searching' ? null : progressText;

  return (
    <View
      testID="reader-search-tools"
      className="flex-row items-center gap-1 pl-3 pr-1"
      style={{ height: SEARCH_TOOLS_HEIGHT }}
    >
      <View testID="reader-search-status" className="flex-1 justify-center">
        {primary !== null ? (
          <Text
            testID="reader-search-summary"
            numberOfLines={headline?.kind === 'error' ? 2 : 1}
            className={`text-sm ${headline?.kind === 'error' ? 'text-danger' : 'font-semibold text-foreground'}`}
          >
            {primary}
          </Text>
        ) : null}
        {secondary !== null ? (
          <Text testID="reader-search-progress" numberOfLines={1} className="text-xs text-muted">
            {secondary}
          </Text>
        ) : null}
      </View>
      <OptionToggle
        testID="reader-search-match-case"
        label={t('reader.search.matchCase')}
        checked={options.matchCase}
        icon={(color) => <MatchCaseIcon color={color} />}
        onPress={() => controller.setOptions({ matchCase: !options.matchCase })}
      />
      <OptionToggle
        testID="reader-search-whole-word"
        label={t('reader.search.wholeWord')}
        checked={options.wholeWord}
        icon={(color) => <MatchWordIcon color={color} />}
        onPress={() => controller.setOptions({ wholeWord: !options.wholeWord })}
      />
      {headline?.kind === 'error' ? (
        <Pressable
          testID="reader-search-retry"
          accessibilityRole="button"
          onPress={controller.retry}
          className="min-h-12 justify-center rounded-full px-3 active:bg-surface"
        >
          <Text className="text-sm font-semibold text-primary">{toRecoveryLabel('retry')}</Text>
        </Pressable>
      ) : (
        <>
          <IconButton
            testID="reader-search-previous"
            icon={<ArrowUpIcon color={palette.foreground} />}
            accessibilityLabel={t('reader.search.previous')}
            disabled={!hasMatches}
            onPress={controller.previous}
          />
          <IconButton
            testID="reader-search-next"
            icon={<ArrowDownIcon color={palette.foreground} />}
            accessibilityLabel={t('reader.search.next')}
            disabled={!hasMatches}
            onPress={controller.next}
          />
        </>
      )}
    </View>
  );
}

/**
 * Tells screen-reader users how the search is going, politely and without
 * flooding: the count while results stream in at most every
 * ANNOUNCE_INTERVAL_MS, the final count or error at once, and the selected
 * result's position when it changes. Renders nothing; stays mounted while
 * the controls are hidden.
 */
export function SearchAnnouncer() {
  const { t } = useTranslation();
  const format = useFormatCount();
  const status = useReaderStore((state) => state.searchStatus);
  const total = useReaderStore((state) => state.searchResults.total);
  const results = useReaderStore((state) => state.searchResults);
  const current = useReaderStore((state) => state.currentMatch);
  const announcerRef = useRef<ReturnType<typeof createThrottledAnnouncer> | null>(null);

  useEffect(() => {
    const announcer = createThrottledAnnouncer((message) =>
      AccessibilityInfo.announceForAccessibility(message),
    );
    announcerRef.current = announcer;
    return () => {
      announcer.dispose();
      if (announcerRef.current === announcer) announcerRef.current = null;
    };
  }, []);

  // Counts: throttled while streaming, at once when finished.
  useEffect(() => {
    const announcer = announcerRef.current;
    if (!announcer) return;
    const value = format(total);
    if (status.kind === 'pending' || status.kind === 'idle') {
      // A new search (or none): its counts are news even if equal to the last.
      announcer.reset();
    } else if (status.kind === 'searching' && total > 0) {
      announcer.say(
        isCapped(total)
          ? t('reader.search.resultsCapped', { value })
          : t('reader.search.resultsSoFar', { count: total, value }),
      );
    } else if (status.kind === 'done') {
      announcer.sayNow(
        total === 0
          ? t('reader.search.noResults')
          : isCapped(total)
            ? t('reader.search.resultsCapped', { value })
            : t('reader.search.results', { count: total, value }),
      );
    } else if (status.kind === 'error') {
      announcer.sayNow(toUserMessage(status.code).title);
    }
  }, [status, total, t, format]);

  // The selected result, after next / previous (not every streamed result).
  const lastCurrentRef = useRef<MatchRef | null>(null);
  useEffect(() => {
    if (current === lastCurrentRef.current) return;
    lastCurrentRef.current = current;
    const announcer = announcerRef.current;
    if (!announcer || current === null) return;
    const { headline } = summarizeSearch({ kind: 'done' }, results, current);
    if (headline?.kind === 'position') announcer.sayNow(headlineText(headline, t, format));
  }, [current, results, t, format]);

  return null;
}
