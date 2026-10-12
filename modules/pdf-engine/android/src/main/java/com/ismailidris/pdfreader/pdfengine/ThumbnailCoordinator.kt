package com.ismailidris.pdfreader.pdfengine

import expo.modules.kotlin.exception.CodedException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import java.io.File
import java.util.concurrent.atomic.AtomicBoolean

/** Everything a queued thumbnail job needs; [key] (the cache key) identifies it. */
internal class ThumbnailJob(val key: String, val source: String, val widthPx: Int)

/** A thumbnail on disk. */
internal data class ThumbnailResult(val file: File, val width: Int, val height: Int)

/**
 * The work behind one thumbnail, split by thread. [R] is the rendered image
 * (a Bitmap in the app, anything in tests).
 */
internal interface ThumbnailStages<R> {
  /** Cache lookup. Called on the IO dispatcher. */
  fun cached(job: ThumbnailJob): ThumbnailResult?

  /**
   * Produces the image. Called from the IO dispatcher and must return there:
   * implementations hop to the PDFium thread only for PDFium calls
   * (withContext), so the caller never resumes on the PDFium thread.
   */
  suspend fun render(job: ThumbnailJob): R

  /** Encodes and stores [rendered]. Called on the IO dispatcher. */
  fun write(rendered: R, job: ThumbnailJob): ThumbnailResult

  /** Frees [rendered]; called exactly once per successful [render]. */
  fun release(rendered: R)

  /** A coded error with a static message for any failure of the stages. */
  fun mapFailure(error: Throwable): CodedException
}

/** Settles one waiter. Implementations must not throw. */
internal interface ThumbnailSettler<W> {
  fun resolve(waiter: W, result: ThumbnailResult)
  fun reject(waiter: W, error: CodedException)
}

/**
 * Schedules thumbnail jobs: newest first, deduplicated by cache key,
 * cancellable while queued, and every waiter settled exactly once.
 *
 * Each queued job gets one worker coroutine on [ioDispatcher]. A worker first
 * takes one of [maxInFlight] permits and only then pops the newest job, so the
 * job order is LIFO at the moment a slot frees up, and at most [maxInFlight]
 * jobs (and so rendered images) are alive at once. Writing happens on IO
 * while the PDFium thread is already free for the next job.
 */
internal class ThumbnailCoordinator<R, W>(
  private val scope: CoroutineScope,
  private val ioDispatcher: CoroutineDispatcher,
  private val stages: ThumbnailStages<R>,
  private val settler: ThumbnailSettler<W>,
  maxInFlight: Int = DEFAULT_MAX_IN_FLIGHT,
  private val onWritten: () -> Unit = {},
) {
  private val queue = RenderQueue<String, ThumbnailJob, W>()
  private val permits = Semaphore(maxInFlight)
  private val destroyed = AtomicBoolean(false)

  private sealed interface Outcome {
    class Success(val result: ThumbnailResult, val wroteFile: Boolean) : Outcome
    class Failure(val error: CodedException) : Outcome
  }

  /** True (and forgotten) if [requestId] was cancelled before it was submitted. */
  fun consumeTombstone(requestId: String): Boolean = queue.consumeTombstone(requestId)

  /** Queues [job] for [waiter], or settles [waiter] at once when that is impossible. */
  fun submit(requestId: String, job: ThumbnailJob, waiter: W) {
    if (destroyed.get()) {
      settler.reject(waiter, cancelled())
      return
    }
    when (queue.enqueue(requestId, job.key, job, waiter)) {
      RenderQueue.Outcome.QUEUED -> launchWorker()
      RenderQueue.Outcome.JOINED -> Unit
      RenderQueue.Outcome.CANCELLED -> settler.reject(waiter, cancelled())
      RenderQueue.Outcome.DUPLICATE_ID ->
        settler.reject(waiter, CodedException(ERR_THUMBNAIL_FAILED, "Duplicate thumbnail request id", null))
    }
    // destroy() may have drained the queue between the check above and the
    // enqueue; settle anything that slipped in so no waiter is left hanging.
    if (destroyed.get()) rejectAll(queue.drainAll())
  }

  /** Rejects a still-queued request with CANCELLED; running or unknown ids are a no-op. */
  fun cancel(requestId: String) {
    queue.cancel(requestId)?.let { settler.reject(it, cancelled()) }
  }

  /** Rejects every queued and running request with CANCELLED; later submits are rejected too. */
  fun destroy() {
    destroyed.set(true)
    rejectAll(queue.drainAll())
  }

  private fun launchWorker() {
    scope.launch(ioDispatcher) {
      permits.withPermit {
        val queued = queue.takeNext() ?: return@withPermit
        process(queued)
      }
    }
  }

  private suspend fun process(queued: RenderQueue.Job<String, ThumbnailJob, W>) {
    val job = queued.payload
    val outcome: Outcome = try {
      val hit = stages.cached(job)
      if (hit != null) {
        Outcome.Success(hit, wroteFile = false)
      } else {
        val rendered = stages.render(job)
        try {
          Outcome.Success(stages.write(rendered, job), wroteFile = true)
        } finally {
          stages.release(rendered)
        }
      }
    } catch (e: CancellationException) {
      // The scope is cancelled only after destroy(), which already drained
      // the queue; complete() hands back anything still owed.
      rejectAll(queue.complete(queued))
      throw e
    } catch (e: Throwable) {
      Outcome.Failure(stages.mapFailure(e))
    }
    val waiters = queue.complete(queued)
    when (outcome) {
      is Outcome.Success -> {
        waiters.forEach { settler.resolve(it, outcome.result) }
        if (outcome.wroteFile) onWritten()
      }
      is Outcome.Failure -> waiters.forEach { settler.reject(it, outcome.error) }
    }
  }

  private fun rejectAll(waiters: List<W>) {
    if (waiters.isEmpty()) return
    val error = cancelled()
    waiters.forEach { settler.reject(it, error) }
  }

  private fun cancelled() = PdfEngineException(ErrorCode.CANCELLED, "The thumbnail request was cancelled")

  companion object {
    /** One job can render while another opens its source or writes its WebP. */
    const val DEFAULT_MAX_IN_FLIGHT = 2
  }
}
