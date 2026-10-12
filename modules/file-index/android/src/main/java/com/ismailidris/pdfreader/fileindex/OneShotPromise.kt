package com.ismailidris.pdfreader.fileindex

import expo.modules.kotlin.Promise
import java.util.concurrent.atomic.AtomicReference

/**
 * A promise that exactly one caller settles. It exists for the flows whose
 * answer arrives in a framework callback rather than in the coroutine that
 * started them: the callback, module teardown and a newer request all race
 * for the same promise, and settling a promise twice crashes the bridge.
 *
 * [settle] hands the promise to the first caller only; later callers get
 * `false` and must do nothing.
 */
class OneShotPromise(promise: Promise) {
  private val ref = AtomicReference<Promise?>(promise)

  /** Whether the promise has already been settled by someone. */
  val isSettled: Boolean
    get() = ref.get() == null

  /** Runs [block] with the promise, or returns false if it is already settled. */
  fun settle(block: (Promise) -> Unit): Boolean {
    val promise = ref.getAndSet(null) ?: return false
    block(promise)
    return true
  }
}
