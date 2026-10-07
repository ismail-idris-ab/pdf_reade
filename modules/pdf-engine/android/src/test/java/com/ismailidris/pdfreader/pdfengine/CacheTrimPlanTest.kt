package com.ismailidris.pdfreader.pdfengine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class CacheTrimPlanTest {
  private fun entry(name: String, size: Long, modified: Long) = CacheEntry(name, size, modified)

  @Test
  fun capIsOneHundredMegabytesAndTargetIsEightyPercent() {
    assertEquals(104_857_600L, CacheTrimPlan.THUMBNAIL_CACHE_CAP_BYTES)
    assertEquals(83_886_080L, CacheTrimPlan.targetBytes(CacheTrimPlan.THUMBNAIL_CACHE_CAP_BYTES))
  }

  @Test
  fun nothingIsEvictedAtOrUnderTheCap() {
    val entries = listOf(entry("a", 50, 1), entry("b", 50, 2))
    assertTrue(CacheTrimPlan.evictions(entries, capBytes = 100, targetBytes = 80).isEmpty())
    assertTrue(CacheTrimPlan.evictions(emptyList(), capBytes = 100, targetBytes = 80).isEmpty())
  }

  @Test
  fun evictsOldestFirstUntilAtOrUnderTarget() {
    val entries = listOf(
      entry("newest", 30, 400),
      entry("oldest", 30, 100),
      entry("middle", 30, 300),
      entry("older", 30, 200),
    )
    // 120 > 100; dropping oldest leaves 90 > 80; dropping older leaves 60.
    val evicted = CacheTrimPlan.evictions(entries, capBytes = 100, targetBytes = 80)
    assertEquals(listOf("oldest", "older"), evicted.map { it.name })
  }

  @Test
  fun stopsAsSoonAsTargetIsReached() {
    val entries = listOf(entry("a", 25, 1), entry("b", 80, 2), entry("c", 10, 3))
    // 115 > 100; dropping a leaves 90 > 80; dropping b leaves 10.
    assertEquals(listOf("a", "b"), CacheTrimPlan.evictions(entries, capBytes = 100, targetBytes = 80).map { it.name })
  }

  @Test
  fun tiesOnLastModifiedBreakByName() {
    val entries = listOf(entry("b", 60, 5), entry("a", 60, 5))
    assertEquals(listOf("a"), CacheTrimPlan.evictions(entries, capBytes = 100, targetBytes = 80).map { it.name })
  }

  @Test
  fun negativeSizesCountAsZero() {
    val entries = listOf(entry("bad", -500, 1), entry("a", 90, 2), entry("b", 20, 3))
    assertEquals(listOf("bad", "a"), CacheTrimPlan.evictions(entries, capBytes = 100, targetBytes = 80).map { it.name })
  }

  @Test
  fun staleTempsAreOlderThanOneHour() {
    val now = 10_000_000L
    val hour = CacheTrimPlan.STALE_TEMP_AGE_MS
    val entries = listOf(
      entry("fresh.tmp", 1, now - 1000),
      entry("exactly-an-hour.tmp", 1, now - hour),
      entry("stale.tmp", 1, now - hour - 1),
    )
    assertEquals(listOf("stale.tmp"), CacheTrimPlan.staleTemps(entries, now).map { it.name })
  }
}
