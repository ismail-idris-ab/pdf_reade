package com.ismailidris.pdfreader.pdfengine

import java.security.MessageDigest
import kotlin.math.roundToLong

/**
 * Thumbnail bitmap size, and the size the full page is scaled to inside it
 * (anchored top-left). renderHeight > bitmapHeight means the bottom is cropped.
 */
internal data class ThumbnailGeometry(
  val bitmapWidth: Int,
  val bitmapHeight: Int,
  val renderWidth: Int,
  val renderHeight: Int,
)

/** Pure sizing and cache-key rules for library thumbnails. */
internal object ThumbnailMath {
  const val MIN_WIDTH_PX = 48
  const val MAX_WIDTH_PX = 360

  /** Tall pages are cropped in height to this multiple of the width. */
  const val MAX_HEIGHT_RATIO = 2

  /**
   * Upper bound on the scaled page height handed to PDFium. Only absurd
   * aspect ratios reach it; such a page is squashed to this height instead of
   * overflowing.
   */
  const val MAX_RENDER_EXTENT_PX = 1 shl 20

  /** Clamps a JS-supplied width to [MIN_WIDTH_PX, MAX_WIDTH_PX]; NaN maps to the minimum. */
  fun clampWidth(widthPx: Double): Int {
    if (widthPx.isNaN()) return MIN_WIDTH_PX
    return widthPx.coerceIn(MIN_WIDTH_PX.toDouble(), MAX_WIDTH_PX.toDouble()).roundToLong().toInt()
  }

  /**
   * Bitmap size plus the size the whole page is scaled to. The page keeps its
   * aspect ratio at [width] px wide; the bitmap is that tall but capped at
   * [MAX_HEIGHT_RATIO] x width, so a tall page is top-cropped (its bottom
   * falls outside the bitmap), never squashed. Heights are at least 1. A page
   * with an unusable size (zero, negative, NaN, infinite) renders square.
   */
  fun geometryFor(width: Int, pageWidthPt: Float, pageHeightPt: Float): ThumbnailGeometry {
    val maxHeight = (width.toLong() * MAX_HEIGHT_RATIO).coerceIn(1L, Int.MAX_VALUE.toLong()).toInt()
    val usable = pageWidthPt.isFinite() && pageHeightPt.isFinite() && pageWidthPt > 0f && pageHeightPt > 0f
    val renderHeight = if (usable) {
      (width.toDouble() * pageHeightPt.toDouble() / pageWidthPt.toDouble())
        .roundToLong()
        .coerceIn(1L, MAX_RENDER_EXTENT_PX.toLong())
        .toInt()
    } else {
      width.coerceAtLeast(1)
    }
    return ThumbnailGeometry(
      bitmapWidth = width,
      bitmapHeight = renderHeight.coerceAtMost(maxHeight),
      renderWidth = width,
      renderHeight = renderHeight,
    )
  }

  /** Hex SHA-1 of "source|mtime|size|width"; the cache file is "<key>.webp". */
  fun cacheKey(source: String, mtimeMs: Long, sizeBytes: Long, clampedWidth: Int): String {
    val digest = MessageDigest.getInstance("SHA-1")
      .digest("$source|$mtimeMs|$sizeBytes|$clampedWidth".toByteArray(Charsets.UTF_8))
    val hex = StringBuilder(digest.size * 2)
    for (byte in digest) {
      val value = byte.toInt() and 0xFF
      hex.append(HEX[value ushr 4]).append(HEX[value and 0x0F])
    }
    return hex.toString()
  }

  private const val HEX = "0123456789abcdef"
}
