import { memo, useMemo } from 'react';
import { View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { useTheme } from '@/theme';
import { textSelectionColors } from '@/theme/palette';

import { selectionPath, selectionViewRects } from '../selection';
import { useReaderStore } from '../store';

export type SelectionHighlightProps = {
  page: number;
  /** The displayed page's size, dp (the overlay slot's layout). */
  width: number;
  height: number;
};

/**
 * The text selection on one page (T2.8): one rect per selected line, in the
 * theme's selection colour. Never takes touches (the handles live above the
 * page area). Subscribes to this page's selection only.
 */
export const SelectionHighlight = memo(function SelectionHighlight({
  page,
  width,
  height,
}: SelectionHighlightProps) {
  const { theme } = useTheme();
  const colors = textSelectionColors[theme];
  const selection = useReaderStore((state) =>
    state.selection?.page === page ? state.selection : null,
  );
  // Drawn at this cell's size: the selection was made at the same zoom.
  const path = useMemo(
    () =>
      selection ? selectionPath(selectionViewRects({ ...selection, view: { width, height } })) : '',
    [selection, width, height],
  );

  if (path === '') return null;
  return (
    <View
      testID={`selection-highlight-${page}`}
      pointerEvents="none"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      className="absolute left-0 top-0"
      style={{ width, height }}
    >
      <Svg width={width} height={height} pointerEvents="none">
        <Path
          testID={`selection-path-${page}`}
          d={path}
          fill={colors.fill}
          fillOpacity={colors.fillOpacity}
        />
      </Svg>
    </View>
  );
});
