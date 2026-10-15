package com.ismailidris.pdfreader.pdfengine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PageRenderMathTest {
  private val mb = 1024L * 1024
  private val roomy = RenderCaps(maxPixels = 100_000_000L, maxSide = 100_000)

  @Test
  fun bitmapIsLayoutDpTimesRenderScale() {
    // 1080 x 1527 px view at density 2.625 = 411.4 x 581.7 dp.
    assertEquals(RenderPlan(1080, 1527), PageRenderMath.plan(1080, 1527, 2.625f, 2.625, roomy))
    assertEquals(RenderPlan(411, 582), PageRenderMath.plan(1080, 1527, 2.625f, 1.0, roomy))
    assertEquals(RenderPlan(3240, 4581), PageRenderMath.plan(1080, 1527, 2.625f, 7.875, roomy))
  }

  @Test
  fun noPlanWithoutLayoutOrWithBadNumbers() {
    assertNull(PageRenderMath.plan(0, 100, 2f, 2.0, roomy))
    assertNull(PageRenderMath.plan(100, -1, 2f, 2.0, roomy))
    assertNull(PageRenderMath.plan(100, 100, 0f, 2.0, roomy))
    assertNull(PageRenderMath.plan(100, 100, 2f, 0.0, roomy))
    assertNull(PageRenderMath.plan(100, 100, 2f, -1.0, roomy))
    assertNull(PageRenderMath.plan(100, 100, 2f, Double.NaN, roomy))
    assertNull(PageRenderMath.plan(100, 100, 2f, Double.POSITIVE_INFINITY, roomy))
  }

  @Test
  fun tinyResultsAreAtLeastOnePixel() {
    assertEquals(RenderPlan(1, 1), PageRenderMath.plan(1, 1, 3f, 0.01, roomy))
  }

  @Test
  fun overThePixelCapTheScaleIsLoweredKeepingAspect() {
    val caps = RenderCaps(maxPixels = 4_000_000L, maxSide = 100_000)
    val plan = PageRenderMath.fit(4000.0, 6000.0, caps)
    assertTrue("${plan.pixels} over cap", plan.pixels <= caps.maxPixels)
    assertTrue("too far under the cap: ${plan.pixels}", plan.pixels > caps.maxPixels * 0.99)
    assertEquals(4000.0 / 6000.0, plan.widthPx.toDouble() / plan.heightPx, 0.002)
  }

  @Test
  fun overTheSideCapTheScaleIsLoweredKeepingAspect() {
    val caps = RenderCaps(maxPixels = 100_000_000L, maxSide = 8192)
    val plan = PageRenderMath.fit(1000.0, 20000.0, caps)
    assertEquals(8192, plan.heightPx)
    assertEquals(409, plan.widthPx)
  }

  @Test
  fun bothCapsApply() {
    val caps = RenderCaps(maxPixels = 1_000_000L, maxSide = 1000)
    val plan = PageRenderMath.fit(500.0, 50_000.0, caps)
    assertTrue(plan.heightPx <= 1000)
    assertTrue(plan.pixels <= 1_000_000L)
  }

  @Test
  fun poolBudgetIsAQuarterOfTheHeapClassWithinBounds() {
    assertEquals(24 * mb, PageRenderMath.poolBudgetBytes(48))
    assertEquals(32 * mb, PageRenderMath.poolBudgetBytes(128))
    assertEquals(48 * mb, PageRenderMath.poolBudgetBytes(192))
    assertEquals(64 * mb, PageRenderMath.poolBudgetBytes(256))
    assertEquals(96 * mb, PageRenderMath.poolBudgetBytes(512))
    assertEquals(96 * mb, PageRenderMath.poolBudgetBytes(1024))
  }

  @Test
  fun perBitmapCapIsAQuarterOfTheBudgetThe16MpCapAndTheDrawLimit() {
    // 32 MB budget: 8 MB per page bitmap = 2 Mi pixels.
    assertEquals(2L * mb, PageRenderMath.capsFor(32 * mb).maxPixels)
    // 96 MB budget: 24 MB = 6 Mi pixels.
    assertEquals(6L * mb, PageRenderMath.capsFor(96 * mb).maxPixels)
    // A huge budget is held to 16 MP.
    assertEquals(PageRenderMath.MAX_PIXELS, PageRenderMath.capsFor(2048 * mb).maxPixels)
    assertEquals(PageRenderMath.MAX_SIDE, PageRenderMath.capsFor(32 * mb).maxSide)
    // Every cap keeps bitmaps under Android's 100 MB drawBitmap limit.
    for (budget in listOf(24 * mb, 96 * mb, 4096 * mb)) {
      assertTrue(PageRenderMath.capsFor(budget).maxPixels * 4 <= PageRenderMath.DRAW_BITMAP_LIMIT_BYTES)
    }
  }

  @Test
  fun halvingForTheMemoryRetry() {
    assertEquals(RenderPlan(540, 763), PageRenderMath.halve(RenderPlan(1080, 1527)))
    assertEquals(RenderPlan(1, 1), PageRenderMath.halve(RenderPlan(1, 3)))
    assertNull(PageRenderMath.halve(RenderPlan(1, 1)))
  }

  @Test
  fun planBytesAreFourPerPixel() {
    assertEquals(1080L * 1527 * 4, RenderPlan(1080, 1527).bytes)
  }

  // region colours

  private fun rgb(r: Int, g: Int, b: Int, a: Int = 255) = (a shl 24) or (r shl 16) or (g shl 8) or b

  @Test
  fun nightModeWinsOverSepia() {
    assertEquals(PaperMode.NIGHT, PaperMode.of(nightMode = true, sepia = true))
    assertEquals(PaperMode.SEPIA, PaperMode.of(nightMode = false, sepia = true))
    assertEquals(PaperMode.DAY, PaperMode.of(nightMode = false, sepia = false))
  }

  @Test
  fun dayDrawsUnfilteredOnWhite() {
    assertNull(PaperColors.matrix(PaperMode.DAY))
    assertEquals(rgb(255, 255, 255), PaperColors.paperColor(PaperMode.DAY))
    assertEquals(rgb(12, 34, 56), PaperColors.apply(PaperMode.DAY, rgb(12, 34, 56)))
  }

  @Test
  fun nightInvertsRgbAndKeepsAlpha() {
    assertEquals(20, PaperColors.matrix(PaperMode.NIGHT)!!.size)
    assertEquals(rgb(0, 0, 0), PaperColors.paperColor(PaperMode.NIGHT))
    assertEquals(rgb(255, 255, 255), PaperColors.apply(PaperMode.NIGHT, rgb(0, 0, 0)))
    assertEquals(rgb(243, 221, 199, 128), PaperColors.apply(PaperMode.NIGHT, rgb(12, 34, 56, 128)))
  }

  @Test
  fun sepiaMapsWhiteToWarmPaperAndBlackToBrownInk() {
    assertEquals(rgb(0xF4, 0xEC, 0xD8), PaperColors.paperColor(PaperMode.SEPIA))
    assertEquals(rgb(0x3B, 0x2F, 0x25), PaperColors.apply(PaperMode.SEPIA, rgb(0, 0, 0)))
    val mid = PaperColors.apply(PaperMode.SEPIA, rgb(128, 128, 128))
    val r = (mid shr 16) and 0xFF
    val b = mid and 0xFF
    assertTrue("sepia must be warm (r > b)", r > b)
  }

  // endregion

  // region detail tiles

  private val tileRoomy = RenderCaps(maxPixels = 100_000_000L, maxSide = 100_000)

  @Test
  fun twoBackdropsAndThreeTilesFitTheBudget() {
    for (budget in listOf(24 * mb, 32 * mb, 64 * mb, 96 * mb)) {
      val backdrop = PageRenderMath.backdropCapsFor(budget).maxPixels * 4
      val tile = PageRenderMath.tileCapsFor(budget).maxPixels * 4
      assertTrue("budget $budget", 2 * backdrop + 3 * tile <= budget)
    }
    // 32 MB: 1 Mi px backdrops, 2 Mi px tiles (a 1080 x 2400 viewport at 0.9x linear).
    assertEquals(1L * mb, PageRenderMath.backdropCapsFor(32 * mb).maxPixels)
    assertEquals(2L * mb, PageRenderMath.tileCapsFor(32 * mb).maxPixels)
    // Unzoomed pages keep a quarter: a 1080 px phone's A4 page (1.65 MP) is not capped.
    assertFalse(PageRenderMath.isCapped(1080, 1528, 2.625f, 2.625, PageRenderMath.capsFor(32 * mb)))
    assertEquals(PageRenderMath.MAX_TILE_PIXELS, PageRenderMath.tileCapsFor(1024 * mb).maxPixels)
  }

  @Test
  fun cappedOnlyWhenTheWholePageIsLowered() {
    val caps = RenderCaps(maxPixels = 2L * mb, maxSide = 8192)
    // 1×: 1080 x 1528 = 1.65 MP fits.
    assertFalse(PageRenderMath.isCapped(1080, 1528, 2.625f, 2.625, caps))
    // 4× zoom by layout: 4320 x 6112 px view at density scale = 26 MP.
    assertTrue(PageRenderMath.isCapped(4320, 6112, 2.625f, 2.625, caps))
    assertFalse(PageRenderMath.isCapped(0, 6112, 2.625f, 2.625, caps))
  }

  @Test
  fun tileIsTheRegionWindowOfTheFullTarget() {
    // 4× view (4320 x 6112 px), renderScale = density: full target = view px.
    val plan = PageRenderMath.tilePlan(4320, 6112, 2.625f, 2.625, NormalizedRegion(0.25, 0.5, 0.25, 0.25), tileRoomy)!!
    assertEquals(TileWindow(-1080, -3056, 4320, 6112), plan.window)
    assertEquals(RenderPlan(1080, 1528), plan.tile)
    assertEquals(RenderPlan(1088, 1536), plan.bitmap)
    // The content sits TILE_PAD_PX in from the bitmap edge.
    assertEquals(PageRenderMath.TILE_PAD_PX, plan.pad)
    assertEquals(TileWindow(-1080 + 4, -3056 + 4, 4320, 6112), plan.renderWindow)
    assertEquals(NormalizedRegion(0.25, 0.5, 0.25, 0.25), plan.covered)
  }

  @Test
  fun tileWindowIsPixelAlignedAndCoversTheRegion() {
    val region = NormalizedRegion(0.1234, 0.4321, 0.3333, 0.2222)
    val plan = PageRenderMath.tilePlan(1000, 1414, 1f, 3.0, region, tileRoomy)!!
    val w = plan.window
    assertEquals(3000, w.pageWidthPx)
    assertEquals(4242, w.pageHeightPx)
    // floor(0.1234 * 3000) = 370; ceil(0.4567 * 3000) = 1371.
    assertEquals(-370, w.startX)
    assertEquals(1371 - 370, plan.tile.widthPx)
    val c = plan.covered
    assertTrue(c.x <= region.x && c.x + c.width >= region.x + region.width)
    assertTrue(c.y <= region.y && c.y + c.height >= region.y + region.height)
  }

  @Test
  fun regionsAreClampedAndEmptyOnesRejected() {
    assertEquals(NormalizedRegion(0.0, 0.5, 0.5, 0.5), PageRenderMath.clampRegion(NormalizedRegion(-0.5, 0.5, 1.0, 0.75)))
    assertNull(PageRenderMath.clampRegion(NormalizedRegion(1.2, 0.0, 0.5, 0.5)))
    assertNull(PageRenderMath.clampRegion(NormalizedRegion(0.0, 0.0, 0.0, 0.5)))
    assertNull(PageRenderMath.clampRegion(NormalizedRegion(Double.NaN, 0.0, 0.5, 0.5)))
    val plan = PageRenderMath.tilePlan(1000, 1000, 1f, 1.0, NormalizedRegion(0.9, 0.9, 0.5, 0.5), tileRoomy)!!
    assertEquals(RenderPlan(100, 100), plan.tile)
    assertEquals(TileWindow(-900, -900, 1000, 1000), plan.window)
    assertNull(PageRenderMath.tilePlan(1000, 1000, 1f, 1.0, NormalizedRegion(2.0, 2.0, 1.0, 1.0), tileRoomy))
    assertNull(PageRenderMath.tilePlan(0, 1000, 1f, 1.0, NormalizedRegion(0.0, 0.0, 1.0, 1.0), tileRoomy))
  }

  @Test
  fun tileOverItsCapScalesThePageImageDownProportionally() {
    val caps = RenderCaps(maxPixels = 1_000_000L, maxSide = 8192)
    // Whole 4× page as region: 26 MP wanted.
    val plan = PageRenderMath.tilePlan(4320, 6112, 2.625f, 2.625, NormalizedRegion(0.0, 0.0, 1.0, 1.0), caps)!!
    assertTrue("${plan.bitmap.pixels}", plan.bitmap.pixels <= caps.maxPixels)
    assertTrue(plan.bitmap.pixels > caps.maxPixels * 0.9)
    assertTrue(plan.tile.pixels <= plan.bitmap.pixels)
    assertEquals(4320.0 / 6112.0, plan.window.pageWidthPx.toDouble() / plan.window.pageHeightPx, 0.002)
    // The window still covers the region of the scaled page.
    assertEquals(plan.window.pageWidthPx, plan.tile.widthPx)
    // A region on the right half keeps its position after scaling.
    val right = PageRenderMath.tilePlan(4320, 6112, 2.625f, 2.625, NormalizedRegion(0.5, 0.0, 0.5, 1.0), caps)!!
    assertEquals(0.5, right.covered.x, 0.002)
    assertTrue(right.bitmap.pixels <= caps.maxPixels)
  }

  @Test
  fun tileMathIsTheSameForAnyRotation() {
    // Region and output are both in displayed space: a landscape (rotated) page
    // is just a wider view, with no rotation-specific offset.
    val plan = PageRenderMath.tilePlan(6112, 4320, 2.625f, 2.625, NormalizedRegion(0.5, 0.25, 0.25, 0.25), tileRoomy)!!
    assertEquals(TileWindow(-3056, -1080, 6112, 4320), plan.window)
    assertEquals(RenderPlan(1528, 1080), plan.tile)
  }

  @Test
  fun tileBitmapsAre64PxBucketsSoNearbySizesShareThem() {
    assertEquals(64, PageRenderMath.bucket(1))
    assertEquals(64, PageRenderMath.bucket(64))
    assertEquals(128, PageRenderMath.bucket(65))
    // Pans of a 4× view: content sizes differ by a pixel, buckets do not.
    val a = PageRenderMath.tilePlan(4320, 6112, 2.625f, 2.625, NormalizedRegion(0.1000, 0.2, 0.25, 0.39), tileRoomy)!!
    val b = PageRenderMath.tilePlan(4320, 6112, 2.625f, 2.625, NormalizedRegion(0.1003, 0.2004, 0.25, 0.39), tileRoomy)!!
    assertTrue(a.tile != b.tile)
    assertEquals(a.bitmap, b.bitmap)
    assertEquals(0, a.bitmap.widthPx % 64)
  }

  // endregion
}
