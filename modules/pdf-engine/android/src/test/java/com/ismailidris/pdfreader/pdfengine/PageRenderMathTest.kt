package com.ismailidris.pdfreader.pdfengine

import org.junit.Assert.assertEquals
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
  fun perBitmapCapIsHalfTheBudgetThe16MpCapAndTheDrawLimit() {
    // 32 MB budget: 16 MB per bitmap = 4 Mi pixels.
    assertEquals(4L * mb, PageRenderMath.capsFor(32 * mb).maxPixels)
    // 96 MB budget: 48 MB = 12 Mi pixels.
    assertEquals(12L * mb, PageRenderMath.capsFor(96 * mb).maxPixels)
    // A huge budget is held to 16 MP.
    assertEquals(PageRenderMath.MAX_PIXELS, PageRenderMath.capsFor(1024 * mb).maxPixels)
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
}
