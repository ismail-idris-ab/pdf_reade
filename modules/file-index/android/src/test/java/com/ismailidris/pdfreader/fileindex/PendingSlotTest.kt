package com.ismailidris.pdfreader.fileindex

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

class PendingSlotTest {
  private class Pick(val code: Int)

  @Test
  fun replaceOnEmptySlotReturnsNothing() {
    val slot = PendingSlot<Pick>()
    assertNull(slot.replace(Pick(1)))
  }

  @Test
  fun replaceHandsBackThePreviousValueOnce() {
    val slot = PendingSlot<Pick>()
    val first = Pick(1)
    val second = Pick(2)
    slot.replace(first)
    assertSame(first, slot.replace(second))
    // The replaced value can no longer be taken or released by anyone else.
    assertFalse(slot.release(first))
    assertSame(second, slot.take())
    assertNull(slot.take())
  }

  @Test
  fun releaseOnlyRemovesTheGivenValue() {
    val slot = PendingSlot<Pick>()
    val first = Pick(1)
    val second = Pick(2)
    slot.replace(first)
    slot.replace(second)
    assertFalse(slot.release(first))
    assertTrue(slot.release(second))
    assertFalse(slot.release(second))
    assertNull(slot.take())
  }

  @Test
  fun takeIfRemovesOnlyAMatchingValue() {
    val slot = PendingSlot<Pick>()
    val pick = Pick(7)
    slot.replace(pick)
    assertNull(slot.takeIf { it.code == 8 })
    assertSame(pick, slot.takeIf { it.code == 7 })
    assertNull(slot.takeIf { it.code == 7 })
  }

  @Test
  fun takeIfOnEmptySlotReturnsNothing() {
    assertNull(PendingSlot<Pick>().takeIf { true })
  }

  @Test
  fun everyValueIsHandedOutExactlyOnceUnderContention() {
    val slot = PendingSlot<Pick>()
    val values = (0 until 2000).map { Pick(it) }
    val handedOut = AtomicInteger(0)
    val start = CountDownLatch(1)
    val pool = Executors.newFixedThreadPool(4)
    try {
      // Replacers: each new value displaces the previous one.
      values.chunked(500).forEach { chunk ->
        pool.execute {
          start.await()
          chunk.forEach { value -> if (slot.replace(value) != null) handedOut.incrementAndGet() }
        }
      }
      start.countDown()
      pool.shutdown()
      assertTrue(pool.awaitTermination(30, TimeUnit.SECONDS))
    } finally {
      pool.shutdownNow()
    }
    if (slot.take() != null) handedOut.incrementAndGet()
    assertEquals(values.size, handedOut.get())
  }
}
