package com.ismailidris.pdfreader.pdfengine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotSame
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class BitmapPoolTest {
  private class FakeBitmap(val width: Int, val height: Int) {
    var freed = false
  }

  private class FakeAllocator : BitmapAllocator<FakeBitmap> {
    val allocated = ArrayList<FakeBitmap>()
    var failuresLeft = 0

    override fun allocate(widthPx: Int, heightPx: Int): FakeBitmap {
      if (failuresLeft > 0) {
        failuresLeft--
        throw OutOfMemoryError("fake")
      }
      return FakeBitmap(widthPx, heightPx).also(allocated::add)
    }

    override fun free(bitmap: FakeBitmap) {
      check(!bitmap.freed) { "freed twice" }
      bitmap.freed = true
    }
  }

  private val allocator = FakeAllocator()

  // 10 x 10 = 400 bytes per bitmap; a 1,000 byte budget holds two.
  private fun pool(budget: Long = 1_000) = BitmapPool(budget, allocator)

  @Test
  fun sameSizeIsReusedOtherSizesAreNot() {
    val pool = pool()
    val first = pool.acquire(10, 10)
    pool.release(first)
    assertSame(first, pool.acquire(10, 10))
    val other = pool.acquire(10, 5)
    assertNotSame(first, other)
    val stats = pool.stats()
    assertEquals(2, stats.allocations)
    assertEquals(1, stats.reuses)
    assertEquals(600L, stats.inUseBytes)
  }

  @Test
  fun accountingFollowsAcquireAndRelease() {
    val pool = pool(10_000)
    val a = pool.acquire(10, 10)
    val b = pool.acquire(20, 10)
    assertEquals(BitmapPoolStats(1200, 0, 2, 0, 1200, 2, 0), pool.stats())
    pool.release(a)
    assertEquals(800L, pool.stats().inUseBytes)
    assertEquals(400L, pool.stats().freeBytes)
    pool.release(b)
    pool.release(b) // unknown / double release is ignored
    assertEquals(0L, pool.stats().inUseBytes)
    assertEquals(1200L, pool.stats().freeBytes)
    assertEquals(1200L, pool.stats().highWaterBytes)
  }

  @Test
  fun leastRecentlyReleasedFreeBitmapIsEvictedFirst() {
    val pool = pool(1_000)
    val a = pool.acquire(10, 10)
    val b = pool.acquire(10, 10)
    pool.release(a)
    pool.release(b)
    // A new size needs room: a (released first) goes, b stays.
    val c = pool.acquire(10, 9)
    assertTrue(a.freed)
    assertFalse(b.freed)
    assertSame(b, pool.acquire(10, 10))
    pool.release(c)
  }

  @Test
  fun releaseOverBudgetFreesTheOldestFree() {
    val pool = pool(1_000)
    val a = pool.acquire(10, 10)
    val b = pool.acquire(10, 10)
    val c = pool.acquire(10, 10) // in use exceeds the budget: allowed, views own them
    assertEquals(1200L, pool.stats().inUseBytes)
    pool.release(a) // total 1,200 > 1,000: a itself is the only free one, evicted
    assertTrue(a.freed)
    pool.release(b)
    pool.release(c) // total 800: both kept
    assertFalse(b.freed)
    assertFalse(c.freed)
    assertEquals(800L, pool.stats().freeBytes)
  }

  @Test
  fun checkedOutBitmapsAreNeverFreed() {
    val pool = pool(500)
    val held = List(5) { pool.acquire(10, 10) }
    pool.clear()
    pool.acquire(20, 20)
    assertTrue(held.none { it.freed })
  }

  @Test
  fun outOfMemoryDropsFreeBitmapsAndRetriesOnce() {
    val pool = pool(100_000)
    val a = pool.acquire(10, 10)
    pool.release(a)
    allocator.failuresLeft = 1
    val b = pool.acquire(30, 30)
    assertTrue("free bitmaps go before the retry", a.freed)
    assertFalse(b.freed)

    allocator.failuresLeft = 2
    try {
      pool.acquire(40, 40)
      fail("expected OutOfMemoryError")
    } catch (expected: OutOfMemoryError) {
      // Accounting is unchanged by the failure.
      assertEquals(3600L, pool.stats().inUseBytes)
    }
  }

  @Test
  fun clearFreesOnlyPooledBitmaps() {
    val pool = pool(10_000)
    val a = pool.acquire(10, 10)
    val b = pool.acquire(10, 10)
    pool.release(a)
    pool.clear()
    assertTrue(a.freed)
    assertFalse(b.freed)
    assertEquals(0L, pool.stats().freeBytes)
    assertEquals(400L, pool.stats().inUseBytes)
  }

  @Test
  fun highWaterCanBeReset() {
    val pool = pool(10_000)
    val a = pool.acquire(10, 10)
    val b = pool.acquire(10, 10)
    pool.release(a)
    pool.clear()
    assertEquals(800L, pool.stats().highWaterBytes)
    pool.resetHighWater()
    assertEquals(400L, pool.stats().highWaterBytes)
    pool.release(b)
  }

  // region idle trim

  private class ManualScheduler {
    val scheduled = ArrayList<Pair<Long, () -> Unit>>()
    var cancels = 0

    fun schedule(delay: Long, block: () -> Unit): RenderCancellable {
      val entry = delay to block
      scheduled.add(entry)
      return RenderCancellable {
        if (scheduled.remove(entry)) cancels++
      }
    }

    fun runAll() {
      val due = ArrayList(scheduled)
      scheduled.clear()
      due.forEach { it.second() }
    }
  }

  private fun trimmedPool(scheduler: ManualScheduler): BitmapPool<FakeBitmap> {
    val pool = BitmapPool(10_000, allocator)
    val trim = PoolIdleTrim(2_000, scheduler::schedule) { pool.trimIfIdle() }
    pool.checkedOutListener = trim::onCheckedOutChanged
    return pool
  }

  @Test
  fun listenerHearsOnlyTheZeroCrossings() {
    val pool = pool(10_000)
    val heard = ArrayList<Int>()
    pool.checkedOutListener = { heard.add(it) }
    val a = pool.acquire(10, 10)
    val b = pool.acquire(10, 10)
    pool.release(a)
    pool.release(b)
    pool.release(b)
    pool.acquire(10, 10)
    assertEquals(listOf(1, 0, 1), heard)
  }

  @Test
  fun freeBitmapsAreDroppedAfterTheDelayOnceNothingIsCheckedOut() {
    val scheduler = ManualScheduler()
    val pool = trimmedPool(scheduler)
    val a = pool.acquire(10, 10)
    val b = pool.acquire(20, 10)
    pool.release(a)
    assertTrue("still one in use: nothing scheduled", scheduler.scheduled.isEmpty())
    pool.release(b)
    assertEquals(1, scheduler.scheduled.size)
    assertEquals(2_000L, scheduler.scheduled[0].first)
    assertFalse(a.freed)
    scheduler.runAll()
    assertTrue(a.freed && b.freed)
    assertEquals(0L, pool.stats().freeBytes)
  }

  @Test
  fun aCheckoutBeforeTheDelayCancelsTheTrim() {
    val scheduler = ManualScheduler()
    val pool = trimmedPool(scheduler)
    val a = pool.acquire(10, 10)
    pool.release(a)
    assertSame(a, pool.acquire(10, 10))
    assertEquals(1, scheduler.cancels)
    assertTrue(scheduler.scheduled.isEmpty())
    assertFalse(a.freed)
  }

  @Test
  fun aStaleTrimDoesNothing() {
    var stale: (() -> Unit)? = null
    val pool = BitmapPool(10_000, allocator)
    // A scheduler whose cancel cannot stop a run already in progress.
    val trim = PoolIdleTrim(2_000, { _, block -> stale = block; RenderCancellable {} }) { pool.trimIfIdle() }
    pool.checkedOutListener = trim::onCheckedOutChanged
    val a = pool.acquire(10, 10)
    pool.release(a)
    val first = stale!!
    val b = pool.acquire(10, 10)
    first()
    assertFalse("a checkout after scheduling voids the trim", b.freed)
    pool.release(b)
  }

  @Test
  fun trimIfIdleRefusesWhileAnythingIsCheckedOut() {
    val pool = pool(10_000)
    val a = pool.acquire(10, 10)
    val b = pool.acquire(10, 10)
    pool.release(a)
    assertFalse(pool.trimIfIdle())
    assertFalse(a.freed)
    pool.release(b)
    assertTrue(pool.trimIfIdle())
    assertTrue(a.freed && b.freed)
  }

  @Test
  fun trimMemoryLevels() {
    // ComponentCallbacks2: RUNNING_MODERATE 5, RUNNING_LOW 10, RUNNING_CRITICAL 15,
    // UI_HIDDEN 20, BACKGROUND 40, MODERATE 60, COMPLETE 80.
    assertFalse(PoolIdleTrim.clearsOnTrimLevel(5))
    for (level in listOf(10, 15, 20, 40, 60, 80)) assertTrue("level $level", PoolIdleTrim.clearsOnTrimLevel(level))
  }

  // endregion
}
