package com.ismailidris.pdfreader.pdfengine

import kotlin.math.abs

/**
 * The JS props that select what a page view shows. A changed [retryToken]
 * makes an otherwise identical request new, so it renders again.
 * [detailRegion] asks for a sharp tile over that part of the page; it never
 * affects the whole-page bitmap.
 */
internal data class PageViewProps(
  val docId: String,
  val page: Int,
  val renderScale: Double,
  val retryToken: Double = 0.0,
  val detailRegion: NormalizedRegion? = null,
)

/** The view's laid-out size in px and the display density (px per dp). */
internal data class ViewSize(val widthPx: Int, val heightPx: Int, val density: Float)

/**
 * One render request handed to a [PageRenderBackend]. [plan] is the bitmap
 * size. Without [window] the whole page fills it; with one, the bitmap is a
 * detail tile showing that window of a larger page image.
 */
internal data class RenderSpec(val docId: String, val page: Int, val plan: RenderPlan, val window: TileWindow? = null)

internal sealed class RenderOutcome<out B : Any> {
  /**
   * [widthPx] x [heightPx] is the bitmap's actual size (lower than planned
   * after an OOM retry). [ms] is the render time on the PDFium thread,
   * [waitMs] the time the request waited in the PDFium queue before it.
   */
  class Rendered<B : Any>(val bitmap: B, val widthPx: Int, val heightPx: Int, val ms: Long, val waitMs: Long = 0) :
    RenderOutcome<B>()

  class Failed(val code: String) : RenderOutcome<Nothing>()

  /** Stopped by its own cancel; carries no bitmap. */
  object Cancelled : RenderOutcome<Nothing>()
}

internal fun interface RenderCancellable {
  /** Stops the render if it has not finished. Any thread; idempotent. */
  fun cancel()
}

/** Renders pages into pooled bitmaps. Implemented by PageRenderService. */
internal interface PageRenderBackend<B : Any> {
  /** Caps on whole-page bitmaps of pages shown unzoomed; a page over them is zoomed. */
  val caps: RenderCaps

  /** Caps on a zoomed page's whole-page bitmap (the backdrop under its detail tile). */
  val backdropCaps: RenderCaps

  /** Caps on detail tiles. */
  val tileCaps: RenderCaps

  /**
   * Starts rendering [spec]. [onDone] runs at most once, on the UI thread,
   * never from inside this call. A [RenderOutcome.Rendered] hands its bitmap
   * to the receiver, who must [release] it. A cancelled render may skip
   * [onDone]; its bitmap goes back to the pool inside the backend.
   */
  fun render(spec: RenderSpec, onDone: (RenderOutcome<B>) -> Unit): RenderCancellable

  /** Returns a bitmap from a Rendered outcome. It must no longer be drawn. */
  fun release(bitmap: B)
}

/** What the controller needs from its view. UI thread only. */
internal interface PageRenderHost<B : Any> {
  /** Draws [bitmap] as the whole page, or the paper placeholder when null. */
  fun display(bitmap: B?)

  /**
   * Draws [tile]'s content window ([plan] .tile at (pad, pad)) over
   * [plan].covered (normalized to the view's bounds), or no tile when null.
   * The rest of the bitmap (pad and 64 px bucket) is not drawn.
   */
  fun displayTile(tile: B?, plan: TilePlan?)

  fun onRendered(page: Int, widthPx: Int, heightPx: Int, ms: Long)

  fun onRenderError(page: Int, code: String)

  /** A tile for [region] (clamped) is on screen; [waitMs] is its time queued for the PDFium thread. */
  fun onDetailRendered(page: Int, region: NormalizedRegion, widthPx: Int, heightPx: Int, ms: Long, waitMs: Long)

  /** A tile render failed; the tile is dropped and nothing is reported to JS. */
  fun onDetailDropped(code: String)

  /**
   * Runs [block] once no frame drawn before this call can still be read by
   * the render thread (production: two Choreographer frames later).
   */
  fun afterNextFrames(block: () -> Unit)

  /**
   * Runs [block] after the UI-thread work in progress (production: the
   * current main-looper message, which applies a mount batch's props and
   * layout together).
   */
  fun afterCurrentWork(block: () -> Unit)
}

/**
 * Render state machine of one PdfPageView, pure so it is unit-tested on the
 * JVM. UI thread only.
 *
 * Whole-page bitmap:
 * - [setProps] and [setSize] are coalesced: one flush after the current
 *   UI-thread work, so a recycled cell whose props and layout change in the
 *   same mount batch starts one render, at the new size.
 * - A new request (docId, page, renderScale, retryToken or view size
 *   changed) bumps the generation and cancels the render in flight; outcomes
 *   of older generations, or for a size other than the latest one, are
 *   dropped and their bitmaps released.
 * - The bitmap on screen stays until its replacement is ready when only the
 *   scale or size changed (and the aspect ratio did not), and also when a
 *   re-render of that page fails. When docId or page changed, or the aspect
 *   ratio did, it is cleared at once.
 *
 * Detail tile (only while the whole-page bitmap is capped below renderScale):
 * - Its own generation: a region or size change renders a new tile and
 *   cancels the old render, leaving the whole page untouched. The previous
 *   tile stays drawn at its normalized area until the new one arrives.
 * - A docId/page change, a null region, or a page that is no longer capped
 *   drops the tile. A failed tile is dropped silently.
 *
 * A replaced bitmap or tile is released only after the next frames
 * ([PageRenderHost.afterNextFrames]), so the pool never reuses a bitmap the
 * render thread may still be drawing.
 */
internal class PageRenderController<B : Any>(
  private val backend: PageRenderBackend<B>,
  private val host: PageRenderHost<B>,
  /** Whether the host view is in a window now; later changes come through attach()/detach(). */
  initiallyAttached: Boolean = true,
) {
  private data class RequestKey(val props: PageViewProps, val size: ViewSize?)

  private var props: PageViewProps? = null
  private var size: ViewSize? = null
  private var flushScheduled = false
  private var attached = initiallyAttached
  private var disposed = false
  private val retired = ArrayList<B>()

  // Whole page.
  private var requested: RequestKey? = null
  private var generation = 0
  private var inFlight: RenderCancellable? = null
  private var shown: B? = null
  private var shownPage: Pair<String, Int>? = null
  private var shownAspect = 0.0
  private var shownWidthPx = 0
  private var shownHeightPx = 0

  // Detail tile.
  private var tileRequested: RequestKey? = null
  private var tileGeneration = 0
  private var tileInFlight: RenderCancellable? = null
  private var tile: B? = null
  private var tilePage: Pair<String, Int>? = null
  private var tileCovered: NormalizedRegion? = null

  val isRendering: Boolean get() = inFlight != null
  val isRenderingTile: Boolean get() = tileInFlight != null
  val displayed: B? get() = shown
  val displayedTile: B? get() = tile
  val displayedTileArea: NormalizedRegion? get() = tileCovered
  val retiredCount: Int get() = retired.size

  /** Stages new props; rendering starts at the coalesced flush. */
  fun setProps(value: PageViewProps) {
    props = value
    scheduleFlush()
  }

  /** Stages a new layout size; rendering starts at the coalesced flush. */
  fun setSize(value: ViewSize) {
    size = value
    scheduleFlush()
  }

  /** Props and (when known) size applied at once, without waiting for a flush. */
  fun update(value: PageViewProps, viewSize: ViewSize?) {
    props = value
    if (viewSize != null) size = viewSize
    refresh()
  }

  /** The view is in a window again: render what the props ask for (at the coalesced flush). */
  fun attach() {
    if (disposed) return
    attached = true
    scheduleFlush()
  }

  /**
   * The view left the window: stop rendering and give its bitmaps back. The
   * next [attach] renders again.
   */
  fun detach() {
    if (disposed) return
    attached = false
    requested = null
    generation++
    cancelInFlight()
    clearShown()
    dropTile()
  }

  /** The view is gone for good. Later outcomes are released unseen. */
  fun dispose() {
    if (disposed) return
    detach()
    disposed = true
  }

  /** Starts the whole-page and tile renders the current request needs. */
  fun refresh() {
    if (disposed || !attached) return
    val current = props ?: return
    refreshPage(current)
    refreshTile(current)
  }

  private fun refreshPage(current: PageViewProps) {
    val viewSize = size
    val key = RequestKey(current.copy(detailRegion = null), viewSize)
    if (key == requested) return
    requested = key
    generation++
    cancelInFlight()
    if (shownPage != current.docId to current.page) {
      clearShown()
    } else if (viewSize != null && !sameAspect(shownAspect, viewSize)) {
      clearShown()
    }
    if (current.docId.isEmpty()) return
    if (current.page < 0 || !PageRenderMath.isValidScale(current.renderScale)) {
      clearShown()
      host.onRenderError(current.page, ERR_INVALID_ARGUMENT)
      return
    }
    // No plan until the view is laid out; setSize brings it back here.
    viewSize ?: return
    // A zoomed page (over the unzoomed caps) is a soft backdrop under its tile.
    val zoomed = PageRenderMath.isCapped(viewSize.widthPx, viewSize.heightPx, viewSize.density, current.renderScale, backend.caps)
    val caps = if (zoomed) backend.backdropCaps else backend.caps
    val plan = PageRenderMath.plan(viewSize.widthPx, viewSize.heightPx, viewSize.density, current.renderScale, caps)
      ?: return
    // Every zoom step resizes every mounted page. The bitmap already shown for
    // this page (same aspect, checked above) is only drawn at the new size, with
    // no render, when it is the planned size, or when the page is zoomed and
    // the shown bitmap is at least [KEEP_AS_BACKDROP_SHARE] of the backdrop
    // plan: the 1x bitmap kept on zoom-in is the backdrop (a backdrop render
    // would be a downgrade or a <15% linear gain, at ~400 ms per scanned page).
    if (shown != null && shownPage == current.docId to current.page) {
      val shownPixels = shownWidthPx.toLong() * shownHeightPx
      val samePlan = shownWidthPx == plan.widthPx && shownHeightPx == plan.heightPx
      if (samePlan || (zoomed && shownPixels >= plan.pixels * KEEP_AS_BACKDROP_SHARE)) return
    }
    val ticket = generation
    inFlight = backend.render(RenderSpec(current.docId, current.page, plan)) { outcome ->
      onOutcome(ticket, current, viewSize, outcome)
    }
  }

  private fun refreshTile(current: PageViewProps) {
    if (tilePage != null && tilePage != current.docId to current.page) dropTile()
    val viewSize = size
    val region = current.detailRegion?.let(PageRenderMath::clampRegion)
    val plan = if (region != null && viewSize != null && current.docId.isNotEmpty() && current.page >= 0 &&
      PageRenderMath.isCapped(viewSize.widthPx, viewSize.heightPx, viewSize.density, current.renderScale, backend.caps)
    ) {
      PageRenderMath.tilePlan(
        viewSize.widthPx, viewSize.heightPx, viewSize.density, current.renderScale, region, backend.tileCaps,
      )
    } else {
      null
    }
    if (plan == null || region == null || viewSize == null) {
      dropTile()
      return
    }
    val key = RequestKey(current.copy(detailRegion = region), viewSize)
    if (key == tileRequested) return
    tileRequested = key
    tileGeneration++
    cancelTileInFlight()
    val ticket = tileGeneration
    tileInFlight = backend.render(RenderSpec(current.docId, current.page, plan.bitmap, plan.renderWindow)) { outcome ->
      onTileOutcome(ticket, current, region, plan, viewSize, outcome)
    }
  }

  private fun scheduleFlush() {
    if (disposed || flushScheduled) return
    flushScheduled = true
    host.afterCurrentWork {
      flushScheduled = false
      refresh()
    }
  }

  private fun onOutcome(ticket: Int, request: PageViewProps, requestSize: ViewSize, outcome: RenderOutcome<B>) {
    // A newer size is staged when it differs: that flush renders again, and
    // this bitmap would be drawn stretched.
    if (disposed || ticket != generation || requestSize != size) {
      // Current generation but a stale size: this render is finished, so
      // nothing is in flight until the staged flush starts the next one.
      if (ticket == generation) inFlight = null
      // Never displayed, so it can go straight back.
      if (outcome is RenderOutcome.Rendered) backend.release(outcome.bitmap)
      return
    }
    inFlight = null
    when (outcome) {
      is RenderOutcome.Rendered -> {
        shown?.let(::retire)
        shown = outcome.bitmap
        shownPage = request.docId to request.page
        shownAspect = outcome.widthPx.toDouble() / outcome.heightPx
        shownWidthPx = outcome.widthPx
        shownHeightPx = outcome.heightPx
        host.display(outcome.bitmap)
        host.onRendered(request.page, outcome.widthPx, outcome.heightPx, outcome.ms)
      }
      is RenderOutcome.Failed -> {
        // A bitmap of this very page (another scale) stays on screen.
        if (shownPage != request.docId to request.page) clearShown()
        host.onRenderError(request.page, outcome.code)
      }
      // Only a superseded render is cancelled, and those were dropped above.
      RenderOutcome.Cancelled -> Unit
    }
  }

  private fun onTileOutcome(
    ticket: Int,
    request: PageViewProps,
    region: NormalizedRegion,
    plan: TilePlan,
    requestSize: ViewSize,
    outcome: RenderOutcome<B>,
  ) {
    if (disposed || ticket != tileGeneration || requestSize != size) {
      // As for the page: a finished render of the current generation is no longer in flight.
      if (ticket == tileGeneration) tileInFlight = null
      if (outcome is RenderOutcome.Rendered) backend.release(outcome.bitmap)
      return
    }
    tileInFlight = null
    when (outcome) {
      is RenderOutcome.Rendered -> {
        tile?.let(::retire)
        tile = outcome.bitmap
        tilePage = request.docId to request.page
        tileCovered = plan.covered
        host.displayTile(outcome.bitmap, plan)
        host.onDetailRendered(request.page, region, plan.tile.widthPx, plan.tile.heightPx, outcome.ms, outcome.waitMs)
      }
      is RenderOutcome.Failed -> {
        clearTile()
        host.onDetailDropped(outcome.code)
      }
      RenderOutcome.Cancelled -> Unit
    }
  }

  private fun sameAspect(aspect: Double, viewSize: ViewSize): Boolean {
    if (viewSize.widthPx <= 0 || viewSize.heightPx <= 0 || aspect <= 0.0) return false
    val target = viewSize.widthPx.toDouble() / viewSize.heightPx
    // Also allow one pixel of rounding on the shorter side, which alone can
    // exceed the relative tolerance for small views.
    val onePixel = 1.0 / minOf(viewSize.widthPx, viewSize.heightPx)
    return abs(aspect - target) / target <= ASPECT_TOLERANCE + onePixel
  }

  private fun cancelInFlight() {
    inFlight?.cancel()
    inFlight = null
  }

  private fun cancelTileInFlight() {
    tileInFlight?.cancel()
    tileInFlight = null
  }

  private fun clearShown() {
    val bitmap = shown ?: return
    shown = null
    shownPage = null
    shownAspect = 0.0
    shownWidthPx = 0
    shownHeightPx = 0
    host.display(null)
    retire(bitmap)
  }

  /** Forgets the tile request, stops its render and clears the tile. */
  private fun dropTile() {
    tileRequested = null
    tileGeneration++
    cancelTileInFlight()
    clearTile()
  }

  private fun clearTile() {
    val bitmap = tile ?: return
    tile = null
    tilePage = null
    tileCovered = null
    host.displayTile(null, null)
    retire(bitmap)
  }

  // Each bitmap waits for frames counted from its own retirement.
  private fun retire(bitmap: B) {
    retired.add(bitmap)
    host.afterNextFrames {
      if (retired.remove(bitmap)) backend.release(bitmap)
    }
  }

  private companion object {
    /** Pixel rounding and the cap's floor move the aspect ratio far less than this. */
    const val ASPECT_TOLERANCE = 0.01

    /** A zoomed page keeps a shown bitmap with at least this share of the backdrop plan's pixels. */
    const val KEEP_AS_BACKDROP_SHARE = 0.75
  }
}
