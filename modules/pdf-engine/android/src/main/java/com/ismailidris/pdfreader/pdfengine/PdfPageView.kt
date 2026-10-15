package com.ismailidris.pdfreader.pdfengine

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.ColorMatrixColorFilter
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.RectF
import android.util.Log
import android.os.Handler
import android.os.Looper
import android.view.Choreographer
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView

/**
 * One PDF page drawn natively (JS contract: modules/pdf-engine/src/PdfPageView.tsx).
 * Props are staged by the setters and handed over together in [commitProps]
 * (OnViewDidUpdateProps); the controller coalesces them with the layout of
 * the same mount batch, so one update starts at most one render, at the new size.
 * Rendering and bitmap lifetime live in [PageRenderController]; this class
 * draws, applies the paper colour filter and sends events. UI thread only.
 */
class PdfPageView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val onRendered by EventDispatcher()
  private val onRenderError by EventDispatcher()
  private val onDetailRendered by EventDispatcher()

  internal var docId = ""
  internal var page = 0
  internal var renderScale = 0.0
  internal var nightMode = false
  internal var sepia = false
  internal var retryToken = 0.0
  internal var detailRegion: NormalizedRegion? = null

  private var controller: PageRenderController<Bitmap>? = null
  private var shown: Bitmap? = null
  private var tile: Bitmap? = null
  private var tileArea: NormalizedRegion? = null
  private val tileSource = Rect()
  private val tileDestination = RectF()
  private var mode = PaperMode.DAY
  private val paint = Paint(Paint.FILTER_BITMAP_FLAG or Paint.DITHER_FLAG)
  private val destination = Rect()
  private var destroyed = false

  private val host = object : PageRenderHost<Bitmap> {
    override fun display(bitmap: Bitmap?) {
      shown = bitmap
      invalidate()
    }

    override fun onRendered(page: Int, widthPx: Int, heightPx: Int, ms: Long) {
      send("onRendered") {
        onRendered(mapOf("page" to page, "widthPx" to widthPx, "heightPx" to heightPx, "ms" to ms.toInt()))
      }
    }

    override fun onRenderError(page: Int, code: String) {
      send("onRenderError") { onRenderError(mapOf("page" to page, "code" to code)) }
    }

    override fun displayTile(tile: Bitmap?, plan: TilePlan?) {
      this@PdfPageView.tile = tile
      tileArea = plan?.covered
      if (plan == null) {
        tileSource.setEmpty()
      } else {
        tileSource.set(plan.pad, plan.pad, plan.pad + plan.tile.widthPx, plan.pad + plan.tile.heightPx)
      }
      invalidate()
    }

    override fun onDetailRendered(page: Int, region: NormalizedRegion, widthPx: Int, heightPx: Int, ms: Long, waitMs: Long) {
      send("onDetailRendered") {
        onDetailRendered(
          mapOf(
            "page" to page,
            "region" to mapOf("x" to region.x, "y" to region.y, "width" to region.width, "height" to region.height),
            "widthPx" to widthPx,
            "heightPx" to heightPx,
            "ms" to ms.toInt(),
            "waitMs" to waitMs.toInt(),
          ),
        )
      }
    }

    // Tiles are optional sharpness: a failure only costs the tile. Code only, no paths.
    override fun onDetailDropped(code: String) {
      Log.w(TAG, "detail tile dropped: $code")
    }

    override fun afterNextFrames(block: () -> Unit) = FrameDeferral.afterNextFrames(block)

    // A main-looper post runs after the message applying this mount batch, so
    // props and the layout that follows them reach the controller together.
    override fun afterCurrentWork(block: () -> Unit) {
      FrameDeferral.mainHandler.post(block)
    }
  }

  init {
    // ExpoView is a ViewGroup, which skips onDraw by default.
    setWillNotDraw(false)
  }

  /** Applies the staged props. Paper mode changes only redraw. */
  internal fun commitProps(backend: () -> PageRenderBackend<Bitmap>) {
    if (destroyed) return
    val newMode = PaperMode.of(nightMode, sepia)
    if (newMode != mode) {
      mode = newMode
      paint.colorFilter = PaperColors.matrix(newMode)?.let(::ColorMatrixColorFilter)
      invalidate()
    }
    val render = controller ?: try {
      PageRenderController(backend(), host, initiallyAttached = isAttachedToWindow).also { controller = it }
    } catch (e: Exception) {
      Log.w(TAG, "page renderer unavailable: ${e.javaClass.simpleName}")
      host.onRenderError(page, ERR_RENDER_FAILED)
      return
    }
    render.setProps(PageViewProps(docId, page, renderScale, retryToken, detailRegion))
    if (width > 0 && height > 0) render.setSize(currentSize())
  }

  /** OnViewDestroys: cancels the render and gives the bitmaps back. */
  internal fun destroy() {
    destroyed = true
    controller?.dispose()
    controller = null
    shown = null
    tile = null
    tileArea = null
  }

  override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
    super.onSizeChanged(w, h, oldw, oldh)
    if (w > 0 && h > 0) controller?.setSize(currentSize())
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    controller?.attach()
  }

  override fun onDetachedFromWindow() {
    controller?.detach()
    super.onDetachedFromWindow()
  }

  // Placeholder, then the whole page scaled to the bounds, then the detail
  // tile over its area; one paint, so night/sepia apply to both.
  override fun onDraw(canvas: Canvas) {
    super.onDraw(canvas)
    val bitmap = shown
    if (bitmap == null || bitmap.isRecycled) {
      canvas.drawColor(PaperColors.paperColor(mode))
    } else {
      destination.set(0, 0, width, height)
      canvas.drawBitmap(bitmap, null, destination, paint)
    }
    val detail = tile
    val area = tileArea
    if (detail != null && area != null && !detail.isRecycled && !tileSource.isEmpty) {
      tileDestination.set(
        (area.x * width).toFloat(),
        (area.y * height).toFloat(),
        ((area.x + area.width) * width).toFloat(),
        ((area.y + area.height) * height).toFloat(),
      )
      // Only the content window; the pad and the rest of the bucket are not part of the tile.
      canvas.drawBitmap(detail, tileSource, tileDestination, paint)
    }
  }

  private fun currentSize() = ViewSize(width, height, resources.displayMetrics.density)

  // Events can outlive the JS runtime (reload) or the view's registration;
  // there is nobody to tell then.
  private inline fun send(name: String, block: () -> Unit) {
    if (destroyed) return
    try {
      block()
    } catch (e: Exception) {
      Log.w(TAG, "Could not send $name: ${e.javaClass.simpleName}")
    }
  }

  private companion object {
    const val TAG = "PdfEngine"
  }
}

/** Runs work two Choreographer frames later: by then the render thread has synced past any frame drawn before. */
internal object FrameDeferral {
  val mainHandler = Handler(Looper.getMainLooper())

  fun afterNextFrames(block: () -> Unit) {
    val choreographer = Choreographer.getInstance()
    choreographer.postFrameCallback {
      choreographer.postFrameCallback { block() }
    }
  }
}
