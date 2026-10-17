import {
  ancestorIds,
  countOutline,
  currentSectionId,
  EXPAND_ALL_LIMIT,
  flattenOutline,
  initialExpanded,
} from '@/features/reader/outline';
import type { OutlineItem } from '@/lib/engine';

const item = (title: string, page: number | null, children: OutlineItem[] = []): OutlineItem => ({
  title,
  page,
  children,
});

const tree: OutlineItem[] = [
  item('Intro', 0),
  item('Part 1', 2, [item('Chapter 1', 3), item('Chapter 2', 6, [item('2.1', 7)])]),
  item('Website', null),
  item('Part 2', 10),
];

describe('outline', () => {
  it('counts every entry', () => {
    expect(countOutline(tree)).toBe(7);
  });

  it('flattens the visible entries with their depth', () => {
    const collapsed = flattenOutline(tree, new Set());
    expect(collapsed.map((row) => row.id)).toEqual(['0', '1', '2', '3']);
    expect(collapsed[1]).toMatchObject({ hasChildren: true, expanded: false, depth: 0 });

    const open = flattenOutline(tree, new Set(['1', '1.1']));
    expect(open.map((row) => [row.title, row.depth])).toEqual([
      ['Intro', 0],
      ['Part 1', 0],
      ['Chapter 1', 1],
      ['Chapter 2', 1],
      ['2.1', 2],
      ['Website', 0],
      ['Part 2', 0],
    ]);
  });

  it('finds the section of the page being read', () => {
    expect(currentSectionId(tree, 0)).toBe('0');
    expect(currentSectionId(tree, 4)).toBe('1.0');
    expect(currentSectionId(tree, 7)).toBe('1.1.0');
    expect(currentSectionId(tree, 9)).toBe('1.1.0');
    expect(currentSectionId(tree, 50)).toBe('3');
    expect(currentSectionId([item('Late', 5)], 1)).toBeNull();
  });

  it('expands a short outline fully, a long one only down to the current section', () => {
    expect([...initialExpanded(tree, null)].sort()).toEqual(['1', '1.1']);
    const long = [
      item(
        'Big',
        0,
        Array.from({ length: EXPAND_ALL_LIMIT }, (_, i) => item(`c${i}`, i, [item('leaf', i)])),
      ),
    ];
    expect([...initialExpanded(long, '0.3.0')].sort()).toEqual(['0', '0.3']);
    expect(ancestorIds('0.3.0')).toEqual(['0', '0.3']);
    expect(ancestorIds('2')).toEqual([]);
  });
});
