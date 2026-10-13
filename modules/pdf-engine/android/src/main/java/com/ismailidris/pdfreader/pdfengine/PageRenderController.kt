package com.ismailidris.pdfreader.pdfengine

import kotlin.math.abs

/**
 * The JS props that select what a page view shows. A changed [retryToken]
 * makes an otherwise identical request new, so it renders again.
 */
internal data class PageViewProps(val docId: String, val page: Int, val renderScale: Double, val retryToken: Double = 0.0)

/** The view's laid-out size in px and the display density (px per dp). */
internal data class ViewSize(val widthPx: Int, val heightPx: Int, val density: Float)

/** One render request handed to a [PageRenderBackend]. */
internal data class RenderSpec(val docId: String, val page: Int, val plan: RenderPlan)

internal sealed class RenderOutcome<out B : Any> {
  /** [widthPx] x [heightPx] is the bitmap's actual size (lower than planned after an OOM retry). */
  class Rendered<B : Any>(val bitmap: B, val widthPx: Int, val heightPx: Int, val ms: Long) : RenderOutcome<B>()

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
  val caps: RenderCaps

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
  /** Draws [bitmap], or the paper placeholder when null. */
  fun display(bitmap: B?)

  fun onRendered(page: Int, widthPx: Int, heightPx: Int, ms: Long)

  fun onRenderError(page: Int, code: String)

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
 *   ratio did, it is cleared at once: a recycled cell never shows another
 *   page, and no bitmap is drawn stretched.
 * - A replaced bitmap is released only after the next frames
 *   ([PageRenderHost.afterNextFrames]), so the pool never reuses a bitmap
 *   the render thread may still be drawing.
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
  private var requested: RequestKey? = null
  private var generation = 0
  private var inFlight: RenderCancellable? = null
  private var shown: B? = null
  private var shownPage: Pair<String, Int>? = null
  private var shownAspect = 0.0
  private val retired = ArrayList<B>()
  private var flushScheduled = false
  private var attached = initiallyAttached
  private var disposed = false

  val isRendering: Boolean get() = inFlight != null
  val displayed: B? get() = shown
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
  }

  /** The view is gone for good. Later outcomes are released unseen. */
  fun dispose() {
    if (disposed) return
    detach()
    disposed = true
  }

  /** Starts a render if the request changed since the last one. */
  fun refresh() {
    if (disposed || !attached) return
    val current = props ?: return
    val viewSize = size
    val key = RequestKey(current, viewSize)
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
    val plan = PageRenderMath.plan(viewSize.widthPx, viewSize.heightPx, viewSize.density, current.renderScale, backend.caps)
      ?: return
    val ticket = generation
    inFlight = backend.render(RenderSpec(current.docId, current.page, plan)) { outcome ->
      onOutcome(ticket, current, viewSize, outcome)
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

  private fun clearShown() {
    val bitmap = shown ?: return
    shown = null
    shownPage = null
    shownAspect = 0.0
    host.display(null)
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
  }
}
