package com.ismailidris.pdfreader.pdfengine

import android.system.ErrnoException
import android.system.OsConstants
import kotlinx.coroutines.CancellationException

/** True when ENOSPC appears in the cause chain, as ErrnoException or in a message. */
internal fun isNoSpace(error: Throwable): Boolean {
  var current: Throwable? = error
  while (current != null) {
    if (current is CancellationException) return false
    if (current is ErrnoException && current.errno == OsConstants.ENOSPC) return true
    val text = current.message
    if (text != null && (text.contains("ENOSPC") || text.contains("No space left on device"))) return true
    current = current.cause
  }
  return false
}
