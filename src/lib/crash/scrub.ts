// Keeps file paths and file names out of anything sent to crash reporting.
// Users open personal documents (ID cards, results, bank statements); their
// names and locations must never leave the device.
//
// Pattern-replacing names out of free text leaks fragments (names contain
// spaces, "(1)" suffixes, no extension), so any string that references a
// file is replaced whole. Every pattern below is linear-time (no nested or
// greedy quantifiers before a fixed suffix), and strings are truncated first.

export const REDACTED = '[redacted]';
export const MAX_STRING_LENGTH = 1000;

const FILE_REFERENCE_PATTERNS: RegExp[] = [
  // content://…, file://… URIs.
  /\b(?:content|file):\/\//i,
  // Absolute Android storage paths.
  /\/(?:storage|sdcard|data|mnt|Android)\//i,
  // Common user folders in relative paths and SAF document IDs.
  /\b(?:Download|Downloads|Documents|DCIM|Pictures|WhatsApp|Movies|Music)\//i,
  /\b(?:primary|raw|msf|home):/i,
  // Any document, image or archive extension.
  /\.(?:pdf|docx?|xlsx?|pptx?|csv|txt|rtf|odt|ods|odp|epub|jpe?g|png|heic|heif|webp|gif|bmp|tiff?|zip|rar|7z)\b/i,
];

export function referencesFile(text: string): boolean {
  return FILE_REFERENCE_PATTERNS.some((pattern) => pattern.test(text));
}

/** Returns the text unchanged, or REDACTED if any part of it references a file. */
export function scrubText(text: string): string {
  const bounded = text.length > MAX_STRING_LENGTH ? text.slice(0, MAX_STRING_LENGTH) : text;
  return referencesFile(bounded) ? REDACTED : bounded;
}

const MAX_DEPTH = 8;

/** Deep-copies `value`, scrubbing every string (keys included). */
export function scrubValue<T>(value: T, depth = 0): T {
  if (typeof value === 'string') return scrubText(value) as T;
  if (value === null || typeof value !== 'object') return value;
  // Never pass deeper data through unscrubbed.
  if (depth >= MAX_DEPTH) return REDACTED as T;
  if (Array.isArray(value)) return value.map((item) => scrubValue(item, depth + 1)) as T;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    result[scrubText(key)] = scrubValue(item, depth + 1);
  }
  return result as T;
}
