package com.ismailidris.pdfreader.pdfengine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

class PageRenderControllerTest {
  private class Bmp(val label: String) {
    override fun toString() = label
  }

  private class Pending(val spec: RenderSpec, val onDone: (RenderOutcome<Bmp>) -> Unit) {
    var cancelled = false
  }

  /** Records renders; the test completes them by hand (as the main-thread post would). */
  private class FakeBackend : PageRenderBackend<Bmp> {
    override val caps = RenderCaps(maxPixels = 4_000_000L, maxSide = 8192)
    override val backdropCaps = RenderCaps(maxPixels = 1_000_000L, maxSide = 8192)
    override val tileCaps = RenderCaps(maxPixels = 2_000_000L, maxSide = 8192)
    val started = ArrayList<Pending>()
    val released = ArrayList<Bmp>()
    var checkedOut = 0

    override fun render(spec: RenderSpec, onDone: (RenderOutcome<Bmp>) -> Unit): RenderCancellable {
      val pending = Pending(spec, onDone)
      started.add(pending)
      return RenderCancellable { pending.cancelled = true }
    }

    override fun release(bitmap: Bmp) {
      released.add(bitmap)
      checkedOut--
    }

    fun complete(index: Int, bitmap: Bmp, ms: Long = 5, waitMs: Long = 0) {
      checkedOut++
      val spec = started[index].spec
      started[index].onDone(RenderOutcome.Rendered(bitmap, spec.plan.widthPx, spec.plan.heightPx, ms, waitMs))
    }

    fun fail(index: Int, code: String) = started[index].onDone(RenderOutcome.Failed(code))
  }

  private class FakeHost : PageRenderHost<Bmp> {
    val displayed = ArrayList<Bmp?>()
    val rendered = ArrayList<List<Any>>()
    val errors = ArrayList<Pair<Int, String>>()
    val deferred = ArrayList<() -> Unit>()

    override fun display(bitmap: Bmp?) {
      displayed.add(bitmap)
    }

    override fun onRendered(page: Int, widthPx: Int, heightPx: Int, ms: Long) {
      rendered.add(listOf(page, widthPx, heightPx, ms))
    }

    override fun onRenderError(page: Int, code: String) {
      errors.add(page to code)
    }

    var tile: Bmp? = null
    var tileArea: NormalizedRegion? = null
    val details = ArrayList<List<Any>>()
    val dropped = ArrayList<String>()

    var tileContent: RenderPlan? = null

    override fun displayTile(tile: Bmp?, covered: NormalizedRegion?, content: RenderPlan?) {
      this.tile = tile
      tileArea = covered
      tileContent = content
    }

    override fun onDetailRendered(page: Int, region: NormalizedRegion, widthPx: Int, heightPx: Int, ms: Long, waitMs: Long) {
      details.add(listOf(page, region, widthPx, heightPx, waitMs))
    }

    override fun onDetailDropped(code: String) {
      dropped.add(code)
    }

    override fun afterNextFrames(block: () -> Unit) {
      deferred.add(block)
    }

    fun runFrames() {
      val blocks = ArrayList(deferred)
      deferred.clear()
      blocks.forEach { it() }
    }

    val work = ArrayList<() -> Unit>()

    override fun afterCurrentWork(block: () -> Unit) {
      work.add(block)
    }

    fun runWork() {
      val blocks = ArrayList(work)
      work.clear()
      blocks.forEach { it() }
    }
  }

  private val backend = FakeBackend()
  private val host = FakeHost()
  private val controller = PageRenderController(backend, host)
  private val size = ViewSize(1080, 1527, 2.625f)

  private fun props(page: Int = 0, scale: Double = 2.625, docId: String = "doc") = PageViewProps(docId, page, scale)

  @Test
  fun waitsForLayoutThenRendersOnce() {
    controller.update(props(), null)
    assertEquals(0, backend.started.size)
    controller.setSize(size)
    host.runWork()
    assertEquals(1, backend.started.size)
    assertEquals(RenderSpec("doc", 0, RenderPlan(1080, 1527)), backend.started[0].spec)
    // The same props and size again start nothing.
    controller.update(props(), size)
    controller.setSize(size)
    host.runWork()
    controller.refresh()
    assertEquals(1, backend.started.size)
  }

  @Test
  fun propsAndSizeTogetherStartOneRender() {
    controller.update(props(), size)
    controller.update(props(page = 1, scale = 5.25), ViewSize(540, 763, 2.625f))
    assertEquals(2, backend.started.size)
    assertTrue(backend.started[0].cancelled)
  }

  @Test
  fun renderedBitmapIsShownAndReported() {
    controller.update(props(page = 3), size)
    val bitmap = Bmp("p3")
    backend.complete(0, bitmap, ms = 42)
    assertSame(bitmap, controller.displayed)
    assertEquals(listOf<Bmp?>(bitmap), host.displayed)
    assertEquals(listOf(listOf<Any>(3, 1080, 1527, 42L)), host.rendered)
    assertFalse(controller.isRendering)
  }

  @Test
  fun supersededResultsAreDroppedAndReleased() {
    controller.update(props(page = 0), size)
    controller.update(props(page = 1), size)
    assertTrue("old render cancelled", backend.started[0].cancelled)
    val stale = Bmp("stale")
    backend.complete(0, stale)
    assertNull(controller.displayed)
    assertEquals(listOf(stale), backend.released)
    assertTrue(host.rendered.isEmpty())
    // A stale failure is dropped too.
    controller.update(props(page = 2), size)
    backend.fail(1, ErrorCode.CORRUPT_FILE.name)
    assertTrue(host.errors.isEmpty())
    backend.complete(2, Bmp("p2"))
    assertEquals(listOf(listOf<Any>(2, 1080, 1527, 5L)), host.rendered)
  }

  @Test
  fun scaleChangeKeepsThePreviousBitmapUntilTheNewOneIsReady() {
    controller.update(props(scale = 2.625), size)
    val low = Bmp("low")
    backend.complete(0, low)
    controller.update(props(scale = 5.25), size)
    assertSame("old bitmap stays while re-rendering", low, controller.displayed)
    // 5.25 px/dp would be 6.6 MP: lowered to the 4 MP cap.
    assertTrue(backend.started[1].spec.plan.pixels <= 4_000_000L)
    val high = Bmp("high")
    backend.complete(1, high)
    assertSame(high, controller.displayed)
    // The old one is released only after the next frames.
    assertTrue(backend.released.isEmpty())
    assertEquals(1, controller.retiredCount)
    host.runFrames()
    assertEquals(listOf(low), backend.released)
  }

  @Test
  fun sizeChangeAlsoKeepsThePreviousBitmap() {
    controller.update(props(), size)
    val first = Bmp("first")
    backend.complete(0, first)
    controller.setSize(ViewSize(540, 763, 2.625f))
    host.runWork()
    assertEquals(2, backend.started.size)
    assertSame(first, controller.displayed)
  }

  @Test
  fun pageChangeClearsToThePlaceholderAtOnce() {
    controller.update(props(page = 0), size)
    val p0 = Bmp("p0")
    backend.complete(0, p0)
    controller.update(props(page = 1), size)
    assertNull(controller.displayed)
    assertEquals(listOf(p0, null), host.displayed)
    host.runFrames()
    assertEquals(listOf(p0), backend.released)
    controller.update(props(page = 1, docId = "other"), size)
    assertEquals(3, backend.started.size)
  }

  @Test
  fun failureOfAnotherPageShowsThePlaceholderAndReportsTheCode() {
    controller.update(props(page = 3), size)
    val old = Bmp("p3")
    backend.complete(0, old)
    controller.update(props(page = 4), size)
    backend.fail(1, ErrorCode.CORRUPT_FILE.name)
    assertNull(controller.displayed)
    assertEquals(listOf(4 to ErrorCode.CORRUPT_FILE.name), host.errors)
    host.runFrames()
    assertEquals(listOf(old), backend.released)
  }

  @Test
  fun failedRescaleKeepsTheBitmapOfThatPage() {
    controller.update(props(page = 4, scale = 2.0), size)
    val low = Bmp("low")
    backend.complete(0, low)
    controller.update(props(page = 4, scale = 3.0), size)
    backend.fail(1, ErrorCode.OUT_OF_MEMORY.name)
    assertSame(low, controller.displayed)
    assertEquals(listOf(4 to ErrorCode.OUT_OF_MEMORY.name), host.errors)
    host.runFrames()
    assertTrue(backend.released.isEmpty())
  }

  @Test
  fun invalidPageOrScaleIsAnInvalidArgumentWithoutARender() {
    controller.update(props(page = -1), size)
    controller.update(props(page = 0, scale = 0.0), size)
    controller.update(props(page = 0, scale = Double.NaN), size)
    assertEquals(0, backend.started.size)
    assertEquals(
      listOf(-1 to ERR_INVALID_ARGUMENT, 0 to ERR_INVALID_ARGUMENT, 0 to ERR_INVALID_ARGUMENT),
      host.errors,
    )
  }

  @Test
  fun emptyDocIdRendersNothing() {
    controller.update(props(docId = ""), size)
    assertEquals(0, backend.started.size)
    assertTrue(host.errors.isEmpty())
  }

  @Test
  fun detachCancelsAndReleasesThenAttachRendersAgain() {
    controller.update(props(), size)
    val shown = Bmp("shown")
    backend.complete(0, shown)
    controller.update(props(scale = 4.0), size)
    controller.detach()
    assertTrue(backend.started[1].cancelled)
    assertNull(controller.displayed)
    host.runFrames()
    assertEquals(listOf(shown), backend.released)
    // Late outcome of the cancelled render goes straight back.
    val late = Bmp("late")
    backend.complete(1, late)
    assertEquals(listOf(shown, late), backend.released)
    controller.refresh()
    assertEquals("detached views do not render", 2, backend.started.size)
    controller.attach()
    host.runWork()
    assertEquals(3, backend.started.size)
  }

  @Test
  fun disposeDropsEverythingForGood() {
    controller.update(props(), size)
    backend.complete(0, Bmp("a"))
    controller.update(props(scale = 4.0), size)
    controller.dispose()
    assertTrue(backend.started[1].cancelled)
    backend.complete(1, Bmp("late"))
    host.runFrames()
    assertEquals(0, backend.checkedOut)
    controller.update(props(page = 9), size)
    controller.refresh()
    assertEquals(2, backend.started.size)
    assertTrue(host.rendered.size == 1)
  }

  @Test
  fun eachRetiredBitmapWaitsForItsOwnFrames() {
    controller.update(props(scale = 1.0), size)
    val a = Bmp("a")
    backend.complete(0, a)
    controller.update(props(scale = 2.0), size)
    backend.complete(1, Bmp("b"))
    // a is retired; before its frames pass, b is retired too.
    controller.update(props(scale = 3.0), size)
    backend.complete(2, Bmp("c"))
    assertEquals(2, host.deferred.size)
    host.deferred.removeAt(0).invoke()
    assertEquals(listOf(a), backend.released)
    host.runFrames()
    assertEquals(2, backend.released.size)
  }

  @Test
  fun stagedPropsAndLayoutCoalesceIntoOneRenderAtTheNewSize() {
    controller.update(props(page = 0), size)
    backend.complete(0, Bmp("p0"))
    // A recycled cell: new page, then its new layout, in one mount batch.
    controller.setProps(props(page = 7))
    controller.setSize(ViewSize(540, 763, 2.625f))
    assertEquals("nothing starts before the flush", 1, backend.started.size)
    assertEquals(1, host.work.size)
    host.runWork()
    assertEquals(2, backend.started.size)
    assertEquals(RenderSpec("doc", 7, RenderPlan(540, 763)), backend.started[1].spec)
    // Unchanged props staged again start nothing.
    controller.setProps(props(page = 7))
    host.runWork()
    assertEquals(2, backend.started.size)
  }

  @Test
  fun resultForASizeNoLongerCurrentIsDropped() {
    controller.update(props(), size)
    // Layout changes; the flush has not run when the old render finishes.
    controller.setSize(ViewSize(540, 763, 2.625f))
    val stale = Bmp("old-size")
    backend.complete(0, stale)
    assertNull(controller.displayed)
    assertEquals(listOf(stale), backend.released)
    assertTrue(host.rendered.isEmpty())
    host.runWork()
    backend.complete(1, Bmp("new-size"))
    assertEquals(listOf(listOf<Any>(0, 540, 763, 5L)), host.rendered)
  }

  @Test
  fun aspectChangeClearsTheBitmapSoItIsNeverDrawnStretched() {
    controller.update(props(), size)
    val tall = Bmp("tall")
    backend.complete(0, tall)
    // Same aspect, smaller: kept while re-rendering.
    controller.update(props(), ViewSize(540, 764, 2.625f))
    assertSame(tall, controller.displayed)
    // Landscape: cleared at once.
    controller.update(props(), ViewSize(1527, 1080, 2.625f))
    assertNull(controller.displayed)
  }

  @Test
  fun retryTokenRendersTheSamePageAgain() {
    controller.update(props(page = 2), size)
    backend.fail(0, ERR_RENDER_FAILED)
    assertEquals(listOf(2 to ERR_RENDER_FAILED), host.errors)
    // Re-sending identical props does not retry.
    controller.setProps(props(page = 2))
    host.runWork()
    assertEquals(1, backend.started.size)
    // A new token does, as a new generation.
    controller.setProps(PageViewProps("doc", 2, 2.625, retryToken = 1.0))
    host.runWork()
    assertEquals(2, backend.started.size)
    assertEquals(RenderSpec("doc", 2, RenderPlan(1080, 1527)), backend.started[1].spec)
    backend.fail(1, ERR_RENDER_FAILED)
    controller.setProps(PageViewProps("doc", 2, 2.625, retryToken = 2.0))
    host.runWork()
    val bitmap = Bmp("ok")
    backend.complete(2, bitmap)
    assertSame(bitmap, controller.displayed)
    // A retry while this page's bitmap of the same size is shown has nothing to redo.
    controller.setProps(PageViewProps("doc", 2, 2.625, retryToken = 3.0))
    host.runWork()
    assertEquals(3, backend.started.size)
    assertSame(bitmap, controller.displayed)
    // At another scale it renders.
    controller.setProps(PageViewProps("doc", 2, 2.0, retryToken = 4.0))
    host.runWork()
    assertEquals(4, backend.started.size)
  }

  @Test
  fun disposeCancelsAPendingFlush() {
    controller.setProps(props())
    controller.setSize(size)
    controller.dispose()
    host.runWork()
    assertEquals(0, backend.started.size)
  }

  // region detail tile

  // 4× zoom by layout: renderScale stays the density, the whole page (26 MP) is capped.
  private val zoomed = ViewSize(4320, 6112, 2.625f)
  private val topLeft = NormalizedRegion(0.0, 0.0, 0.25, 0.25)
  private val middle = NormalizedRegion(0.4, 0.4, 0.25, 0.25)

  private fun tileProps(region: NormalizedRegion?, page: Int = 0) = PageViewProps("doc", page, 2.625, detailRegion = region)

  private fun tileIndices() = backend.started.indices.filter { backend.started[it].spec.window != null }

  private fun pageIndices() = backend.started.indices.filter { backend.started[it].spec.window == null }

  /** Zoomed page with its base and first tile on screen; returns the tile. */
  private fun zoomedWithTile(region: NormalizedRegion = topLeft): Bmp {
    controller.update(tileProps(region), zoomed)
    backend.complete(pageIndices().last(), Bmp("base"))
    val tile = Bmp("tile-$region")
    backend.complete(tileIndices().last(), tile)
    return tile
  }

  @Test
  fun noTileUnlessTheWholePageIsCappedAndARegionIsSet() {
    controller.update(tileProps(topLeft), size)
    assertEquals("1×: the page bitmap is already sharp", 1, backend.started.size)
    controller.update(tileProps(null), zoomed)
    assertEquals(listOf(1), pageIndices().drop(1))
    assertTrue(tileIndices().isEmpty())
    controller.update(tileProps(topLeft), zoomed)
    assertEquals(1, tileIndices().size)
    val spec = backend.started[tileIndices()[0]].spec
    assertEquals(TileWindow(0, 0, 4320, 6112), spec.window)
    // The bitmap is the 64 px bucket around the 1080 x 1528 content.
    assertEquals(RenderPlan(1088, 1536), spec.plan)
    assertEquals("region alone does not re-render the page", 2, pageIndices().size)
  }

  @Test
  fun tileIsDrawnAtItsAreaAndReported() {
    val tile = zoomedWithTile(middle)
    assertSame(tile, host.tile)
    assertSame(tile, controller.displayedTile)
    val area = host.tileArea!!
    assertTrue(area.x <= 0.4 && area.x + area.width >= 0.65)
    assertEquals(1, host.details.size)
    assertEquals(0, host.details[0][0])
    assertEquals(middle, host.details[0][1])
  }

  @Test
  fun regionChangeKeepsTheOldTileUntilTheNewOneAndLeavesThePageAlone() {
    val old = zoomedWithTile(topLeft)
    val pagesBefore = pageIndices().size
    controller.setProps(tileProps(middle))
    host.runWork()
    assertEquals(pagesBefore, pageIndices().size)
    assertEquals(2, tileIndices().size)
    assertSame("old tile stays meanwhile", old, controller.displayedTile)
    val fresh = Bmp("fresh")
    backend.complete(tileIndices().last(), fresh)
    assertSame(fresh, controller.displayedTile)
    assertFalse(old in backend.released)
    host.runFrames()
    assertTrue(old in backend.released)
  }

  @Test
  fun supersededTileRenderIsCancelledAndItsResultReleased() {
    zoomedWithTile(topLeft)
    controller.setProps(tileProps(middle))
    host.runWork()
    val first = tileIndices().last()
    controller.setProps(tileProps(NormalizedRegion(0.7, 0.7, 0.2, 0.2)))
    host.runWork()
    assertTrue(backend.started[first].cancelled)
    val late = Bmp("late")
    backend.complete(first, late)
    assertTrue(late in backend.released)
    assertTrue(host.details.size == 1)
  }

  @Test
  fun pageChangeDropsTheTile() {
    val tile = zoomedWithTile()
    controller.update(tileProps(topLeft, page = 1), zoomed)
    assertNull(controller.displayedTile)
    assertNull(host.tile)
    host.runFrames()
    assertTrue(tile in backend.released)
    // The new page gets its own tile request.
    assertEquals(1, backend.started[tileIndices().last()].spec.page)
  }

  @Test
  fun nullRegionOrZoomingBackOutDropsTheTile() {
    zoomedWithTile()
    controller.update(tileProps(null), zoomed)
    assertNull(controller.displayedTile)
    zoomedWithTile()
    controller.update(tileProps(topLeft), size)
    assertNull("1× needs no tile", controller.displayedTile)
  }

  @Test
  fun sizeChangeKeepsTheTileAtItsNormalizedAreaUntilReplaced() {
    val tile = zoomedWithTile(middle)
    val area = controller.displayedTileArea
    val threeX = ViewSize(3240, 4584, 2.625f)
    controller.setSize(threeX)
    host.runWork()
    assertSame(tile, controller.displayedTile)
    assertEquals(area, controller.displayedTileArea)
    val spec = backend.started[tileIndices().last()].spec
    assertEquals(3240, spec.window!!.pageWidthPx)
  }

  @Test
  fun tileFailureIsSilentAndKeepsThePage() {
    controller.update(tileProps(topLeft), zoomed)
    val base = Bmp("base")
    backend.complete(pageIndices().last(), base)
    backend.fail(tileIndices().last(), ErrorCode.OUT_OF_MEMORY.name)
    assertSame(base, controller.displayed)
    assertNull(controller.displayedTile)
    assertTrue(host.errors.isEmpty())
    assertEquals(listOf(ErrorCode.OUT_OF_MEMORY.name), host.dropped)
    // An identical request does not loop on the failure.
    controller.setProps(tileProps(topLeft))
    host.runWork()
    assertEquals(1, tileIndices().size)
  }

  @Test
  fun pageFailureDoesNotTouchTheTile() {
    controller.update(tileProps(topLeft), zoomed)
    val tile = Bmp("tile")
    backend.complete(tileIndices().last(), tile)
    backend.fail(pageIndices().last(), ErrorCode.CORRUPT_FILE.name)
    assertEquals(listOf(0 to ErrorCode.CORRUPT_FILE.name), host.errors)
    assertNull(controller.displayed)
    assertSame("the tile stays over the placeholder", tile, controller.displayedTile)
  }

  @Test
  fun detachAndDisposeReleaseTiles() {
    zoomedWithTile()
    controller.update(tileProps(middle), zoomed)
    controller.dispose()
    assertTrue(backend.started[tileIndices().last()].cancelled)
    backend.complete(tileIndices().last(), Bmp("late"))
    host.runFrames()
    assertEquals(0, backend.checkedOut)
  }

  @Test
  fun tileEventCarriesContentSizeAndQueueWait() {
    controller.update(tileProps(topLeft), zoomed)
    backend.complete(pageIndices().last(), Bmp("base"))
    backend.complete(tileIndices().last(), Bmp("tile"), waitMs = 37)
    assertEquals(listOf<Any>(0, topLeft, 1080, 1528, 37L), host.details.single())
    assertEquals(RenderPlan(1080, 1528), host.tileContent)
  }

  @Test
  fun zoomedPageIsABackdropAtTheBackdropCaps() {
    controller.update(tileProps(topLeft), zoomed)
    val plan = backend.started[pageIndices().single()].spec.plan
    assertTrue("${plan.pixels}", plan.pixels <= backend.backdropCaps.maxPixels)
    assertTrue(plan.pixels > backend.backdropCaps.maxPixels * 0.98)
  }

  @Test
  fun atOneTimesARegionAsksForNoTileAndThePageIsFull() {
    controller.update(tileProps(NormalizedRegion(0.0, 0.0, 1.0, 1.0)), size)
    assertTrue(tileIndices().isEmpty())
    assertEquals(RenderPlan(1080, 1527), backend.started.single().spec.plan)
  }

  @Test
  fun zoomStepsDoNotReRenderACappedPageWhosePlanIsAlreadyShown() {
    controller.update(tileProps(topLeft), zoomed)
    backend.complete(pageIndices().last(), Bmp("backdrop"))
    // 3× and 5× layouts of the same page: the backdrop plan is the same size.
    controller.update(tileProps(topLeft), ViewSize(3240, 4584, 2.625f))
    controller.update(tileProps(topLeft), ViewSize(5400, 7640, 2.625f))
    assertEquals("only the first backdrop rendered", 1, pageIndices().size)
    assertNotNull(controller.displayed)
    // Tiles still follow the new sizes.
    assertEquals(3, tileIndices().size)
    // Zooming back to 1× needs a sharper page: it renders.
    controller.update(tileProps(topLeft), size)
    assertEquals(2, pageIndices().size)
  }

  @Test
  fun staleSizeDropLeavesNothingInFlight() {
    controller.update(props(), size)
    assertTrue(controller.isRendering)
    controller.setSize(ViewSize(540, 763, 2.625f))
    backend.complete(0, Bmp("old-size"))
    assertFalse("the dropped render is finished", controller.isRendering)
    host.runWork()
    assertTrue(controller.isRendering)
  }

  @Test
  fun smallViewsAllowOnePixelOfAspectRounding() {
    // A 30 x 43 view: a 1 px rounding is a 2–3% aspect change.
    val small = ViewSize(30, 43, 1f)
    controller.update(PageViewProps("doc", 0, 1.0), small)
    val first = Bmp("first")
    backend.complete(0, first)
    controller.update(PageViewProps("doc", 0, 1.0), ViewSize(30, 42, 1f))
    assertSame("kept: within one pixel", first, controller.displayed)
  }

  // endregion

  @Test
  fun manyCreateDestroyCyclesLeaveNothingCheckedOut() {
    repeat(500) { i ->
      val c = PageRenderController(backend, host)
      c.update(props(page = i % 7), size)
      val index = backend.started.lastIndex
      if (i % 2 == 0) backend.complete(index, Bmp("b$i"))
      if (i % 3 == 0) c.update(props(page = i % 7, scale = 4.0), size)
      c.dispose()
      if (i % 3 == 0 && i % 2 == 0) backend.complete(backend.started.lastIndex, Bmp("late$i"))
      host.runFrames()
    }
    assertEquals(0, backend.checkedOut)
  }
}
