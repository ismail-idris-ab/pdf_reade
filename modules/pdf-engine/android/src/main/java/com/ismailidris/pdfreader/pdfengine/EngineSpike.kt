package com.ismailidris.pdfreader.pdfengine

import android.content.Context
import android.graphics.Bitmap
import android.os.SystemClock
import com.tom_roush.pdfbox.android.PDFBoxResourceLoader
import com.tom_roush.pdfbox.io.MemoryUsageSetting
import com.tom_roush.pdfbox.multipdf.PDFMergerUtility
import com.tom_roush.pdfbox.pdmodel.PDDocument
import com.tom_roush.pdfbox.pdmodel.PDPage
import com.tom_roush.pdfbox.pdmodel.PDPageContentStream
import com.tom_roush.pdfbox.pdmodel.common.PDRectangle
import com.tom_roush.pdfbox.pdmodel.font.PDType1Font
import java.io.File
import java.io.FileOutputStream

/**
 * T0.1b engine spike: proves PDFium rendering and PdfBox/PDFium merging inside
 * the Expo module. Dev-only; replaced by the real engine API in T2.1.
 */
internal class EngineSpike(context: Context) {
  private val workDir = File(context.cacheDir, "engine-spike")

  init {
    PDFBoxResourceLoader.init(context.applicationContext)
  }

  fun render(): Map<String, Any> {
    val start = SystemClock.elapsedRealtime()
    val fixture = createFixture("fixture-a.pdf", "Fixture A")
    val (pageCount, bitmap) = withPdfiumDocument(PdfiumNative.open(fixture.path)) { doc ->
      val count = PdfiumNative.pageCount(doc)
      val size = PdfiumNative.pageSize(doc, 0)
      // 2x PDF points, roughly 144 dpi.
      val target = Bitmap.createBitmap((size[0] * 2).toInt(), (size[1] * 2).toInt(), Bitmap.Config.ARGB_8888)
      try {
        PdfiumNative.renderPage(doc, 0, target)
      } catch (e: Exception) {
        target.recycle()
        throw e
      }
      count to target
    }
    try {
      val png = File(workDir, "fixture-a-page1.png")
      FileOutputStream(png).use {
        check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)) { "PNG encoding failed" }
      }
      return mapOf(
        "pageCount" to pageCount,
        "width" to bitmap.width,
        "height" to bitmap.height,
        "nonWhiteRatio" to nonWhiteRatio(bitmap),
        "pngPath" to png.path,
        "elapsedMs" to (SystemClock.elapsedRealtime() - start),
      )
    } finally {
      bitmap.recycle()
    }
  }

  fun merge(): Map<String, Any> {
    val a = createFixture("fixture-a.pdf", "Fixture A")
    val b = createFixture("fixture-b.pdf", "Fixture B")

    var start = SystemClock.elapsedRealtime()
    val pdfboxOut = File(workDir, "merged-pdfbox.pdf")
    PDFMergerUtility().apply {
      addSource(a)
      addSource(b)
      destinationFileName = pdfboxOut.path
      mergeDocuments(MemoryUsageSetting.setupMainMemoryOnly())
    }
    val pdfboxMs = SystemClock.elapsedRealtime() - start
    val pdfboxPages = withPdfiumDocument(PdfiumNative.open(pdfboxOut.path)) { PdfiumNative.pageCount(it) }

    start = SystemClock.elapsedRealtime()
    val pdfiumOut = File(workDir, "merged-pdfium.pdf")
    withPdfiumDocument(PdfiumNative.createDocument()) { dest ->
      for (source in listOf(a, b)) {
        withPdfiumDocument(PdfiumNative.open(source.path)) { src -> PdfiumNative.importAllPages(dest, src) }
      }
      PdfiumNative.save(dest, pdfiumOut.path)
    }
    val pdfiumMs = SystemClock.elapsedRealtime() - start
    val pdfiumPages = withPdfiumDocument(PdfiumNative.open(pdfiumOut.path)) { PdfiumNative.pageCount(it) }

    return mapOf(
      "pdfboxPages" to pdfboxPages,
      "pdfboxBytes" to pdfboxOut.length(),
      "pdfboxMs" to pdfboxMs,
      "pdfiumPages" to pdfiumPages,
      "pdfiumBytes" to pdfiumOut.length(),
      "pdfiumMs" to pdfiumMs,
    )
  }

  /** One A4 page with a title and a filled block so rendering is visibly non-blank. */
  private fun createFixture(name: String, title: String): File {
    workDir.mkdirs()
    val file = File(workDir, name)
    PDDocument().use { document ->
      val page = PDPage(PDRectangle.A4)
      document.addPage(page)
      PDPageContentStream(document, page).use { content ->
        content.setNonStrokingColor(0.12f, 0.35f, 0.78f)
        content.addRect(72f, 500f, 451f, 200f)
        content.fill()
        content.setNonStrokingColor(0f, 0f, 0f)
        content.beginText()
        content.setFont(PDType1Font.HELVETICA_BOLD, 28f)
        content.newLineAtOffset(72f, 760f)
        content.showText(title)
        content.endText()
      }
      document.save(file)
    }
    return file
  }

  private fun nonWhiteRatio(bitmap: Bitmap): Double {
    val pixels = IntArray(bitmap.width * bitmap.height)
    bitmap.getPixels(pixels, 0, bitmap.width, 0, 0, bitmap.width, bitmap.height)
    val nonWhite = pixels.count { (it and 0x00FFFFFF) != 0x00FFFFFF }
    return nonWhite.toDouble() / pixels.size
  }
}
