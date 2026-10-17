import { memo, useMemo } from 'react';
import { View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { useTheme } from '@/theme';
import { searchHighlights } from '@/theme/palette';

import { highlightPath } from '../search';
import { useReaderStore } from '../store';

export type SearchHighlightsProps = {
  page: number;
  /** The displayed page's size, dp (the overlay slot's layout). */
  width: number;
  height: number;
};

/**
 * Search matches on one page (T2.6): every match in the theme's highlight
 * colour, and the selected one drawn again on top, stronger and outlined. One SVG with two paths per
 * page, however many matches. Never takes touches. Subscribes to this page's
 * matches only, so a result on another page does not re-render it.
 */
export const SearchHighlights = memo(function SearchHighlights({
  page,
  width,
  height,
}: SearchHighlightsProps) {
  const { theme } = useTheme();
  const colors = searchHighlights[theme];
  const matches = useReaderStore((state) => state.searchResults.byPage[page]);
  const current = useReaderStore((state) =>
    state.currentMatch?.page === page ? state.currentMatch.index : -1,
  );

  // Every match, the selected one included: rebuilt only when this page's
  // matches or size change, not on next / previous.
  const allPath = useMemo(
    () => (matches ? highlightPath(matches.rects, matches.rotation, { width, height }) : ''),
    [matches, width, height],
  );
  // The selected match, drawn again on top, stronger and outlined.
  const selected = matches?.rects[current];
  const currentPath = useMemo(
    () =>
      matches && selected ? highlightPath([selected], matches.rotation, { width, height }) : '',
    [matches, selected, width, height],
  );

  if (!matches) return null;
  return (
    <View
      testID={`search-highlights-${page}`}
      pointerEvents="none"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      className="absolute left-0 top-0"
      style={{ width, height }}
    >
      <Svg width={width} height={height} pointerEvents="none">
        {allPath !== '' ? (
          <Path
            testID={`search-matches-${page}`}
            d={allPath}
            fill={colors.match}
            fillOpacity={colors.matchOpacity}
          />
        ) : null}
        {currentPath !== '' ? (
          <Path
            testID={`search-current-${page}`}
            d={currentPath}
            fill={colors.current}
            fillOpacity={colors.currentOpacity}
            stroke={colors.currentStroke}
            strokeWidth={2}
          />
        ) : null}
      </Svg>
    </View>
  );
});
