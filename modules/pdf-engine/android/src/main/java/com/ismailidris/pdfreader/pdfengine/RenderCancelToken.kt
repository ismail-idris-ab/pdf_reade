package com.ismailidris.pdfreader.pdfengine

/**
 * Owns one native cancel flag for a progressive render. [cancel] may come
 * from any thread at any time, including after [close]; the lock makes sure
 * it never touches a freed flag. [close] only after the render returned.
 */
internal class RenderCancelToken private constructor(private var pointer: Long) {
  @Volatile
  var isCancelled = false
    private set

  /** Set when the cancel came from the document closing (reported as ERR_DOC_NOT_OPEN). */
  @Volatile
  var documentClosed = false
    private set

  /** The native flag for PdfiumNative.renderPageProgressive; 0 once closed. */
  val nativeHandle: Long
    @Synchronized get() = pointer

  @Synchronized
  fun cancel(documentClosing: Boolean = false) {
    if (documentClosing) documentClosed = true
    isCancelled = true
    if (pointer != 0L) PdfiumNative.cancelToken(pointer)
  }

  @Synchronized
  fun close() {
    if (pointer == 0L) return
    PdfiumNative.freeCancelToken(pointer)
    pointer = 0L
  }

  companion object {
    fun create(): RenderCancelToken = RenderCancelToken(PdfiumNative.newCancelToken())
  }
}
