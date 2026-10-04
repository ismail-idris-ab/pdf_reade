import fs from 'node:fs';
import path from 'node:path';

import { AppError, ERROR_CODES, toAppError, toUserMessage, type AppErrorCode } from '@/lib/errors';

const KOTLIN_ERROR_CODE = path.join(
  __dirname,
  '../../modules/pdf-engine/android/src/main/java/com/ismailidris/pdfreader/pdfengine/ErrorCode.kt',
);

describe('error codes', () => {
  it('match the Kotlin ErrorCode enum exactly', () => {
    const source = fs.readFileSync(KOTLIN_ERROR_CODE, 'utf8');
    const body = /enum class ErrorCode \{([^}]*)\}/.exec(source)?.[1] ?? '';
    const kotlinCodes = body
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
    expect(kotlinCodes).toEqual([...ERROR_CODES]);
  });
});

describe('toAppError', () => {
  it('keeps the code of native module errors', () => {
    const native = Object.assign(new Error('bad password'), { code: 'WRONG_PASSWORD' });
    const error = toAppError(native);
    expect(error).toBeInstanceOf(AppError);
    expect(error.code).toBe('WRONG_PASSWORD');
    expect(error.cause).toBe(native);
  });

  it('maps unknown codes and non-errors to UNKNOWN', () => {
    expect(toAppError(Object.assign(new Error('x'), { code: 'ERR_SOMETHING' })).code).toBe(
      'UNKNOWN',
    );
    expect(toAppError('a string').code).toBe('UNKNOWN');
    expect(toAppError(null).code).toBe('UNKNOWN');
  });

  it('returns AppErrors unchanged', () => {
    const error = new AppError('NO_SPACE');
    expect(toAppError(error)).toBe(error);
  });
});

describe('toUserMessage', () => {
  const codes: AppErrorCode[] = [...ERROR_CODES, 'UNKNOWN'];

  it.each(codes)('%s has a title, message and recovery action', (code) => {
    const message = toUserMessage(code);
    expect(message.title.length).toBeGreaterThan(0);
    expect(message.message.length).toBeGreaterThan(0);
    expect(message.recovery).toBeDefined();
  });

  it('offers the expected recovery for key codes', () => {
    expect(toUserMessage('PASSWORD_REQUIRED').recovery).toBe('enterPassword');
    expect(toUserMessage('NO_SPACE').recovery).toBe('freeSpace');
    expect(toUserMessage('PERMISSION_DENIED').recovery).toBe('openSettings');
    expect(toUserMessage('NOT_FOUND').recovery).toBe('pickAnotherFile');
    expect(toUserMessage('CANCELLED').recovery).toBe('none');
  });
});
