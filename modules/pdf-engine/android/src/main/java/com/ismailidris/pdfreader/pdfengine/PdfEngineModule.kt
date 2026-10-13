package com.ismailidris.pdfreader.pdfengine

import android.app.ActivityManager
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

class SearchOptions : Record {
  @Field
  val matchCase: Boolean = false

  @Field
  val wholeWord: Boolean = false
}

class PdfEngineModule : Module() {
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

  // Created on first use because it needs the React context. Shares the
  // PDFium thread with thumbnails.
  private val readerLazy = lazy {
    ReaderEngine(
      appContext.reactContext ?: throw Exceptions.ReactContextLost(),
      searchScope = scope,
      listener = searchListener,
    )
  }
  private val reader by readerLazy

  // Created by the first page view; its pool budget comes from the heap class.
  private val pageRendererLazy = lazy {
    // A view created during teardown gets no renderer (it reports ERR_RENDER_FAILED).
    check(!destroyed.get()) { "The engine is shutting down" }
    val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
    val memoryClass = context.getSystemService(ActivityManager::class.java)?.memoryClass ?: FALLBACK_MEMORY_CLASS_MB
    PageRenderService({ reader }, memoryClass).also { it.registerMemoryCallbacks(context) }
  }

  override fun definition() = ModuleDefinition {
    Name("PdfEngine")

    // Version of the JS-facing contract, exposed for diagnostics. Bump it
    // whenever the module API changes.
    Constant("apiVersion") {
      API_VERSION
    }

    Events(EVENT_SEARCH_RESULT, EVENT_SEARCH_PROGRESS, EVENT_SEARCH_DONE)

    // The module's default view (JS: requireNativeView('PdfEngine')). Setters
    // only stage values; OnViewDidUpdateProps applies them together.
    View(PdfPageView::class) {
      Prop("docId", "") { view: PdfPageView, value: String -> view.docId = value }
      Prop("page", 0) { view: PdfPageView, value: Int -> view.page = value }
      Prop("renderScale", 0.0) { view: PdfPageView, value: Double -> view.renderScale = value }
      Prop("nightMode", false) { view: PdfPageView, value: Boolean -> view.nightMode = value }
      Prop("sepia", false) { view: PdfPageView, value: Boolean -> view.sepia = value }
      Prop("retryToken", 0.0) { view: PdfPageView, value: Double -> view.retryToken = value }

      Events("onRendered", "onRenderError")

      OnViewDidUpdateProps { view: PdfPageView ->
        view.commitProps { pageRendererLazy.value }
      }

      OnViewDestroys { view: PdfPageView ->
        view.destroy()
      }
    }

    // Creating the reader at start-up also deletes cache copies a previous
    // process left behind (on IO).
    OnCreate {
      try {
        readerLazy.value
      } catch (e: Exception) {
        Log.w(TAG, "Reader start-up failed: ${e.javaClass.simpleName}")
      }
    }

    OnDestroy {
      destroyed.set(true)
      if (coordinatorLazy.isInitialized()) coordinator.destroy()
      // Closes every open document and its cache copy; searches end silently.
      // Page renders stop first; reader.destroy() also cancels any still running.
      if (pageRendererLazy.isInitialized()) pageRendererLazy.value.destroy()
      if (readerLazy.isInitialized()) reader.destroy()
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

    // Promise-based so a document is never left registered when its result
    // cannot be delivered (see openDocument).
    AsyncFunction("open") { source: String, password: String?, openId: String, promise: Promise ->
      openDocument(source, password, openId, promise)
    }

    // Sync and never throws; unknown or finished ids are a no-op.
    Function("cancelOpen") { openId: String ->
      try {
        if (!destroyed.get()) reader.cancelOpen(openId)
      } catch (e: Exception) {
        Log.w(TAG, "cancelOpen failed: ${e.javaClass.simpleName}")
      }
    }

    // Never rejects: close failures are logged inside the engine.
    AsyncFunction("close") Coroutine { docId: String ->
      if (readerLazy.isInitialized()) reader.close(docId)
    }

    AsyncFunction("getOutline") Coroutine { docId: String ->
      reader.outline(docId).map { it.toMap() }
    }

    AsyncFunction("getPageText") Coroutine { docId: String, page: Int ->
      reader.pageText(docId, page)
    }

    AsyncFunction("getTextRects") Coroutine { docId: String, page: Int ->
      reader.textRects(docId, page).toMap()
    }

    // Resolves with the id before the search starts, so JS knows the id
    // before the first event for it is sent.
    AsyncFunction("search") { docId: String, query: String, options: SearchOptions, promise: Promise ->
      startSearch(docId, query, options, promise)
    }

    // Sync and never throws; unknown or finished ids are a no-op.
    Function("cancelSearch") { searchId: String ->
      try {
        if (readerLazy.isInitialized()) reader.cancelSearch(searchId)
      } catch (e: Exception) {
        Log.w(TAG, "cancelSearch failed: ${e.javaClass.simpleName}")
      }
    }
  }

  private fun openDocument(source: String, password: String?, openId: String, promise: Promise) {
    if (destroyed.get()) {
      rejectQuietly(promise, PdfEngineException(ErrorCode.CANCELLED, "The engine is shutting down"))
      return
    }
    val settled = AtomicBoolean(false)
    fun reject(error: CodedException) {
      if (settled.compareAndSet(false, true)) rejectQuietly(promise, error)
    }
    val job = scope.launch {
      val opened = try {
        reader.open(source, password, openId)
      } catch (e: CodedException) {
        reject(e)
        return@launch
      } catch (e: CancellationException) {
        reject(PdfEngineException(ErrorCode.CANCELLED, "Opening the document was cancelled"))
        return@launch
      } catch (e: Throwable) {
        Log.w(TAG, "open failed: ${e.javaClass.simpleName}")
        reject(CodedException(ERR_OPEN_FAILED, "The document could not be opened", null))
        return@launch
      }
      // No suspension between open returning and this resolve. If it cannot
      // be delivered (JS runtime gone), nobody holds the docId: close it.
      val delivered = settled.compareAndSet(false, true) && try {
        promise.resolve(opened.toMap())
        true
      } catch (e: Exception) {
        Log.w(TAG, "Could not resolve open promise: ${e.javaClass.simpleName}")
        false
      }
      if (!delivered) reader.close(opened.docId)
    }
    // A job cancelled before it ran (module torn down) never runs its body.
    job.invokeOnCompletion { reject(PdfEngineException(ErrorCode.CANCELLED, "Opening the document was cancelled")) }
  }

  private fun startSearch(docId: String, query: String, options: SearchOptions, promise: Promise) {
    try {
      if (destroyed.get()) throw CodedException(ERR_DOC_NOT_OPEN, "The document is not open", null)
      reader.startSearch(docId, query, options.matchCase, options.wholeWord) { searchId ->
        promise.resolve(mapOf("searchId" to searchId))
      }
    } catch (e: CodedException) {
      rejectQuietly(promise, e)
    } catch (e: Exception) {
      Log.w(TAG, "search failed to start: ${e.javaClass.simpleName}")
      rejectQuietly(promise, CodedException(ERR_SEARCH_FAILED, "The search could not be started", null))
    }
  }

  private fun rejectQuietly(promise: Promise, error: CodedException) {
    try {
      promise.reject(error)
    } catch (e: Exception) {
      Log.w(TAG, "Could not reject promise: ${e.javaClass.simpleName}")
    }
  }

  // Events can outlive the JS runtime (reload); there is nobody to tell then.
  private fun emit(name: String, body: Map<String, Any?>) {
    if (destroyed.get()) return
    try {
      sendEvent(name, body)
    } catch (e: Exception) {
      Log.w(TAG, "Could not send $name: ${e.javaClass.simpleName}")
    }
  }

  private val searchListener = object : SearchListener {
    override fun onResult(searchId: String, page: Int, matches: List<List<NormalizedRect>>, rotation: Int) {
      emit(
        EVENT_SEARCH_RESULT,
        mapOf(
          "searchId" to searchId,
          "page" to page,
          "matches" to matches.map { rects -> rects.map { it.toMap() } },
          "rotation" to rotation,
        ),
      )
    }

    override fun onProgress(searchId: String, pagesSearched: Int, pageCount: Int) {
      emit(EVENT_SEARCH_PROGRESS, mapOf("searchId" to searchId, "pagesSearched" to pagesSearched, "pageCount" to pageCount))
    }

    override fun onDone(searchId: String, totalMatches: Int, errorCode: String?) {
      emit(EVENT_SEARCH_DONE, mapOf("searchId" to searchId, "totalMatches" to totalMatches, "errorCode" to errorCode))
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
    const val API_VERSION = 4

    private const val TAG = "PdfEngine"
    private const val EVENT_SEARCH_RESULT = "onSearchResult"
    private const val EVENT_SEARCH_PROGRESS = "onSearchProgress"
    private const val EVENT_SEARCH_DONE = "onSearchDone"
    private const val TRIM_DEBOUNCE_MS = 2_000L

    // Used only if ActivityManager is unavailable: the low-end class (32 MB pool).
    private const val FALLBACK_MEMORY_CLASS_MB = 128
  }
}
