package com.ismailidris.pdfreader.pdfengine

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PageTextTest {
  /** Geometry header for a 100 x 200 pt box at the origin with [quarterTurns] rotation. */
  private fun header(quarterTurns: Int = 0) = doubleArrayOf(0.0, 0.0, 100.0, 200.0, quarterTurns.toDouble())

  private fun raw(quarterTurns: Int = 0, vararg chars: Double) = header(quarterTurns) + chars

  @Test
  fun keepsOneUnitPerBmpCharacter() {
    assertEquals("Hi\r\n", PageText.text(intArrayOf('H'.code, 'i'.code, '\r'.code, '\n'.code)))
    assertEquals("", PageText.text(IntArray(0)))
  }

  @Test
  fun supplementaryCodePointsBecomeSurrogatePairs() {
    // wchar_t is 32-bit on Android, so PDFium can report U+1F600 as one character.
    assertEquals("a😀b", PageText.text(intArrayOf('a'.code, 0x1F600, 'b'.code)))
    assertEquals("􏿿", PageText.text(intArrayOf(0x10FFFF)))
  }

  @Test
  fun loneSurrogateHalvesPassThrough() {
    assertEquals("😀", PageText.text(intArrayOf(0xD83D, 0xDE00)))
    assertEquals("x\uD800", PageText.text(intArrayOf('x'.code, 0xD800)))
  }

  @Test
  fun unmappedAndInvalidValuesBecomeReplacementCharacters() {
    assertEquals("a�b��", PageText.text(intArrayOf('a'.code, 0, 'b'.code, 0x110000, -5)))
  }

  @Test
  fun decodesBoxesAlignedWithText() {
    val nan = Double.NaN
    val decoded = requireNotNull(
      PageText.decode(
        raw(
          0,
          'A'.code.toDouble(), 10.0, 200.0, 20.0, 180.0,
          ' '.code.toDouble(), nan, nan, nan, nan,
          'B'.code.toDouble(), 50.0, 100.0, 100.0, 0.0,
        ),
      ),
    )
    assertEquals("A B", decoded.text)
    assertEquals(0, decoded.rotation)
    assertArrayEquals(
      doubleArrayOf(
        0.1, 0.0, 0.1, 0.1,
        0.0, 0.0, 0.0, 0.0,
        0.5, 0.5, 0.5, 0.5,
      ),
      decoded.boxes,
      1e-9,
    )
  }

  @Test
  fun surrogatePairsDuplicateTheirBox() {
    val decoded = requireNotNull(
      PageText.decode(
        raw(
          1,
          'a'.code.toDouble(), 0.0, 200.0, 10.0, 180.0,
          0x1F600.toDouble(), 50.0, 100.0, 100.0, 0.0,
          'b'.code.toDouble(), 10.0, 200.0, 20.0, 180.0,
        ),
      ),
    )
    assertEquals("a😀b", decoded.text)
    assertEquals(90, decoded.rotation)
    assertEquals(decoded.text.length * 4, decoded.boxes.size)
    assertArrayEquals(
      doubleArrayOf(
        0.0, 0.0, 0.1, 0.1,
        0.5, 0.5, 0.5, 0.5,
        0.5, 0.5, 0.5, 0.5,
        0.1, 0.0, 0.1, 0.1,
      ),
      decoded.boxes,
      1e-9,
    )
  }

  @Test
  fun textRectsTextMatchesPageText() {
    val codes = intArrayOf('x'.code, 0x1F600, 0, 0xD800, 'y'.code)
    val chars = codes.flatMap { listOf(it.toDouble(), 0.0, 200.0, 10.0, 190.0) }.toDoubleArray()
    assertEquals(PageText.text(codes), requireNotNull(PageText.decode(header() + chars)).text)
  }

  @Test
  fun boxesOutsideThePageAreZero() {
    val decoded = requireNotNull(PageText.decode(raw(0, 'x'.code.toDouble(), 500.0, 500.0, 600.0, 400.0)))
    assertEquals("x", decoded.text)
    assertArrayEquals(DoubleArray(4), decoded.boxes, 0.0)
  }

  @Test
  fun emptyPageHasNoTextOrBoxes() {
    val decoded = requireNotNull(PageText.decode(header(2)))
    assertEquals("", decoded.text)
    assertEquals(0, decoded.boxes.size)
    assertEquals(180, decoded.rotation)
  }

  @Test
  fun unusablePageBoxDecodesToNull() {
    assertNull(PageText.decode(DoubleArray(3)))
    assertNull(PageText.decode(doubleArrayOf(0.0, 0.0, 0.0, 0.0, 0.0)))
  }

  @Test(expected = IllegalArgumentException::class)
  fun rejectsMalformedData() {
    PageText.decode(header() + DoubleArray(7))
  }

  @Test
  fun mapHasTheContractKeys() {
    val map = requireNotNull(PageText.decode(raw(3, 'a'.code.toDouble(), 0.0, 200.0, 10.0, 190.0))).toMap()
    assertEquals(setOf("text", "boxes", "rotation"), map.keys)
    assertEquals(4, (map["boxes"] as DoubleArray).size)
    assertEquals(270, map["rotation"])
  }
}
