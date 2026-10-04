package com.ismailidris.pdfreader.fileindex

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

class FileNamesTest {
  @get:Rule
  val temp = TemporaryFolder()

  @Test
  fun keepsOrdinaryNames() {
    assertEquals("Invoice 2024.pdf", FileNames.sanitize("Invoice 2024.pdf"))
    assertEquals("Fàcture été.pdf", FileNames.sanitize("Fàcture été.pdf"))
  }

  @Test
  fun stripsSeparatorsAndControlCharacters() {
    assertEquals("etcpasswd", FileNames.sanitize("/etc/passwd"))
    assertEquals("ab.pdf", FileNames.sanitize("a\\b.pdf"))
    assertEquals("report.pdf", FileNames.sanitize("re\u0000po\nrt\u007f.pdf"))
  }

  @Test
  fun neverReturnsDotSegmentsOrHiddenNames() {
    assertEquals(FileNames.FALLBACK_NAME, FileNames.sanitize(".."))
    assertEquals(FileNames.FALLBACK_NAME, FileNames.sanitize("."))
    assertEquals(FileNames.FALLBACK_NAME, FileNames.sanitize("../.."))
    assertEquals("secret.pdf", FileNames.sanitize(".secret.pdf"))
  }

  @Test
  fun fallsBackWhenNothingUsableRemains() {
    assertEquals(FileNames.FALLBACK_NAME, FileNames.sanitize(null))
    assertEquals(FileNames.FALLBACK_NAME, FileNames.sanitize(""))
    assertEquals(FileNames.FALLBACK_NAME, FileNames.sanitize("   "))
    assertEquals(FileNames.FALLBACK_NAME, FileNames.sanitize("///"))
  }

  @Test
  fun capsLengthAndKeepsExtension() {
    val result = FileNames.sanitize("a".repeat(500) + ".pdf")
    assertTrue(result.endsWith(".pdf"))
    assertTrue(result.toByteArray(Charsets.UTF_8).size <= FileNames.MAX_NAME_BYTES)
  }

  @Test
  fun capsMultiByteNamesWithoutSplittingCodePoints() {
    val result = FileNames.sanitize("📄".repeat(100) + ".pdf")
    val bytes = result.toByteArray(Charsets.UTF_8)
    assertTrue(bytes.size <= FileNames.MAX_NAME_BYTES)
    assertTrue(result.endsWith(".pdf"))
    // Round-trips, so no surrogate was cut in half.
    assertEquals(result, String(bytes, Charsets.UTF_8))
  }

  @Test
  fun uniqueInAppendsCounterBeforeExtension() {
    val dir = temp.newFolder("share")
    assertEquals("a.pdf", FileNames.uniqueIn(dir, "a.pdf"))
    File(dir, "a.pdf").writeText("x")
    assertEquals("a (2).pdf", FileNames.uniqueIn(dir, "a.pdf"))
    File(dir, "a (2).pdf").writeText("x")
    assertEquals("a (3).pdf", FileNames.uniqueIn(dir, "a.pdf"))
    File(dir, "notes").writeText("x")
    assertEquals("notes (2)", FileNames.uniqueIn(dir, "notes"))
  }
}
