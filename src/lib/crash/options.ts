import type { ReactNativeOptions } from '@sentry/react-native';

import { isErrorCode } from '@/lib/errors/codes';

import { MAX_STRING_LENGTH, scrubValue } from './scrub';

type Breadcrumb = Parameters<NonNullable<ReactNativeOptions['beforeBreadcrumb']>>[0];
type ErrorEvent = Parameters<NonNullable<ReactNativeOptions['beforeSend']>>[0];
type EventHint = Parameters<NonNullable<ReactNativeOptions['beforeSend']>>[1];

/** Crash reporting runs only in release builds with a configured DSN. */
export function shouldEnableCrashReporting(isDev: boolean, dsn: string | undefined): boolean {
  return !isDev && typeof dsn === 'string' && dsn.length > 0;
}

/** Console output often echoes file names; console breadcrumbs are dropped. */
export function filterBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb | null {
  if (breadcrumb.category === 'console') return null;
  return scrubValue(breadcrumb);
}

/**
 * Scrubs the event. Errors carrying one of our codes are reported by code
 * only: their messages may describe the file that failed.
 */
export function filterEvent(event: ErrorEvent, hint: EventHint): ErrorEvent {
  const code = (hint?.originalException as { code?: unknown } | null | undefined)?.code;
  const scrubbed = scrubValue(event);
  if (isErrorCode(code) && scrubbed.exception?.values) {
    for (const value of scrubbed.exception.values) value.value = code;
  }
  return scrubbed;
}

export function createSentryOptions(dsn: string): ReactNativeOptions {
  return {
    dsn,
    sendDefaultPii: false,
    // The Android SDK applies its own beforeSend, so native crash, ANR and
    // NDK events would bypass the scrubbing above. Native reporting stays off
    // until a native scrubbing hook exists (TASKS.md T6.6).
    enableNative: false,
    attachScreenshot: false,
    attachViewHierarchy: false,
    // No tracing at all (any numeric tracesSampleRate counts as enabled).
    enableAutoPerformanceTracing: false,
    enableAppStartTracking: false,
    enableStallTracking: false,
    enableNativeFramesTracking: false,
    enableCaptureFailedRequests: false,
    // Release-health sessions feed the crash-free-users KPI; they carry no
    // file data.
    enableAutoSessionTracking: true,
    maxValueLength: MAX_STRING_LENGTH,
    beforeBreadcrumb: filterBreadcrumb,
    beforeSend: filterEvent,
  };
}
