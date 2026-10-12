package com.ismailidris.pdfreader.pdfengine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.UUID

class DocumentRegistryTest {
  @Test
  fun addReturnsAnIdThatFindsTheEntry() {
    val registry = DocumentRegistry<String>()
    val a = registry.add("doc-a")
    val b = registry.add("doc-b")
    assertNotEquals(a, b)
    assertEquals("doc-a", registry.get(a))
    assertEquals("doc-b", registry.get(b))
    assertEquals(2, registry.size)
  }

  @Test
  fun defaultIdsAreUuids() {
    val id = DocumentRegistry<String>().add("x")
    assertEquals(id, UUID.fromString(id).toString())
  }

  @Test
  fun removeIsIdempotent() {
    val registry = DocumentRegistry<String>()
    val id = registry.add("doc")
    assertEquals("doc", registry.remove(id))
    assertNull(registry.remove(id))
    assertNull(registry.get(id))
    assertEquals(0, registry.size)
  }

  @Test
  fun unknownIdsAreAbsent() {
    val registry = DocumentRegistry<String>()
    assertNull(registry.get("nope"))
    assertNull(registry.remove("nope"))
  }

  @Test
  fun idCollisionsAreRetried() {
    val ids = ArrayDeque(listOf("same", "same", "other"))
    val registry = DocumentRegistry<String> { ids.removeFirst() }
    assertEquals("same", registry.add("first"))
    assertEquals("other", registry.add("second"))
    assertEquals("first", registry.get("same"))
  }

  @Test
  fun removeAllHandsEveryEntryBackOnce() {
    val registry = DocumentRegistry<Any>()
    val entries = List(5) { Any() }
    entries.forEach { registry.add(it) }
    val removed = registry.removeAll()
    assertEquals(5, removed.size)
    assertTrue(entries.all { entry -> removed.count { it === entry } == 1 })
    assertEquals(0, registry.size)
    assertEquals(emptyList<Any>(), registry.removeAll())
  }
}
