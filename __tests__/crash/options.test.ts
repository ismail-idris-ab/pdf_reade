import { shouldReport } from '@/lib/crash';
import {
  createSentryOptions,
  filterBreadcrumb,
  filterEvent,
  shouldEnableCrashReporting,
} from '@/lib/crash/options';
import { REDACTED } from '@/lib/crash/scrub';
import { AppError } from '@/lib/errors';

type EventArg = Parameters<typeof filterEvent>[0];

describe('shouldEnableCrashReporting', () => {
  it('requires a release build and a DSN', () => {
    expect(shouldEnableCrashReporting(false, 'https://key@sentry.io/1')).toBe(true);
    expect(shouldEnableCrashReporting(true, 'https://key@sentry.io/1')).toBe(false);
    expect(shouldEnableCrashReporting(false, undefined)).toBe(false);
    expect(shouldEnableCrashReporting(false, '')).toBe(false);
  });
});

describe('createSentryOptions', () => {
  it('turns off PII, native reporting, captures and tracing', () => {
    const options = createSentryOptions('https://key@sentry.io/1');
    expect(options).toMatchObject({
      sendDefaultPii: false,
      enableNative: false,
      attachScreenshot: false,
      attachViewHierarchy: false,
      enableAutoPerformanceTracing: false,
      enableStallTracking: false,
      enableNativeFramesTracking: false,
      enableCaptureFailedRequests: false,
    });
    expect(options).not.toHaveProperty('tracesSampleRate');
    expect(options.beforeSend).toBe(filterEvent);
    expect(options.beforeBreadcrumb).toBe(filterBreadcrumb);
  });
});

describe('filterBreadcrumb', () => {
  it('drops console breadcrumbs and scrubs the rest', () => {
    expect(filterBreadcrumb({ category: 'console', message: 'hello' })).toBeNull();
    expect(filterBreadcrumb({ category: 'navigation', message: 'to cv.pdf' })).toEqual({
      category: 'navigation',
      message: REDACTED,
    });
  });
});

describe('filterEvent', () => {
  function errorEvent(value: string): EventArg {
    return { type: undefined, exception: { values: [{ type: 'Error', value }] } };
  }

  it('reports coded errors by code only', () => {
    const error = Object.assign(new Error('render failed for page 3'), { code: 'OUT_OF_MEMORY' });
    const event = filterEvent(errorEvent('render failed for page 3'), {
      originalException: error,
    });
    expect(event.exception?.values?.[0]?.value).toBe('OUT_OF_MEMORY');
  });

  it('scrubs uncoded errors', () => {
    const event = filterEvent(errorEvent('ENOENT /storage/emulated/0/x.pdf'), {
      originalException: new Error('ENOENT'),
    });
    expect(event.exception?.values?.[0]?.value).toBe(REDACTED);
  });
});

describe('shouldReport', () => {
  it('skips expected outcomes and reports bugs', () => {
    expect(shouldReport(new AppError('CANCELLED'))).toBe(false);
    expect(shouldReport(new AppError('WRONG_PASSWORD'))).toBe(false);
    expect(shouldReport(new AppError('OUT_OF_MEMORY'))).toBe(true);
    expect(shouldReport(new AppError('UNKNOWN'))).toBe(true);
    expect(shouldReport(new TypeError('x is undefined'))).toBe(true);
  });
});
