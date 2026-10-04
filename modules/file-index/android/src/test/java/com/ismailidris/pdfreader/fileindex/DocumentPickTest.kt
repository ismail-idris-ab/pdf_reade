package com.ismailidris.pdfreader.fileindex

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DocumentPickTest {
  @Test
  fun typeFilterWithoutTypesAllowsAnything() {
    assertEquals(DocumentPick.TypeFilter("*/*", null), DocumentPick.typeFilter(emptyList()))
    assertEquals(DocumentPick.TypeFilter("*/*", null), DocumentPick.typeFilter(listOf(" ", "")))
  }

  @Test
  fun typeFilterUsesASingleTypeDirectly() {
    assertEquals(
      DocumentPick.TypeFilter("application/pdf", null),
      DocumentPick.typeFilter(listOf("application/pdf", " application/pdf ")),
    )
  }

  @Test
  fun typeFilterNarrowsAnyTypeWithSeveralTypes() {
    assertEquals(
      DocumentPick.TypeFilter("*/*", listOf("application/pdf", "image/*")),
      DocumentPick.typeFilter(listOf("application/pdf", "image/*", "application/pdf")),
    )
  }

  @Test
  fun typeFilterWithWildcardEntryAllowsAnything() {
    assertEquals(
      DocumentPick.TypeFilter("*/*", null),
      DocumentPick.typeFilter(listOf("application/pdf", "*/*")),
    )
  }

  @Test
  fun collectUrisPrefersClipItems() {
    assertEquals(
      listOf("content://a/1", "content://a/2"),
      DocumentPick.collectUris(listOf("content://a/1", null, "", "content://a/2", "content://a/1"), "content://a/1"),
    )
  }

  @Test
  fun collectUrisFallsBackToDataUri() {
    assertEquals(listOf("content://a/9"), DocumentPick.collectUris(emptyList(), "content://a/9"))
    assertEquals(listOf("content://a/9"), DocumentPick.collectUris(listOf(null, " "), "content://a/9"))
  }

  @Test
  fun collectUrisIsEmptyWithoutAnyUri() {
    assertEquals(emptyList<String>(), DocumentPick.collectUris(emptyList(), null))
    assertEquals(emptyList<String>(), DocumentPick.collectUris(listOf(null), ""))
  }

  @Test
  fun readGrantedKeepsOnlyReadGrants() {
    assertEquals(
      listOf("content://a/1", "content://a/3"),
      DocumentPick.readGranted(
        listOf("content://a/1" to true, "content://a/2" to false, "content://a/3" to true, "content://a/1" to true),
      ),
    )
  }

  @Test
  fun pickedDocumentMapsAllValues() {
    assertEquals(
      mapOf(
        "uri" to "content://a/1",
        "name" to "Invoice.pdf",
        "size" to 2048.0,
        "mime" to "application/pdf",
        "mtime" to 1_700_000_000_000.0,
        "persisted" to true,
      ),
      DocumentPick.pickedDocument("content://a/1", "Invoice.pdf", 2048L, "application/pdf", 1_700_000_000_000L, true),
    )
  }

  @Test
  fun pickedDocumentNullsMissingOrUnusableValues() {
    val item = DocumentPick.pickedDocument("content://a/1", "  ", -1L, " ", 0L, false)
    assertEquals("content://a/1", item["uri"])
    assertNull(item["name"])
    assertNull(item["size"])
    assertNull(item["mime"])
    assertNull(item["mtime"])

    val absent = DocumentPick.pickedDocument("content://a/2", null, null, null, null, false)
    assertEquals(setOf("uri", "name", "size", "mime", "mtime", "persisted"), absent.keys)
    assertNull(absent["name"])
    assertNull(absent["size"])
  }

  @Test
  fun pickedDocumentKeepsEmptyFileSize() {
    assertEquals(0.0, DocumentPick.pickedDocument("content://a/1", "a.pdf", 0L, null, null, true)["size"])
  }

  @Test
  fun pickedDocumentReportsWhetherTheGrantWasPersisted() {
    assertEquals(true, DocumentPick.pickedDocument("content://a/1", null, null, null, null, true)["persisted"])
    assertEquals(false, DocumentPick.pickedDocument("content://a/1", null, null, null, null, false)["persisted"])
  }

  @Test
  fun requestCodesCycleWithinTheirRange() {
    val base = DocumentPick.REQUEST_CODE_BASE
    val count = DocumentPick.REQUEST_CODE_COUNT
    assertEquals(base, DocumentPick.requestCodeFor(0))
    assertEquals(base + 1, DocumentPick.requestCodeFor(1))
    assertEquals(base, DocumentPick.requestCodeFor(count))
    assertEquals(base + count - 1, DocumentPick.requestCodeFor(-1))
    // AtomicInteger overflow wraps to a negative sequence: still in range.
    assertTrue(DocumentPick.isPickRequestCode(DocumentPick.requestCodeFor(Int.MIN_VALUE)))
    assertTrue(DocumentPick.isPickRequestCode(DocumentPick.requestCodeFor(Int.MAX_VALUE)))
  }

  @Test
  fun requestCodeRangeFitsSixteenBitsAndRecognisesOnlyItsCodes() {
    val last = DocumentPick.REQUEST_CODE_BASE + DocumentPick.REQUEST_CODE_COUNT - 1
    assertTrue(last <= 0xFFFF)
    assertTrue(DocumentPick.isPickRequestCode(DocumentPick.REQUEST_CODE_BASE))
    assertTrue(DocumentPick.isPickRequestCode(last))
    assertFalse(DocumentPick.isPickRequestCode(DocumentPick.REQUEST_CODE_BASE - 1))
    assertFalse(DocumentPick.isPickRequestCode(last + 1))
    assertFalse(DocumentPick.isPickRequestCode(0x00010000))
  }
}
