package com.ismailidris.pdfreader.pdfengine

import android.app.ActivityManager
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ColorMatrixColorFilter
import android.graphics.RadialGradient
import android.graphics.Shader
import android.graphics.Paint
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import androidx.core.graphics.createBitmap
import androidx.test.platform.app.InstrumentationRegistry
import com.tom_roush.pdfbox.android.PDFBoxResourceLoader
import com.tom_roush.pdfbox.cos.COSArray
import com.tom_roush.pdfbox.cos.COSInteger
import com.tom_roush.pdfbox.cos.COSName
import com.tom_roush.pdfbox.pdmodel.PDDocument
import com.tom_roush.pdfbox.pdmodel.PDPage
import com.tom_roush.pdfbox.pdmodel.PDPageContentStream
import com.tom_roush.pdfbox.pdmodel.common.PDRectangle
import com.tom_roush.pdfbox.pdmodel.font.PDType1Font
import com.tom_roush.pdfbox.pdmodel.graphics.image.JPEGFactory
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import java.io.File
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import kotlin.random.Random

/**
 * The page-view render path against real PDFium: PageRenderService plus
 * PageRenderController driven on the main thread with real Choreographer
 * frame deferral. PdfPageView itself needs an Expo AppContext and a React
 * host to exist, so these tests drive the same controller and backend the
 * view uses, headlessly; the view adds only drawing (checked here with the
 * same ColorMatrixColorFilter) and event dispatch.
 */
class PageRenderServiceTest {
  private lateinit var context: Context
  private lateinit var fixtures: File
  private lateinit var scope: CoroutineScope
  private lateinit var engine: ReaderEngine
  private val services = ArrayList<PageRenderService>()
  private val main = Handler(Looper.getMainLooper())
  private val instrumentation = InstrumentationRegistry.getInstrumentation()

  private val noSearch = object : SearchListener {
    override fun onResult(searchId: String, page: Int, matches: List<List<NormalizedRect>>, rotation: Int) = Unit

    override fun onProgress(searchId: String, pagesSearched: Int, pageCount: Int) = Unit

    override fun onDone(searchId: String, totalMatches: Int, errorCode: String?) = Unit
  }

  @Before
  fun setUp() {
    context = instrumentation.targetContext
    PDFBoxResourceLoader.init(context)
    fixtures = File(context.cacheDir, "render-fixtures").apply {
      deleteRecursively()
      mkdirs()
    }
    scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    engine = ReaderEngine(context, scope, noSearch)
  }

  @After
  fun tearDown() {
    services.forEach { it.destroy() }
    engine.destroy()
    scope.cancel()
    fixtures.deleteRecursively()
  }

  // region fixtures and helpers

  private fun write(name: String, build: (PDDocument) -> Unit): File {
    val file = File(fixtures, name)
    PDDocument().use { document ->
      build(document)
      document.save(file)
    }
    return file
  }

  /** A page with a black square in the top-left corner of the unrotated page. */
  private fun PDDocument.markerPage(rotation: Int = 0, box: PDRectangle = PDRectangle.LETTER): PDPage {
    val page = PDPage(box)
    page.rotation = rotation
    addPage(page)
    PDPageContentStream(this, page).use { content ->
      content.setNonStrokingColor(0f, 0f, 0f)
      content.addRect(0f, box.height - 100f, 100f, 100f)
      content.fill()
    }
    return page
  }

  /** An A4 page of body text, the common reading case. */
  private fun PDDocument.textPage(label: String) {
    val page = PDPage(PDRectangle.A4)
    addPage(page)
    PDPageContentStream(this, page).use { content ->
      content.beginText()
      content.setFont(PDType1Font.TIMES_ROMAN, 11f)
      content.setLeading(14f)
      content.newLineAtOffset(56f, 790f)
      repeat(52) { line ->
        content.showText("$label line $line: the quick brown fox jumps over the lazy dog, again and again.")
        content.newLine()
      }
      content.endText()
    }
  }

  /** Tens of thousands of separately stroked curves: slow to render, so a cancel lands mid-way. */
  private fun heavy(name: String = "heavy.pdf") = write(name) { document ->
    val page = PDPage(PDRectangle.LETTER)
    document.addPage(page)
    val random = Random(7)
    PDPageContentStream(document, page).use { content ->
      content.setLineWidth(0.6f)
      repeat(HEAVY_PATHS) {
        val x = random.nextFloat() * 600f
        val y = random.nextFloat() * 780f
        content.setStrokingColor(random.nextFloat(), random.nextFloat(), random.nextFloat())
        content.moveTo(x, y)
        content.curveTo(x + 20f, y + 30f, x - 25f, y + 15f, x + 10f, y - 20f)
        content.stroke()
      }
    }
  }

  private fun open(file: File): OpenedReaderDocument = runBlocking { engine.open(file.path, null, UUID.randomUUID().toString()) }

  private fun service(budgetBytes: Long = deviceBudget(), allocator: BitmapAllocator<Bitmap> = AndroidBitmapAllocator) =
    PageRenderService({ engine }, BitmapPool(budgetBytes, allocator), mainHandler = main).also(services::add)

  private fun deviceBudget(): Long =
    PageRenderMath.poolBudgetBytes(context.getSystemService(ActivityManager::class.java).memoryClass)

  private fun render(service: PageRenderService, spec: RenderSpec): RenderOutcome<Bitmap> {
    val latch = CountDownLatch(1)
    val result = AtomicReference<RenderOutcome<Bitmap>>()
    service.render(spec) {
      assertEquals("outcomes arrive on the main thread", Looper.getMainLooper(), Looper.myLooper())
      result.set(it)
      latch.countDown()
    }
    assertTrue("render never finished", latch.await(60, TimeUnit.SECONDS))
    return result.get()
  }

  private fun rendered(outcome: RenderOutcome<Bitmap>): RenderOutcome.Rendered<Bitmap> =
    outcome as? RenderOutcome.Rendered ?: throw AssertionError("expected a bitmap, got ${describe(outcome)}")

  private fun describe(outcome: RenderOutcome<Bitmap>) = when (outcome) {
    is RenderOutcome.Failed -> "Failed(${outcome.code})"
    is RenderOutcome.Rendered -> "Rendered"
    RenderOutcome.Cancelled -> "Cancelled"
  }

  private fun isDark(pixel: Int) = Color.red(pixel) < 60 && Color.green(pixel) < 60 && Color.blue(pixel) < 60

  private fun isLight(pixel: Int) = Color.red(pixel) > 200 && Color.green(pixel) > 200 && Color.blue(pixel) > 200

  private fun awaitCondition(message: String, timeoutMs: Long = 20_000, condition: () -> Boolean) {
    val deadline = SystemClock.elapsedRealtime() + timeoutMs
    while (!condition()) {
      if (SystemClock.elapsedRealtime() > deadline) fail(message)
      SystemClock.sleep(10)
    }
  }

  /** A controller on the main thread whose host defers releases with the real Choreographer. */
  private class CountingHost : PageRenderHost<Bitmap> {
    @Volatile var renders = 0

    @Volatile var errors = 0

    override fun display(bitmap: Bitmap?) = Unit

    override fun onRendered(page: Int, widthPx: Int, heightPx: Int, ms: Long) {
      renders++
    }

    override fun onRenderError(page: Int, code: String) {
      errors++
    }

    override fun afterNextFrames(block: () -> Unit) = FrameDeferral.afterNextFrames(block)

    override fun afterCurrentWork(block: () -> Unit) {
      FrameDeferral.mainHandler.post(block)
    }
  }

  // endregion

  @Test
  fun rotatedPageRendersInDisplayedOrientation() {
    val file = write("rotated.pdf") { document ->
      document.markerPage(rotation = 0)
      document.markerPage(rotation = 90)
      document.markerPage(rotation = 180)
    }
    val opened = open(file)
    val service = service()
    // Displayed size from open: 90° swaps width and height.
    assertEquals(PageSize(792.0, 612.0), opened.sizes[1])

    val upright = rendered(render(service, RenderSpec(opened.docId, 0, RenderPlan(612, 792))))
    assertTrue("marker top-left at 0°", isDark(upright.bitmap.getPixel(50, 50)))
    assertTrue(isLight(upright.bitmap.getPixel(561, 50)))

    // Clockwise quarter turn: the unrotated top-left corner is now top-right.
    val quarter = rendered(render(service, RenderSpec(opened.docId, 1, RenderPlan(792, 612))))
    assertTrue("marker top-right at 90°", isDark(quarter.bitmap.getPixel(741, 50)))
    assertTrue(isLight(quarter.bitmap.getPixel(50, 50)))
    assertTrue(isLight(quarter.bitmap.getPixel(50, 561)))

    // Half turn: bottom-right.
    val half = rendered(render(service, RenderSpec(opened.docId, 2, RenderPlan(612, 792))))
    assertTrue("marker bottom-right at 180°", isDark(half.bitmap.getPixel(561, 741)))
    assertTrue(isLight(half.bitmap.getPixel(50, 50)))
    listOf(upright, quarter, half).forEach { service.release(it.bitmap) }
  }

  /** A scanned-document page: one A4 300 dpi (2480 x 3508) photo-like JPEG filling the page. */
  private fun scanned() = write("scanned.pdf") { document ->
    val image = createBitmap(SCAN_WIDTH, SCAN_HEIGHT)
    val canvas = Canvas(image)
    val random = Random(11)
    val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    repeat(400) {
      val x = random.nextFloat() * SCAN_WIDTH
      val y = random.nextFloat() * SCAN_HEIGHT
      val radius = 40f + random.nextFloat() * 400f
      paint.shader = RadialGradient(
        x, y, radius,
        Color.rgb(random.nextInt(256), random.nextInt(256), random.nextInt(256)),
        Color.argb(0, random.nextInt(256), random.nextInt(256), random.nextInt(256)),
        Shader.TileMode.CLAMP,
      )
      canvas.drawCircle(x, y, radius, paint)
    }
    // Sensor-like noise, row by row, so the JPEG carries real high-frequency detail.
    val row = IntArray(SCAN_WIDTH)
    for (y in 0 until SCAN_HEIGHT) {
      image.getPixels(row, 0, SCAN_WIDTH, 0, y, SCAN_WIDTH, 1)
      for (x in row.indices) {
        val n = random.nextInt(-24, 25)
        val p = row[x]
        row[x] = Color.rgb(
          (Color.red(p) + n).coerceIn(0, 255),
          (Color.green(p) + n).coerceIn(0, 255),
          (Color.blue(p) + n).coerceIn(0, 255),
        )
      }
      image.setPixels(row, 0, SCAN_WIDTH, 0, y, SCAN_WIDTH, 1)
    }
    val page = PDPage(PDRectangle.A4)
    document.addPage(page)
    val jpeg = JPEGFactory.createFromImage(document, image, 0.85f)
    image.recycle()
    PDPageContentStream(document, page).use { content ->
      content.drawImage(jpeg, 0f, 0f, PDRectangle.A4.width, PDRectangle.A4.height)
    }
  }

  /**
   * Benchmark: cancel latency on an image-only (scanned) page. PDFium decodes
   * the DCT image in one step the pause callback cannot interrupt, so this
   * reports the latency rather than asserting a bound; it only checks the
   * cancel is honoured and the bitmap returned.
   */
  @Test
  fun cancelLatencyOnAScannedPage() {
    val opened = open(scanned())
    Log.i(BENCH_TAG, "scanned fixture ${File(fixtures, "scanned.pdf").length() / 1024} KB")
    val service = service()
    val spec = RenderSpec(opened.docId, 0, RenderPlan(1080, 1528))
    val fulls = ArrayList<Long>()
    repeat(3) {
      val full = rendered(render(service, spec))
      fulls.add(full.ms)
      service.release(full.bitmap)
    }
    val fullMs = fulls.sorted()[1]
    val latencies = ArrayList<Long>()
    for (fraction in listOf(5, 3, 2)) {
      val started = CountDownLatch(1)
      service.beforeRenderForTest = { started.countDown() }
      // A cancel that lands after the decode finished still yields a bitmap; give it back.
      val handle = service.render(spec) { if (it is RenderOutcome.Rendered) service.release(it.bitmap) }
      assertTrue(started.await(30, TimeUnit.SECONDS))
      service.beforeRenderForTest = null
      SystemClock.sleep(fullMs / fraction)
      val cancelAt = SystemClock.elapsedRealtime()
      handle.cancel()
      awaitCondition("the cancelled bitmap never went back") { service.pool.stats().inUseCount == 0 }
      latencies.add(SystemClock.elapsedRealtime() - cancelAt)
    }
    Log.i(
      BENCH_TAG,
      "scanned page ${SCAN_WIDTH}x$SCAN_HEIGHT JPEG at 1080x1528: full renders $fulls ms; " +
        "cancel at 1/5, 1/3, 1/2 of $fullMs ms stopped after $latencies ms",
    )
  }

  @Test
  fun progressiveRenderStopsEarlyWhenCancelled() {
    val opened = open(heavy())
    val service = service()
    val spec = RenderSpec(opened.docId, 0, RenderPlan(1224, 1584))

    val fullStart = SystemClock.elapsedRealtime()
    val full = rendered(render(service, spec))
    val fullMs = SystemClock.elapsedRealtime() - fullStart
    service.release(full.bitmap)
    Log.i(BENCH_TAG, "heavy page ($HEAVY_PATHS paths) full render ${full.ms} ms")
    assertTrue("fixture too light to test cancellation: $fullMs ms", fullMs >= 100)

    val started = CountDownLatch(1)
    service.beforeRenderForTest = { started.countDown() }
    val done = CountDownLatch(1)
    val result = AtomicReference<RenderOutcome<Bitmap>>()
    val handle = service.render(spec) {
      result.set(it)
      done.countDown()
    }
    assertTrue(started.await(30, TimeUnit.SECONDS))
    SystemClock.sleep(fullMs / 5)
    val cancelAt = SystemClock.elapsedRealtime()
    handle.cancel()
    // A cancelled render may skip onDone; wait for the pool instead.
    awaitCondition("the cancelled bitmap never went back") { service.pool.stats().inUseCount == 0 }
    val stopMs = SystemClock.elapsedRealtime() - cancelAt
    service.beforeRenderForTest = null
    Log.i(BENCH_TAG, "cancel after ${fullMs / 5} ms stopped in $stopMs ms (full $fullMs ms)")
    assertTrue("cancel took $stopMs ms of a $fullMs ms render", stopMs < fullMs / 2)
    done.await(2, TimeUnit.SECONDS)
    result.get()?.let { assertTrue("a cancelled render yields no bitmap", it is RenderOutcome.Cancelled) }
    // The PDFium thread is free again: a normal render still works.
    service.release(rendered(render(service, RenderSpec(opened.docId, 0, RenderPlan(100, 130)))).bitmap)
  }

  @Test
  fun alreadyCancelledRenderNeverRuns() {
    val opened = open(write("one.pdf") { it.markerPage() })
    val service = service()
    val gate = CountDownLatch(1)
    // Keep the PDFium thread busy so the next render is still queued when cancelled.
    val blocker = blockPdfiumThread(gate)
    val delivered = java.util.concurrent.atomic.AtomicBoolean(false)
    val handle = service.render(RenderSpec(opened.docId, 0, RenderPlan(200, 260))) { delivered.set(true) }
    handle.cancel()
    gate.countDown()
    runBlocking { blocker.join() }
    SystemClock.sleep(300)
    instrumentation.waitForIdleSync()
    assertTrue("a render cancelled while queued never delivers", !delivered.get())
    assertEquals(0, service.pool.stats().allocations)
  }

  @Test
  fun poolReusesSameSizeBitmaps() {
    val opened = open(write("two.pdf") { document -> repeat(2) { document.textPage("p$it") } })
    val service = service()
    val first = rendered(render(service, RenderSpec(opened.docId, 0, RenderPlan(600, 848))))
    service.release(first.bitmap)
    val second = rendered(render(service, RenderSpec(opened.docId, 1, RenderPlan(600, 848))))
    assertTrue("same bitmap object reused", first.bitmap === second.bitmap)
    val stats = service.pool.stats()
    assertEquals(1, stats.allocations)
    assertEquals(1, stats.reuses)
    service.release(second.bitmap)
  }

  @Test
  fun overCapScaleIsLoweredAndReported() {
    val opened = open(write("a4.pdf") { it.textPage("cap") })
    // 8 MB budget: 4 MB per bitmap = 1 Mi pixels.
    val service = service(budgetBytes = 8L * 1024 * 1024)
    val plan = PageRenderMath.plan(1080, 1528, 2.625f, 2.625 * 5, service.caps)!!
    assertTrue("plan ${plan.widthPx}x${plan.heightPx}", plan.pixels <= 1024L * 1024)
    val result = rendered(render(service, RenderSpec(opened.docId, 0, plan)))
    assertEquals(plan.widthPx, result.widthPx)
    assertEquals(plan.heightPx, result.heightPx)
    assertEquals(plan.widthPx, result.bitmap.width)
    service.release(result.bitmap)
  }

  @Test
  fun outOfMemoryRetriesOnceAtHalfScaleThenFails() {
    val opened = open(write("a4.pdf") { it.textPage("oom") })
    // Refuses anything over 500 x 500, like a device out of memory for big bitmaps.
    val picky = object : BitmapAllocator<Bitmap> {
      override fun allocate(widthPx: Int, heightPx: Int): Bitmap {
        if (widthPx.toLong() * heightPx > 250_000) throw OutOfMemoryError("test")
        return AndroidBitmapAllocator.allocate(widthPx, heightPx)
      }

      override fun free(bitmap: Bitmap) = AndroidBitmapAllocator.free(bitmap)
    }
    val service = service(allocator = picky)
    val retried = rendered(render(service, RenderSpec(opened.docId, 0, RenderPlan(800, 600))))
    assertEquals(400, retried.widthPx)
    assertEquals(300, retried.heightPx)
    service.release(retried.bitmap)
    val failed = render(service, RenderSpec(opened.docId, 0, RenderPlan(2000, 2000)))
    assertEquals(ErrorCode.OUT_OF_MEMORY.name, (failed as RenderOutcome.Failed).code)
    assertEquals(0, service.pool.stats().inUseCount)
  }

  @Test
  fun nightModeFilterInvertsThePage() {
    val opened = open(write("marker.pdf") { it.markerPage() })
    val service = service()
    val page = rendered(render(service, RenderSpec(opened.docId, 0, RenderPlan(612, 792))))
    val out = createBitmap(612, 792)
    val paint = Paint(Paint.FILTER_BITMAP_FLAG).apply {
      colorFilter = ColorMatrixColorFilter(PaperColors.matrix(PaperMode.NIGHT)!!)
    }
    Canvas(out).drawBitmap(page.bitmap, 0f, 0f, paint)
    assertTrue("ink becomes light", isLight(out.getPixel(50, 50)))
    assertTrue("paper becomes dark", isDark(out.getPixel(400, 400)))
    assertEquals(PaperColors.paperColor(PaperMode.NIGHT), out.getPixel(400, 400))
    // Sepia paper matches the placeholder colour exactly.
    Canvas(out).drawBitmap(page.bitmap, 0f, 0f, Paint().apply { colorFilter = ColorMatrixColorFilter(PaperColors.matrix(PaperMode.SEPIA)!!) })
    assertEquals(PaperColors.paperColor(PaperMode.SEPIA), out.getPixel(400, 400))
    out.recycle()
    service.release(page.bitmap)
  }

  @Test
  fun corruptPageAndBadIndexAndClosedDocument() {
    val file = write("bad-page.pdf") { document ->
      repeat(3) { document.markerPage() }
      val kids = document.documentCatalog.pages.cosObject.getDictionaryObject(COSName.KIDS) as COSArray
      kids.set(1, COSInteger.get(7))
    }
    val opened = open(file)
    val service = service()
    fun code(page: Int, docId: String = opened.docId) =
      (render(service, RenderSpec(docId, page, RenderPlan(100, 100))) as RenderOutcome.Failed).code
    assertEquals(ErrorCode.CORRUPT_FILE.name, code(1))
    assertEquals(ERR_INVALID_ARGUMENT, code(3))
    assertEquals(ERR_INVALID_ARGUMENT, code(-1))
    assertEquals(ERR_DOC_NOT_OPEN, code(0, docId = "nope"))
    runBlocking { engine.close(opened.docId) }
    assertEquals(ERR_DOC_NOT_OPEN, code(0))
    assertEquals(0, service.pool.stats().inUseCount)
  }

  @Test
  fun closingTheDocumentMidRenderReportsDocNotOpen() {
    val opened = open(heavy())
    val service = service()
    val started = CountDownLatch(1)
    service.beforeRenderForTest = { started.countDown() }
    val latch = CountDownLatch(1)
    val result = AtomicReference<RenderOutcome<Bitmap>>()
    service.render(RenderSpec(opened.docId, 0, RenderPlan(1224, 1584))) {
      result.set(it)
      latch.countDown()
    }
    assertTrue(started.await(30, TimeUnit.SECONDS))
    val closeStart = SystemClock.elapsedRealtime()
    runBlocking { engine.close(opened.docId) }
    Log.i(BENCH_TAG, "close during a heavy render took ${SystemClock.elapsedRealtime() - closeStart} ms")
    assertTrue(latch.await(30, TimeUnit.SECONDS))
    assertEquals(ERR_DOC_NOT_OPEN, (result.get() as RenderOutcome.Failed).code)
    assertEquals(0, engine.openDocumentCount)
    assertEquals(0, service.pool.stats().inUseCount)
  }

  @Test
  fun fiveHundredViewLifecyclesLeaveNoBitmapCheckedOut() {
    val opened = open(write("pages.pdf") { document -> repeat(10) { document.textPage("p$it") } })
    val service = service()
    val host = CountingHost()
    val size = ViewSize(360, 509, 2.625f)
    repeat(500) { i ->
      instrumentation.runOnMainSync {
        val controller = PageRenderController(service, host)
        controller.update(PageViewProps(opened.docId, i % 10, 2.625), size)
        // Every other view lives long enough to show its page, then rescales.
        if (i % 2 == 0) {
          main.postDelayed({
            controller.update(PageViewProps(opened.docId, i % 10, 4.0), size)
            main.postDelayed({ controller.dispose() }, 5)
          }, 20)
        } else {
          controller.dispose()
        }
      }
      if (i % 50 == 0) SystemClock.sleep(30)
    }
    awaitCondition("bitmaps still checked out: ${service.pool.stats()}", timeoutMs = 60_000) {
      instrumentation.waitForIdleSync()
      service.pool.stats().inUseCount == 0
    }
    Log.i(BENCH_TAG, "500 lifecycles: ${host.renders} rendered, ${host.errors} errors, ${service.pool.stats()}")
    assertEquals(0, host.errors)
    assertTrue(host.renders > 0)
    // With every view gone, the idle trim gives the free bitmaps back after its delay.
    assertTrue(service.pool.stats().freeCount > 0)
    awaitCondition("pool not emptied after the idle delay: ${service.pool.stats()}", timeoutMs = 10_000) {
      service.pool.stats().let { it.freeCount == 0 && it.freeBytes == 0L && it.inUseCount == 0 }
    }
  }

  @Test
  fun measureRenderTimesAndFastScrollMemory() {
    val density = 2.625f
    val viewWidth = 1080
    val viewHeight = Math.round(viewWidth * 842f / 595f)
    val opened = open(write("book.pdf") { document -> repeat(100) { document.textPage("Page $it") } })
    val service = service()
    val caps = service.caps

    for ((label, zoom) in listOf("1x" to 1.0, "3x" to 3.0)) {
      val plan = PageRenderMath.plan(viewWidth, viewHeight, density, density * zoom, caps)!!
      val times = ArrayList<Long>()
      repeat(6) { i ->
        val result = rendered(render(service, RenderSpec(opened.docId, i, plan)))
        times.add(result.ms)
        service.release(result.bitmap)
      }
      // The first render warms fonts and caches; report it apart.
      val steady = times.drop(1).sorted()
      Log.i(
        BENCH_TAG,
        "A4 text $label at density $density: ${plan.widthPx}x${plan.heightPx} px, first ${times[0]} ms, " +
          "median ${steady[steady.size / 2]} ms, max ${steady.last()} ms",
      )
    }

    // Fast scroll: 7 recycled cells (a FlashList window) bound to pages 0..99,
    // one page every 16 ms, as a fling would.
    service.pool.clear()
    service.pool.resetHighWater()
    val host = CountingHost()
    val size = ViewSize(viewWidth, viewHeight, density)
    val cells = ArrayList<PageRenderController<Bitmap>>()
    instrumentation.runOnMainSync { repeat(7) { cells.add(PageRenderController(service, host)) } }
    val scrollStart = SystemClock.elapsedRealtime()
    for (page in 0 until 100) {
      instrumentation.runOnMainSync { cells[page % 7].update(PageViewProps(opened.docId, page, density.toDouble()), size) }
      SystemClock.sleep(16)
    }
    awaitCondition("scroll never settled") {
      var busy = false
      instrumentation.runOnMainSync { busy = cells.any { it.isRendering } }
      !busy
    }
    val settleMs = SystemClock.elapsedRealtime() - scrollStart
    val stats = service.pool.stats()
    Log.i(
      BENCH_TAG,
      "fast scroll 100 pages: high-water ${stats.highWaterBytes / (1024 * 1024)} MB of ${service.pool.budgetBytes / (1024 * 1024)} MB budget, " +
        "${host.renders} rendered, allocations ${stats.allocations}, reuses ${stats.reuses}, settled after $settleMs ms",
    )
    assertTrue(
      "high-water ${stats.highWaterBytes} over the ${service.pool.budgetBytes} budget",
      stats.highWaterBytes <= service.pool.budgetBytes,
    )
    instrumentation.runOnMainSync { cells.forEach { it.dispose() } }
    awaitCondition("cells kept bitmaps") {
      instrumentation.waitForIdleSync()
      service.pool.stats().inUseCount == 0
    }
    assertEquals(0, host.errors)
  }

  /** Occupies the PDFium thread until [gate] opens; returns once it is running. */
  private fun blockPdfiumThread(gate: CountDownLatch): Job {
    val started = CountDownLatch(1)
    val job = CoroutineScope(PdfiumThread.dispatcher).launch {
      started.countDown()
      gate.await(10, TimeUnit.SECONDS)
    }
    assertTrue(started.await(10, TimeUnit.SECONDS))
    return job
  }

  companion object {
    private const val BENCH_TAG = "PdfEngineBench"
    private const val HEAVY_PATHS = 60_000
    private const val SCAN_WIDTH = 2480
    private const val SCAN_HEIGHT = 3508
  }
}

