package com.ismailidris.pdfreader.pdfengine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class RenderJobQueueTest {
  private val tile = RenderJobQueue.PRIORITY_TILE
  private val page = RenderJobQueue.PRIORITY_PAGE

  private fun RenderJobQueue<String>.pollAll(): List<String> = generateSequence { poll() }.toList()

  @Test
  fun tilesRunBeforePagesAndEachClassIsFifo() {
    val queue = RenderJobQueue<String>()
    queue.add("page1", page)
    queue.add("page2", page)
    queue.add("tile1", tile)
    queue.add("page3", page)
    queue.add("tile2", tile)
    assertEquals(listOf("tile1", "tile2", "page1", "page2", "page3"), queue.pollAll())
    assertNull(queue.poll())
  }

  @Test
  fun aTileArrivingWhilePagesWaitGoesNext() {
    val queue = RenderJobQueue<String>()
    repeat(3) { queue.add("backdrop$it", page) }
    assertEquals("backdrop0", queue.poll())
    queue.add("tile", tile)
    assertEquals("tile", queue.poll())
    assertEquals(listOf("backdrop1", "backdrop2"), queue.pollAll())
  }

  @Test
  fun removedItemsNeverRunAndRemoveIsByIdentity() {
    val queue = RenderJobQueue<String>()
    val a = String(charArrayOf('x'))
    val b = String(charArrayOf('x'))
    queue.add(a, page)
    queue.add(b, page)
    assertTrue(queue.remove(b))
    assertFalse(queue.remove(b))
    assertEquals(1, queue.size)
    assertTrue(queue.poll() === a)
  }

  @Test
  fun drainEmptiesTheQueue() {
    val queue = RenderJobQueue<String>()
    queue.add("a", page)
    queue.add("b", tile)
    assertEquals(setOf("a", "b"), queue.drain().toSet())
    assertEquals(0, queue.size)
    assertNull(queue.poll())
  }
}
