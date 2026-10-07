package com.ismailidris.pdfreader.pdfengine

import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers

/**
 * PDFium is not thread-safe. Every PdfiumNative call in this module runs on
 * this dispatcher, which executes one task at a time. It is process-wide so a
 * module instance being torn down (JS reload) and its replacement still share
 * it. The JNI layer's global lock remains as a second line of defence.
 */
internal object PdfiumThread {
  val dispatcher: CoroutineDispatcher = Dispatchers.IO.limitedParallelism(1, "pdfium")
}
