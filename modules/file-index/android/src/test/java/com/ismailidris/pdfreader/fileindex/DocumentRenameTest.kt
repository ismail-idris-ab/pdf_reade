package com.ismailidris.pdfreader.fileindex

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.FileNotFoundException

class DocumentRenameTest {
  /**
   * Behaves like AOSP DocumentsProvider: a rename that changes the document
   * id revokes every grant on the old id. [pathIds] providers derive the id
   * from the name (renaming back restores the original id); others hand out
   * a fresh id on every rename. [persistable] decides the grant a persist
   * call obtains for a document name.
   */
  private class FakeProvider(
    private val pathIds: Boolean,
    private val persistable: (String) -> GrantMode,
  ) {
    private var counter = 0
    private val names = HashMap<String, String>()
    val grants = HashMap<String, GrantMode>()
    val persistCalls = ArrayList<String>()
    var renameBackFails = false

    fun add(name: String): String {
      val id = idFor(name)
      names[id] = name
      grants[id] = GrantMode.READ_WRITE
      return id
    }

    fun nameOf(id: String): String? = names[id]

    fun rename(id: String, newName: String): String? {
      names.remove(id) ?: throw FileNotFoundException()
      val newId = idFor(newName)
      names[newId] = newName
      if (newId != id) grants.remove(id)
      return newId
    }

    fun renameBack(id: String, originalName: String): String? {
      if (renameBackFails) throw IllegalStateException("provider refused")
      return rename(id, originalName)
    }

    fun persist(id: String): GrantMode {
      persistCalls.add(id)
      val name = names[id] ?: return GrantMode.NONE
      val mode = persistable(name)
      if (mode != GrantMode.NONE) grants[id] = mode
      return mode
    }

    fun release(id: String) {
      grants.remove(id)
    }

    private fun idFor(name: String) = if (pathIds) "doc:$name" else "id${++counter}"
  }

  private fun run(provider: FakeProvider, original: String, newName: String, originalName: String) =
    DocumentRename.rename(
      original = original,
      required = GrantMode.READ_WRITE,
      rename = { provider.rename(it, newName) },
      renameBack = { provider.renameBack(it, originalName) },
      persist = provider::persist,
      release = provider::release,
    )

  private fun expectLost(block: () -> Unit) {
    try {
      block()
      fail("expected ERR_FILE_OP_FAILED")
    } catch (e: FileOpFailure) {
      assertEquals(FileOpCodes.ERR_FILE_OP_FAILED, e.code)
    }
  }

  @Test
  fun freshIdProviderMovesTheGrantToTheNewUri() {
    val provider = FakeProvider(pathIds = false) { GrantMode.READ_WRITE }
    val original = provider.add("a.pdf")
    val outcome = run(provider, original, "b.pdf", "a.pdf")
    assertTrue(outcome.renamed)
    assertEquals("b.pdf", provider.nameOf(outcome.uri))
    assertEquals(mapOf(outcome.uri to GrantMode.READ_WRITE), provider.grants)
  }

  @Test
  fun pathIdProviderRenamedBackWhenWriteAccessWouldBeLost() {
    // Write can only be persisted under the original name.
    val provider = FakeProvider(pathIds = true) { if (it == "a.pdf") GrantMode.READ_WRITE else GrantMode.READ }
    val original = provider.add("a.pdf")
    val outcome = run(provider, original, "b.pdf", "a.pdf")
    assertFalse(outcome.renamed)
    // Same id as before, but its grant was revoked by the rename and had to be persisted again.
    assertEquals(original, outcome.uri)
    assertEquals("a.pdf", provider.nameOf(outcome.uri))
    assertEquals(mapOf(original to GrantMode.READ_WRITE), provider.grants)
  }

  @Test
  fun freshIdProviderRenamedBackLandsOnAThirdUri() {
    val provider = FakeProvider(pathIds = false) { if (it == "b.pdf") GrantMode.NONE else GrantMode.READ_WRITE }
    val original = provider.add("a.pdf")
    val outcome = run(provider, original, "b.pdf", "a.pdf")
    assertFalse(outcome.renamed)
    assertTrue(outcome.uri != original)
    assertEquals("a.pdf", provider.nameOf(outcome.uri))
    assertEquals(mapOf(outcome.uri to GrantMode.READ_WRITE), provider.grants)
  }

  @Test
  fun noPersistableUriAtAllRejects() {
    val provider = FakeProvider(pathIds = false) { GrantMode.NONE }
    val original = provider.add("a.pdf")
    expectLost { run(provider, original, "b.pdf", "a.pdf") }
    // Access is lost: the provider revoked the original grant on rename.
    assertEquals(emptyMap<String, GrantMode>(), provider.grants)
  }

  @Test
  fun failedRenameBackKeepsTheRenamedUriWhenItHoldsAnyGrant() {
    val provider = FakeProvider(pathIds = false) { GrantMode.READ }
    provider.renameBackFails = true
    val original = provider.add("a.pdf")
    val outcome = run(provider, original, "b.pdf", "a.pdf")
    assertTrue(outcome.renamed)
    assertEquals("b.pdf", provider.nameOf(outcome.uri))
    assertEquals(mapOf(outcome.uri to GrantMode.READ), provider.grants)
  }

  @Test
  fun failedRenameBackWithoutAnyGrantRejects() {
    val provider = FakeProvider(pathIds = false) { GrantMode.NONE }
    provider.renameBackFails = true
    val original = provider.add("a.pdf")
    expectLost { run(provider, original, "b.pdf", "a.pdf") }
  }

  @Test
  fun unchangedUriIsStillPersistedAgain() {
    val provider = FakeProvider(pathIds = false) { GrantMode.READ_WRITE }
    val original = provider.add("a.pdf")
    val outcome = DocumentRename.rename(
      original = original,
      required = GrantMode.READ_WRITE,
      rename = { null },
      renameBack = { fail("no rename-back"); null },
      persist = provider::persist,
      release = provider::release,
    )
    assertEquals(DocumentRename.Outcome(original, true), outcome)
    assertEquals(listOf(original), provider.persistCalls)
  }

  @Test
  fun readOnlyOriginalAcceptsAReadGrant() {
    val provider = FakeProvider(pathIds = false) { GrantMode.READ }
    val original = provider.add("a.pdf")
    val outcome = DocumentRename.rename(
      original = original,
      required = GrantMode.READ,
      rename = { provider.rename(it, "b.pdf") },
      renameBack = { fail("no rename-back"); null },
      persist = provider::persist,
      release = provider::release,
    )
    assertTrue(outcome.renamed)
    assertEquals("b.pdf", provider.nameOf(outcome.uri))
  }

  @Test
  fun renameFailuresPropagateUnchanged() {
    val provider = FakeProvider(pathIds = false) { GrantMode.READ_WRITE }
    try {
      run(provider, "missing", "b.pdf", "a.pdf")
      fail("expected failure")
    } catch (_: FileNotFoundException) {
      // Mapped to NOT_FOUND by the module.
    }
    assertEquals(emptyList<String>(), provider.persistCalls)
  }
}
