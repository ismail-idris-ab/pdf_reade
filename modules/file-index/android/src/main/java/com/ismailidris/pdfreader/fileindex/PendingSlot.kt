package com.ismailidris.pdfreader.fileindex

import java.util.concurrent.atomic.AtomicReference

/**
 * Thread-safe holder for at most one pending value (the picker's promise).
 * Every operation that removes a value hands it to exactly one caller, which
 * then owns settling it, so each value is settled exactly once.
 */
class PendingSlot<T : Any> {
  private val ref = AtomicReference<T?>(null)

  /** Stores [value] and returns the value it replaced, which the caller must settle. */
  fun replace(value: T): T? = ref.getAndSet(value)

  /** Removes and returns the current value, if any. */
  fun take(): T? = ref.getAndSet(null)

  /** Removes and returns the current value only when [predicate] accepts it. */
  fun takeIf(predicate: (T) -> Boolean): T? {
    while (true) {
      val current = ref.get() ?: return null
      if (!predicate(current)) return null
      if (ref.compareAndSet(current, null)) return current
    }
  }

  /** Removes [value] if it is still the current value; true when it was removed. */
  fun release(value: T): Boolean = ref.compareAndSet(value, null)
}
