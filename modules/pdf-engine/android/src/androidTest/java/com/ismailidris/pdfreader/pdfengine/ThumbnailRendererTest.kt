package com.ismailidris.pdfreader.pdfengine

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import androidx.test.platform.app.InstrumentationRegistry
import com.tom_roush.pdfbox.android.PDFBoxResourceLoader
import com.tom_roush.pdfbox.pdmodel.PDDocument
import com.tom_roush.pdfbox.pdmodel.PDPage
import com.tom_roush.pdfbox.pdmodel.PDPageContentStream
import com.tom_roush.pdfbox.pdmodel.common.PDRectangle
import com.tom_roush.pdfbox.pdmodel.encryption.AccessPermission
import com.tom_roush.pdfbox.pdmodel.encryption.StandardProtectionPolicy
import expo.modules.kotlin.exception.CodedException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import java.io.File
import java.util.Collections
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/**
 * Engine-level tests for thumbnails against real PDFium, BitmapFactory and
 * the app cache dir. Fixtures are generated with PdfBox-Android per test.
 */
class ThumbnailRendererTest {
  private lateinit var context: Context
  private lateinit var fixtures: File
  private lateinit var renderer: ThumbnailRenderer

  @Before
  fun setUp() {
    context = InstrumentationRegistry.getInstrumentation().targetContext
    PDFBoxResourceLoader.init(context)
    fixtures = File(context.cacheDir, "thumb-fixtures").apply {
      deleteRecursively()
      mkdirs()
    }
    renderer = ThumbnailRenderer(context)
    renderer.cacheDir.deleteRecursively()
  }

  @After
  fun tearDown() {
    fixtures.deleteRecursively()
    renderer.cacheDir.deleteRecursively()
  }

  // region fixtures

  /** One page; optional black bands across the top and bottom 10% of the page. */
  private fun pdf(
    name: String,
    widthPt: Float = PDRectangle.A4.width,
    heightPt: Float = PDRectangle.A4.height,
    topBand: Boolean = true,
    bottomBand: Boolean = false,
    userPassword: String? = null,
  ): File {
    val file = File(fixtures, name)
    PDDocument().use { document ->
      val page = PDPage(PDRectangle(widthPt, heightPt))
      document.addPage(page)
      PDPageContentStream(document, page).use { content ->
        content.setNonStrokingColor(0f, 0f, 0f)
        // PDF user space has its origin bottom-left.
        if (topBand) content.addRect(0f, heightPt * 0.9f, widthPt, heightPt * 0.1f)
        if (bottomBand) content.addRect(0f, 0f, widthPt, heightPt * 0.1f)
        content.fill()
      }
      if (userPassword != null) {
        val policy = StandardProtectionPolicy("owner-$userPassword", userPassword, AccessPermission())
        policy.encryptionKeyLength = 128
        document.protect(policy)
      }
      document.save(file)
    }
    return file
  }

  private fun job(source: String, width: Int = 120) =
    ThumbnailJob(ThumbnailMath.cacheKey(source, 1L, 2L, width), source, width)

  private fun renderBlocking(job: ThumbnailJob): Bitmap = runBlocking { renderer.render(job) }

  private fun renderFailureCode(job: ThumbnailJob): String {
    try {
      renderBlocking(job).recycle()
    } catch (e: Throwable) {
      return renderer.mapFailure(e).code
    }
    fail("Expected the render to fail")
    throw AssertionError("unreachable")
  }

  private fun isDark(pixel: Int) = Color.red(pixel) < 64 && Color.green(pixel) < 64 && Color.blue(pixel) < 64

  private fun isWhite(pixel: Int) = Color.red(pixel) > 240 && Color.green(pixel) > 240 && Color.blue(pixel) > 240

  // endregion

  @Test
  fun validPdfWritesAWebpWithTheExpectedSize() {
    val job = job(pdf("a4.pdf").path)
    val bitmap = renderBlocking(job)
    val result = try {
      assertEquals(120, bitmap.width)
      assertEquals(170, bitmap.height)
      renderer.write(bitmap, job)
    } finally {
      renderer.release(bitmap)
    }
    assertTrue(result.file.isFile)
    assertEquals("${job.key}.webp", result.file.name)
    assertEquals(120, result.width)
    assertEquals(170, result.height)
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(result.file.path, bounds)
    assertEquals(120, bounds.outWidth)
    assertEquals(170, bounds.outHeight)
    assertEquals("image/webp", bounds.outMimeType)
    assertTrue(result.toMap()["uri"].toString().startsWith("file:///"))
  }

  @Test
  fun rendersPageContentOnWhite() {
    val bitmap = renderBlocking(job(pdf("a4.pdf").path))
    try {
      // Top band is black, the middle of the page is white background.
      assertTrue(isDark(bitmap.getPixel(60, 5)))
      assertTrue(isWhite(bitmap.getPixel(60, 85)))
    } finally {
      bitmap.recycle()
    }
  }

  @Test
  fun tallPagesAreTopCroppedNotSquashed() {
    // 1:10 page with black bands in its top and bottom 10%.
    val file = pdf("tall.pdf", widthPt = 100f, heightPt = 1000f, topBand = true, bottomBand = true)
    val bitmap = renderBlocking(job(file.path))
    try {
      assertEquals(120, bitmap.width)
      assertEquals(240, bitmap.height)
      // Full-page scale is 1.2 px/pt, so the top band covers rows 0..119.
      assertTrue(isDark(bitmap.getPixel(60, 10)))
      assertTrue(isDark(bitmap.getPixel(60, 110)))
      // Below the top band is white; a squashed render would show the bottom
      // band in the last rows instead.
      assertTrue(isWhite(bitmap.getPixel(60, 130)))
      assertTrue(isWhite(bitmap.getPixel(60, 236)))
    } finally {
      bitmap.recycle()
    }
  }

  @Test
  fun encryptedPdfIsPasswordRequired() {
    val file = pdf("locked.pdf", userPassword = "secret")
    assertEquals(ErrorCode.PASSWORD_REQUIRED.name, renderFailureCode(job(file.path)))
  }

  @Test
  fun garbageBytesAreCorrupt() {
    val file = File(fixtures, "garbage.pdf").apply { writeBytes(ByteArray(4096) { (it * 31).toByte() }) }
    assertEquals(ErrorCode.CORRUPT_FILE.name, renderFailureCode(job(file.path)))
  }

  @Test
  fun missingFileIsNotFound() {
    assertEquals(ErrorCode.NOT_FOUND.name, renderFailureCode(job(File(fixtures, "missing.pdf").path)))
    assertEquals(ErrorCode.NOT_FOUND.name, renderFailureCode(job("file://" + File(fixtures, "missing.pdf").path)))
  }

  @Test
  fun errorMessagesNeverContainThePath() {
    val missing = File(fixtures, "secret-name.pdf").path
    try {
      renderBlocking(job(missing)).recycle()
      fail("Expected the render to fail")
    } catch (e: CodedException) {
      assertFalse(e.message.orEmpty().contains("secret-name"))
      assertNull(e.cause)
    }
  }

  @Test
  fun cachedReturnsTheWrittenFileAndTouchesIt() {
    val job = job(pdf("a4.pdf").path)
    assertNull(renderer.cached(job))
    val bitmap = renderBlocking(job)
    val written = try {
      renderer.write(bitmap, job)
    } finally {
      renderer.release(bitmap)
    }
    assertTrue(written.file.setLastModified(1_000_000L))
    val hit = renderer.cached(job)
    assertNotNull(hit)
    assertEquals(written.file, hit!!.file)
    assertEquals(120, hit.width)
    assertEquals(170, hit.height)
    assertTrue(hit.file.lastModified() > 1_000_000L)
  }

  @Test
  fun unreadableCacheFileIsDroppedAsAMiss() {
    val job = job(pdf("a4.pdf").path)
    renderer.cacheDir.mkdirs()
    val file = renderer.cacheFile(job.key).apply { writeText("not an image") }
    assertNull(renderer.cached(job))
    assertFalse(file.exists())
  }

  @Test
  fun failedWriteLeavesNoFinalOrTempFile() {
    val job = job(pdf("a4.pdf").path)
    val bitmap = renderBlocking(job)
    bitmap.recycle()
    // Compressing a recycled bitmap throws mid-write.
    try {
      renderer.write(bitmap, job)
      fail("Expected the write to fail")
    } catch (expected: IllegalStateException) {
      // The failure itself is the point; the directory is checked below.
    }
    assertFalse(renderer.cacheFile(job.key).exists())
    val leftovers = renderer.cacheDir.listFiles().orEmpty().filter { it.isFile }
    assertTrue("Leftover files: ${leftovers.map { it.name }}", leftovers.isEmpty())
  }

  @Test
  fun trimEvictsLeastRecentlyUsedDownToEightyPercentOfTheCap() {
    val small = ThumbnailRenderer(context, cacheCapBytes = 3_000L)
    small.cacheDir.mkdirs()
    val now = System.currentTimeMillis()
    val files = (0 until 5).map { i ->
      File(small.cacheDir, "k$i.webp").apply {
        writeBytes(ByteArray(1_000))
        assertTrue(setLastModified(now - (5 - i) * 60_000L))
      }
    }
    val unrelated = File(small.cacheDir, "notes.bin").apply { writeBytes(ByteArray(10_000)) }
    small.trim()
    // 5,000 > 3,000: the three oldest go, leaving 2,000 <= 2,400.
    assertEquals(listOf(false, false, false, true, true), files.map { it.exists() })
    assertTrue(unrelated.exists())
  }

  @Test
  fun trimLeavesACacheUnderTheCapAlone() {
    val small = ThumbnailRenderer(context, cacheCapBytes = 3_000L)
    small.cacheDir.mkdirs()
    val files = (0 until 3).map { i -> File(small.cacheDir, "k$i.webp").apply { writeBytes(ByteArray(1_000)) } }
    small.trim()
    assertTrue(files.all { it.exists() })
  }

  @Test
  fun trimDeletesTempFilesOlderThanAnHour() {
    renderer.cacheDir.mkdirs()
    val copies = File(renderer.cacheDir, ThumbnailRenderer.COPY_DIR_NAME).apply { mkdirs() }
    val now = System.currentTimeMillis()
    val twoHoursAgo = now - 2 * 60 * 60 * 1000L
    val staleTemp = File(renderer.cacheDir, "abc.123.tmp").apply { writeText("x"); setLastModified(twoHoursAgo) }
    val freshTemp = File(renderer.cacheDir, "abc.456.tmp").apply { writeText("x") }
    val staleCopy = File(copies, "source.1.pdf").apply { writeText("x"); setLastModified(twoHoursAgo) }
    val freshCopy = File(copies, "source.2.pdf").apply { writeText("x") }
    val oldThumb = File(renderer.cacheDir, "old.webp").apply { writeText("x"); setLastModified(twoHoursAgo) }
    renderer.trim()
    assertFalse(staleTemp.exists())
    assertTrue(freshTemp.exists())
    assertFalse(staleCopy.exists())
    assertTrue(freshCopy.exists())
    // Thumbnails are only evicted by size, never by age.
    assertTrue(oldThumb.exists())
  }

  @Test
  fun coordinatorServesTheSecondRequestFromCacheWithoutRendering() {
    val renders = AtomicInteger(0)
    val counting = object : ThumbnailStages<Bitmap> by renderer {
      override suspend fun render(job: ThumbnailJob): Bitmap {
        renders.incrementAndGet()
        return renderer.render(job)
      }
    }
    val results = ConcurrentHashMap<String, String>()
    val errors: MutableList<String> = Collections.synchronizedList(ArrayList())
    val latches = mapOf("first" to CountDownLatch(1), "second" to CountDownLatch(1))
    val settler = object : ThumbnailSettler<String> {
      override fun resolve(waiter: String, result: ThumbnailResult) {
        results[waiter] = result.toMap()["uri"].toString()
        latches.getValue(waiter).countDown()
      }

      override fun reject(waiter: String, error: CodedException) {
        errors.add("$waiter:${error.code}")
        latches.getValue(waiter).countDown()
      }
    }
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    try {
      val coordinator = ThumbnailCoordinator(scope, Dispatchers.IO, counting, settler)
      val job = job(pdf("a4.pdf").path)
      coordinator.submit("r1", job, "first")
      assertTrue(latches.getValue("first").await(10, TimeUnit.SECONDS))
      coordinator.submit("r2", job, "second")
      assertTrue(latches.getValue("second").await(10, TimeUnit.SECONDS))
      assertTrue(errors.toString(), errors.isEmpty())
      assertNotNull(results["first"])
      assertEquals(results["first"], results["second"])
      assertEquals(1, renders.get())
    } finally {
      scope.cancel()
    }
  }
}
