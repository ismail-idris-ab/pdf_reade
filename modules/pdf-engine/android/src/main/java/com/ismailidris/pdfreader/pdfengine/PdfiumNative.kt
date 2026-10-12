package com.ismailidris.pdfreader.pdfengine

import android.graphics.Bitmap

/**
 * JNI bindings to PDFium (see src/main/cpp/pdfengine_jni.cpp). Document handles
 * are native pointers; every handle from [open] must be passed to [close]
 * exactly once, and no other call may use it afterwards. Call only from
 * [PdfiumThread.dispatcher].
 *
 * Load failures surface as IOException whose message is
 * "PDFIUM_ERROR:<FPDF_GetLastError code>"; a page that cannot be loaded for
 * text or search reports FPDF_ERR_PAGE the same way. Native allocation
 * failures surface as OutOfMemoryError. Coordinates are PDF user space.
 */
internal object PdfiumNative {
  init {
    System.loadLibrary("pdfengine")
    nativeInit()
  }

  // Paths and passwords cross JNI as standard UTF-8 bytes; see readUtf8 in pdfengine_jni.cpp.
  fun open(path: String, password: String? = null): Long =
    nativeOpen(path.toByteArray(Charsets.UTF_8), password?.toByteArray(Charsets.UTF_8))

  fun close(handle: Long) = nativeClose(handle)

  fun pageCount(handle: Long): Int = nativePageCount(handle)

  /** FPDF_GetSecurityHandlerRevision: -1 when the document is not encrypted. */
  fun securityHandlerRevision(handle: Long): Int = nativeSecurityHandlerRevision(handle)

  /** Page size in PDF points as [width, height], rotation applied. */
  fun pageSize(handle: Long, index: Int): FloatArray = nativePageSize(handle, index)

  /**
   * Displayed size ([width, height] in points, /Rotate applied) of each page
   * in [start, start + count); NaN for a page without a valid dictionary.
   * Does not load or parse the pages.
   */
  fun pageSizes(handle: Long, start: Int, count: Int): DoubleArray = nativePageSizes(handle, start, count)

  /**
   * Renders page [index] scaled to [sizeX] x [sizeY] px at the bitmap's
   * top-left; anything beyond the bitmap is clipped. The defaults fill the bitmap.
   */
  fun renderPage(handle: Long, index: Int, bitmap: Bitmap, sizeX: Int = bitmap.width, sizeY: Int = bitmap.height) =
    nativeRenderPage(handle, index, bitmap, sizeX, sizeY)

  /** Unicode value per PDFium character index (0 = unmapped). */
  fun pageChars(handle: Long, index: Int): IntArray = nativePageChars(handle, index)

  /**
   * [PageGeometry.HEADER_SIZE] geometry values, then per character: unicode,
   * left, top, right, bottom (NaN box when it has none).
   */
  fun textBoxes(handle: Long, index: Int): DoubleArray = nativeTextBoxes(handle, index)

  /** Page geometry then raw search hits for one page; decode with [SearchResults.decode]. */
  fun searchPage(handle: Long, index: Int, query: String, flags: Int, maxMatches: Int): DoubleArray =
    nativeSearchPage(handle, index, query.toCharArray(), flags, maxMatches)

  /** First child of [bookmark], or the first top-level item when [bookmark] is 0; 0 when none. */
  fun bookmarkFirstChild(handle: Long, bookmark: Long): Long = nativeBookmarkFirstChild(handle, bookmark)

  fun bookmarkNextSibling(handle: Long, bookmark: Long): Long = nativeBookmarkNextSibling(handle, bookmark)

  fun bookmarkTitle(bookmark: Long): String = String(nativeBookmarkTitle(bookmark))

  /** Target page index of the bookmark (destination or GoTo action), or -1. */
  fun bookmarkPage(handle: Long, bookmark: Long): Int = nativeBookmarkPage(handle, bookmark)

  private external fun nativeInit()
  private external fun nativeOpen(path: ByteArray, password: ByteArray?): Long
  private external fun nativeClose(handle: Long)
  private external fun nativePageCount(handle: Long): Int
  private external fun nativeSecurityHandlerRevision(handle: Long): Int
  private external fun nativePageSize(handle: Long, index: Int): FloatArray
  private external fun nativePageSizes(handle: Long, start: Int, count: Int): DoubleArray
  private external fun nativeRenderPage(handle: Long, index: Int, bitmap: Bitmap, sizeX: Int, sizeY: Int)
  private external fun nativePageChars(handle: Long, index: Int): IntArray
  private external fun nativeTextBoxes(handle: Long, index: Int): DoubleArray
  private external fun nativeSearchPage(handle: Long, index: Int, query: CharArray, flags: Int, maxMatches: Int): DoubleArray
  private external fun nativeBookmarkFirstChild(handle: Long, bookmark: Long): Long
  private external fun nativeBookmarkNextSibling(handle: Long, bookmark: Long): Long
  private external fun nativeBookmarkTitle(bookmark: Long): CharArray
  private external fun nativeBookmarkPage(handle: Long, bookmark: Long): Int
}

/** Runs [block] with an open document and always closes it. */
internal inline fun <T> withPdfiumDocument(handle: Long, block: (Long) -> T): T {
  try {
    return block(handle)
  } finally {
    PdfiumNative.close(handle)
  }
}
