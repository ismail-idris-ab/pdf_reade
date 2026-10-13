package com.ismailidris.pdfreader.pdfengine

import java.util.IdentityHashMap

/** Creates and frees the pooled bitmaps; abstract so the pool is unit-tested on the JVM. */
internal interface BitmapAllocator<B : Any> {
  /** A new ARGB_8888 bitmap; may throw OutOfMemoryError. */
  fun allocate(widthPx: Int, heightPx: Int): B

  /** Frees a bitmap nobody holds or draws any more. */
  fun free(bitmap: B)
}

/** Point-in-time pool accounting, in bytes and bitmap counts. */
internal data class BitmapPoolStats(
  val inUseBytes: Long,
  val freeBytes: Long,
  val inUseCount: Int,
  val freeCount: Int,
  /** Highest inUseBytes + freeBytes seen since creation or [BitmapPool.resetHighWater]. */
  val highWaterBytes: Long,
  val allocations: Int,
  val reuses: Int,
)

/**
 * Reuses same-size page bitmaps under a byte budget. Thread-safe: renders
 * acquire on the PDFium thread, views release on the UI thread.
 *
 * Checked-out bitmaps are owned by the views showing them, so the pool never
 * frees one: it only frees bitmaps that were released to it (least recently
 * released first). The budget is enforced on the whole pool by evicting free
 * bitmaps before allocating and when one comes back. Checked-out bytes alone
 * can still exceed it (JS decides how many views exist); refusing a bitmap
 * then would blank visible pages, so the allocation goes ahead and the
 * per-bitmap caps (PageRenderMath.capsFor) keep each one bounded.
 */
internal class BitmapPool<B : Any>(
  val budgetBytes: Long,
  private val allocator: BitmapAllocator<B>,
) {
  private class Entry(val widthPx: Int, val heightPx: Int) {
    val bytes: Long get() = widthPx.toLong() * heightPx * PageRenderMath.BYTES_PER_PIXEL
  }

  private val inUse = IdentityHashMap<B, Entry>()

  // Insertion order = release order: the first entry is least recently released.
  private val free = LinkedHashMap<B, Entry>()
  private var inUseBytes = 0L
  private var freeBytes = 0L
  private var highWater = 0L
  private var allocations = 0
  private var reuses = 0

  /**
   * Told when the checked-out count goes 0 -> 1 and 1 -> 0 (see
   * [PoolIdleTrim]). Called under the pool lock; it must not call back into
   * the pool synchronously.
   */
  @Volatile
  var checkedOutListener: ((checkedOut: Int) -> Unit)? = null

  /**
   * A bitmap of exactly [widthPx] x [heightPx], reused when a free one has
   * that size. Its pixels are stale; the renderer paints every pixel. Throws
   * OutOfMemoryError when allocation fails even after every free bitmap was
   * dropped.
   */
  @Synchronized
  fun acquire(widthPx: Int, heightPx: Int): B {
    require(widthPx > 0 && heightPx > 0)
    val reusable = free.entries.lastOrNull { it.value.widthPx == widthPx && it.value.heightPx == heightPx }
    if (reusable != null) {
      free.remove(reusable.key)
      freeBytes -= reusable.value.bytes
      checkOut(reusable.key, reusable.value)
      reuses++
      return reusable.key
    }
    val entry = Entry(widthPx, heightPx)
    evictFreeUntil { inUseBytes + freeBytes + entry.bytes <= budgetBytes }
    val bitmap = try {
      allocator.allocate(widthPx, heightPx)
    } catch (e: OutOfMemoryError) {
      // Give everything pooled back to the system and try once more.
      evictFreeUntil { false }
      allocator.allocate(widthPx, heightPx)
    }
    allocations++
    checkOut(bitmap, entry)
    return bitmap
  }

  /**
   * Returns a bitmap from [acquire]. The caller must no longer draw it (see
   * PageRenderController's deferred release). Unknown or already released
   * bitmaps are ignored.
   */
  @Synchronized
  fun release(bitmap: B) {
    val entry = inUse.remove(bitmap) ?: return
    inUseBytes -= entry.bytes
    if (inUse.isEmpty()) checkedOutListener?.invoke(0)
    free[bitmap] = entry
    freeBytes += entry.bytes
    evictFreeUntil { inUseBytes + freeBytes <= budgetBytes }
  }

  /** Frees every pooled bitmap if none is checked out; true when it did. */
  @Synchronized
  fun trimIfIdle(): Boolean {
    if (inUse.isNotEmpty()) return false
    evictFreeUntil { false }
    return true
  }

  /** Frees every pooled bitmap; checked-out ones are untouched. */
  @Synchronized
  fun clear() {
    evictFreeUntil { false }
  }

  @Synchronized
  fun stats() = BitmapPoolStats(inUseBytes, freeBytes, inUse.size, free.size, highWater, allocations, reuses)

  @Synchronized
  fun resetHighWater() {
    highWater = inUseBytes + freeBytes
  }

  private fun checkOut(bitmap: B, entry: Entry) {
    inUse[bitmap] = entry
    if (inUse.size == 1) checkedOutListener?.invoke(1)
    inUseBytes += entry.bytes
    highWater = maxOf(highWater, inUseBytes + freeBytes)
  }

  private inline fun evictFreeUntil(done: () -> Boolean) {
    val iterator = free.entries.iterator()
    while (!done() && iterator.hasNext()) {
      val (bitmap, entry) = iterator.next()
      iterator.remove()
      freeBytes -= entry.bytes
      allocator.free(bitmap)
    }
  }
}

/**
 * When to give pooled (free) page bitmaps back to the system. Pure so it is
 * unit-tested on the JVM; PageRenderService wires it to a main-thread
 * Handler and ComponentCallbacks2.
 *
 * Once no bitmap is checked out (the reader closed, or every page view was
 * recycled away) the free bitmaps are cleared after [delayMs], unless a view
 * checks one out again first. That keeps the pool for quick returns (a
 * re-render, a new document) without holding up to the whole budget for the
 * rest of the process, including in the background.
 */
internal class PoolIdleTrim(
  private val delayMs: Long,
  private val schedule: (delayMs: Long, block: () -> Unit) -> RenderCancellable,
  private val trim: () -> Unit,
) {
  private var pending: RenderCancellable? = null
  private var epoch = 0

  /** Called by the pool when the checked-out count goes 0 -> 1 or 1 -> 0. */
  @Synchronized
  fun onCheckedOutChanged(checkedOut: Int) {
    epoch++
    pending?.cancel()
    pending = null
    if (checkedOut == 0) {
      val mine = epoch
      pending = schedule(delayMs) { fire(mine) }
    }
  }

  @Synchronized
  fun cancel() {
    epoch++
    pending?.cancel()
    pending = null
  }

  private fun fire(mine: Int) {
    synchronized(this) {
      if (mine != epoch) return
      pending = null
    }
    // Outside this lock: trim takes the pool's lock, which calls into this class.
    trim()
  }

  companion object {
    /** Delay after the last bitmap comes back before free ones are dropped. */
    const val DEFAULT_DELAY_MS = 2_000L

    // ComponentCallbacks2 levels (several are deprecated constants from API 34, values unchanged).
    const val TRIM_MEMORY_RUNNING_LOW = 10

    /**
     * True when an onTrimMemory level should drop every free bitmap: the
     * process is running low (RUNNING_LOW, RUNNING_CRITICAL), its UI is
     * hidden (UI_HIDDEN) or it is in the background (BACKGROUND, MODERATE,
     * COMPLETE). RUNNING_MODERATE (5) keeps the pool.
     */
    fun clearsOnTrimLevel(level: Int): Boolean = level >= TRIM_MEMORY_RUNNING_LOW
  }
}
