package com.ismailidris.pdfreader.fileindex

import expo.modules.kotlin.Promise
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

class OneShotPromiseTest {
  /** Records how a promise was settled, and how often. */
  private class RecordingPromise : Promise {
    val resolved = mutableListOf<Any?>()
    val rejected = mutableListOf<String?>()

    override fun resolve(value: Any?) {
      resolved.add(value)
    }

    override fun reject(code: String?, message: String?, cause: Throwable?) {
      rejected.add(code)
    }

    val settlements: Int
      get() = resolved.size + rejected.size
  }

  @Test
  fun theFirstCallerSettlesAndLaterOnesAreIgnored() {
    val promise = RecordingPromise()
    val request = OneShotPromise(promise)

    assertFalse(request.isSettled)
    assertTrue(request.settle { it.resolve("granted") })
    assertTrue(request.isSettled)
    // The permission listener answering after teardown must change nothing.
    assertFalse(request.settle { it.resolve("denied") })
    assertFalse(request.settle { it.reject("ERR_MODULE_DESTROYED", null, null) })

    assertEquals(listOf<Any?>("granted"), promise.resolved)
    assertEquals(1, promise.settlements)
  }

  @Test
  fun aRejectionAlsoSettlesItForGood() {
    val promise = RecordingPromise()
    val request = OneShotPromise(promise)

    // OnDestroy getting there first: the later listener answer is dropped.
    assertTrue(request.settle { it.reject("ERR_MODULE_DESTROYED", null, null) })
    assertFalse(request.settle { it.resolve("granted") })

    assertEquals(listOf("ERR_MODULE_DESTROYED"), promise.rejected)
    assertEquals(1, promise.settlements)
  }

  @Test
  fun exactlyOneThreadSettlesItUnderContention() {
    val promise = RecordingPromise()
    val request = OneShotPromise(promise)
    val winners = AtomicInteger(0)
    val start = CountDownLatch(1)
    val pool = Executors.newFixedThreadPool(8)
    try {
      repeat(8) {
        pool.execute {
          start.await()
          if (request.settle { p -> p.resolve("granted") }) winners.incrementAndGet()
        }
      }
      start.countDown()
      pool.shutdown()
      assertTrue(pool.awaitTermination(30, TimeUnit.SECONDS))
    } finally {
      pool.shutdownNow()
    }

    assertEquals(1, winners.get())
    assertEquals(1, promise.settlements)
  }
}
