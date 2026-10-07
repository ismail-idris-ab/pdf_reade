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

/** Non-shared code for thumbnail failures with no user-fixable cause; JS maps it to UNKNOWN. */
internal const val ERR_THUMBNAIL_FAILED = "ERR_THUMBNAIL_FAILED"

/** Non-shared: a content:// source that would need a private copy above the copy cap. */
internal const val ERR_THUMBNAIL_TOO_LARGE = "ERR_THUMBNAIL_TOO_LARGE"

/** Non-shared: a virtual (cloud / non-file) document; no thumbnail without downloading it. */
internal const val ERR_THUMBNAIL_UNAVAILABLE = "ERR_THUMBNAIL_UNAVAILABLE"

/** Parses PdfiumNative failures and maps FPDF_GetLastError codes to shared codes. */
internal object PdfiumErrors {
  // FPDF_ERR_* values from fpdfview.h.
  const val FPDF_ERR_SUCCESS = 0
  const val FPDF_ERR_UNKNOWN = 1
  const val FPDF_ERR_FILE = 2
  const val FPDF_ERR_FORMAT = 3
  const val FPDF_ERR_PASSWORD = 4
  const val FPDF_ERR_SECURITY = 5
  const val FPDF_ERR_PAGE = 6

  private const val PREFIX = "PDFIUM_ERROR:"

  /** The code in a "PDFIUM_ERROR:<code>" message, or null for any other message. */
  fun parseCode(message: String?): Int? {
    if (message == null || !message.startsWith(PREFIX)) return null
    return message.substring(PREFIX.length).trim().toIntOrNull()
  }

  /**
   * Shared code for a PDFium load/render failure, or null when the failure has
   * no user-fixable cause (callers then use a non-shared ERR_* code).
   * [fileExists] separates a missing file from an unreadable one for FPDF_ERR_FILE.
   */
  fun errorCodeFor(pdfiumCode: Int, fileExists: Boolean): ErrorCode? = when (pdfiumCode) {
    FPDF_ERR_PASSWORD -> ErrorCode.PASSWORD_REQUIRED
    FPDF_ERR_FORMAT, FPDF_ERR_PAGE -> ErrorCode.CORRUPT_FILE
    FPDF_ERR_FILE -> if (fileExists) ErrorCode.CORRUPT_FILE else ErrorCode.NOT_FOUND
    FPDF_ERR_SECURITY -> ErrorCode.UNSUPPORTED
    else -> null
  }
}
