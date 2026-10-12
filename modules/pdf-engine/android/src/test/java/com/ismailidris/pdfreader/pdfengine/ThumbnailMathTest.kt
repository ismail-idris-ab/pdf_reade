package com.ismailidris.pdfreader.pdfengine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test

class ThumbnailMathTest {
  @Test
  fun clampWidthKeepsValuesInRange() {
    assertEquals(120, ThumbnailMath.clampWidth(120.0))
    assertEquals(48, ThumbnailMath.clampWidth(48.0))
    assertEquals(360, ThumbnailMath.clampWidth(360.0))
  }

  @Test
  fun clampWidthClampsOutOfRangeAndOddValues() {
    assertEquals(48, ThumbnailMath.clampWidth(10.0))
    assertEquals(48, ThumbnailMath.clampWidth(-5.0))
    assertEquals(360, ThumbnailMath.clampWidth(4000.0))
    assertEquals(360, ThumbnailMath.clampWidth(Double.POSITIVE_INFINITY))
    assertEquals(48, ThumbnailMath.clampWidth(Double.NEGATIVE_INFINITY))
    assertEquals(48, ThumbnailMath.clampWidth(Double.NaN))
  }

  @Test
  fun clampWidthRoundsFractionalPixels() {
    assertEquals(121, ThumbnailMath.clampWidth(120.6))
    assertEquals(120, ThumbnailMath.clampWidth(120.4))
  }

  private fun geometry(width: Int, pageW: Float, pageH: Float) = ThumbnailMath.geometryFor(width, pageW, pageH)

  @Test
  fun pagesWithinTheCapRenderWholeIntoTheBitmap() {
    // A4: 595 x 842 pt.
    assertEquals(ThumbnailGeometry(120, 170, 120, 170), geometry(120, 595f, 842f))
    // Landscape.
    assertEquals(ThumbnailGeometry(120, 85, 120, 85), geometry(120, 842f, 595f))
    assertEquals(ThumbnailGeometry(120, 120, 120, 120), geometry(120, 500f, 500f))
    // Exactly at the 2:1 cap: nothing is cropped.
    assertEquals(ThumbnailGeometry(120, 240, 120, 240), geometry(120, 100f, 200f))
  }

  @Test
  fun tallPagesAreTopCroppedNotSquashed() {
    // 1:10 page: the bitmap stops at 2x width, the page keeps its full scaled
    // height, so only its top fifth is visible.
    val tall = geometry(120, 100f, 1000f)
    assertEquals(ThumbnailGeometry(120, 240, 120, 1200), tall)
    // Scale is identical on both axes (no squash).
    assertEquals(tall.renderWidth / 100.0, tall.renderHeight / 1000.0, 1e-9)
    assertEquals(ThumbnailGeometry(360, 720, 360, 518_400), geometry(360, 10f, 14400f))
  }

  @Test
  fun absurdAspectRatiosAreBoundedForPdfium() {
    val extreme = geometry(360, 1f, 14400f * 1000f)
    assertEquals(ThumbnailMath.MAX_RENDER_EXTENT_PX, extreme.renderHeight)
    assertEquals(720, extreme.bitmapHeight)
  }

  @Test
  fun heightsAreAtLeastOnePixel() {
    assertEquals(ThumbnailGeometry(48, 1, 48, 1), geometry(48, 14400f, 10f))
  }

  @Test
  fun unusablePageSizeRendersSquare() {
    val square = ThumbnailGeometry(120, 120, 120, 120)
    assertEquals(square, geometry(120, 0f, 842f))
    assertEquals(square, geometry(120, 595f, -1f))
    assertEquals(square, geometry(120, Float.NaN, 842f))
    assertEquals(square, geometry(120, 595f, Float.POSITIVE_INFINITY))
  }

  @Test
  fun cacheKeyIsHexSha1OfTheJoinedFields() {
    assertEquals(
      "60cb087b30ca0113a91c5d7e0a3b8dea9091349f",
      ThumbnailMath.cacheKey("/sdcard/Download/a.pdf", 1_700_000_000_000L, 1234L, 120),
    )
  }

  @Test
  fun cacheKeyHashesUtf8() {
    assertEquals("4587148d04a7587652166af3b8907e98b98beb65", ThumbnailMath.cacheKey("content://x/é", 0L, 0L, 48))
  }

  @Test
  fun cacheKeyChangesWithEveryField() {
    val base = ThumbnailMath.cacheKey("/a.pdf", 1L, 2L, 120)
    assertNotEquals(base, ThumbnailMath.cacheKey("/b.pdf", 1L, 2L, 120))
    assertNotEquals(base, ThumbnailMath.cacheKey("/a.pdf", 9L, 2L, 120))
    assertNotEquals(base, ThumbnailMath.cacheKey("/a.pdf", 1L, 9L, 120))
    assertNotEquals(base, ThumbnailMath.cacheKey("/a.pdf", 1L, 2L, 121))
    assertEquals(40, base.length)
    assertEquals(base, base.lowercase())
  }
}
