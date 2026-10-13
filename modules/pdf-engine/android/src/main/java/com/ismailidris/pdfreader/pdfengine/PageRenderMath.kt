package com.ismailidris.pdfreader.pdfengine

import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToLong
import kotlin.math.sqrt

/** Size of one page bitmap in pixels. */
internal data class RenderPlan(val widthPx: Int, val heightPx: Int) {
  val pixels: Long get() = widthPx.toLong() * heightPx
  val bytes: Long get() = pixels * PageRenderMath.BYTES_PER_PIXEL
}

/** Limits on one page bitmap. A plan over any of them is scaled down, keeping the aspect ratio. */
internal data class RenderCaps(val maxPixels: Long, val maxSide: Int) {
  init {
    require(maxPixels >= 1 && maxSide >= 1)
  }
}

/**
 * Bitmap sizing for PdfPageView, pure so it is unit-tested on the JVM.
 *
 * renderScale is bitmap pixels per layout dp, so the bitmap is the view's
 * layout size in dp (view px / display density) times renderScale.
 */
internal object PageRenderMath {
  const val BYTES_PER_PIXEL = 4 // ARGB_8888

  private const val MB = 1024L * 1024

  /**
   * Pool budget bounds. A quarter of the app's heap class leaves the Java
   * heap, JS, Skia overlays and PDFium's own caches room inside the 250 MB
   * reader budget: memoryClass 128 (2 GB phones) gives 32 MB, 256 (3–4 GB)
   * gives 64 MB, and 384+ is capped at 96 MB, which already holds ~14
   * full-screen pages at 1×. The floor keeps two typical pages on devices
   * that report a tiny class.
   */
  const val MIN_POOL_BUDGET_BYTES = 24L * MB
  const val MAX_POOL_BUDGET_BYTES = 96L * MB

  /**
   * 16 MP (64 MB of pixels) is ~3× zoom of a full-width A4 page on a 1080 px
   * wide phone (1.65 MP at 1×). Above that one bitmap is too large a share of
   * the reader's 250 MB budget; deeper zoom needs tiles (T2.4), not a bigger
   * bitmap. On small heaps [capsFor] lowers it further.
   */
  const val MAX_PIXELS = 16_000_000L

  /**
   * android.graphics.RecordingCanvas.MAX_BITMAP_SIZE: drawing a bitmap
   * larger than 100 MiB throws "Canvas: trying to draw too large bitmap".
   */
  const val DRAW_BITMAP_LIMIT_BYTES = 100L * MB

  /**
   * Largest side drawn. 8192 is the GL_MAX_TEXTURE_SIZE floor of current
   * Mali, Adreno and PowerVR GPUs; querying the real value needs an EGL
   * context, which is not cheap at start-up.
   */
  const val MAX_SIDE = 8192

  /** Budget for all page bitmaps (in use + pooled), from ActivityManager.memoryClass in MB. */
  fun poolBudgetBytes(memoryClassMb: Int): Long =
    (memoryClassMb.toLong() * MB / 4).coerceIn(MIN_POOL_BUDGET_BYTES, MAX_POOL_BUDGET_BYTES)

  /**
   * Per-bitmap caps for a pool of [poolBudgetBytes]. One bitmap may use at
   * most half the budget, so a view can hold its old bitmap while the new one
   * renders without the pair exceeding the budget on its own.
   */
  fun capsFor(poolBudgetBytes: Long): RenderCaps {
    val byBudget = poolBudgetBytes / 2 / BYTES_PER_PIXEL
    val byDrawLimit = DRAW_BITMAP_LIMIT_BYTES / BYTES_PER_PIXEL
    return RenderCaps(maxPixels = max(1L, min(MAX_PIXELS, min(byBudget, byDrawLimit))), maxSide = MAX_SIDE)
  }

  /**
   * The bitmap for a view of [viewWidthPx] x [viewHeightPx] at [density] px
   * per dp and [renderScale] bitmap px per dp, lowered to fit [caps]; null
   * when the view has no size yet or the inputs are not usable numbers.
   */
  fun plan(viewWidthPx: Int, viewHeightPx: Int, density: Float, renderScale: Double, caps: RenderCaps): RenderPlan? {
    if (viewWidthPx <= 0 || viewHeightPx <= 0) return null
    if (!density.isFinite() || density <= 0f || !isValidScale(renderScale)) return null
    val width = viewWidthPx / density.toDouble() * renderScale
    val height = viewHeightPx / density.toDouble() * renderScale
    return fit(width, height, caps)
  }

  /** True for a finite, positive renderScale. */
  fun isValidScale(renderScale: Double): Boolean = renderScale.isFinite() && renderScale > 0.0

  /** Rounds [width] x [height] to whole pixels (at least 1), scaled down uniformly to fit [caps]. */
  fun fit(width: Double, height: Double, caps: RenderCaps): RenderPlan {
    val w = max(width, 1.0)
    val h = max(height, 1.0)
    var factor = 1.0
    if (w * h > caps.maxPixels) factor = sqrt(caps.maxPixels / (w * h))
    val longest = max(w, h) * factor
    if (longest > caps.maxSide) factor *= caps.maxSide / longest
    if (factor >= 1.0) {
      return RenderPlan(clampSide(w.roundToLong()), clampSide(h.roundToLong()))
    }
    // Floor so the capped plan never rounds back over a cap; the epsilon keeps
    // an exact side (e.g. maxSide) from flooring to one less after float error.
    fun side(value: Double) = min(clampSide(floor(value * factor + FLOOR_EPSILON).toLong()), caps.maxSide)
    return RenderPlan(side(w), side(h))
  }

  private const val FLOOR_EPSILON = 1e-6

  /** The plan at half the scale (the out-of-memory retry), or null when it cannot shrink. */
  fun halve(plan: RenderPlan): RenderPlan? {
    if (plan.widthPx <= 1 && plan.heightPx <= 1) return null
    return RenderPlan(max(1, plan.widthPx / 2), max(1, plan.heightPx / 2))
  }

  private fun clampSide(value: Long): Int = value.coerceIn(1L, Int.MAX_VALUE.toLong()).toInt()
}

/** How the page paper is drawn. Night wins over sepia. */
internal enum class PaperMode {
  DAY,
  SEPIA,
  NIGHT,
  ;

  companion object {
    fun of(nightMode: Boolean, sepia: Boolean): PaperMode = when {
      nightMode -> NIGHT
      sepia -> SEPIA
      else -> DAY
    }
  }
}

/**
 * Colour matrices (android.graphics.ColorMatrix layout: 4 rows of
 * [r, g, b, a, offset], offsets in 0–255) and placeholder colours per
 * [PaperMode]. Pure so they are unit-tested on the JVM.
 */
internal object PaperColors {
  /** Sepia paper (white maps here) and ink (black maps here). */
  private const val SEPIA_PAPER_R = 0xF4
  private const val SEPIA_PAPER_G = 0xEC
  private const val SEPIA_PAPER_B = 0xD8
  private const val SEPIA_INK_R = 0x3B
  private const val SEPIA_INK_G = 0x2F
  private const val SEPIA_INK_B = 0x25

  /** Matrix for [mode], or null when the bitmap is drawn unfiltered. */
  fun matrix(mode: PaperMode): FloatArray? = when (mode) {
    PaperMode.DAY -> null
    // Inverts RGB, keeps alpha: white paper becomes black, black ink white.
    PaperMode.NIGHT -> floatArrayOf(
      -1f, 0f, 0f, 0f, 255f,
      0f, -1f, 0f, 0f, 255f,
      0f, 0f, -1f, 0f, 255f,
      0f, 0f, 0f, 1f, 0f,
    )
    // Per channel, maps 0..255 linearly onto ink..paper: a warm tint that
    // keeps the page's tonal range.
    PaperMode.SEPIA -> floatArrayOf(
      (SEPIA_PAPER_R - SEPIA_INK_R) / 255f, 0f, 0f, 0f, SEPIA_INK_R.toFloat(),
      0f, (SEPIA_PAPER_G - SEPIA_INK_G) / 255f, 0f, 0f, SEPIA_INK_G.toFloat(),
      0f, 0f, (SEPIA_PAPER_B - SEPIA_INK_B) / 255f, 0f, SEPIA_INK_B.toFloat(),
      0f, 0f, 0f, 1f, 0f,
    )
  }

  /** Placeholder colour (ARGB): white paper as it looks through [matrix]. */
  fun paperColor(mode: PaperMode): Int = apply(mode, WHITE)

  /** [argb] transformed by [mode]'s matrix, the same arithmetic ColorMatrixColorFilter does. */
  fun apply(mode: PaperMode, argb: Int): Int {
    val m = matrix(mode) ?: return argb
    val a = (argb ushr 24) and 0xFF
    val r = (argb shr 16) and 0xFF
    val g = (argb shr 8) and 0xFF
    val b = argb and 0xFF
    fun row(i: Int): Int {
      val o = i * 5
      val v = m[o] * r + m[o + 1] * g + m[o + 2] * b + m[o + 3] * a + m[o + 4]
      return Math.round(v).coerceIn(0, 255)
    }
    return (row(3) shl 24) or (row(0) shl 16) or (row(1) shl 8) or row(2)
  }

  const val WHITE = -0x1 // 0xFFFFFFFF
}
