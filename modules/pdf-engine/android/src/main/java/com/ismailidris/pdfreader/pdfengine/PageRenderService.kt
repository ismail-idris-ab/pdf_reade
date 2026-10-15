package com.ismailidris.pdfreader.pdfengine

import android.content.ComponentCallbacks2
import android.content.Context
import android.content.res.Configuration
import android.graphics.Bitmap
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import androidx.core.graphics.createBitmap
import expo.modules.kotlin.exception.CodedException
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineExceptionHandler
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import java.io.IOException
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean

internal object AndroidBitmapAllocator : BitmapAllocator<Bitmap> {
  override fun allocate(widthPx: Int, heightPx: Int): Bitmap = createBitmap(widthPx, heightPx, Bitmap.Config.ARGB_8888)

  override fun free(bitmap: Bitmap) {
    if (!bitmap.isRecycled) bitmap.recycle()
  }
}

/**
 * The page-view render backend: renders on the shared PDFium thread with
 * PDFium's progressive renderer into bitmaps from [pool], and delivers
 * outcomes on the main thread. One per module instance.
 */
internal class PageRenderService(
  private val reader: () -> ReaderEngine,
  val pool: BitmapPool<Bitmap>,
  private val pdfiumDispatcher: CoroutineDispatcher = PdfiumThread.dispatcher,
  private val mainHandler: Handler = Handler(Looper.getMainLooper()),
  idleTrimDelayMs: Long = PoolIdleTrim.DEFAULT_DELAY_MS,
) : PageRenderBackend<Bitmap> {
  constructor(reader: () -> ReaderEngine, memoryClassMb: Int) :
    this(reader, BitmapPool(PageRenderMath.poolBudgetBytes(memoryClassMb), AndroidBitmapAllocator))

  override val caps: RenderCaps = PageRenderMath.capsFor(pool.budgetBytes)
  override val backdropCaps: RenderCaps = PageRenderMath.backdropCapsFor(pool.budgetBytes)
  override val tileCaps: RenderCaps = PageRenderMath.tileCapsFor(pool.budgetBytes)

  // Last-resort guard; renderNow catches everything itself.
  private val uncaughtHandler = CoroutineExceptionHandler { _, error ->
    Log.e(TAG, "Uncaught page render failure: ${error.javaClass.simpleName}")
  }
  private val scope = CoroutineScope(SupervisorJob() + pdfiumDispatcher + uncaughtHandler)
  private val active: MutableSet<RenderCancelToken> = ConcurrentHashMap.newKeySet()
  private val queue = RenderJobQueue<QueuedRender>()
  private val pumpLock = Any()

  // Guarded by pumpLock: a render task is on (or queued for) the PDFium thread.
  private var running = false
  private val destroyed = AtomicBoolean(false)

  private val idleTrim = PoolIdleTrim(
    idleTrimDelayMs,
    schedule = { delay, block ->
      val runnable = Runnable(block)
      mainHandler.postDelayed(runnable, delay)
      RenderCancellable { mainHandler.removeCallbacks(runnable) }
    },
    trim = { pool.trimIfIdle() },
  )

  // Drops free bitmaps when the system asks for memory (see PoolIdleTrim.clearsOnTrimLevel).
  private val memoryCallbacks = object : ComponentCallbacks2 {
    override fun onTrimMemory(level: Int) {
      if (PoolIdleTrim.clearsOnTrimLevel(level)) pool.clear()
    }

    @Deprecated("Deprecated in Java")
    override fun onLowMemory() {
      pool.clear()
    }

    override fun onConfigurationChanged(newConfig: Configuration) = Unit
  }
  private var callbacksContext: Context? = null

  init {
    pool.checkedOutListener = idleTrim::onCheckedOutChanged
  }

  /** Starts listening for onTrimMemory on [context]'s application; undone by [destroy]. */
  fun registerMemoryCallbacks(context: Context) {
    val app = context.applicationContext
    // Registered under the same lock destroy() uses to unregister, so a
    // destroy racing this call either runs first (and we skip) or sees the
    // context and unregisters what we registered.
    synchronized(this) {
      if (destroyed.get() || callbacksContext != null) return
      app.registerComponentCallbacks(memoryCallbacks)
      callbacksContext = app
    }
  }

  /** Test-only: runs on the PDFium thread just before PDFium renders. Always null in production. */
  @Volatile
  internal var beforeRenderForTest: (() -> Unit)? = null

  override fun render(spec: RenderSpec, onDone: (RenderOutcome<Bitmap>) -> Unit): RenderCancellable {
    if (destroyed.get()) {
      deliver(RenderOutcome.Failed(ERR_DOC_NOT_OPEN), onDone)
      return RenderCancellable {}
    }
    val token = try {
      RenderCancelToken.create()
    } catch (e: OutOfMemoryError) {
      deliver(RenderOutcome.Failed(ErrorCode.OUT_OF_MEMORY.name), onDone)
      return RenderCancellable {}
    }
    active.add(token)
    val job = QueuedRender(spec, token, onDone, SystemClock.elapsedRealtime())
    queue.add(job, if (spec.window != null) RenderJobQueue.PRIORITY_TILE else RenderJobQueue.PRIORITY_PAGE)
    pump()
    return RenderCancellable {
      token.cancel()
      // Still waiting: it will never run, so its token is freed now.
      if (queue.remove(job)) finish(job)
    }
  }

  private class QueuedRender(
    val spec: RenderSpec,
    val token: RenderCancelToken,
    val onDone: (RenderOutcome<Bitmap>) -> Unit,
    val requestedAt: Long,
  )

  /**
   * Feeds one render at a time onto the PDFium thread, best first (tiles,
   * then pages; FIFO within each). Each render is its own task on
   * [pdfiumDispatcher], so thumbnail and search work queued there runs
   * between renders, and a tile requested while pages wait goes next instead
   * of behind them.
   */
  private fun pump() {
    val next: QueuedRender
    synchronized(pumpLock) {
      if (running || destroyed.get()) return
      next = queue.poll() ?: return
      running = true
    }
    val task = scope.launch {
      // Nothing below suspends, so a finished render is always delivered.
      deliver(renderNow(next.spec, next.token, next.requestedAt), next.onDone)
    }
    // Also runs for a task cancelled before it started (destroy).
    task.invokeOnCompletion {
      finish(next)
      synchronized(pumpLock) { running = false }
      pump()
    }
  }

  private fun finish(job: QueuedRender) {
    active.remove(job.token)
    job.token.close()
  }

  override fun release(bitmap: Bitmap) {
    pool.release(bitmap)
    if (destroyed.get()) pool.clear()
  }

  /** Stops every render and frees pooled bitmaps. Bitmaps still shown come back via [release]. */
  fun destroy() {
    if (!destroyed.compareAndSet(false, true)) return
    active.forEach { it.cancel() }
    queue.drain().forEach(::finish)
    scope.cancel()
    idleTrim.cancel()
    pool.checkedOutListener = null
    synchronized(this) { callbacksContext.also { callbacksContext = null } }
      ?.unregisterComponentCallbacks(memoryCallbacks)
    pool.clear()
  }

  /** PDFium thread. Maps every failure (any Throwable) to an outcome; never throws. */
  internal fun renderNow(spec: RenderSpec, token: RenderCancelToken, requestedAt: Long = SystemClock.elapsedRealtime()): RenderOutcome<Bitmap> {
    val started = SystemClock.elapsedRealtime()
    val waitMs = started - requestedAt
    if (token.isCancelled) return RenderOutcome.Cancelled
    return try {
      reader().withRenderablePage(spec.docId, spec.page, token) { handle ->
        renderWithRetry(handle, spec, token, started, waitMs)
      }
    } catch (e: CodedException) {
      RenderOutcome.Failed(e.code)
    } catch (e: OutOfMemoryError) {
      RenderOutcome.Failed(ErrorCode.OUT_OF_MEMORY.name)
    } catch (e: IOException) {
      // Only PDFIUM_ERROR:<code> (page cannot be loaded) is expected here.
      if (PdfiumErrors.parseCode(e.message) != null) {
        RenderOutcome.Failed(ErrorCode.CORRUPT_FILE.name)
      } else {
        Log.w(TAG, "page render failed: ${e.javaClass.simpleName}")
        RenderOutcome.Failed(ERR_RENDER_FAILED)
      }
    } catch (e: Throwable) {
      // Anything else (including Errors) still ends in an outcome, so onDone always runs.
      Log.w(TAG, "page render failed: ${e.javaClass.simpleName}")
      RenderOutcome.Failed(ERR_RENDER_FAILED)
    }
  }

  /**
   * Renders at [spec]'s plan; on OutOfMemoryError (allocation or render) a
   * whole page retries once at half the scale, then fails with
   * OUT_OF_MEMORY. A detail tile is optional sharpness, so it fails at once
   * (the view drops it). The bitmap goes back to the pool on every path
   * except success.
   */
  private fun renderWithRetry(
    handle: Long,
    spec: RenderSpec,
    token: RenderCancelToken,
    started: Long,
    waitMs: Long,
  ): RenderOutcome<Bitmap> {
    var plan = spec.plan
    var retried = spec.window != null
    while (true) {
      val bitmap: Bitmap
      val status: Int
      try {
        bitmap = pool.acquire(plan.widthPx, plan.heightPx)
        try {
          beforeRenderForTest?.invoke()
          val window = spec.window
          status = if (window == null) {
            PdfiumNative.renderPageProgressive(handle, spec.page, bitmap, token.nativeHandle)
          } else {
            PdfiumNative.renderPageProgressive(
              handle, spec.page, bitmap, token.nativeHandle,
              window.startX, window.startY, window.pageWidthPx, window.pageHeightPx,
            )
          }
        } catch (e: Throwable) {
          pool.release(bitmap)
          throw e
        }
      } catch (e: OutOfMemoryError) {
        val smaller = if (retried) null else PageRenderMath.halve(plan)
        if (smaller == null) return RenderOutcome.Failed(ErrorCode.OUT_OF_MEMORY.name)
        plan = smaller
        retried = true
        continue
      }
      when (status) {
        PdfiumNative.RENDER_DONE ->
          return RenderOutcome.Rendered(bitmap, plan.widthPx, plan.heightPx, SystemClock.elapsedRealtime() - started, waitMs)
        PdfiumNative.RENDER_CANCELLED -> {
          pool.release(bitmap)
          return if (token.documentClosed) RenderOutcome.Failed(ERR_DOC_NOT_OPEN) else RenderOutcome.Cancelled
        }
        else -> {
          pool.release(bitmap)
          return RenderOutcome.Failed(ERR_RENDER_FAILED)
        }
      }
    }
  }

  /** Hands [outcome] to [onDone] on the main thread; a bitmap nobody can receive goes back to the pool. */
  private fun deliver(outcome: RenderOutcome<Bitmap>, onDone: (RenderOutcome<Bitmap>) -> Unit) {
    val posted = mainHandler.post {
      try {
        onDone(outcome)
      } catch (e: Exception) {
        Log.w(TAG, "page render delivery failed: ${e.javaClass.simpleName}")
      }
    }
    if (!posted && outcome is RenderOutcome.Rendered) release(outcome.bitmap)
  }

  companion object {
    private const val TAG = "PdfEngine"
  }
}
