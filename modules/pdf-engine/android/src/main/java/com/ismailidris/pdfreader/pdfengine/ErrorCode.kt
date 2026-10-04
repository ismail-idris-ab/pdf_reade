package com.ismailidris.pdfreader.pdfengine

import expo.modules.kotlin.exception.CodedException

/**
 * Error codes shared with JavaScript. Keep in sync with
 * src/lib/errors/codes.ts (enforced by a Jest test).
 */
enum class ErrorCode {
  PASSWORD_REQUIRED,
  WRONG_PASSWORD,
  CORRUPT_FILE,
  UNSUPPORTED,
  NO_SPACE,
  OUT_OF_MEMORY,
  CANCELLED,
  PERMISSION_DENIED,
  NOT_FOUND,
}

/** Rejects a module call with one of the shared codes; JS reads it as `error.code`. */
class PdfEngineException(code: ErrorCode, message: String, cause: Throwable? = null) :
  CodedException(code.name, message, cause)
