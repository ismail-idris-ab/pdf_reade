package com.ismailidris.pdfreader.fileindex

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class NameRulesTest {
  @Test
  fun acceptsOrdinaryNamesAndTrimsSurroundingWhitespace() {
    assertEquals("Invoice 2024.pdf", NameRules.normalize("Invoice 2024.pdf"))
    assertEquals("Fàcture été.pdf", NameRules.normalize("  Fàcture été.pdf "))
    assertEquals("a.tar.gz", NameRules.normalize("a.tar.gz"))
    assertEquals("v1.0.", NameRules.normalize("v1.0."))
  }

  @Test
  fun rejectsEmptyAndDotNames() {
    assertNull(NameRules.normalize(""))
    assertNull(NameRules.normalize("   "))
    assertNull(NameRules.normalize("."))
    assertNull(NameRules.normalize(".."))
    assertNull(NameRules.normalize(" .. "))
  }

  @Test
  fun rejectsLeadingDotNames() {
    assertNull(NameRules.normalize(".hidden"))
    assertNull(NameRules.normalize("..."))
    assertNull(NameRules.normalize(" .pdf"))
    assertNull(NameRules.normalize(".rename-1-abc"))
    try {
      NameRules.requireValid(".env")
      fail("expected failure")
    } catch (e: FileOpFailure) {
      assertEquals(FileOpCodes.ERR_NAME_INVALID, e.code)
    }
  }

  @Test
  fun rejectsSeparatorsNulControlAndFatCharacters() {
    for (bad in listOf("a/b", "a\u0000b", "a\nb", "a\u007fb", "a\\b", "a:b", "a*b", "a?b", "a\"b", "a<b", "a>b", "a|b")) {
      assertNull(bad, NameRules.normalize(bad))
    }
  }

  @Test
  fun enforcesUtf8ByteLimit() {
    assertEquals(255, NameRules.normalize("a".repeat(255))?.length)
    assertNull(NameRules.normalize("a".repeat(256)))
    // "é" is 2 bytes in UTF-8: 127 of them (254 bytes) fit, 128 (256 bytes) do not.
    assertEquals(127, NameRules.normalize("é".repeat(127))?.length)
    assertNull(NameRules.normalize("é".repeat(128)))
  }

  @Test
  fun requireValidThrowsNameInvalid() {
    try {
      NameRules.requireValid("a/b")
      fail("expected failure")
    } catch (e: FileOpFailure) {
      assertEquals(FileOpCodes.ERR_NAME_INVALID, e.code)
    }
  }

  @Test
  fun splitsOnlyTheLastExtension() {
    assertEquals("a.tar" to ".gz", NameRules.splitExtension("a.tar.gz"))
    assertEquals("report" to ".pdf", NameRules.splitExtension("report.pdf"))
    assertEquals("README" to "", NameRules.splitExtension("README"))
    assertEquals(".bashrc" to "", NameRules.splitExtension(".bashrc"))
    assertEquals("name." to "", NameRules.splitExtension("name."))
  }

  @Test
  fun moveCandidates() {
    assertEquals("Doc.pdf", NameRules.candidate("Doc.pdf", NameRules.Style.MOVE, 0))
    assertEquals("Doc (1).pdf", NameRules.candidate("Doc.pdf", NameRules.Style.MOVE, 1))
    assertEquals("Doc (2).pdf", NameRules.candidate("Doc.pdf", NameRules.Style.MOVE, 2))
    assertEquals("Notes (1)", NameRules.candidate("Notes", NameRules.Style.MOVE, 1))
    assertEquals("a.tar (1).gz", NameRules.candidate("a.tar.gz", NameRules.Style.MOVE, 1))
  }

  @Test
  fun copyCandidates() {
    assertEquals("Doc (copy).pdf", NameRules.candidate("Doc.pdf", NameRules.Style.COPY, 0))
    assertEquals("Doc (copy 2).pdf", NameRules.candidate("Doc.pdf", NameRules.Style.COPY, 1))
    assertEquals("Doc (copy 3).pdf", NameRules.candidate("Doc.pdf", NameRules.Style.COPY, 2))
    assertEquals("Notes (copy)", NameRules.candidate("Notes", NameRules.Style.COPY, 0))
    assertEquals("a.tar (copy).gz", NameRules.candidate("a.tar.gz", NameRules.Style.COPY, 0))
  }

  @Test
  fun candidatesStayWithinTheByteLimit() {
    val long = "x".repeat(251) + ".pdf"
    val moved = NameRules.candidate(long, NameRules.Style.MOVE, 12)
    assertEquals(255, moved.toByteArray(Charsets.UTF_8).size)
    assertTrue(moved.endsWith(" (12).pdf"))
    val copied = NameRules.candidate("é".repeat(125) + ".pdf", NameRules.Style.COPY, 0)
    assertTrue(copied.toByteArray(Charsets.UTF_8).size <= 255)
    assertTrue(copied.endsWith(" (copy).pdf"))
  }

  @Test
  fun freeNameSkipsTakenNames() {
    val taken = setOf("Doc.pdf", "Doc (1).pdf", "Doc (2).pdf")
    assertEquals("Doc (3).pdf", NameRules.freeName("Doc.pdf", NameRules.Style.MOVE) { it in taken })
    assertEquals("Other.pdf", NameRules.freeName("Other.pdf", NameRules.Style.MOVE) { it in taken })

    val copies = setOf("Doc (copy).pdf", "Doc (copy 2).pdf")
    assertEquals("Doc (copy 3).pdf", NameRules.freeName("Doc.pdf", NameRules.Style.COPY) { it in copies })
    assertEquals("Doc (copy).pdf", NameRules.freeName("Doc.pdf", NameRules.Style.COPY) { false })
  }

  @Test
  fun freeNameGivesUpAfterTheAttemptLimit() {
    try {
      NameRules.freeName("Doc.pdf", NameRules.Style.MOVE) { true }
      fail("expected failure")
    } catch (e: FileOpFailure) {
      assertEquals(FileOpCodes.ERR_FILE_OP_FAILED, e.code)
    }
  }

  @Test
  fun tempNamesAreHiddenAndRecognised() {
    val temp = NameRules.tempName("Doc.pdf", 1_700_000_000_000, "abc123")
    assertTrue(temp.startsWith("."))
    assertTrue(NameRules.isTempName(temp))
    assertTrue(temp.toByteArray(Charsets.UTF_8).size <= 255)
    val longTemp = NameRules.tempName("x".repeat(255), Long.MAX_VALUE, "abcdef123456")
    assertTrue(longTemp.toByteArray(Charsets.UTF_8).size <= 255)
    assertFalse(NameRules.isTempName("Doc.pdf"))
    assertFalse(NameRules.isTempName(".hidden"))
    assertFalse(NameRules.isTempName("report.tmp-1.pdf"))
  }

  @Test
  fun tempNamesCarryTheirCreationTime() {
    assertEquals(1_700_000_000_000L, NameRules.tempCreatedAt(NameRules.tempName("a.tmp-9-x.pdf", 1_700_000_000_000, "abc")))
    assertEquals(null, NameRules.tempCreatedAt(".a.pdf.tmp-notanumber-abc"))
    assertEquals(null, NameRules.tempCreatedAt("a.pdf.tmp-123-abc"))
    assertEquals(null, NameRules.tempCreatedAt("Doc.pdf"))
  }

  @Test
  fun renameTempsAreHiddenButNeverStale() {
    val temp = NameRules.renameTempName(1_700_000_000_000, "abc")
    assertTrue(temp.startsWith("."))
    assertTrue(NameRules.isTempName(temp))
    // Not a copy temp: the stale-copy cleanup never applies to it.
    assertNull(NameRules.tempCreatedAt(temp))
  }
}
