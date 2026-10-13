package com.ismailidris.pdfreader.pdfengine

import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * Open documents by id. Thread-safe. Removing hands the entry back exactly
 * once, so a second close of the same id is a no-op for the caller.
 */
internal class DocumentRegistry<T : Any>(private val newId: () -> String = { UUID.randomUUID().toString() }) {
  private val entries = ConcurrentHashMap<String, T>()

  val size: Int get() = entries.size

  /** Stores [entry] under a fresh id and returns that id. */
  fun add(entry: T): String {
    while (true) {
      val id = newId()
      if (entries.putIfAbsent(id, entry) == null) return id
    }
  }

  fun get(id: String): T? = entries[id]

  /** A snapshot of the current entries. */
  fun values(): List<T> = entries.values.toList()

  /** The entry for [id], removed; null when unknown or already removed. */
  fun remove(id: String): T? = entries.remove(id)

  /** Removes and returns every entry. */
  fun removeAll(): List<T> {
    val removed = ArrayList<T>()
    for (id in entries.keys.toList()) {
      entries.remove(id)?.let(removed::add)
    }
    return removed
  }
}
