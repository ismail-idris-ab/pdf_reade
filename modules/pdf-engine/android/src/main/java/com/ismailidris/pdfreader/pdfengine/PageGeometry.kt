package com.ismailidris.pdfreader.pdfengine

/**
 * A page's visible box (crop box clipped to the media box) in PDF user space:
 * y grows upward and the origin may be anywhere. Always ordered:
 * [left] <= [right] and [bottom] <= [top].
 */
internal class PageBox private constructor(
  val left: Double,
  val bottom: Double,
  val right: Double,
  val top: Double,
) {
  val width: Double get() = right - left
  val height: Double get() = top - bottom

  override fun equals(other: Any?): Boolean =
    other is PageBox && left == other.left && bottom == other.bottom && right == other.right && top == other.top

  override fun hashCode(): Int = listOf(left, bottom, right, top).hashCode()

  override fun toString(): String = "PageBox(left=$left, bottom=$bottom, right=$right, top=$top)"

  companion object {
    /** Builds a box from two opposite corners given in any order. */
    fun of(x1: Double, y1: Double, x2: Double, y2: Double): PageBox =
      PageBox(minOf(x1, x2), minOf(y1, y2), maxOf(x1, x2), maxOf(y1, y2))
  }
}

/**
 * One page's exact geometry, read when the page is first loaded: its box for
 * coordinate conversion and its /Rotate in clockwise degrees (0/90/180/270).
 */
internal data class PageGeometryInfo(val box: PageBox, val rotation: Int)

/** A page's displayed size in points (/Rotate applied), as reported by open. */
internal data class PageSize(val width: Double, val height: Double) {
  fun toMap(): Map<String, Double> = mapOf("width" to width, "height" to height)
}

/** Rectangle in normalized page space (0–1, origin top-left, y down, unrotated page box). */
internal data class NormalizedRect(val x: Double, val y: Double, val width: Double, val height: Double) {
  fun toMap(): Map<String, Double> = mapOf("x" to x, "y" to y, "width" to width, "height" to height)
}

/**
 * Converts PDF user space (y up, arbitrary origin) to the normalized page
 * space exchanged with JS: 0–1 on both axes relative to the unrotated page
 * box, origin at its top-left, y growing downward. Pure, no PDFium.
 */
internal object PageGeometry {
  /**
   * Leading values of PdfiumNative.textBoxes / searchPage output: left,
   * bottom, right, top of the page box (user space), then rotation quarter turns.
   */
  const val HEADER_SIZE = 5

  /**
   * Size used for a page PDFium cannot size (no valid page dictionary): US
   * Letter, the same default PDFium applies to a page without a media box.
   * Such a page then fails with CORRUPT_FILE when it is read.
   */
  val FALLBACK_SIZE = PageSize(612.0, 792.0)

  /**
   * The page geometry at the start of [raw]. Null when the data is too short
   * or the box is degenerate, which callers treat as an unreadable page.
   */
  fun decodeHeader(raw: DoubleArray): PageGeometryInfo? {
    if (raw.size < HEADER_SIZE) return null
    val box = PageBox.of(raw[0], raw[1], raw[2], raw[3])
    if (!box.width.isFinite() || !box.height.isFinite() || box.width <= 0.0 || box.height <= 0.0) return null
    return PageGeometryInfo(box, rotationDegrees(raw[4].toInt()))
  }

  /**
   * Decodes PdfiumNative.pageSizes output ([width, height] per page) for
   * [count] pages. Pages without a usable size get [FALLBACK_SIZE] so one bad
   * page never fails the whole document.
   */
  fun decodeSizes(raw: DoubleArray, count: Int): List<PageSize> {
    require(raw.size == count * 2) { "Malformed page size data" }
    return List(count) { i ->
      val width = raw[i * 2]
      val height = raw[i * 2 + 1]
      if (width.isFinite() && height.isFinite() && width > 0.0 && height > 0.0) PageSize(width, height) else FALLBACK_SIZE
    }
  }

  /** PDFium's FPDFPage_GetRotation quarter turns (0-3, -1 unknown) as clockwise degrees. */
  fun rotationDegrees(quarterTurns: Int): Int = when (quarterTurns) {
    1 -> 90
    2 -> 180
    3 -> 270
    else -> 0
  }

  /**
   * Normalizes a user-space rectangle given by two opposite corners
   * (any order), clamped to the page box. Null when nothing of it lies
   * inside the box, when any coordinate is not finite, or when the box is
   * degenerate.
   */
  fun normalize(box: PageBox, x1: Double, y1: Double, x2: Double, y2: Double): NormalizedRect? {
    if (!x1.isFinite() || !y1.isFinite() || !x2.isFinite() || !y2.isFinite()) return null
    if (!(box.width > 0.0) || !(box.height > 0.0)) return null
    val left = normalizeX(box, minOf(x1, x2))
    val right = normalizeX(box, maxOf(x1, x2))
    // Higher user-space y is nearer the top, so it gives the smaller normalized y.
    val top = normalizeY(box, maxOf(y1, y2))
    val bottom = normalizeY(box, minOf(y1, y2))
    val width = right - left
    val height = bottom - top
    if (width <= 0.0 && height <= 0.0) return null
    if (isOutside(box, x1, y1, x2, y2)) return null
    return NormalizedRect(left, top, width, height)
  }

  /** Normalized x of user-space [x], clamped to [0, 1]. */
  fun normalizeX(box: PageBox, x: Double): Double = clamp01((x - box.left) / box.width)

  /** Normalized y (top-down) of user-space [y], clamped to [0, 1]. */
  fun normalizeY(box: PageBox, y: Double): Double = clamp01((box.top - y) / box.height)

  /** True when the rectangle lies entirely beyond one edge of the box. */
  private fun isOutside(box: PageBox, x1: Double, y1: Double, x2: Double, y2: Double): Boolean =
    maxOf(x1, x2) < box.left || minOf(x1, x2) > box.right || maxOf(y1, y2) < box.bottom || minOf(y1, y2) > box.top

  private fun clamp01(value: Double): Double = when {
    value.isNaN() -> 0.0
    value < 0.0 -> 0.0
    value > 1.0 -> 1.0
    else -> value
  }
}
