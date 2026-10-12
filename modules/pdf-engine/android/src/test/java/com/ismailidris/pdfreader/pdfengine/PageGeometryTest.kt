package com.ismailidris.pdfreader.pdfengine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PageGeometryTest {
  private val letter = PageBox.of(0.0, 0.0, 612.0, 792.0)

  private fun assertRect(expected: NormalizedRect, actual: NormalizedRect?) {
    requireNotNull(actual) { "Expected $expected, got null" }
    assertEquals(expected.x, actual.x, EPS)
    assertEquals(expected.y, actual.y, EPS)
    assertEquals(expected.width, actual.width, EPS)
    assertEquals(expected.height, actual.height, EPS)
  }

  @Test
  fun boxOrdersItsCorners() {
    val box = PageBox.of(612.0, 792.0, 0.0, 0.0)
    assertEquals(letter, box)
    assertEquals(612.0, box.width, EPS)
    assertEquals(792.0, box.height, EPS)
  }

  @Test
  fun topLeftOfThePageIsTheOrigin() {
    // User space y grows upward: the page's top edge is y = 792.
    assertRect(NormalizedRect(0.0, 0.0, 0.5, 0.25), PageGeometry.normalize(letter, 0.0, 792.0, 306.0, 594.0))
  }

  @Test
  fun flipsTheYAxis() {
    // A box hugging the bottom edge ends at normalized y = 1.
    assertRect(NormalizedRect(0.25, 0.75, 0.5, 0.25), PageGeometry.normalize(letter, 153.0, 198.0, 459.0, 0.0))
  }

  @Test
  fun acceptsCornersInAnyOrder() {
    val expected = requireNotNull(PageGeometry.normalize(letter, 100.0, 700.0, 200.0, 650.0))
    assertRect(expected, PageGeometry.normalize(letter, 200.0, 650.0, 100.0, 700.0))
    assertRect(expected, PageGeometry.normalize(letter, 100.0, 650.0, 200.0, 700.0))
  }

  @Test
  fun handlesBoxesWithANonZeroOrigin() {
    // Crop box from (100, 200) to (400, 600): 300 x 400 points.
    val cropped = PageBox.of(100.0, 200.0, 400.0, 600.0)
    assertRect(NormalizedRect(0.0, 0.0, 1.0, 1.0), PageGeometry.normalize(cropped, 100.0, 600.0, 400.0, 200.0))
    assertRect(NormalizedRect(0.5, 0.25, 0.25, 0.25), PageGeometry.normalize(cropped, 250.0, 500.0, 325.0, 400.0))
    assertEquals(0.5, PageGeometry.normalizeX(cropped, 250.0), EPS)
    assertEquals(0.25, PageGeometry.normalizeY(cropped, 500.0), EPS)
  }

  @Test
  fun handlesNegativeOrigins() {
    val box = PageBox.of(-300.0, -400.0, 300.0, 400.0)
    assertRect(NormalizedRect(0.5, 0.5, 0.25, 0.25), PageGeometry.normalize(box, 0.0, 0.0, 150.0, -200.0))
  }

  @Test
  fun clampsRectsThatOverhangThePage() {
    assertRect(NormalizedRect(0.0, 0.0, 0.5, 0.5), PageGeometry.normalize(letter, -50.0, 900.0, 306.0, 396.0))
    assertRect(NormalizedRect(0.5, 0.5, 0.5, 0.5), PageGeometry.normalize(letter, 306.0, 396.0, 700.0, -10.0))
    assertEquals(0.0, PageGeometry.normalizeX(letter, -1.0), EPS)
    assertEquals(1.0, PageGeometry.normalizeX(letter, 10_000.0), EPS)
    assertEquals(0.0, PageGeometry.normalizeY(letter, 10_000.0), EPS)
    assertEquals(1.0, PageGeometry.normalizeY(letter, -10_000.0), EPS)
  }

  @Test
  fun dropsRectsEntirelyOutsideThePage() {
    assertNull(PageGeometry.normalize(letter, 700.0, 100.0, 800.0, 50.0))
    assertNull(PageGeometry.normalize(letter, 10.0, 900.0, 20.0, 850.0))
    assertNull(PageGeometry.normalize(letter, -20.0, 100.0, -10.0, 50.0))
    assertNull(PageGeometry.normalize(letter, 10.0, -50.0, 20.0, -60.0))
  }

  @Test
  fun dropsNonFiniteAndPointRects() {
    assertNull(PageGeometry.normalize(letter, Double.NaN, 0.0, 10.0, 10.0))
    assertNull(PageGeometry.normalize(letter, 0.0, Double.POSITIVE_INFINITY, 10.0, 10.0))
    assertNull(PageGeometry.normalize(letter, 10.0, 10.0, 10.0, 10.0))
  }

  @Test
  fun keepsZeroWidthRectsWithHeight() {
    assertRect(NormalizedRect(0.5, 0.5, 0.0, 0.25), PageGeometry.normalize(letter, 306.0, 396.0, 306.0, 198.0))
  }

  @Test
  fun degenerateBoxesNormalizeNothing() {
    assertNull(PageGeometry.normalize(PageBox.of(0.0, 0.0, 0.0, 792.0), 0.0, 0.0, 10.0, 10.0))
    assertNull(PageGeometry.normalize(PageBox.of(0.0, 5.0, 612.0, 5.0), 0.0, 0.0, 10.0, 10.0))
  }

  @Test
  fun mapsPdfiumRotationToDegrees() {
    assertEquals(0, PageGeometry.rotationDegrees(0))
    assertEquals(90, PageGeometry.rotationDegrees(1))
    assertEquals(180, PageGeometry.rotationDegrees(2))
    assertEquals(270, PageGeometry.rotationDegrees(3))
    assertEquals(0, PageGeometry.rotationDegrees(-1))
    assertEquals(0, PageGeometry.rotationDegrees(7))
  }

  @Test
  fun decodesTheGeometryHeader() {
    val geometry = PageGeometry.decodeHeader(doubleArrayOf(50.0, 400.0, 350.0, 792.0, 1.0, 99.0))
    assertEquals(PageGeometryInfo(PageBox.of(50.0, 400.0, 350.0, 792.0), 90), geometry)
    assertNull(PageGeometry.decodeHeader(doubleArrayOf(0.0, 0.0, 612.0, 792.0)))
    assertNull(PageGeometry.decodeHeader(doubleArrayOf(0.0, 0.0, 0.0, 792.0, 0.0)))
    assertNull(PageGeometry.decodeHeader(doubleArrayOf(Double.NaN, 0.0, 612.0, 792.0, 0.0)))
  }

  @Test
  fun decodesDisplayedSizesWithAFallbackForUnsizablePages() {
    val raw = doubleArrayOf(612.0, 792.0, 842.0, 595.0, Double.NaN, Double.NaN, 0.0, 10.0)
    assertEquals(
      listOf(PageSize(612.0, 792.0), PageSize(842.0, 595.0), PageGeometry.FALLBACK_SIZE, PageGeometry.FALLBACK_SIZE),
      PageGeometry.decodeSizes(raw, 4),
    )
    assertEquals(PageSize(612.0, 792.0), PageGeometry.FALLBACK_SIZE)
    assertEquals(mapOf("width" to 1.0, "height" to 2.0), PageSize(1.0, 2.0).toMap())
  }

  @Test(expected = IllegalArgumentException::class)
  fun rejectsMalformedSizeData() {
    PageGeometry.decodeSizes(DoubleArray(3), 2)
  }

  @Test
  fun copyNeedsTheDeclaredSizePlusAMargin() {
    val margin = ReaderSources.COPY_SPACE_MARGIN_BYTES
    assertEquals(true, ReaderSources.hasRoomForCopy(declaredSize = 1_000, availableBytes = 1_000 + margin))
    assertEquals(false, ReaderSources.hasRoomForCopy(declaredSize = 1_001, availableBytes = 1_000 + margin))
    assertEquals(false, ReaderSources.hasRoomForCopy(declaredSize = 0, availableBytes = margin - 1))
    // Unknown size: copy anyway; ENOSPC during the copy is still mapped.
    assertEquals(true, ReaderSources.hasRoomForCopy(declaredSize = -1, availableBytes = 0))
  }

  @Test
  fun copySpaceCheckCannotOverflow() {
    val margin = ReaderSources.COPY_SPACE_MARGIN_BYTES
    // declaredSize + margin would wrap negative and wrongly pass.
    assertEquals(false, ReaderSources.hasRoomForCopy(declaredSize = Long.MAX_VALUE, availableBytes = 1L shl 40))
    assertEquals(false, ReaderSources.hasRoomForCopy(declaredSize = Long.MAX_VALUE - margin + 1, availableBytes = Long.MAX_VALUE))
    assertEquals(true, ReaderSources.hasRoomForCopy(declaredSize = Long.MAX_VALUE - margin, availableBytes = Long.MAX_VALUE))
    assertEquals(false, ReaderSources.hasRoomForCopy(declaredSize = 0, availableBytes = 0))
    assertEquals(true, ReaderSources.hasRoomForCopy(declaredSize = 0, availableBytes = margin))
  }

  @Test
  fun rectMapHasTheContractKeys() {
    assertEquals(
      mapOf("x" to 0.1, "y" to 0.2, "width" to 0.3, "height" to 0.4),
      NormalizedRect(0.1, 0.2, 0.3, 0.4).toMap(),
    )
  }

  private companion object {
    const val EPS = 1e-9
  }
}
