package com.ismailidris.pdfreader.pdfengine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SearchSupportTest {
  /** Geometry header: a 100 x 100 pt box at the origin, rotated 270. */
  private val header = doubleArrayOf(0.0, 0.0, 100.0, 100.0, 3.0)

  private fun decode(vararg body: Double) = SearchResults.decode(header + body)

  @Test
  fun flagsMatchFpdfText() {
    assertEquals(0, SearchResults.flags(matchCase = false, wholeWord = false))
    assertEquals(1, SearchResults.flags(matchCase = true, wholeWord = false))
    assertEquals(2, SearchResults.flags(matchCase = false, wholeWord = true))
    assertEquals(3, SearchResults.flags(matchCase = true, wholeWord = true))
  }

  @Test
  fun blankQueriesAreNotRun() {
    assertTrue(SearchResults.isBlank(""))
    assertTrue(SearchResults.isBlank("   \t\n"))
    assertFalse(SearchResults.isBlank(" a "))
  }

  @Test
  fun decodesMatchesWithOneOrMoreRects() {
    val found = requireNotNull(
      decode(
      2.0,
      // Match 1: one rect (left, top, right, bottom).
      1.0, 10.0, 90.0, 30.0, 80.0,
      // Match 2: wraps onto two lines.
      2.0, 80.0, 70.0, 100.0, 60.0, 0.0, 60.0, 20.0, 50.0,
      ),
    )
    assertEquals(270, found.geometry.rotation)
    val matches = found.matches
    assertEquals(2, matches.size)
    assertEquals(listOf(NormalizedRect(0.1, 0.1, 0.2, 0.1)), matches[0].map { it.rounded() })
    assertEquals(
      listOf(NormalizedRect(0.8, 0.3, 0.2, 0.1), NormalizedRect(0.0, 0.4, 0.2, 0.1)),
      matches[1].map { it.rounded() },
    )
  }

  @Test
  fun keepsMatchesWhoseRectsAreNotVisible() {
    val matches = requireNotNull(decode(2.0, 1.0, 500.0, 500.0, 600.0, 400.0, 0.0)).matches
    assertEquals(2, matches.size)
    assertTrue(matches.all { it.isEmpty() })
  }

  @Test
  fun noMatchesDecodesToAnEmptyList() {
    assertTrue(requireNotNull(decode(0.0)).matches.isEmpty())
  }

  @Test
  fun unusablePageBoxDecodesToNull() {
    assertNull(SearchResults.decode(DoubleArray(0)))
    assertNull(SearchResults.decode(doubleArrayOf(5.0, 5.0, 5.0, 9.0, 0.0, 0.0)))
  }

  @Test(expected = IllegalArgumentException::class)
  fun rejectsTruncatedData() {
    decode(1.0, 2.0, 0.0, 0.0, 1.0, 1.0)
  }

  @Test(expected = IllegalArgumentException::class)
  fun rejectsMissingMatches() {
    decode(3.0, 0.0)
  }

  @Test
  fun progressIsThrottledButAlwaysReportsTheLastPage() {
    val throttle = ProgressThrottle(intervalMs = 100)
    assertTrue(throttle.shouldEmit(nowMs = 1_000, pagesSearched = 1, pageCount = 10))
    assertFalse(throttle.shouldEmit(nowMs = 1_050, pagesSearched = 2, pageCount = 10))
    assertFalse(throttle.shouldEmit(nowMs = 1_099, pagesSearched = 3, pageCount = 10))
    assertTrue(throttle.shouldEmit(nowMs = 1_100, pagesSearched = 4, pageCount = 10))
    assertFalse(throttle.shouldEmit(nowMs = 1_120, pagesSearched = 5, pageCount = 10))
    assertTrue(throttle.shouldEmit(nowMs = 1_121, pagesSearched = 10, pageCount = 10))
  }

  @Test
  fun singlePageDocumentReportsItsOnlyPage() {
    assertTrue(ProgressThrottle(intervalMs = 100).shouldEmit(nowMs = 0, pagesSearched = 1, pageCount = 1))
  }

  private fun NormalizedRect.rounded() = NormalizedRect(round(x), round(y), round(width), round(height))

  private fun round(value: Double) = Math.round(value * 1e9) / 1e9
}
