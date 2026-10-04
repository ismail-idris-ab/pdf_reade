import * as Sentry from '@sentry/react-native';

import { isErrorCode, type ErrorCode } from '@/lib/errors/codes';

import { createSentryOptions, shouldEnableCrashReporting } from './options';

export { REDACTED, referencesFile, scrubText, scrubValue } from './scrub';

// The DSN is not a secret; it is inlined at build time from the environment.
const DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;

let enabled = false;

/**
 * Starts crash reporting in release builds when a DSN is configured; does
 * nothing otherwise (no SDK traffic at all). See ./options for what is sent.
 */
export function initCrashReporting(): void {
  if (enabled || !shouldEnableCrashReporting(__DEV__, DSN) || DSN === undefined) return;
  Sentry.init(createSentryOptions(DSN));
  enabled = true;
}

// Expected outcomes of user actions or bad input files, not app bugs.
const NOT_REPORTED: ReadonlySet<ErrorCode> = new Set([
  'PASSWORD_REQUIRED',
  'WRONG_PASSWORD',
  'CANCELLED',
  'PERMISSION_DENIED',
  'NOT_FOUND',
  'NO_SPACE',
  'CORRUPT_FILE',
  'UNSUPPORTED',
]);

export function shouldReport(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return !(isErrorCode(code) && NOT_REPORTED.has(code));
}

/** Reports an unexpected error caught by our own handlers (e.g. the error boundary). */
export function reportError(error: unknown): void {
  if (enabled && shouldReport(error)) Sentry.captureException(error);
}
