package com.ismailidris.pdfreader.pdfengine

import kotlin.math.ceil
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
   * Whole-page bitmap caps for a pool of [poolBudgetBytes]: a quarter of the
   * budget each, for pages shown unzoomed. On a 32 MB pool that is 2 Mi px:
   * a 1080 x 2400 phone's unzoomed A4 page is 1.65 MP, a 720p one's 0.73 MP.
   * A page over this cap is zoomed in: it is drawn as a backdrop at
   * [backdropCapsFor] with a detail tile ([tileCapsFor]) for the visible part.
   */
  fun capsFor(poolBudgetBytes: Long): RenderCaps {
    val byBudget = poolBudgetBytes / 4 / BYTES_PER_PIXEL
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

  /**
   * Backdrop caps: a zoomed page's whole-page bitmap, under the detail tile,
   * gets an eighth of the budget (1 Mi px on 32 MB). It only shows while a
   * pan or zoom settles, so it can be soft.
   */
  fun backdropCapsFor(poolBudgetBytes: Long): RenderCaps {
    val byBudget = poolBudgetBytes / 8 / BYTES_PER_PIXEL
    return RenderCaps(maxPixels = max(1L, min(MAX_PIXELS, byBudget)), maxSide = MAX_SIDE)
  }

  /**
   * Detail tile caps: a quarter of the budget each, at most [MAX_TILE_PIXELS].
   * On a 32 MB pool a tile is 2 Mi px: a 720p viewport (1.15 MP) at full
   * scale, a 1080 x 2400 one (2.6 MP) at 0.9x linear. Tiles are 64 px
   * buckets ([TILE_BUCKET_PX]); the cap is checked on the bucket.
   *
   * Worst case in use while zoomed, with at most two pages visible:
   * - pages: a page zoomed in keeps its 1x bitmap as backdrop (no render;
   *   see PageRenderController), so two pages hold at most 2 x 1/4 of the
   *   budget; a backdrop rendered fresh is smaller (1/8).
   * - tiles: each covers its page's visible part, so the shown tiles together
   *   cover at most one viewport, and the replacements in flight another:
   *   at most 2 viewports of pixels (each tile also capped at 1/4).
   * 720p on 32 MB: 16 MB + 2 x 4.6 MB = 25 MB. 1080 x 2400 on 64 MB (its
   * usual class): 32 MB + 2 x 10.4 MB = 53 MB. 1080 x 2400 on a 32 MB pool
   * would reach 37 MB during a tile swap, 15% over the soft budget, for one
   * frame-to-render interval; checked-out bitmaps may exceed it (see
   * BitmapPool) and every bitmap stays under its own cap.
   */
  fun tileCapsFor(poolBudgetBytes: Long): RenderCaps {
    val byBudget = poolBudgetBytes / 4 / BYTES_PER_PIXEL
    return RenderCaps(maxPixels = max(1L, min(MAX_TILE_PIXELS, byBudget)), maxSide = MAX_SIDE)
  }

  /**
   * True when the whole-page bitmap for this view would be lowered by
   * [caps], i.e. it is below renderScale and a detail tile adds sharpness.
   */
  fun isCapped(viewWidthPx: Int, viewHeightPx: Int, density: Float, renderScale: Double, caps: RenderCaps): Boolean {
    val plan = plan(viewWidthPx, viewHeightPx, density, renderScale, caps) ?: return false
    val wanted = viewWidthPx / density.toDouble() * renderScale
    return plan.widthPx < wanted * CAPPED_RATIO
  }

  /** [region] clamped to the unit square, or null when it is not finite or has no area left. */
  fun clampRegion(region: NormalizedRegion): NormalizedRegion? {
    with(region) {
      if (!x.isFinite() || !y.isFinite() || !width.isFinite() || !height.isFinite()) return null
      val left = x.coerceIn(0.0, 1.0)
      val top = y.coerceIn(0.0, 1.0)
      val right = (x + width).coerceIn(0.0, 1.0)
      val bottom = (y + height).coerceIn(0.0, 1.0)
      if (right <= left || bottom <= top) return null
      return NormalizedRegion(left, top, right - left, bottom - top)
    }
  }

  /**
   * The tile that shows [region] (normalized to the view's displayed bounds)
   * at [renderScale]: the page is drawn at the view's full target size
   * (layout dp x renderScale) and the tile is the pixel-aligned window over
   * the region, so it is at most the region's on-screen size when renderScale
   * is the density. Over [caps] the whole page image is scaled down until the
   * window fits. Null when the view has no size or the inputs are unusable.
   * Rotation needs no handling: the region and PDFium's output are both in
   * displayed orientation.
   */
  fun tilePlan(
    viewWidthPx: Int,
    viewHeightPx: Int,
    density: Float,
    renderScale: Double,
    region: NormalizedRegion,
    caps: RenderCaps,
  ): TilePlan? {
    if (viewWidthPx <= 0 || viewHeightPx <= 0) return null
    if (!density.isFinite() || density <= 0f || !isValidScale(renderScale)) return null
    val clamped = clampRegion(region) ?: return null
    val fullWidth = viewWidthPx / density.toDouble() * renderScale
    val fullHeight = viewHeightPx / density.toDouble() * renderScale
    var factor = 1.0
    // ceil() can push a scaled window back over a cap by a pixel; a few rounds settle it.
    repeat(MAX_TILE_FIT_ROUNDS) {
      val tile = window(fullWidth * factor, fullHeight * factor, clamped)
      val pixels = tile.bitmap.pixels.toDouble()
      val longest = max(tile.bitmap.widthPx, tile.bitmap.heightPx).toDouble()
      if (pixels <= caps.maxPixels && longest <= caps.maxSide) return tile
      factor *= min(sqrt(caps.maxPixels / pixels), caps.maxSide / longest) * TILE_SHRINK_MARGIN
    }
    return window(fullWidth * factor, fullHeight * factor, clamped)
  }

  private fun window(pageWidth: Double, pageHeight: Double, region: NormalizedRegion): TilePlan {
    val pageW = clampSide(pageWidth.roundToLong())
    val pageH = clampSide(pageHeight.roundToLong())
    val left = floor(region.x * pageW + FLOOR_EPSILON).toInt().coerceIn(0, pageW - 1)
    val top = floor(region.y * pageH + FLOOR_EPSILON).toInt().coerceIn(0, pageH - 1)
    val right = ceil((region.x + region.width) * pageW - FLOOR_EPSILON).toInt().coerceIn(left + 1, pageW)
    val bottom = ceil((region.y + region.height) * pageH - FLOOR_EPSILON).toInt().coerceIn(top + 1, pageH)
    val content = RenderPlan(right - left, bottom - top)
    val bitmap = RenderPlan(bucket(content.widthPx + TILE_PAD_PX), bucket(content.heightPx + TILE_PAD_PX))
    return TilePlan(content, TileWindow(-left, -top, pageW, pageH), bitmap, TILE_PAD_PX)
  }

  /** [side] rounded up to a whole [TILE_BUCKET_PX], so tiles of similar size share pooled bitmaps. */
  fun bucket(side: Int): Int = ((side + TILE_BUCKET_PX - 1) / TILE_BUCKET_PX) * TILE_BUCKET_PX

  /** Detail tiles never exceed 5 MP (20 MB): a 1440 x 3200 screen is 4.6 MP. */
  const val MAX_TILE_PIXELS = 5_000_000L

  /** Tile bitmaps are whole multiples of this many px on each side, for pool reuse. */
  const val TILE_BUCKET_PX = 64

  /**
   * The tile content starts this many px into its bitmap. PDFium rasterises
   * glyphs that cross the bitmap's left edge (column 0) differently from the
   * same glyphs in a full render: on device, an 8 px band at the tile's left
   * edge differed by up to 136 levels (a visible seam). With the page drawn
   * from 1 px or more inside the bitmap the tile matched the full render
   * exactly, so the edge is padded and never drawn; 4 px leaves margin.
   */
  const val TILE_PAD_PX = 4

  /** Below this share of the wanted width the page bitmap counts as capped (rounding stays above it). */
  private const val CAPPED_RATIO = 0.98
  private const val MAX_TILE_FIT_ROUNDS = 4
  private const val TILE_SHRINK_MARGIN = 0.999

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

/**
 * A rectangle normalized to a view's displayed bounds (rotation applied):
 * 0–1 on both axes, origin top-left.
 */
internal data class NormalizedRegion(val x: Double, val y: Double, val width: Double, val height: Double)

/**
 * Where a detail tile sits in the full page image: PDFium draws the page at
 * [pageWidthPx] x [pageHeightPx] with its top-left at ([startX], [startY])
 * in the tile bitmap (both <= 0), and clips to the tile.
 */
internal data class TileWindow(val startX: Int, val startY: Int, val pageWidthPx: Int, val pageHeightPx: Int)

/**
 * A detail tile. [tile] is the content: the pixel-aligned window over the
 * region, at [window] in the full page image. In the [bitmap] (rounded up to
 * 64 px buckets) the content starts at ([pad], [pad]); everything around it
 * is more of the page and is never drawn. Render with [renderWindow].
 */
internal data class TilePlan(val tile: RenderPlan, val window: TileWindow, val bitmap: RenderPlan = tile, val pad: Int = 0) {
  /** Where PDFium draws the page in [bitmap]: the content window moved in by [pad]. */
  val renderWindow: TileWindow
    get() = window.copy(startX = window.startX + pad, startY = window.startY + pad)

  /** The page area the tile actually covers (pixel-aligned, so a little more than the region). */
  val covered: NormalizedRegion
    get() = NormalizedRegion(
      -window.startX.toDouble() / window.pageWidthPx,
      -window.startY.toDouble() / window.pageHeightPx,
      tile.widthPx.toDouble() / window.pageWidthPx,
      tile.heightPx.toDouble() / window.pageHeightPx,
    )
}
