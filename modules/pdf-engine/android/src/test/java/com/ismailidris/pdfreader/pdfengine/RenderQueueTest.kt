package com.ismailidris.pdfreader.pdfengine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Collections
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class RenderQueueTest {
  private class Waiter(val name: String)

  private fun queue(tombstones: Int = RenderQueue.DEFAULT_TOMBSTONE_CAPACITY) =
    RenderQueue<String, String, Waiter>(tombstones)

  @Test
  fun takesNewestJobFirst() {
    val q = queue()
    q.enqueue("r1", "k1", "p1", Waiter("w1"))
    q.enqueue("r2", "k2", "p2", Waiter("w2"))
    q.enqueue("r3", "k3", "p3", Waiter("w3"))
    assertEquals("k3", q.takeNext()?.key)
    q.enqueue("r4", "k4", "p4", Waiter("w4"))
    assertEquals("k4", q.takeNext()?.key)
    assertEquals("k2", q.takeNext()?.key)
    assertEquals("k1", q.takeNext()?.key)
    assertNull(q.takeNext())
  }

  @Test
  fun enqueueReportsQueued() {
    val q = queue()
    assertEquals(RenderQueue.Outcome.QUEUED, q.enqueue("r1", "k1", "p1", Waiter("w1")))
    assertEquals(1, q.pendingCount)
  }

  @Test
  fun sameKeyJoinsAndRendersOnce() {
    val q = queue()
    val a = Waiter("a")
    val b = Waiter("b")
    assertEquals(RenderQueue.Outcome.QUEUED, q.enqueue("r1", "k", "first", a))
    assertEquals(RenderQueue.Outcome.JOINED, q.enqueue("r2", "k", "second", b))
    assertEquals(1, q.pendingCount)
    val job = q.takeNext()!!
    assertEquals("first", job.payload)
    assertNull(q.takeNext())
    assertEquals(listOf(a, b), q.complete(job))
    assertEquals(0, q.requestCount)
  }

  @Test
  fun joiningAPendingJobMovesItToTheFront() {
    val q = queue()
    q.enqueue("r1", "k1", "p1", Waiter("w1"))
    q.enqueue("r2", "k2", "p2", Waiter("w2"))
    q.enqueue("r3", "k1", "p1", Waiter("w3"))
    assertEquals("k1", q.takeNext()?.key)
    assertEquals("k2", q.takeNext()?.key)
  }

  @Test
  fun joiningARunningJobSharesItsResult() {
    val q = queue()
    val a = Waiter("a")
    val b = Waiter("b")
    q.enqueue("r1", "k", "p", a)
    val job = q.takeNext()!!
    assertEquals(RenderQueue.Outcome.JOINED, q.enqueue("r2", "k", "p", b))
    assertEquals(0, q.pendingCount)
    assertEquals(listOf(a, b), q.complete(job))
  }

  @Test
  fun aNewRequestAfterCompletionStartsANewJob() {
    val q = queue()
    q.enqueue("r1", "k", "p", Waiter("a"))
    q.complete(q.takeNext()!!)
    assertEquals(RenderQueue.Outcome.QUEUED, q.enqueue("r2", "k", "p", Waiter("b")))
  }

  @Test
  fun cancelRemovesAPendingRequestAndHandsBackItsWaiter() {
    val q = queue()
    val a = Waiter("a")
    q.enqueue("r1", "k1", "p1", a)
    q.enqueue("r2", "k2", "p2", Waiter("b"))
    assertSame(a, q.cancel("r1"))
    assertEquals(1, q.pendingCount)
    assertEquals("k2", q.takeNext()?.key)
    assertNull(q.takeNext())
  }

  @Test
  fun cancelHandsBackAWaiterOnlyOnce() {
    val q = queue()
    val a = Waiter("a")
    q.enqueue("r1", "k1", "p1", a)
    assertSame(a, q.cancel("r1"))
    assertNull(q.cancel("r1"))
  }

  @Test
  fun cancellingOneOfTwoJoinedRequestsKeepsTheJob() {
    val q = queue()
    val a = Waiter("a")
    val b = Waiter("b")
    q.enqueue("r1", "k", "p", a)
    q.enqueue("r2", "k", "p", b)
    assertSame(a, q.cancel("r1"))
    val job = q.takeNext()!!
    assertEquals(listOf(b), q.complete(job))
  }

  @Test
  fun cancelIsANoOpForARunningRequest() {
    val q = queue()
    val a = Waiter("a")
    q.enqueue("r1", "k", "p", a)
    val job = q.takeNext()!!
    assertNull(q.cancel("r1"))
    assertEquals(listOf(a), q.complete(job))
  }

  @Test
  fun cancelOfAnUnknownIdIsANoOp() {
    val q = queue()
    q.enqueue("r1", "k", "p", Waiter("a"))
    assertNull(q.cancel("nope"))
    assertEquals(1, q.pendingCount)
  }

  @Test
  fun cancelBeforeArrivalRefusesTheLaterEnqueue() {
    val q = queue()
    assertNull(q.cancel("early"))
    assertEquals(RenderQueue.Outcome.CANCELLED, q.enqueue("early", "k", "p", Waiter("a")))
    assertEquals(0, q.pendingCount)
    // The tombstone is used up.
    assertEquals(RenderQueue.Outcome.QUEUED, q.enqueue("early", "k", "p", Waiter("b")))
  }

  @Test
  fun consumeTombstoneReportsAndForgetsAnEarlyCancel() {
    val q = queue()
    q.cancel("early")
    assertTrue(q.consumeTombstone("early"))
    assertEquals(false, q.consumeTombstone("early"))
  }

  @Test
  fun tombstonesAreBounded() {
    val q = queue(tombstones = 2)
    q.cancel("t1")
    q.cancel("t2")
    q.cancel("t3")
    assertEquals(RenderQueue.Outcome.QUEUED, q.enqueue("t1", "k1", "p", Waiter("a")))
    assertEquals(RenderQueue.Outcome.CANCELLED, q.enqueue("t2", "k2", "p", Waiter("b")))
    assertEquals(RenderQueue.Outcome.CANCELLED, q.enqueue("t3", "k3", "p", Waiter("c")))
  }

  @Test
  fun duplicateRequestIdIsRefused() {
    val q = queue()
    q.enqueue("r1", "k1", "p", Waiter("a"))
    assertEquals(RenderQueue.Outcome.DUPLICATE_ID, q.enqueue("r1", "k2", "p", Waiter("b")))
    assertEquals(1, q.pendingCount)
  }

  @Test
  fun drainAllReturnsPendingAndRunningWaitersOnce() {
    val q = queue()
    val running = Waiter("running")
    val pending = Waiter("pending")
    q.enqueue("r1", "k1", "p", running)
    val job = q.takeNext()!!
    q.enqueue("r2", "k2", "p", pending)
    val drained = q.drainAll()
    assertEquals(setOf(running, pending), drained.toSet())
    assertEquals(2, drained.size)
    assertTrue(q.complete(job).isEmpty())
    assertNull(q.takeNext())
    assertTrue(q.drainAll().isEmpty())
    assertEquals(0, q.requestCount)
  }

  @Test
  fun concurrentCancelAndTakeSettleEachWaiterExactlyOnce() {
    repeat(50) {
      val q = queue()
      val count = 200
      repeat(count) { i -> q.enqueue("r$i", "k${i % 50}", "p", Waiter("w$i")) }
      val settled = Collections.synchronizedList(ArrayList<Waiter>())
      val pool = Executors.newFixedThreadPool(4)
      val start = CountDownLatch(1)
      val done = CountDownLatch(4)
      repeat(2) {
        pool.execute {
          start.await()
          for (i in 0 until count) q.cancel("r$i")?.let { settled.add(it) }
          done.countDown()
        }
      }
      repeat(2) {
        pool.execute {
          start.await()
          while (true) {
            val job = q.takeNext() ?: break
            settled.addAll(q.complete(job))
          }
          done.countDown()
        }
      }
      start.countDown()
      assertTrue(done.await(10, TimeUnit.SECONDS))
      pool.shutdown()
      // Both drainers stop once the queue is empty; drainAll proves nothing is left behind.
      settled.addAll(q.drainAll())
      assertEquals(count, settled.size)
      assertEquals(count, settled.toSet().size)
    }
  }
}
