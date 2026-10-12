package com.ismailidris.pdfreader.pdfengine

/**
 * Thread-safe pending queue for render jobs: newest first (LIFO), deduplicated
 * by key, with per-request cancellation.
 *
 * The queue never settles anything itself. Every method that removes a waiter
 * hands it back to the caller, and a waiter is handed back at most once, so the
 * caller that receives it owns settling it exactly once.
 *
 * Lifecycle of a job: [enqueue] makes it pending; [takeNext] pops the newest
 * pending job and marks it running; [complete] removes it and returns its
 * waiters. Requests that arrive for the key of a pending or running job join
 * it. A running job can no longer be cancelled: its waiters get its result.
 */
internal class RenderQueue<K : Any, P, W>(private val tombstoneCapacity: Int = DEFAULT_TOMBSTONE_CAPACITY) {
  class Job<K, P, W> internal constructor(val key: K, val payload: P) {
    internal val waiters = LinkedHashMap<String, W>()
    internal var running = false
  }

  enum class Outcome {
    /** A new pending job was created. */
    QUEUED,

    /** Joined an existing job for the same key; a pending job moves to the front. */
    JOINED,

    /** The id was cancelled before it arrived; nothing was queued. */
    CANCELLED,

    /** The id is already in the queue; nothing was queued. */
    DUPLICATE_ID,
  }

  // Last element = newest = next to run.
  private val pending = ArrayDeque<Job<K, P, W>>()
  private val jobsByKey = HashMap<K, Job<K, P, W>>()
  private val keysByRequest = HashMap<String, K>()

  // Ids cancelled before their request reached the queue (JS may call cancel
  // synchronously before the async render call is delivered). Bounded, oldest
  // dropped first.
  private val tombstones = LinkedHashSet<String>()

  @Synchronized
  fun enqueue(requestId: String, key: K, payload: P, waiter: W): Outcome {
    if (tombstones.remove(requestId)) return Outcome.CANCELLED
    if (keysByRequest.containsKey(requestId)) return Outcome.DUPLICATE_ID
    keysByRequest[requestId] = key
    val existing = jobsByKey[key]
    if (existing != null) {
      existing.waiters[requestId] = waiter
      if (!existing.running) {
        pending.remove(existing)
        pending.addLast(existing)
      }
      return Outcome.JOINED
    }
    val job = Job<K, P, W>(key, payload)
    job.waiters[requestId] = waiter
    jobsByKey[key] = job
    pending.addLast(job)
    return Outcome.QUEUED
  }

  /**
   * Removes a still-pending request and returns its waiter for the caller to
   * reject. Returns null for a running or unknown request; an unknown id is
   * remembered so a later [enqueue] with it is refused.
   */
  @Synchronized
  fun cancel(requestId: String): W? {
    val key = keysByRequest[requestId]
    if (key == null) {
      rememberTombstone(requestId)
      return null
    }
    val job = jobsByKey.getValue(key)
    if (job.running) return null
    keysByRequest.remove(requestId)
    val waiter = job.waiters.remove(requestId)
    if (job.waiters.isEmpty()) {
      pending.remove(job)
      jobsByKey.remove(key)
    }
    return waiter
  }

  /**
   * True (and forgotten) if [requestId] was cancelled before it arrived. For
   * callers that may settle a request without queueing it (cache hits).
   */
  @Synchronized
  fun consumeTombstone(requestId: String): Boolean = tombstones.remove(requestId)

  /** Pops the newest pending job and marks it running, or null when idle. */
  @Synchronized
  fun takeNext(): Job<K, P, W>? {
    val job = pending.removeLastOrNull() ?: return null
    job.running = true
    return job
  }

  /** Finishes [job] and returns its waiters; empty if [drainAll] already took them. */
  @Synchronized
  fun complete(job: Job<K, P, W>): List<W> {
    if (jobsByKey[job.key] !== job) return emptyList()
    jobsByKey.remove(job.key)
    job.waiters.keys.forEach { keysByRequest.remove(it) }
    val waiters = job.waiters.values.toList()
    job.waiters.clear()
    return waiters
  }

  /** Removes every pending and running job and returns all their waiters. */
  @Synchronized
  fun drainAll(): List<W> {
    val waiters = jobsByKey.values.flatMap { it.waiters.values }
    jobsByKey.values.forEach { it.waiters.clear() }
    jobsByKey.clear()
    keysByRequest.clear()
    pending.clear()
    tombstones.clear()
    return waiters
  }

  @get:Synchronized
  val pendingCount: Int
    get() = pending.size

  /** Number of requests (waiters) across pending and running jobs. */
  @get:Synchronized
  val requestCount: Int
    get() = keysByRequest.size

  private fun rememberTombstone(requestId: String) {
    if (tombstoneCapacity <= 0) return
    tombstones.remove(requestId)
    tombstones.add(requestId)
    while (tombstones.size > tombstoneCapacity) {
      tombstones.remove(tombstones.first())
    }
  }

  companion object {
    const val DEFAULT_TOMBSTONE_CAPACITY = 256
  }
}
