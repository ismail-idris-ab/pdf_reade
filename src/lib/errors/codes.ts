// Error codes shared with the native modules. Keep in sync with
// modules/pdf-engine/android/.../ErrorCode.kt (enforced by a Jest test).
export const ERROR_CODES = [
  'PASSWORD_REQUIRED',
  'WRONG_PASSWORD',
  'CORRUPT_FILE',
  'UNSUPPORTED',
  'NO_SPACE',
  'OUT_OF_MEMORY',
  'CANCELLED',
  'PERMISSION_DENIED',
  'NOT_FOUND',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** ErrorCode plus the fallback for anything unexpected (JS bugs, unmapped native errors). */
export type AppErrorCode = ErrorCode | 'UNKNOWN';

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && (ERROR_CODES as readonly string[]).includes(value);
}

export class AppError extends Error {
  readonly code: AppErrorCode;

  constructor(code: AppErrorCode, message?: string, options?: { cause?: unknown }) {
    super(message ?? code, options);
    this.name = 'AppError';
    this.code = code;
    // Not every engine honours the ES2022 `cause` option.
    if (options && 'cause' in options && this.cause === undefined) {
      Object.defineProperty(this, 'cause', {
        value: options.cause,
        configurable: true,
        writable: true,
      });
    }
  }
}

/**
 * Normalises anything thrown into an AppError. Native module errors carry a
 * `code` property (Expo CodedException); it is kept when it is a known code.
 */
export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  const code = (error as { code?: unknown } | null)?.code;
  const message = error instanceof Error ? error.message : undefined;
  return new AppError(isErrorCode(code) ? code : 'UNKNOWN', message, { cause: error });
}
