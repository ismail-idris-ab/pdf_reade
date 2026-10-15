package com.ismailidris.pdfreader.pdfengine

/**
 * Pending page-view renders, lowest priority value first and, within one
 * priority, in arrival order (FIFO). Thread-safe; pure so the ordering is
 * unit-tested on the JVM. Small by construction (cancelled renders leave it
 * at once), so a list scan is fine.
 */
internal class RenderJobQueue<T : Any> {
  private class Entry<T>(val item: T, val priority: Int, val seq: Long)

  private val entries = ArrayList<Entry<T>>()
  private var nextSeq = 0L

  val size: Int @Synchronized get() = entries.size

  @Synchronized
  fun add(item: T, priority: Int) {
    entries.add(Entry(item, priority, nextSeq++))
  }

  /** Removes [item] if it is still waiting; true when it was. */
  @Synchronized
  fun remove(item: T): Boolean {
    val index = entries.indexOfFirst { it.item === item }
    if (index < 0) return false
    entries.removeAt(index)
    return true
  }

  /** The next item to run, removed; null when nothing waits. */
  @Synchronized
  fun poll(): T? {
    var best = -1
    for (i in entries.indices) {
      val e = entries[i]
      if (best < 0 || e.priority < entries[best].priority ||
        (e.priority == entries[best].priority && e.seq < entries[best].seq)
      ) {
        best = i
      }
    }
    return if (best < 0) null else entries.removeAt(best).item
  }

  /** Removes and returns everything still waiting. */
  @Synchronized
  fun drain(): List<T> {
    val all = entries.map { it.item }
    entries.clear()
    return all
  }

  companion object {
    /** Detail tiles: what the user is looking at, after a zoom or pan settles. */
    const val PRIORITY_TILE = 0

    /** Whole-page bitmaps (and backdrops). */
    const val PRIORITY_PAGE = 1
  }
}
