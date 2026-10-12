package com.ismailidris.pdfreader.pdfengine

/** One page's search hits, with the page geometry they are relative to. */
internal class PageMatches(val geometry: PageGeometryInfo, val matches: List<List<NormalizedRect>>)

/** Pure helpers for whole-document search. No PDFium. */
internal object SearchResults {
  /**
   * Most matches one search reports. Bounds the memory held by results on
   * both sides of the bridge; a search that reaches it stops early and
   * reports exactly this many.
   */
  const val MAX_TOTAL_MATCHES = 10_000

  // FPDF_MATCHCASE / FPDF_MATCHWHOLEWORD from fpdf_text.h.
  const val FLAG_MATCH_CASE = 0x1
  const val FLAG_MATCH_WHOLE_WORD = 0x2

  fun flags(matchCase: Boolean, wholeWord: Boolean): Int =
    (if (matchCase) FLAG_MATCH_CASE else 0) or (if (wholeWord) FLAG_MATCH_WHOLE_WORD else 0)

  /** A blank query (empty or whitespace only) finds nothing and is not run. */
  fun isBlank(query: String): Boolean = query.isBlank()

  /**
   * Decodes PdfiumNative.searchPage output (a [PageGeometry.HEADER_SIZE]
   * geometry header, then [matchCount, then per match rectCount followed by
   * rectCount x (left, top, right, bottom)], user space) into normalized
   * rects per match. A match keeps its place even when none of its rects is
   * visible, so counts stay exact. Null when the header has no usable page box.
   */
  fun decode(raw: DoubleArray): PageMatches? {
    val geometry = PageGeometry.decodeHeader(raw) ?: return null
    val box = geometry.box
    var at = PageGeometry.HEADER_SIZE
    require(at < raw.size) { "Malformed search data" }
    val matchCount = raw[at++].toInt()
    require(matchCount >= 0) { "Malformed search data" }
    val matches = ArrayList<List<NormalizedRect>>(matchCount)
    repeat(matchCount) {
      require(at < raw.size) { "Malformed search data" }
      val rectCount = raw[at++].toInt()
      require(rectCount >= 0 && at + rectCount * 4 <= raw.size) { "Malformed search data" }
      val rects = ArrayList<NormalizedRect>(rectCount)
      repeat(rectCount) {
        PageGeometry.normalize(box, raw[at], raw[at + 1], raw[at + 2], raw[at + 3])?.let(rects::add)
        at += 4
      }
      matches.add(rects)
    }
    return PageMatches(geometry, matches)
  }
}

/**
 * Decides when to emit onSearchProgress: at most once per [intervalMs], and
 * always for the final page. Not thread-safe; one instance per search.
 */
internal class ProgressThrottle(private val intervalMs: Long) {
  private var lastEmitAt: Long? = null

  fun shouldEmit(nowMs: Long, pagesSearched: Int, pageCount: Int): Boolean {
    val last = lastEmitAt
    val due = pagesSearched >= pageCount || last == null || nowMs - last >= intervalMs
    if (due) lastEmitAt = nowMs
    return due
  }
}
