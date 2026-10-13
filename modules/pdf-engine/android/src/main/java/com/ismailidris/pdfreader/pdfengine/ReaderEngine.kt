package com.ismailidris.pdfreader.pdfengine

import android.content.Context
import android.os.SystemClock
import android.util.Log
import expo.modules.kotlin.exception.CodedException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.yield
import java.io.File
import java.io.FileNotFoundException
import java.io.IOException
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean

/**
 * An open reader document. [sizes] are the displayed page sizes read at open
 * without loading any page. Exact page geometry (box origin, rotation) comes
 * back with every page load (text and search), so it is never fetched apart.
 */
internal class ReaderDocument(
  val handle: Long,
  val sizes: List<PageSize>,
  val isEncrypted: Boolean,
  val copy: File?,
) {
  val pageCount: Int get() = sizes.size

  /** Set on the PDFium thread right before the handle is closed. */
  @Volatile
  var closed = false

  /** Set as soon as a close is requested (any thread), before the close task is queued. */
  @Volatile
  var closing = false
    private set

  /** Page-view renders using this document right now (registered on the PDFium thread). */
  val renders: MutableSet<RenderCancelToken> = ConcurrentHashMap.newKeySet()

  /** Marks the document closing and stops its page-view renders. Any thread. */
  fun beginClosing() {
    closing = true
    renders.forEach { it.cancel(documentClosing = true) }
  }
}

internal class OpenedReaderDocument(val docId: String, val sizes: List<PageSize>, val isEncrypted: Boolean) {
  fun toMap(): Map<String, Any> = mapOf(
    "docId" to docId,
    "pageCount" to sizes.size,
    "pages" to sizes.map { it.toMap() },
    "isEncrypted" to isEncrypted,
  )
}

/** Receives search events. Called from background threads. */
internal interface SearchListener {
  /** [rotation] is the page's /Rotate in degrees; [matches] are in unrotated page space. */
  fun onResult(searchId: String, page: Int, matches: List<List<NormalizedRect>>, rotation: Int)

  fun onProgress(searchId: String, pagesSearched: Int, pageCount: Int)

  /** Exactly once per search. [errorCode] is null on success. */
  fun onDone(searchId: String, totalMatches: Int, errorCode: String?)
}

/**
 * The reader half of the engine: open documents by id, outline, text, and
 * streaming search. Every PdfiumNative call runs on [pdfiumDispatcher] (one
 * thread shared with thumbnails); provider and file work runs on
 * [ioDispatcher]. A document's handle is looked up and used inside the same
 * PDFium-thread task, so close can never free a handle another call is using.
 */
internal class ReaderEngine(
  context: Context,
  private val searchScope: CoroutineScope,
  private val listener: SearchListener,
  private val ioDispatcher: CoroutineDispatcher = Dispatchers.IO,
  private val pdfiumDispatcher: CoroutineDispatcher = PdfiumThread.dispatcher,
  private val clock: () -> Long = SystemClock::elapsedRealtime,
) {
  val sources = ReaderSources(context)
  private val registry = DocumentRegistry<ReaderDocument>()
  private val searches = ConcurrentHashMap<String, RunningSearch>()

  // Opens in progress by JS-chosen openId, and ids cancelled before their
  // open registered (cancelOpen is synchronous and can overtake the async open).
  private val openLock = Any()
  private val opens = HashMap<String, Job>()
  private val earlyCancels = LinkedHashSet<String>()

  // Outlives searchScope so teardown still runs after the module scope is cancelled.
  private val teardownScope = CoroutineScope(SupervisorJob() + pdfiumDispatcher)

  /** Read and written on the PDFium thread only, so it orders against registration. */
  @Volatile
  private var destroyed = false
  private val destroyRequested = AtomicBoolean(false)

  val openDocumentCount: Int get() = registry.size

  init {
    // Copies left by a previous process (crash, kill) are deleted at start-up.
    searchScope.launch(ioDispatcher) {
      try {
        sources.cleanStaleCopiesOnce()
      } catch (e: Exception) {
        Log.w(TAG, "stale copy cleanup failed: ${e.javaClass.simpleName}")
      }
    }
  }

  // region open / close

  /** Handles opened but not yet registered, so a failure or cancellation can release them. */
  /**
   * What an open has acquired so far, so every exit path can release it.
   * [docId] is set once the document is registered; [delivered] only when
   * [open] is about to return it. Registered but not delivered means the
   * caller will never learn the id (cancelled in between), so it is discarded.
   */
  private class PendingOpen {
    @Volatile var handle = 0L

    @Volatile var copy: File? = null

    @Volatile var docId: String? = null

    @Volatile var delivered = false
  }

  /**
   * Test-only hook run on the PDFium thread right after a document is
   * registered, to reach the cancel-after-register window deterministically.
   * Always null in production.
   */
  @Volatile
  internal var afterRegisterForTest: ((docId: String) -> Unit)? = null

  /**
   * Opens [source]. [openId] is the [cancelOpen] target: a cancelled open
   * rejects with CANCELLED after releasing any handle and deleting any copy.
   * An [openId] already in flight is rejected with ERR_INVALID_ARGUMENT and
   * leaves the earlier open untouched.
   *
   * On success the document belongs to the caller, who must [close] it, also
   * when handing the result on fails (e.g. a promise that cannot resolve).
   */
  suspend fun open(source: String, password: String?, openId: String): OpenedReaderDocument {
    val openJob = Job(currentCoroutineContext()[Job])
    synchronized(openLock) {
      if (opens.containsKey(openId)) {
        openJob.cancel()
        throw CodedException(ERR_INVALID_ARGUMENT, "This open id is already in use", null)
      }
      if (earlyCancels.remove(openId)) openJob.cancel()
      opens[openId] = openJob
    }
    val pending = PendingOpen()
    try {
      val opened = withContext(openJob) { openCancellable(source, password, openJob, pending) }
      // Nothing between here and the return can suspend, so the caller gets it.
      pending.delivered = true
      return opened
    } catch (e: CancellationException) {
      // Cancelled by cancelOpen (the caller is still active), not by teardown.
      if (openJob.isCancelled && currentCoroutineContext().isActive) {
        throw PdfEngineException(ErrorCode.CANCELLED, "Opening the document was cancelled")
      }
      throw e
    } finally {
      if (!pending.delivered) pending.docId?.let { discardUndelivered(it) }
      synchronized(openLock) {
        if (opens[openId] === openJob) opens.remove(openId)
      }
      openJob.complete()
    }
  }

  /** Closes a document registered by an open whose result never reached its caller. */
  private suspend fun discardUndelivered(docId: String) {
    try {
      withContext(NonCancellable) {
        val document = withContext(pdfiumDispatcher) {
          registry.remove(docId)?.also { closeNative(it) }
        }
        document?.copy?.let { copy -> withContext(ioDispatcher) { copy.delete() } }
      }
    } catch (e: Throwable) {
      Log.w(TAG, "discarding an undelivered open failed: ${e.javaClass.simpleName}")
    }
  }

  /**
   * Cancels the open with [openId]. An id with no open in progress is
   * remembered (bounded) in case its open has not started yet; since ids are
   * unique per call, a finished id is never reused, so this is a no-op for it.
   */
  fun cancelOpen(openId: String) {
    synchronized(openLock) {
      val job = opens[openId]
      if (job != null) {
        job.cancel()
        return
      }
      earlyCancels.add(openId)
      while (earlyCancels.size > MAX_EARLY_CANCELS) earlyCancels.remove(earlyCancels.first())
    }
  }

  private suspend fun openCancellable(source: String, password: String?, openJob: Job, pending: PendingOpen): OpenedReaderDocument {
    val givenPassword = password?.takeIf { it.isNotEmpty() }
    try {
      val resolved = withContext(ioDispatcher) {
        sources.resolve(source) { !openJob.isActive }.also { pending.copy = it.copy }
      }
      withContext(pdfiumDispatcher) {
        // FPDF_LoadDocument cannot be interrupted; skip it if already cancelled.
        currentCoroutineContext().ensureActive()
        pending.handle = try {
          PdfiumNative.open(resolved.path, givenPassword)
        } catch (e: IOException) {
          val code = PdfiumErrors.parseCode(e.message) ?: throw e
          throw openFailure(code, resolved.exists(), givenPassword != null)
        }
      }
      val pageCount = withContext(pdfiumDispatcher) { PdfiumNative.pageCount(pending.handle) }
      if (pageCount <= 0) throw corrupt()
      val sizes = ArrayList<PageSize>(pageCount)
      var start = 0
      while (start < pageCount) {
        // No page is loaded here; chunks only keep each PDFium-thread task short.
        val count = minOf(PAGE_SIZE_CHUNK, pageCount - start)
        val raw = withContext(pdfiumDispatcher) { PdfiumNative.pageSizes(pending.handle, start, count) }
        sizes.addAll(PageGeometry.decodeSizes(raw, count))
        start += count
        yield()
      }
      return withContext(pdfiumDispatcher) {
        if (destroyed) throw PdfEngineException(ErrorCode.CANCELLED, "The engine is shutting down")
        val encrypted = PdfiumNative.securityHandlerRevision(pending.handle) != -1
        val document = ReaderDocument(pending.handle, sizes, encrypted, pending.copy)
        val docId = registry.add(document)
        // From here the registry owns the handle and copy; [open] releases
        // them if the result is not delivered.
        pending.docId = docId
        afterRegisterForTest?.invoke(docId)
        OpenedReaderDocument(docId, sizes, encrypted)
      }
    } catch (e: Throwable) {
      throw mapFailure(e, ERR_OPEN_FAILED, "The document could not be opened", "open")
    } finally {
      if (pending.docId == null) releasePending(pending)
    }
  }

  /** Releases the document, cancels its searches and deletes its copy. Idempotent; never throws. */
  suspend fun close(docId: String) {
    cancelSearchesOf(docId)
    registry.get(docId)?.beginClosing()
    try {
      withContext(NonCancellable) {
        val document = withContext(pdfiumDispatcher) {
          registry.remove(docId)?.also { closeNative(it) }
        }
        document?.copy?.let { copy -> withContext(ioDispatcher) { copy.delete() } }
      }
    } catch (e: Throwable) {
      Log.w(TAG, "close failed: ${e.javaClass.simpleName}")
    }
  }

  /**
   * Closes every document and cancels every search and open. Returns at once;
   * the native work is queued on the PDFium thread. Later opens are refused.
   */
  fun destroy() {
    if (!destroyRequested.compareAndSet(false, true)) return
    searches.values.forEach { it.job.cancel() }
    synchronized(openLock) { opens.values.forEach { it.cancel() } }
    registry.values().forEach { it.beginClosing() }
    teardownScope.launch {
      destroyed = true
      for (document in registry.removeAll()) {
        try {
          closeNative(document)
          document.copy?.delete()
        } catch (e: Throwable) {
          Log.w(TAG, "teardown close failed: ${e.javaClass.simpleName}")
        }
      }
    }
  }

  private fun closeNative(document: ReaderDocument) {
    if (document.closed) return
    document.closed = true
    PdfiumNative.close(document.handle)
  }

  private suspend fun releasePending(pending: PendingOpen) {
    try {
      withContext(NonCancellable) {
        if (pending.handle != 0L) {
          withContext(pdfiumDispatcher) { PdfiumNative.close(pending.handle) }
          pending.handle = 0L
        }
        pending.copy?.let { copy -> withContext(ioDispatcher) { copy.delete() } }
      }
    } catch (e: Throwable) {
      Log.w(TAG, "open cleanup failed: ${e.javaClass.simpleName}")
    }
  }

  // endregion

  // region outline / text

  suspend fun outline(docId: String): List<OutlineNode> = try {
    withContext(pdfiumDispatcher) {
      val document = requireDocument(docId)
      OutlineBuilder.build(NativeOutlineSource(document))
    }
  } catch (e: Throwable) {
    throw mapFailure(e, ERR_READ_FAILED, "The outline could not be read", "getOutline")
  }

  suspend fun pageText(docId: String, page: Int): String = try {
    val codes = withContext(pdfiumDispatcher) {
      val document = requireDocument(docId)
      requirePage(document, page)
      PdfiumNative.pageChars(document.handle, page)
    }
    PageText.text(codes)
  } catch (e: Throwable) {
    throw mapFailure(e, ERR_READ_FAILED, "The page text could not be read", "getPageText")
  }

  suspend fun textRects(docId: String, page: Int): PageTextRects = try {
    val raw = withContext(pdfiumDispatcher) {
      val document = requireDocument(docId)
      requirePage(document, page)
      PdfiumNative.textBoxes(document.handle, page)
    }
    PageText.decode(raw) ?: throw corrupt()
  } catch (e: Throwable) {
    throw mapFailure(e, ERR_READ_FAILED, "The page text could not be read", "getTextRects")
  }

  private class NativeOutlineSource(private val document: ReaderDocument) : OutlineSource {
    override fun firstChild(parent: Long): Long = PdfiumNative.bookmarkFirstChild(document.handle, parent)

    override fun nextSibling(item: Long): Long = PdfiumNative.bookmarkNextSibling(document.handle, item)

    override fun title(item: Long): String = PdfiumNative.bookmarkTitle(item)

    override fun page(item: Long): Int? =
      PdfiumNative.bookmarkPage(document.handle, item).takeIf { it in 0 until document.pageCount }
  }

  // endregion

  // region page view

  /**
   * PDFium thread only (the caller is already running on [pdfiumDispatcher];
   * nothing here suspends, so a result is never lost to cancellation).
   * Runs [block] with the handle of an open document whose [page] exists,
   * with [token] registered so closing the document cancels the render.
   * Throws ERR_DOC_NOT_OPEN (unknown, closed or closing) or
   * ERR_INVALID_ARGUMENT (page out of range).
   */
  fun <T> withRenderablePage(docId: String, page: Int, token: RenderCancelToken, block: (handle: Long) -> T): T {
    val document = requireDocument(docId)
    if (document.closing) throw docNotOpen()
    requirePage(document, page)
    document.renders.add(token)
    try {
      // A close that started before the add above did not see this token.
      if (document.closing) token.cancel(documentClosing = true)
      return block(document.handle)
    } finally {
      document.renders.remove(token)
    }
  }

  // endregion

  // region search

  private class RunningSearch(val docId: String, val job: Job) {
    val doneSent = AtomicBoolean(false)

    @Volatile var totalMatches = 0
  }

  /**
   * Prepares a search and returns its id, or throws ERR_DOC_NOT_OPEN. The
   * search starts only after [beforeStart] returns, so the caller can hand the
   * id to JS before the first event. Exactly one onDone follows, including
   * when the search is cancelled before it starts.
   */
  fun startSearch(docId: String, query: String, matchCase: Boolean, wholeWord: Boolean, beforeStart: (String) -> Unit): String {
    val document = registry.get(docId)?.takeUnless { it.closed } ?: throw docNotOpen()
    val searchId = UUID.randomUUID().toString()
    val flags = SearchResults.flags(matchCase, wholeWord)
    lateinit var running: RunningSearch
    val job = searchScope.launch(start = CoroutineStart.LAZY) {
      var errorCode: String? = null
      try {
        if (!SearchResults.isBlank(query)) runSearch(searchId, document, query, flags, running)
      } catch (e: CancellationException) {
        errorCode = ErrorCode.CANCELLED.name
      } catch (e: OutOfMemoryError) {
        errorCode = ErrorCode.OUT_OF_MEMORY.name
      } catch (e: Throwable) {
        Log.w(TAG, "search failed: ${e.javaClass.simpleName}")
        errorCode = ERR_SEARCH_FAILED
      } finally {
        finishSearch(searchId, running, errorCode)
      }
    }
    running = RunningSearch(docId, job)
    searches[searchId] = running
    // Covers a job cancelled before it ever ran its body (and so its finally).
    job.invokeOnCompletion { cause ->
      finishSearch(searchId, running, if (cause == null) null else ErrorCode.CANCELLED.name)
    }
    try {
      beforeStart(searchId)
    } catch (e: Throwable) {
      job.cancel()
      throw e
    }
    // A destroy() that raced with this call has already swept `searches`.
    if (destroyRequested.get()) job.cancel()
    job.start()
    return searchId
  }

  /** Stops a running search; its onDone reports CANCELLED. Unknown ids are ignored. */
  fun cancelSearch(searchId: String) {
    searches[searchId]?.job?.cancel()
  }

  private fun cancelSearchesOf(docId: String) {
    searches.values.filter { it.docId == docId }.forEach { it.job.cancel() }
  }

  private suspend fun runSearch(searchId: String, document: ReaderDocument, query: String, flags: Int, running: RunningSearch) {
    val pageCount = document.pageCount
    val throttle = ProgressThrottle(PROGRESS_INTERVAL_MS)
    for (page in 0 until pageCount) {
      yield()
      val remaining = SearchResults.MAX_TOTAL_MATCHES - running.totalMatches
      val raw = withContext(pdfiumDispatcher) {
        if (document.closed) throw CancellationException("The document was closed")
        try {
          PdfiumNative.searchPage(document.handle, page, query, flags, remaining)
        } catch (e: IOException) {
          // One unreadable page does not end the search.
          if (PdfiumErrors.parseCode(e.message) == null) throw e
          null
        }
      }
      // A page without a usable box is unreadable too: skipped.
      val found = raw?.let(SearchResults::decode)
      if (found != null && found.matches.isNotEmpty()) {
        running.totalMatches += found.matches.size
        listener.onResult(searchId, page, found.matches, found.geometry.rotation)
      }
      // At the cap the search is over: report it complete rather than leave progress short.
      val searched = if (running.totalMatches >= SearchResults.MAX_TOTAL_MATCHES) pageCount else page + 1
      if (throttle.shouldEmit(clock(), searched, pageCount)) listener.onProgress(searchId, searched, pageCount)
      if (searched == pageCount) return
    }
  }

  private fun finishSearch(searchId: String, running: RunningSearch, errorCode: String?) {
    if (!running.doneSent.compareAndSet(false, true)) return
    searches.remove(searchId)
    try {
      listener.onDone(searchId, running.totalMatches, errorCode)
    } catch (e: Exception) {
      Log.w(TAG, "search done listener failed: ${e.javaClass.simpleName}")
    }
  }

  // endregion

  // region helpers

  /** PDFium thread only. */
  private fun requireDocument(docId: String): ReaderDocument =
    registry.get(docId)?.takeUnless { it.closed } ?: throw docNotOpen()

  private fun requirePage(document: ReaderDocument, page: Int) {
    if (page !in 0 until document.pageCount) {
      throw CodedException(ERR_INVALID_ARGUMENT, "The page index is out of range", null)
    }
  }

  private fun openFailure(pdfiumCode: Int, fileExists: Boolean, passwordGiven: Boolean): CodedException =
    when (PdfiumErrors.openErrorCodeFor(pdfiumCode, fileExists, passwordGiven)) {
      ErrorCode.PASSWORD_REQUIRED -> PdfEngineException(ErrorCode.PASSWORD_REQUIRED, "The document is password protected")
      ErrorCode.WRONG_PASSWORD -> PdfEngineException(ErrorCode.WRONG_PASSWORD, "The password is incorrect")
      ErrorCode.CORRUPT_FILE -> corrupt()
      ErrorCode.NOT_FOUND -> PdfEngineException(ErrorCode.NOT_FOUND, "The document could not be found")
      ErrorCode.UNSUPPORTED -> PdfEngineException(ErrorCode.UNSUPPORTED, "The document uses unsupported security")
      else -> CodedException(ERR_OPEN_FAILED, "The document could not be opened", null)
    }

  /**
   * Maps any failure to a coded exception with a static message and no
   * cause, so nothing path-like reaches JS. Cancellation passes through.
   */
  private fun mapFailure(error: Throwable, fallbackCode: String, fallbackMessage: String, operation: String): Throwable {
    val pdfiumCode = if (error is IOException) PdfiumErrors.parseCode(error.message) else null
    return when {
      error is CancellationException -> error
      error is CodedException -> error
      error is OutOfMemoryError -> PdfEngineException(ErrorCode.OUT_OF_MEMORY, "Not enough memory to read the document")
      pdfiumCode != null && PdfiumErrors.errorCodeFor(pdfiumCode, fileExists = true) == ErrorCode.CORRUPT_FILE -> corrupt()
      isNoSpace(error) -> PdfEngineException(ErrorCode.NO_SPACE, "Not enough storage to open the document")
      error is SecurityException -> PdfEngineException(ErrorCode.PERMISSION_DENIED, "Access to the file was refused")
      error is FileNotFoundException -> PdfEngineException(ErrorCode.NOT_FOUND, "The document could not be found")
      else -> {
        Log.w(TAG, "$operation failed: ${error.javaClass.simpleName}")
        CodedException(fallbackCode, fallbackMessage, null)
      }
    }
  }

  private fun corrupt() = PdfEngineException(ErrorCode.CORRUPT_FILE, "The document is damaged or not a PDF")

  private fun docNotOpen() = CodedException(ERR_DOC_NOT_OPEN, "The document is not open", null)

  // endregion

  companion object {
    private const val TAG = "PdfEngine"
    private const val PAGE_SIZE_CHUNK = 256
    private const val PROGRESS_INTERVAL_MS = 100L
    private const val MAX_EARLY_CANCELS = 64
  }
}
