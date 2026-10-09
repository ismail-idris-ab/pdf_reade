package com.ismailidris.pdfreader.fileindex

import android.system.ErrnoException
import android.system.OsConstants
import expo.modules.kotlin.exception.CodedException
import kotlinx.coroutines.CancellationException
import java.io.FileNotFoundException
import java.nio.file.AccessDeniedException
import java.nio.file.FileAlreadyExistsException
import java.nio.file.NoSuchFileException

/** Maps I/O failures to coded exceptions whose messages never contain paths. */
object IoFailures {
  /**
   * Maps any failure to a coded exception with a static message, so no
   * exception text (which can hold URIs or paths) reaches JS. Errno checks run
   * before the FileNotFoundException branch because FileInputStream and
   * FileOutputStream report EACCES/EPERM/EROFS/ENOSPC as FileNotFoundException.
   * Anything unrecognised gets [fallbackCode], a non-shared ERR_* code.
   */
  fun map(error: Throwable, fallbackCode: String, message: String): Throwable = when {
    error is CancellationException || error is CodedException -> error
    error is FileOpFailure -> CodedException(error.code, error.message ?: message, null)
    error is OutOfMemoryError -> FileIndexException(ErrorCode.OUT_OF_MEMORY, message)
    hasErrno(error, OsConstants.ENOSPC, "ENOSPC", "No space left on device") ->
      FileIndexException(ErrorCode.NO_SPACE, message)
    error is AccessDeniedException ||
      hasErrno(error, OsConstants.EACCES, "EACCES", "Permission denied") ||
      hasErrno(error, OsConstants.EPERM, "EPERM", "Operation not permitted") ||
      hasErrno(error, OsConstants.EROFS, "EROFS", "Read-only file system") ->
      FileIndexException(ErrorCode.PERMISSION_DENIED, message)
    error is SecurityException -> FileIndexException(ErrorCode.PERMISSION_DENIED, message)
    error is FileNotFoundException || error is NoSuchFileException -> FileIndexException(ErrorCode.NOT_FOUND, message)
    error is FileAlreadyExistsException -> CodedException(FileOpCodes.ERR_NAME_EXISTS, message, null)
    else -> CodedException(fallbackCode, message, null)
  }

  /** The JS-facing code [map] would give [error]. */
  fun codeOf(error: Throwable, fallbackCode: String): String =
    when (val mapped = map(error, fallbackCode, "")) {
      is CodedException -> mapped.code
      else -> fallbackCode
    }

  /** True when [errno] (as ErrnoException) or one of [markers] appears in the cause chain. */
  private fun hasErrno(error: Throwable, errno: Int, vararg markers: String): Boolean {
    var current: Throwable? = error
    while (current != null) {
      if (current is ErrnoException && current.errno == errno) return true
      val text = current.message
      if (text != null && markers.any { text.contains(it) }) return true
      current = current.cause
    }
    return false
  }
}
