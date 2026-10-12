package com.ismailidris.pdfreader.pdfengine

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color
import android.os.Debug
import android.os.SystemClock
import android.util.Log
import androidx.core.content.FileProvider
import androidx.test.platform.app.InstrumentationRegistry
import com.tom_roush.pdfbox.android.PDFBoxResourceLoader
import com.tom_roush.pdfbox.cos.COSArray
import com.tom_roush.pdfbox.cos.COSInteger
import com.tom_roush.pdfbox.cos.COSName
import com.tom_roush.pdfbox.pdmodel.PDDocument
import com.tom_roush.pdfbox.pdmodel.PDPage
import com.tom_roush.pdfbox.pdmodel.PDPageContentStream
import com.tom_roush.pdfbox.pdmodel.common.PDRectangle
import com.tom_roush.pdfbox.pdmodel.encryption.AccessPermission
import com.tom_roush.pdfbox.pdmodel.encryption.StandardProtectionPolicy
import com.tom_roush.pdfbox.pdmodel.font.PDType1Font
import com.tom_roush.pdfbox.pdmodel.graphics.image.LosslessFactory
import com.tom_roush.pdfbox.pdmodel.interactive.action.PDActionGoTo
import com.tom_roush.pdfbox.pdmodel.interactive.action.PDActionURI
import com.tom_roush.pdfbox.pdmodel.interactive.documentnavigation.destination.PDPageFitDestination
import com.tom_roush.pdfbox.pdmodel.interactive.documentnavigation.outline.PDDocumentOutline
import com.tom_roush.pdfbox.pdmodel.interactive.documentnavigation.outline.PDOutlineItem
import com.tom_roush.pdfbox.pdmodel.interactive.form.PDAcroForm
import com.tom_roush.pdfbox.pdmodel.interactive.form.PDTextField
import expo.modules.kotlin.exception.CodedException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.cancel
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import java.io.File
import java.util.Collections
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Opens with a fresh openId; tests that cancel opens pass their own. */
private suspend fun ReaderEngine.open(source: String, password: String?): OpenedReaderDocument =
  open(source, password, UUID.randomUUID().toString())

/**
 * Reader engine against real PDFium. Fixtures are generated with
 * PdfBox-Android per test (no committed binaries). Calls the engine directly,
 * not through JS.
 */
class ReaderEngineTest {
  private class Done(val searchId: String, val totalMatches: Int, val errorCode: String?)

  /** Records search events; [awaitDone] blocks until onDone for an id. */
  private class RecordingListener : SearchListener {
    val results: MutableList<Triple<String, Int, List<List<NormalizedRect>>>> = Collections.synchronizedList(ArrayList())
    val rotations = ConcurrentHashMap<Int, Int>()
    val progress: MutableList<Triple<String, Int, Int>> = Collections.synchronizedList(ArrayList())
    val done: MutableList<Done> = Collections.synchronizedList(ArrayList())
    val firstResult = CountDownLatch(1)
    private val doneLatch = CountDownLatch(1)

    override fun onResult(searchId: String, page: Int, matches: List<List<NormalizedRect>>, rotation: Int) {
      results.add(Triple(searchId, page, matches))
      rotations[page] = rotation
      firstResult.countDown()
    }

    override fun onProgress(searchId: String, pagesSearched: Int, pageCount: Int) {
      progress.add(Triple(searchId, pagesSearched, pageCount))
    }

    override fun onDone(searchId: String, totalMatches: Int, errorCode: String?) {
      done.add(Done(searchId, totalMatches, errorCode))
      doneLatch.countDown()
    }

    fun awaitDone(): Done {
      assertTrue("search did not finish", doneLatch.await(60, TimeUnit.SECONDS))
      // Give a duplicate onDone (a bug) a moment to show up.
      SystemClock.sleep(200)
      assertEquals("onDone must fire exactly once", 1, done.size)
      return done[0]
    }
  }

  private lateinit var context: Context
  private lateinit var fixtures: File
  private lateinit var scope: CoroutineScope
  private lateinit var listener: RecordingListener
  private lateinit var engine: ReaderEngine

  @Before
  fun setUp() {
    context = InstrumentationRegistry.getInstrumentation().targetContext
    PDFBoxResourceLoader.init(context)
    fixtures = File(context.cacheDir, "reader-fixtures").apply {
      deleteRecursively()
      mkdirs()
    }
    scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    listener = RecordingListener()
    engine = ReaderEngine(context, scope, listener)
  }

  @After
  fun tearDown() {
    engine.destroy()
    scope.cancel()
    fixtures.deleteRecursively()
  }

  // region fixtures

  private fun write(name: String, build: (PDDocument) -> Unit): File {
    val file = File(fixtures, name)
    PDDocument().use { document ->
      build(document)
      document.save(file)
    }
    return file
  }

  private fun PDDocument.textPage(text: String, box: PDRectangle = PDRectangle.LETTER, x: Float = 100f, y: Float = 700f): PDPage {
    val page = PDPage(box)
    addPage(page)
    PDPageContentStream(this, page).use { content ->
      content.beginText()
      content.setFont(PDType1Font.HELVETICA, 24f)
      content.newLineAtOffset(x, y)
      content.showText(text)
      content.endText()
    }
    return page
  }

  private fun simple(name: String = "simple.pdf", text: String = "Hello world") = write(name) { it.textPage(text) }

  private fun encrypted(name: String, owner: String, user: String) = write(name) { document ->
    document.textPage("Secret text")
    val policy = StandardProtectionPolicy(owner, user, AccessPermission())
    policy.encryptionKeyLength = 128
    document.protect(policy)
  }

  private fun manyPages(count: Int) = write("many-$count.pdf") { document ->
    for (i in 1..count) document.textPage("Page $i needle")
  }

  private fun contentUri(file: File): String =
    FileProvider.getUriForFile(context, "${context.packageName}.readertest", file).toString()

  // endregion

  private fun open(source: String, password: String? = null) = runBlocking { engine.open(source, password) }

  private fun failureCode(block: suspend () -> Unit): String {
    try {
      runBlocking { block() }
    } catch (e: CodedException) {
      return e.code
    }
    fail("Expected a coded failure")
    throw AssertionError("unreachable")
  }

  private fun close(docId: String) = runBlocking { engine.close(docId) }

  // region open

  @Test
  fun opensAPlainDocument() {
    val opened = open(simple().path)
    assertEquals(1, opened.sizes.size)
    assertFalse(opened.isEncrypted)
    assertEquals(PageSize(612.0, 792.0), opened.sizes[0])
    val map = opened.toMap()
    assertEquals(setOf("docId", "pageCount", "pages", "isEncrypted"), map.keys)
    assertEquals(1, map["pageCount"])
    assertEquals(1, engine.openDocumentCount)
    close(opened.docId)
    assertEquals(0, engine.openDocumentCount)
  }

  @Test
  fun opensFileUris() {
    val opened = open("file://" + simple().path)
    assertEquals(1, opened.sizes.size)
    close(opened.docId)
  }

  @Test
  fun userPasswordIsRequiredThenWrongThenAccepted() {
    val file = encrypted("locked.pdf", owner = "owner-pw", user = "user-pw")
    assertEquals(ErrorCode.PASSWORD_REQUIRED.name, failureCode { engine.open(file.path, null) })
    assertEquals(ErrorCode.PASSWORD_REQUIRED.name, failureCode { engine.open(file.path, "") })
    assertEquals(ErrorCode.WRONG_PASSWORD.name, failureCode { engine.open(file.path, "nope") })
    val opened = open(file.path, "user-pw")
    assertTrue(opened.isEncrypted)
    assertTrue(runBlocking { engine.pageText(opened.docId, 0) }.contains("Secret text"))
    close(opened.docId)
    assertEquals(0, engine.openDocumentCount)
  }

  @Test
  fun ownerPasswordOnlyOpensWithoutAPasswordButIsEncrypted() {
    val file = encrypted("owner-only.pdf", owner = "owner-pw", user = "")
    val opened = open(file.path)
    assertTrue(opened.isEncrypted)
    assertTrue(runBlocking { engine.pageText(opened.docId, 0) }.contains("Secret text"))
    close(opened.docId)
  }

  @Test
  fun aes256UserPasswordIsRequiredThenWrongThenAccepted() {
    val file = write("aes256.pdf") { document ->
      document.textPage("Secret text")
      val policy = StandardProtectionPolicy("owner-pw", "user-pw", AccessPermission())
      policy.encryptionKeyLength = 256
      document.protect(policy)
    }
    assertEquals(ErrorCode.PASSWORD_REQUIRED.name, failureCode { engine.open(file.path, null) })
    assertEquals(ErrorCode.WRONG_PASSWORD.name, failureCode { engine.open(file.path, "nope") })
    val opened = open(file.path, "user-pw")
    assertTrue(opened.isEncrypted)
    assertTrue(runBlocking { engine.pageText(opened.docId, 0) }.contains("Secret text"))
    close(opened.docId)
  }

  /** A valid PDF followed by 100 MB of padding, so copying it takes a while. */
  private fun bigFile(): File {
    val big = File(fixtures, "big.pdf")
    big.outputStream().use { out ->
      out.write(simple().readBytes())
      val chunk = ByteArray(1 shl 20)
      repeat(100) { out.write(chunk) }
    }
    return big
  }

  /** Starts an open in the background; the result is "opened" or the error code. */
  private fun openAsync(source: String, openId: String) = scope.async {
    try {
      engine.open(source, null, openId)
      "opened"
    } catch (e: CodedException) {
      e.code
    }
  }

  private fun awaitCopyStarted() {
    val deadline = SystemClock.elapsedRealtime() + 20_000
    while (engine.sources.copyDir.listFiles().orEmpty().none { it.length() > 0 }) {
      assertTrue("the copy never started", SystemClock.elapsedRealtime() < deadline)
      SystemClock.sleep(2)
    }
  }

  @Test
  fun cancelOpenStopsAContentCopyMidway() {
    val result = openAsync(contentUri(bigFile()), "open-big")
    awaitCopyStarted()
    engine.cancelOpen("open-big")
    assertEquals(ErrorCode.CANCELLED.name, runBlocking { result.await() })
    assertTrue(engine.sources.copyDir.listFiles().orEmpty().isEmpty())
    assertEquals(0, engine.openDocumentCount)
  }

  @Test
  fun duplicateInFlightOpenIdIsRejectedWithoutDisturbingTheFirst() {
    val first = openAsync(contentUri(bigFile()), "same-id")
    awaitCopyStarted()
    assertEquals(ERR_INVALID_ARGUMENT, failureCode { engine.open(simple().path, null, "same-id") })
    assertEquals(0, engine.openDocumentCount)
    // The first open is still the cancel target for that id.
    engine.cancelOpen("same-id")
    assertEquals(ErrorCode.CANCELLED.name, runBlocking { first.await() })
    assertTrue(engine.sources.copyDir.listFiles().orEmpty().isEmpty())
    // Once finished, the id is free again.
    val reused = runBlocking { engine.open(simple().path, null, "same-id") }
    close(reused.docId)
  }

  /**
   * A cancel landing after the document is registered but before open returns
   * must not leave it open: the caller never learns its docId. The hook fires
   * on the PDFium thread right after registration, hitting that window exactly.
   */
  @Test
  fun cancelAfterRegistrationDiscardsTheDocument() {
    engine.afterRegisterForTest = { engine.cancelOpen("late-cancel") }
    try {
      assertEquals(
        ErrorCode.CANCELLED.name,
        failureCode { engine.open(contentUri(simple()), null, "late-cancel") },
      )
    } finally {
      engine.afterRegisterForTest = null
    }
    assertEquals(0, engine.openDocumentCount)
    assertTrue(engine.sources.copyDir.listFiles().orEmpty().isEmpty())
  }

  @Test
  fun cancelOpenBeforeTheOpenArrivesStillCancelsIt() {
    engine.cancelOpen("early")
    assertEquals(ErrorCode.CANCELLED.name, failureCode { engine.open(contentUri(simple()), null, "early") })
    assertTrue(engine.sources.copyDir.listFiles().orEmpty().isEmpty())
    assertEquals(0, engine.openDocumentCount)
  }

  @Test
  fun cancelOpenOfAFinishedOpenIsANoOp() {
    val opened = runBlocking { engine.open(simple().path, null, "done-id") }
    engine.cancelOpen("done-id")
    engine.cancelOpen("never-used")
    assertEquals(1, engine.openDocumentCount)
    assertTrue(runBlocking { engine.pageText(opened.docId, 0) }.contains("Hello"))
    close(opened.docId)
  }

  @Test
  fun corruptBytesAreCorruptFile() {
    val file = File(fixtures, "garbage.pdf").apply { writeBytes(ByteArray(4096) { (it * 31).toByte() }) }
    assertEquals(ErrorCode.CORRUPT_FILE.name, failureCode { engine.open(file.path, null) })
    val truncated = File(fixtures, "truncated.pdf").apply { writeBytes(simple().readBytes().copyOf(100)) }
    assertEquals(ErrorCode.CORRUPT_FILE.name, failureCode { engine.open(truncated.path, null) })
    assertEquals(0, engine.openDocumentCount)
  }

  @Test
  fun missingFilesAreNotFoundAndBadSourcesInvalid() {
    val missing = File(fixtures, "missing.pdf").path
    assertEquals(ErrorCode.NOT_FOUND.name, failureCode { engine.open(missing, null) })
    assertEquals(ErrorCode.NOT_FOUND.name, failureCode { engine.open("file://$missing", null) })
    assertEquals(ERR_INVALID_ARGUMENT, failureCode { engine.open("relative/doc.pdf", null) })
  }

  @Test
  fun errorMessagesNeverContainThePath() {
    val missing = File(fixtures, "secret-name.pdf").path
    val garbage = File(fixtures, "secret-garbage.pdf").apply { writeBytes(ByteArray(64)) }
    for (source in listOf(missing, garbage.path)) {
      try {
        runBlocking { engine.open(source, null) }
        fail("Expected the open to fail")
      } catch (e: CodedException) {
        assertFalse(e.message.orEmpty().contains("secret"))
        assertNull(e.cause)
      }
    }
  }

  @Test
  fun contentUrisAreCopiedAndTheCopyDeletedOnClose() {
    val opened = open(contentUri(simple()))
    val copies = engine.sources.copyDir.listFiles().orEmpty()
    assertEquals(1, copies.size)
    assertFalse("copy name must not reveal the source", copies[0].name.contains("simple"))
    assertTrue(runBlocking { engine.pageText(opened.docId, 0) }.contains("Hello world"))
    close(opened.docId)
    assertTrue(engine.sources.copyDir.listFiles().orEmpty().isEmpty())
  }

  @Test
  fun failedContentOpenLeavesNoCopy() {
    val garbage = File(fixtures, "garbage.pdf").apply { writeBytes(ByteArray(512) { 7 }) }
    assertEquals(ErrorCode.CORRUPT_FILE.name, failureCode { engine.open(contentUri(garbage), null) })
    val locked = encrypted("locked.pdf", owner = "o", user = "u")
    assertEquals(ErrorCode.PASSWORD_REQUIRED.name, failureCode { engine.open(contentUri(locked), null) })
    assertTrue(engine.sources.copyDir.listFiles().orEmpty().isEmpty())
  }

  @Test
  fun missingContentUriIsNotFound() {
    val gone = File(fixtures, "gone.pdf").apply { writeBytes(simple().readBytes()) }
    val uri = contentUri(gone)
    assertTrue(gone.delete())
    assertEquals(ErrorCode.NOT_FOUND.name, failureCode { engine.open(uri, null) })
  }

  // endregion

  // region close

  @Test
  fun closeIsIdempotentAndUnknownIdsAreHarmless() {
    val opened = open(simple().path)
    close(opened.docId)
    close(opened.docId)
    close("never-opened")
    assertEquals(ERR_DOC_NOT_OPEN, failureCode { engine.pageText(opened.docId, 0) })
    assertEquals(ERR_DOC_NOT_OPEN, failureCode { engine.outline(opened.docId) })
    assertEquals(ERR_DOC_NOT_OPEN, failureCode { engine.textRects("never-opened", 0) })
  }

  @Test
  fun openCloseLoopLeaksNothing() {
    val file = simple()
    val uriFile = simple("via-uri.pdf")
    // Warm up PDFium's lazily allocated globals before measuring.
    repeat(5) { close(open(file.path).docId) }
    System.gc()
    val before = Debug.getNativeHeapAllocatedSize()
    repeat(300) { i ->
      val opened = open(if (i % 3 == 0) contentUri(uriFile) else file.path)
      runBlocking { engine.textRects(opened.docId, 0) }
      close(opened.docId)
    }
    System.gc()
    val growth = Debug.getNativeHeapAllocatedSize() - before
    Log.i(TAG, "native heap growth after 300 open/close cycles: $growth bytes")
    assertEquals(0, engine.openDocumentCount)
    assertTrue(engine.sources.copyDir.listFiles().orEmpty().isEmpty())
    assertTrue("native heap grew by $growth bytes", growth < 16L * 1024 * 1024)
  }

  @Test
  fun destroyClosesEverythingAndRefusesNewDocuments() {
    val a = open(simple().path)
    val b = open(contentUri(simple("b.pdf")))
    engine.destroy()
    // Teardown runs on the PDFium thread; wait for it to drain.
    runBlocking { kotlinx.coroutines.withContext(PdfiumThread.dispatcher) {} }
    assertEquals(0, engine.openDocumentCount)
    assertTrue(engine.sources.copyDir.listFiles().orEmpty().isEmpty())
    assertEquals(ERR_DOC_NOT_OPEN, failureCode { engine.pageText(a.docId, 0) })
    assertEquals(ERR_DOC_NOT_OPEN, failureCode { engine.pageText(b.docId, 0) })
    assertEquals(ErrorCode.CANCELLED.name, failureCode { engine.open(simple("c.pdf").path, null) })
    assertEquals(0, engine.openDocumentCount)
  }

  // endregion

  // region pages and text

  @Test
  fun largeDocumentOpensWithEveryPage() {
    val file = manyPages(600)
    val start = SystemClock.elapsedRealtime()
    val opened = open(file.path)
    Log.i(TAG, "open of 600 pages took ${SystemClock.elapsedRealtime() - start} ms")
    assertEquals(600, opened.sizes.size)
    assertTrue(opened.sizes.all { it == PageSize(612.0, 792.0) })
    assertEquals("Page 600 needle", runBlocking { engine.pageText(opened.docId, 599) }.trim())
    close(opened.docId)
  }

  /**
   * ~3,000 characters per page, 300 pages. Open must not parse pages
   * (FPDF_GetPageSizeByIndexF, see nativePageSizes in pdfengine_jni.cpp for
   * the PDFium source evidence), so it must take well under the time of
   * loading every page: asserted below 25% (measured about 2%).
   */
  @Test
  fun denseDocumentOpensWithoutLoadingPages() {
    val line = "The quick brown fox jumps over the lazy dog while seventy-five chars fill it."
    val file = write("dense-300.pdf") { document ->
      repeat(300) { index ->
        val page = PDPage(PDRectangle.LETTER)
        document.addPage(page)
        PDPageContentStream(document, page).use { content ->
          content.beginText()
          content.setFont(PDType1Font.HELVETICA, 8f)
          content.setLeading(17f)
          content.newLineAtOffset(36f, 750f)
          repeat(40) { row ->
            content.showText("$index.$row $line")
            content.newLine()
          }
          content.endText()
        }
      }
    }
    val start = SystemClock.elapsedRealtime()
    val opened = open(file.path)
    val openMs = SystemClock.elapsedRealtime() - start
    assertEquals(300, opened.sizes.size)
    val loadStart = SystemClock.elapsedRealtime()
    var chars = 0
    for (page in 0 until 300) chars += runBlocking { engine.pageText(opened.docId, page) }.length
    val loadMs = SystemClock.elapsedRealtime() - loadStart
    Log.i(TAG, "dense 300 pages (${chars / 300} chars/page): open $openMs ms; loading every page for text $loadMs ms")
    assertTrue(chars / 300 >= 2_500)
    // Ratio check, with a floor so a fast device where both times are tiny cannot flake.
    assertTrue("open took $openMs ms vs $loadMs ms to load every page", openMs < 50 || openMs * 4 < loadMs)
    close(opened.docId)
  }

  @Test
  fun unloadablePageFailsAloneAndSearchSkipsIt() {
    val file = write("bad-page.pdf") { document ->
      repeat(3) { document.textPage("Page needle ${it + 1}") }
      // Replace the second page object with a number: /Count still says 3, so
      // PDFium reports three pages but cannot load the second one.
      val kids = document.documentCatalog.pages.cosObject.getDictionaryObject(COSName.KIDS) as COSArray
      kids.set(1, COSInteger.get(7))
    }
    val opened = open(file.path)
    assertEquals(3, opened.sizes.size)
    assertEquals(PageGeometry.FALLBACK_SIZE, opened.sizes[1])
    assertEquals(ErrorCode.CORRUPT_FILE.name, failureCode { engine.pageText(opened.docId, 1) })
    assertEquals(ErrorCode.CORRUPT_FILE.name, failureCode { engine.textRects(opened.docId, 1) })
    assertTrue(runBlocking { engine.pageText(opened.docId, 2) }.contains("needle 3"))
    engine.startSearch(opened.docId, "needle", matchCase = false, wholeWord = false) {}
    val done = listener.awaitDone()
    assertNull(done.errorCode)
    assertEquals(2, done.totalMatches)
    assertEquals(listOf(0, 2), listener.results.map { it.second })
    assertEquals(3, listener.progress.last().second)
    close(opened.docId)
  }

  @Test
  fun imageOnlyPageHasNoText() {
    val file = write("scan.pdf") { document ->
      val page = PDPage(PDRectangle.A4)
      document.addPage(page)
      val bitmap = Bitmap.createBitmap(200, 280, Bitmap.Config.ARGB_8888).apply { eraseColor(Color.GRAY) }
      val image = LosslessFactory.createFromImage(document, bitmap)
      bitmap.recycle()
      PDPageContentStream(document, page).use { it.drawImage(image, 0f, 0f, page.mediaBox.width, page.mediaBox.height) }
    }
    val opened = open(file.path)
    assertEquals("", runBlocking { engine.pageText(opened.docId, 0) })
    val rects = runBlocking { engine.textRects(opened.docId, 0) }
    assertEquals("", rects.text)
    assertEquals(0, rects.boxes.size)
    close(opened.docId)
  }

  @Test
  fun textAndBoxesAreAligned() {
    val opened = open(simple().path)
    val text = runBlocking { engine.pageText(opened.docId, 0) }
    val rects = runBlocking { engine.textRects(opened.docId, 0) }
    assertEquals(text, rects.text)
    assertEquals(rects.text.length * 4, rects.boxes.size)
    assertTrue(rects.boxes.all { it in 0.0..1.0 })
    // 'H' is drawn at x = 100 pt, baseline y = 700 pt on a 612 x 792 page.
    val h = rects.text.indexOf('H')
    assertTrue(h >= 0)
    assertWordBox(rects, h)
    close(opened.docId)
  }

  /** The glyph at [index] starts near x = 100/612 with its line between y = 700 and 724 pt. */
  private fun assertWordBox(rects: PageTextRects, index: Int, boxLeft: Double = 0.0, boxTop: Double = 792.0, boxW: Double = 612.0, boxH: Double = 792.0) {
    val x = rects.boxes[index * 4]
    val y = rects.boxes[index * 4 + 1]
    val w = rects.boxes[index * 4 + 2]
    val h = rects.boxes[index * 4 + 3]
    val expectedX = (100.0 - boxLeft) / boxW
    assertEquals("x", expectedX, x, 3.0 / boxW)
    assertTrue("width $w", w > 0.0 && w < 30.0 / boxW)
    // Top of the box is above the baseline, within one font size of it.
    val baselineY = (boxTop - 700.0) / boxH
    assertTrue("top $y vs baseline $baselineY", y < baselineY && y > baselineY - 30.0 / boxH)
    assertTrue("bottom ${y + h} vs baseline $baselineY", y + h > baselineY - 2.0 / boxH && y + h < baselineY + 12.0 / boxH)
  }

  @Test
  fun rotatedPagesReportRotationAndUnrotatedCoordinates() {
    val file = write("rotated.pdf") { document ->
      for (rotation in listOf(0, 90, 180, 270)) document.textPage("Hello").setRotation(rotation)
    }
    val opened = open(file.path)
    // Open reports the displayed size: swapped for 90 and 270.
    val portrait = PageSize(612.0, 792.0)
    val landscape = PageSize(792.0, 612.0)
    assertEquals(listOf(portrait, landscape, portrait, landscape), opened.sizes)
    for ((page, rotation) in listOf(0, 90, 180, 270).withIndex()) {
      val rects = runBlocking { engine.textRects(opened.docId, page) }
      assertEquals(rotation, rects.rotation)
      assertTrue(rects.text.startsWith("Hello"))
      // Boxes stay in the unrotated page space whatever the rotation.
      assertWordBox(rects, 0)
    }
    close(opened.docId)
  }

  /** The first rect of a search hit for text drawn at (100, 700) with 24 pt Helvetica. */
  private fun assertHitRect(rect: NormalizedRect, boxLeft: Double, boxTop: Double, boxW: Double, boxH: Double) {
    assertEquals("x", (100.0 - boxLeft) / boxW, rect.x, 3.0 / boxW)
    val baselineY = (boxTop - 700.0) / boxH
    assertTrue("top ${rect.y} vs baseline $baselineY", rect.y < baselineY && rect.y > baselineY - 30.0 / boxH)
    assertTrue("width ${rect.width}", rect.width > 0.0 && rect.width < 120.0 / boxW)
    assertTrue("height ${rect.height}", rect.height > 0.0 && rect.height < 40.0 / boxH)
  }

  @Test
  fun searchRectsOnRotatedAndCroppedPages() {
    val file = write("search-geometry.pdf") { document ->
      document.textPage("needle").setRotation(90)
      document.textPage("needle").setRotation(270)
      document.textPage("needle").setCropBox(PDRectangle(50f, 400f, 300f, 400f))
    }
    val opened = open(file.path)
    engine.startSearch(opened.docId, "needle", matchCase = false, wholeWord = false) {}
    val done = listener.awaitDone()
    assertEquals(3, done.totalMatches)
    assertEquals(mapOf(0 to 90, 1 to 270, 2 to 0), listener.rotations.toMap())
    val byPage = listener.results.associate { it.second to it.third.single().first() }
    assertHitRect(byPage.getValue(0), boxLeft = 0.0, boxTop = 792.0, boxW = 612.0, boxH = 792.0)
    assertHitRect(byPage.getValue(1), boxLeft = 0.0, boxTop = 792.0, boxW = 612.0, boxH = 792.0)
    assertHitRect(byPage.getValue(2), boxLeft = 50.0, boxTop = 792.0, boxW = 300.0, boxH = 392.0)
    close(opened.docId)
  }

  @Test
  fun mixedPageSizesAndCropBoxesWithAnOffset() {
    val file = write("mixed.pdf") { document ->
      document.textPage("Letter")
      document.textPage("A4", PDRectangle.A4)
      document.textPage("Wide", PDRectangle(842f, 595f))
      // Crop box from (50, 400) to (350, 800), clipped by the Letter media box to y = 792.
      document.textPage("Hello", PDRectangle.LETTER).setCropBox(PDRectangle(50f, 400f, 300f, 400f))
    }
    val opened = open(file.path)
    val sizes = opened.sizes.map { Math.round(it.width) to Math.round(it.height) }
    assertEquals(listOf(612L to 792L, 595L to 842L, 842L to 595L, 300L to 392L), sizes)
    // The crop box origin (50, 400) only shows up in coordinate conversion.
    val rects = runBlocking { engine.textRects(opened.docId, 3) }
    assertEquals(0, rects.rotation)
    assertWordBox(rects, 0, boxLeft = 50.0, boxTop = 792.0, boxW = 300.0, boxH = 392.0)
    close(opened.docId)
  }

  @Test
  fun acroFormDocumentsOpenAndReadText() {
    val file = write("form.pdf") { document ->
      val page = document.textPage("Name:")
      val form = PDAcroForm(document)
      document.documentCatalog.acroForm = form
      val field = PDTextField(form)
      field.partialName = "name"
      val widget = field.widgets[0]
      widget.rectangle = PDRectangle(200f, 690f, 200f, 30f)
      widget.page = page
      page.annotations.add(widget)
      form.fields = listOf(field)
    }
    val opened = open(file.path)
    assertEquals(1, opened.sizes.size)
    assertTrue(runBlocking { engine.pageText(opened.docId, 0) }.contains("Name:"))
    close(opened.docId)
  }

  @Test
  fun pageIndexIsValidated() {
    val opened = open(simple().path)
    assertEquals(ERR_INVALID_ARGUMENT, failureCode { engine.pageText(opened.docId, 1) })
    assertEquals(ERR_INVALID_ARGUMENT, failureCode { engine.pageText(opened.docId, -1) })
    assertEquals(ERR_INVALID_ARGUMENT, failureCode { engine.textRects(opened.docId, 5) })
    close(opened.docId)
  }

  // endregion

  // region outline

  @Test
  fun nestedOutlineWithGoToAndUriActions() {
    val file = write("outline.pdf") { document ->
      val pages = (1..3).map { document.textPage("Page $it") }
      val outline = PDDocumentOutline()
      document.documentCatalog.documentOutline = outline
      fun dest(page: PDPage) = PDPageFitDestination().apply { setPage(page) }
      val chapter1 = PDOutlineItem().apply { title = "Chapter 1"; destination = dest(pages[0]) }
      val section = PDOutlineItem().apply { title = "Section 1.1"; action = PDActionGoTo().apply { destination = dest(pages[1]) } }
      val web = PDOutlineItem().apply { title = "Website"; action = PDActionURI().apply { uri = "https://example.com" } }
      val chapter2 = PDOutlineItem().apply { title = "Chapter 2"; destination = dest(pages[2]) }
      chapter1.addLast(section)
      chapter1.addLast(web)
      outline.addLast(chapter1)
      outline.addLast(chapter2)
    }
    val opened = open(file.path)
    val expected = listOf(
      OutlineNode(
        "Chapter 1",
        0,
        listOf(OutlineNode("Section 1.1", 1, emptyList()), OutlineNode("Website", null, emptyList())),
      ),
      OutlineNode("Chapter 2", 2, emptyList()),
    )
    assertEquals(expected, runBlocking { engine.outline(opened.docId) })
    close(opened.docId)
  }

  @Test
  fun documentWithoutOutlineHasAnEmptyOne() {
    val opened = open(simple().path)
    assertEquals(emptyList<OutlineNode>(), runBlocking { engine.outline(opened.docId) })
    close(opened.docId)
  }

  // endregion

  // region search

  private fun search(docId: String, query: String, matchCase: Boolean = false, wholeWord: Boolean = false, beforeStart: (String) -> Unit = {}) =
    engine.startSearch(docId, query, matchCase, wholeWord, beforeStart)

  @Test
  fun searchStreamsEveryPageAndFinishesOnce() {
    val opened = open(manyPages(600).path)
    val id = search(opened.docId, "NEEDLE")
    val done = listener.awaitDone()
    assertEquals(id, done.searchId)
    assertNull(done.errorCode)
    assertEquals(600, done.totalMatches)
    assertEquals((0 until 600).toList(), listener.results.map { it.second })
    assertTrue(listener.results.all { it.first == id && it.third.size == 1 && it.third[0].isNotEmpty() })
    val rect = listener.results[0].third[0][0]
    assertTrue(rect.x in 0.0..1.0 && rect.y in 0.0..1.0 && rect.width > 0.0 && rect.height > 0.0)
    val searched = listener.progress.map { it.second }
    assertEquals(searched.sorted(), searched)
    assertEquals(600, searched.last())
    assertTrue(listener.progress.all { it.third == 600 })
    close(opened.docId)
  }

  @Test
  fun searchHonoursMatchCaseAndWholeWord() {
    val opened = open(simple(text = "Cat cat category").path)
    search(opened.docId, "cat", matchCase = true, wholeWord = true)
    val done = listener.awaitDone()
    assertEquals(1, done.totalMatches)
    close(opened.docId)
  }

  @Test
  fun blankQueryFinishesAtOnceWithNothing() {
    val opened = open(simple().path)
    search(opened.docId, "   ")
    val done = listener.awaitDone()
    assertEquals(0, done.totalMatches)
    assertNull(done.errorCode)
    assertTrue(listener.results.isEmpty())
    close(opened.docId)
  }

  @Test
  fun unknownDocumentCannotBeSearched() {
    assertEquals(ERR_DOC_NOT_OPEN, failureCode { search("nope", "x") })
    assertTrue(listener.done.isEmpty())
  }

  @Test
  fun cancelStopsARunningSearch() {
    val opened = open(manyPages(600).path)
    val id = search(opened.docId, "needle")
    assertTrue(listener.firstResult.await(30, TimeUnit.SECONDS))
    engine.cancelSearch(id)
    val done = listener.awaitDone()
    assertEquals(ErrorCode.CANCELLED.name, done.errorCode)
    assertTrue(done.totalMatches < 600)
    engine.cancelSearch(id)
    close(opened.docId)
  }

  @Test
  fun cancelBeforeStartStillReportsDone() {
    val opened = open(simple().path)
    search(opened.docId, "Hello") { id -> engine.cancelSearch(id) }
    val done = listener.awaitDone()
    assertEquals(ErrorCode.CANCELLED.name, done.errorCode)
    assertEquals(0, done.totalMatches)
    close(opened.docId)
  }

  @Test
  fun closeCancelsTheDocumentsSearch() {
    val opened = open(manyPages(600).path)
    search(opened.docId, "needle")
    assertTrue(listener.firstResult.await(30, TimeUnit.SECONDS))
    close(opened.docId)
    val done = listener.awaitDone()
    assertEquals(ErrorCode.CANCELLED.name, done.errorCode)
  }

  // endregion

  private companion object {
    const val TAG = "ReaderEngineTest"
  }
}
