package com.ismailidris.pdfreader.pdfengine

/** One file in a cache directory, as seen by [CacheTrimPlan]. */
internal data class CacheEntry(val name: String, val sizeBytes: Long, val lastModified: Long)

/** Pure LRU selection for the thumbnail cache; the caller does the file I/O. */
internal object CacheTrimPlan {
  /** Thumbnail cache cap. A trim runs only above it and stops at [TRIM_TARGET_RATIO] of it. */
  const val THUMBNAIL_CACHE_CAP_BYTES = 100L * 1024 * 1024
  const val TRIM_TARGET_RATIO = 0.8

  /** Temp files older than this are leftovers of interrupted writes. */
  const val STALE_TEMP_AGE_MS = 60L * 60 * 1000

  fun targetBytes(capBytes: Long): Long = (capBytes * TRIM_TARGET_RATIO).toLong()

  /**
   * Entries to delete, least recently used first. Nothing is selected while the
   * total is at or under [capBytes]; above it, the oldest go until the total is
   * at or under [targetBytes]. Ties on lastModified break by name for determinism.
   */
  fun evictions(
    entries: List<CacheEntry>,
    capBytes: Long = THUMBNAIL_CACHE_CAP_BYTES,
    targetBytes: Long = targetBytes(capBytes),
  ): List<CacheEntry> {
    var total = entries.sumOf { it.sizeBytes.coerceAtLeast(0) }
    if (total <= capBytes) return emptyList()
    val selected = ArrayList<CacheEntry>()
    for (entry in entries.sortedWith(compareBy<CacheEntry>({ it.lastModified }, { it.name }))) {
      if (total <= targetBytes) break
      selected.add(entry)
      total -= entry.sizeBytes.coerceAtLeast(0)
    }
    return selected
  }

  /** Temp entries last modified more than [maxAgeMs] before [nowMs]. */
  fun staleTemps(entries: List<CacheEntry>, nowMs: Long, maxAgeMs: Long = STALE_TEMP_AGE_MS): List<CacheEntry> =
    entries.filter { nowMs - it.lastModified > maxAgeMs }
}
