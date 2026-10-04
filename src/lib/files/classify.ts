import type { ScannedFile } from '../../../modules/file-index/src/FileIndexModule';
import type { FileSource } from '@/db/schema';
import type { NewFile } from '@/db/types';

/** Document types the library indexes (lower-case, no dot). */
export const DEFAULT_SCAN_EXTS = [
  'pdf',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'csv',
  'txt',
  'ppt',
  'pptx',
] as const;

const MIME_BY_EXT: Readonly<Record<string, string>> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv',
  txt: 'text/plain',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

/** MIME type for a known document extension, or null. */
export function mimeForExt(ext: string): string | null {
  return MIME_BY_EXT[ext.toLowerCase()] ?? null;
}

// Alternative MIME types some document providers report.
const EXT_BY_MIME_ALIAS: Readonly<Record<string, string>> = {
  'text/comma-separated-values': 'csv',
  'application/csv': 'csv',
};

/** Document extension for a MIME type (parameters and case ignored), or null. */
export function extForMime(mime: string): string | null {
  const base = mime.split(';')[0]?.trim().toLowerCase() ?? '';
  for (const [ext, known] of Object.entries(MIME_BY_EXT)) {
    if (known === base) return ext;
  }
  return EXT_BY_MIME_ALIAS[base] ?? null;
}

/**
 * Android application id. Mirrors ANDROID_PACKAGE in app.config.ts (a Jest
 * test keeps them in sync); it is part of the app's private storage paths.
 */
export const APP_PACKAGE = 'com.ismailidris.pdfreader';

/**
 * Folder, directly inside the app's files dir (`Context.getFilesDir()`, or
 * its external counterpart `Android/data/<package>/files`), where the
 * document scanner saves its output. Assumption shared with the scanner
 * tasks (T3/T4): they must write there for files to be classified as scans.
 */
export const SCANS_DIR_NAME = 'Scans';

// Root of a storage volume: primary (/storage/emulated/<user>, the legacy
// /sdcard symlinks, /storage/self/primary) or removable (/storage/XXXX-XXXX).
const VOLUME_ROOT =
  '(?:/storage/emulated/\\d+|/storage/self/primary|/sdcard|/mnt/sdcard|/storage/(?!emulated/|self/)[^/]+)';

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const underVolume = (relative: string) => new RegExp(`^${VOLUME_ROOT}/${relative}/`, 'i');

const WHATSAPP_DIRS = [
  'Android/media/com.whatsapp/WhatsApp/Media/WhatsApp Documents',
  'WhatsApp/Media/WhatsApp Documents',
  'Android/media/com.whatsapp.w4b/WhatsApp Business/Media/WhatsApp Business Documents',
  'WhatsApp Business/Media/WhatsApp Business Documents',
].map((dir) => underVolume(escape(dir)));

const DOWNLOADS_DIR = underVolume('Download');

const SCANS_DIRS = [
  new RegExp(
    `^/data/(?:user/\\d+|data)/${escape(APP_PACKAGE)}/files/${escape(SCANS_DIR_NAME)}/`,
    'i',
  ),
  underVolume(`Android/data/${escape(APP_PACKAGE)}/files/${escape(SCANS_DIR_NAME)}`),
];

/**
 * Library source of an absolute file path (a `file://` prefix is accepted).
 * Matching is case-insensitive and includes subfolders.
 */
export function classifySource(path: string): FileSource {
  const normalised = path.replace(/^file:\/\//i, '');
  if (WHATSAPP_DIRS.some((dir) => dir.test(normalised))) return 'whatsapp';
  if (DOWNLOADS_DIR.test(normalised)) return 'downloads';
  if (SCANS_DIRS.some((dir) => dir.test(normalised))) return 'scans';
  return 'device';
}

/** Maps a scanned file to a `files` row. The source defaults to the path's. */
export function toNewFile(scanned: ScannedFile, source?: FileSource): NewFile {
  const ext = scanned.ext.toLowerCase();
  return {
    path: scanned.path,
    uri: null,
    name: scanned.name,
    ext,
    mime: mimeForExt(ext),
    size: scanned.size,
    mtime: scanned.mtime,
    source: source ?? classifySource(scanned.path),
  };
}
