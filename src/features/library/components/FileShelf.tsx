import { FlashList, type ListRenderItem } from '@shopify/flash-list';
import { memo, useCallback } from 'react';
import { Text, View } from 'react-native';

import type { LibraryFile } from '@/db/repositories';

import { FileTile, type FormatDetails } from './FileItems';

// Card thumbnail width, dp.
const CARD_WIDTH = 88;

const keyExtractor = (file: LibraryFile) => String(file.id);

type FileShelfProps = {
  title: string;
  files: readonly LibraryFile[];
  formatDetails: FormatDetails;
  testID: string;
};

/** Titled horizontal row of file cards (Recent, Favorites). Renders nothing when empty. */
export const FileShelf = memo(function FileShelf({
  title,
  files,
  formatDetails,
  testID,
}: FileShelfProps) {
  const renderItem: ListRenderItem<LibraryFile> = useCallback(
    ({ item }) => (
      <FileTile
        testID={`${testID}-${item.id}`}
        file={item}
        formatDetails={formatDetails}
        width={CARD_WIDTH}
      />
    ),
    [formatDetails, testID],
  );

  if (files.length === 0) return null;
  return (
    <View testID={testID} className="pt-2">
      <Text accessibilityRole="header" className="px-4 text-base font-semibold text-foreground">
        {title}
      </Text>
      <FlashList
        horizontal
        data={files}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={SHELF_PADDING}
      />
    </View>
  );
});

const SHELF_PADDING = { paddingHorizontal: 8 };
