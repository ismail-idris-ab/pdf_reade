import type { FileSource } from '@/db/schema';
import { isInMyFiles } from '@/lib/files';

/** Separator between folder names in a friendly location ("My Files › a › b"). */
export const PATH_SEPARATOR = ' › ';

export type LocationLabels = {
  pickedFile: string;
  phoneStorage: string;
  sdCard: string;
  myFiles: string;
  downloads: string;
  whatsapp: string;
  scans: string;
};

/** One step of a My Files breadcrumb; `path` is null for the root. */
export type Crumb = { name: string; path: string | null };

/** Folders from the My Files root down to `dir` (root first). */
export function folderTrail(root: string, dir: string | null, rootName: string): Crumb[] {
  const trail: Crumb[] = [{ name: rootName, path: null }];
  if (dir === null || dir === root || !dir.startsWith(`${root}/`)) return trail;
  let path = root;
  for (const name of dir.slice(root.length + 1).split('/')) {
    if (name === '') continue;
    path = `${path}/${name}`;
    trail.push({ name, path });
  }
  return trail;
}

const PRIMARY_VOLUME =
  /^(?:\/storage\/emulated\/\d+|\/storage\/self\/primary|\/sdcard|\/mnt\/sdcard)(\/.*)?$/i;
const OTHER_VOLUME = /^\/storage\/[^/]+(\/.*)?$/i;

function dirSegments(rest: string | undefined): string[] {
  const segments = (rest ?? '').split('/').filter((segment) => segment !== '');
  // The last segment is the file name.
  return segments.slice(0, -1);
}

/**
 * Where a file lives, in words: "Picked file" for picked documents (never
 * the content:// URI), "My Files › a › b" inside My Files, the source name
 * for Downloads / WhatsApp / Scans, and "Phone storage › folder" or
 * "SD card › folder" for anything else.
 */
export function describeLocation(
  path: string,
  source: FileSource,
  myFilesRoot: string | null,
  labels: LocationLabels,
): string {
  if (/^content:\/\//i.test(path)) return labels.pickedFile;
  if (isInMyFiles(path, myFilesRoot)) {
    const dir = path.slice(0, path.lastIndexOf('/'));
    const names =
      myFilesRoot !== null
        ? folderTrail(myFilesRoot, dir, labels.myFiles).map((crumb) => crumb.name)
        : [labels.myFiles];
    return names.join(PATH_SEPARATOR);
  }
  if (source === 'downloads') return labels.downloads;
  if (source === 'whatsapp') return labels.whatsapp;
  if (source === 'scans') return labels.scans;
  const primary = PRIMARY_VOLUME.exec(path);
  if (primary) return [labels.phoneStorage, ...dirSegments(primary[1])].join(PATH_SEPARATOR);
  const other = OTHER_VOLUME.exec(path);
  if (other) return [labels.sdCard, ...dirSegments(other[1])].join(PATH_SEPARATOR);
  return labels.phoneStorage;
}
