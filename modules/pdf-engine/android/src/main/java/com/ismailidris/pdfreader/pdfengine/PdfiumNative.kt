package com.ismailidris.pdfreader.pdfengine

import android.graphics.Bitmap

/**
 * JNI bindings to PDFium (see src/main/cpp/pdfengine_jni.cpp). Document handles
 * are native pointers; every handle from [open] or [createDocument] must be
 * passed to [close] exactly once. Load and render failures surface as
 * IOException whose message is "PDFIUM_ERROR:<FPDF_GetLastError code>"; other
 * failures carry a plain message. Mapping to typed error codes arrives in T2.1.
 */
internal object PdfiumNative {
  init {
    System.loadLibrary("pdfengine")
    nativeInit()
  }

  // Strings cross JNI as standard UTF-8 bytes; see readUtf8 in pdfengine_jni.cpp.
  fun open(path: String, password: String? = null): Long =
    nativeOpen(path.toByteArray(Charsets.UTF_8), password?.toByteArray(Charsets.UTF_8))

  fun createDocument(): Long = nativeCreateDocument()

  fun close(handle: Long) = nativeClose(handle)

  fun pageCount(handle: Long): Int = nativePageCount(handle)

  /** Page size in PDF points as [width, height]. */
  fun pageSize(handle: Long, index: Int): FloatArray = nativePageSize(handle, index)

  /**
   * Renders page [index] scaled to [sizeX] x [sizeY] px at the bitmap's
   * top-left; anything beyond the bitmap is clipped. The defaults fill the bitmap.
   */
  fun renderPage(handle: Long, index: Int, bitmap: Bitmap, sizeX: Int = bitmap.width, sizeY: Int = bitmap.height) =
    nativeRenderPage(handle, index, bitmap, sizeX, sizeY)

  fun importAllPages(dest: Long, src: Long) = nativeImportAllPages(dest, src)

  fun save(handle: Long, path: String) = nativeSave(handle, path.toByteArray(Charsets.UTF_8))

  private external fun nativeInit()
  private external fun nativeOpen(path: ByteArray, password: ByteArray?): Long
  private external fun nativeCreateDocument(): Long
  private external fun nativeClose(handle: Long)
  private external fun nativePageCount(handle: Long): Int
  private external fun nativePageSize(handle: Long, index: Int): FloatArray
  private external fun nativeRenderPage(handle: Long, index: Int, bitmap: Bitmap, sizeX: Int, sizeY: Int)
  private external fun nativeImportAllPages(dest: Long, src: Long)
  private external fun nativeSave(handle: Long, path: ByteArray)
}

/** Runs [block] with an open document and always closes it. */
internal inline fun <T> withPdfiumDocument(handle: Long, block: (Long) -> T): T {
  try {
    return block(handle)
  } finally {
    PdfiumNative.close(handle)
  }
}
