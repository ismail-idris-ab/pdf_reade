package com.ismailidris.pdfreader.pdfengine

import android.graphics.Bitmap
import android.util.Log
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineExceptionHandler
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.concurrent.atomic.AtomicBoolean

class ThumbnailRequest : Record {
  @Field
  val requestId: String = ""

  @Field
  val source: String = ""

  @Field
  val mtime: Double = 0.0

  @Field
  val size: Double = 0.0

  @Field
  val widthPx: Double = 0.0
}

class PdfEngineModule : Module() {
  private val spike by lazy {
    EngineSpike(appContext.reactContext ?: throw Exceptions.ReactContextLost())
  }
  private val thumbnails by lazy {
    ThumbnailRenderer(appContext.reactContext ?: throw Exceptions.ReactContextLost())
  }

  // Last-resort guard: every launch below catches its own failures, so this
  // only fires on a bug. Logs the exception class only (messages can hold paths).
  private val uncaughtHandler = CoroutineExceptionHandler { _, error ->
    Log.e(TAG, "Uncaught failure in pdf-engine: ${error.javaClass.simpleName}")
  }
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO + uncaughtHandler)
  private val trimScheduled = AtomicBoolean(false)

  // Settling can throw once the JS runtime is gone (reload); nothing is left to notify then.
  private val promiseSettler = object : ThumbnailSettler<Promise> {
    override fun resolve(waiter: Promise, result: ThumbnailResult) {
      try {
        waiter.resolve(result.toMap())
      } catch (e: Exception) {
        Log.w(TAG, "Could not resolve thumbnail promise: ${e.javaClass.simpleName}")
      }
    }

    override fun reject(waiter: Promise, error: CodedException) {
      try {
        waiter.reject(error)
      } catch (e: Exception) {
        Log.w(TAG, "Could not reject thumbnail promise: ${e.javaClass.simpleName}")
      }
    }
  }

  // Created on first use because the renderer needs the React context.
  private val coordinatorLazy = lazy {
    ThumbnailCoordinator<Bitmap, Promise>(
      scope = scope,
      ioDispatcher = Dispatchers.IO,
      stages = thumbnails,
      settler = promiseSettler,
      onWritten = ::scheduleTrim,
    )
  }
  private val coordinator by coordinatorLazy
  private val destroyed = AtomicBoolean(false)

  override fun definition() = ModuleDefinition {
    Name("PdfEngine")

    // Version of the JS-facing contract, exposed for diagnostics. Bump it
    // whenever the module API changes.
    Constant("apiVersion") {
      API_VERSION
    }

    OnDestroy {
      destroyed.set(true)
      if (coordinatorLazy.isInitialized()) coordinator.destroy()
      scope.cancel()
    }

    AsyncFunction("renderThumbnail") { request: ThumbnailRequest, promise: Promise ->
      requestThumbnail(request, promise)
    }

    // Sync and never throws; an unknown or already-running id is a no-op.
    Function("cancelThumbnail") { requestId: String ->
      try {
        coordinator.cancel(requestId)
      } catch (e: Exception) {
        Log.w(TAG, "cancelThumbnail failed: ${e.javaClass.simpleName}")
      }
    }

    // T0.1b spike functions, registered in debug builds only. Removed when
    // T2.1 defines the engine API. They share the PDFium thread with thumbnails.
    if (BuildConfig.DEBUG) {
      AsyncFunction("spikeRender") Coroutine { ->
        withContext(PdfiumThread.dispatcher) { spike.render() }
      }

      AsyncFunction("spikeMerge") Coroutine { ->
        withContext(PdfiumThread.dispatcher) { spike.merge() }
      }
    }
  }

  // Runs on the Expo modules queue (a background thread). Cache hits resolve
  // here without waiting behind the render queue.
  private fun requestThumbnail(request: ThumbnailRequest, promise: Promise) {
    if (destroyed.get()) {
      promiseSettler.reject(promise, PdfEngineException(ErrorCode.CANCELLED, "The thumbnail request was cancelled"))
      return
    }
    if (request.requestId.isEmpty() || request.source.isEmpty()) {
      promiseSettler.reject(promise, CodedException(ERR_THUMBNAIL_FAILED, "Invalid thumbnail request", null))
      return
    }
    try {
      val coordinator = coordinator
      if (coordinator.consumeTombstone(request.requestId)) {
        promiseSettler.reject(promise, PdfEngineException(ErrorCode.CANCELLED, "The thumbnail request was cancelled"))
        return
      }
      val width = ThumbnailMath.clampWidth(request.widthPx)
      val key = ThumbnailMath.cacheKey(request.source, request.mtime.toLong(), request.size.toLong(), width)
      val hit = try {
        thumbnails.cached(key)
      } catch (e: Exception) {
        Log.w(TAG, "Thumbnail cache read failed: ${e.javaClass.simpleName}")
        null
      }
      if (hit != null) {
        promiseSettler.resolve(promise, hit)
        return
      }
      coordinator.submit(request.requestId, ThumbnailJob(key, request.source, width), promise)
      // OnDestroy may have run before this coordinator existed and so could
      // not drain it; settle whatever was just queued.
      if (destroyed.get()) coordinator.destroy()
    } catch (e: CodedException) {
      promiseSettler.reject(promise, e)
    } catch (e: OutOfMemoryError) {
      promiseSettler.reject(promise, PdfEngineException(ErrorCode.OUT_OF_MEMORY, "Not enough memory to render the thumbnail"))
    } catch (e: Exception) {
      Log.w(TAG, "renderThumbnail failed: ${e.javaClass.simpleName}")
      promiseSettler.reject(promise, CodedException(ERR_THUMBNAIL_FAILED, "Could not create the thumbnail", null))
    }
  }

  /** Debounced cache trim on IO (never the PDFium thread), at most once per [TRIM_DEBOUNCE_MS]. */
  private fun scheduleTrim() {
    if (!trimScheduled.compareAndSet(false, true)) return
    scope.launch(Dispatchers.IO) {
      try {
        delay(TRIM_DEBOUNCE_MS)
        thumbnails.trim()
      } catch (e: CancellationException) {
        throw e
      } catch (e: Exception) {
        Log.w(TAG, "Thumbnail cache trim failed: ${e.javaClass.simpleName}")
      } finally {
        trimScheduled.set(false)
      }
    }
  }

  companion object {
    const val API_VERSION = 2

    private const val TAG = "PdfEngine"
    private const val TRIM_DEBOUNCE_MS = 2_000L
  }
}
