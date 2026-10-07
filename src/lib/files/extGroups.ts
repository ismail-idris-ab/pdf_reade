import { DEFAULT_SCAN_EXTS } from './classify';

type KnownExt = (typeof DEFAULT_SCAN_EXTS)[number];

/** Library tabs by document type. 'other' is every extension not grouped below. */
export const EXT_GROUPS = ['pdf', 'word', 'excel', 'other'] as const;
export type ExtGroup = (typeof EXT_GROUPS)[number];

/** Extensions (lower-case, no dot) of each named group. */
export const GROUP_EXTS: Readonly<Record<Exclude<ExtGroup, 'other'>, readonly KnownExt[]>> = {
  pdf: ['pdf'],
  word: ['doc', 'docx'],
  excel: ['xls', 'xlsx', 'csv'],
};

/** Every extension that belongs to a named group; anything else is 'other'. */
export const GROUPED_EXTS: readonly string[] = Object.values(GROUP_EXTS).flat();

/** The group of a stored extension (case-insensitive). */
export function extGroupOf(ext: string): ExtGroup {
  const lower = ext.toLowerCase();
  for (const group of ['pdf', 'word', 'excel'] as const) {
    if ((GROUP_EXTS[group] as readonly string[]).includes(lower)) return group;
  }
  return 'other';
}
