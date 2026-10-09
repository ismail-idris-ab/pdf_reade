package com.ismailidris.pdfreader.fileindex

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.nio.file.AccessDeniedException
import java.nio.file.FileAlreadyExistsException
import java.nio.file.FileSystemException
import java.nio.file.Files
import java.nio.file.Path
import java.util.concurrent.CountDownLatch
import java.util.concurrent.locks.ReentrantLock

class FileOpsTest {
  @get:Rule
  val temp = TemporaryFolder()

  private lateinit var myFiles: File
  private lateinit var shared: File
  private lateinit var outside: File
  private val sharedChanges = ArrayList<String>()

  @Before
  fun setUp() {
    myFiles = FileOps.canonicalOrNull(temp.newFolder("MyFiles"))!!
    shared = FileOps.canonicalOrNull(temp.newFolder("shared"))!!
    outside = FileOps.canonicalOrNull(temp.newFolder("outside"))!!
  }

  private fun ops(
    sharedAccess: () -> Unit = {},
    createLink: ((Path, Path) -> Unit)? = null,
    openInput: ((File) -> InputStream)? = null,
    deletePath: ((Path) -> Unit)? = null,
    syncDirectory: (File) -> Unit = {},
    clock: () -> Long = System::currentTimeMillis,
    journal: OpJournal? = null,
    lock: ReentrantLock = ReentrantLock(),
    movePath: ((Path, Path) -> Unit)? = null,
    directRename: ((File, File) -> Boolean)? = null,
    knownVolumes: List<File> = emptyList(),
    pathExists: (Path) -> Boolean? = FileOps::existenceOf,
  ): FileOps = FileOps(
    knownVolumes = knownVolumes,
    pathExists = pathExists,
    myFilesRoot = myFiles,
    sharedRoots = listOf(shared),
    requireSharedAccess = sharedAccess,
    onSharedChanged = { sharedChanges.addAll(it) },
    journal = journal,
    lock = lock,
    movePath = movePath ?: { s, t -> Files.move(s, t); Unit },
    directRename = directRename ?: { s, t -> s.renameTo(t) },
    createLink = createLink ?: { link, existing -> Files.createLink(link, existing); Unit },
    openInput = openInput ?: { it.inputStream() },
    deletePath = deletePath ?: { Files.delete(it) },
    syncDirectory = syncDirectory,
    clock = clock,
  )

  /** Simulates a cross-filesystem move: hard links are refused with EXDEV. */
  private val noLinks: (Path, Path) -> Unit = { link, existing ->
    throw FileSystemException(existing.toString(), link.toString(), "Invalid cross-device link")
  }

  private fun write(dir: File, name: String, bytes: ByteArray = name.toByteArray()): File =
    File(dir, name).apply { writeBytes(bytes) }

  private fun expectCode(code: String, block: () -> Unit) {
    try {
      block()
      fail("expected $code")
    } catch (e: FileOpFailure) {
      assertEquals(code, e.code)
    }
  }

  private fun visibleNames(dir: File): Set<String> = dir.list()!!.toSet()

  // region path safety

  @Test
  fun isWithinRequiresASegmentBoundary() {
    assertTrue(FileOps.isWithin(File(myFiles, "a/b"), myFiles))
    assertTrue(FileOps.isWithin(myFiles, myFiles))
    assertFalse(FileOps.isWithin(File(myFiles.path + "2"), myFiles))
    assertFalse(FileOps.isWithin(myFiles.parentFile!!, myFiles))
  }

  @Test
  fun filesystemRootIsNeverAnAllowedRoot() {
    val fsRoot = myFiles.toPath().root.toFile()
    assertFalse(FileOps.isWithin(myFiles, fsRoot))
  }

  @Test
  fun rejectsPathsOutsideTheRoots() {
    val file = write(outside, "x.pdf")
    expectCode(ErrorCode.PERMISSION_DENIED.name) { ops().renameFile(file.path, "y.pdf") }
    expectCode(ErrorCode.PERMISSION_DENIED.name) { ops().deleteFile(file.path) }
    assertTrue(file.exists())
  }

  @Test
  fun rejectsRelativeAndEmptyPaths() {
    expectCode(ErrorCode.PERMISSION_DENIED.name) { ops().deleteFile("x.pdf") }
    expectCode(ErrorCode.PERMISSION_DENIED.name) { ops().deleteFile("") }
  }

  @Test
  fun rejectsDotDotEscapes() {
    val file = write(outside, "x.pdf")
    val sneaky = myFiles.path + File.separator + ".." + File.separator + "outside" + File.separator + "x.pdf"
    expectCode(ErrorCode.PERMISSION_DENIED.name) { ops().deleteFile(sneaky) }
    expectCode(ErrorCode.PERMISSION_DENIED.name) { ops().listFolder(myFiles.path + File.separator + "..") }
    assertTrue(file.exists())
  }

  @Test
  fun rejectsSymlinksThatEscapeTheRoot() {
    val target = write(outside, "secret.pdf")
    val link = File(myFiles, "link")
    assumeTrue("symlinks not creatable here", tryCreateSymlink(link, outside))
    expectCode(ErrorCode.PERMISSION_DENIED.name) { ops().deleteFile(File(link, "secret.pdf").path) }
    expectCode(ErrorCode.PERMISSION_DENIED.name) { ops().listFolder(link.path) }
    assertTrue(target.exists())
  }

  @Test
  fun folderActionsRefuseSharedStorage() {
    expectCode(ErrorCode.PERMISSION_DENIED.name) { ops().listFolder(shared.path) }
    expectCode(ErrorCode.PERMISSION_DENIED.name) { ops().createFolder(shared.path, "New") }
    expectCode(ErrorCode.PERMISSION_DENIED.name) { ops().folderStats(shared.path) }
    assertFalse(File(shared, "New").exists())
  }

  @Test
  fun sharedAccessCheckRunsBeforeTouchingSharedFiles() {
    val file = write(shared, "doc.pdf")
    val refusing = ops(sharedAccess = { throw FileOpFailure(ErrorCode.PERMISSION_DENIED.name, "no access") })
    expectCode(ErrorCode.PERMISSION_DENIED.name) { refusing.deleteFile(file.path) }
    expectCode(ErrorCode.PERMISSION_DENIED.name) { refusing.renameFile(file.path, "x.pdf") }
    assertTrue(file.exists())
  }

  // endregion

  // region rename

  @Test
  fun renameKeepsMtimeAndReportsFreshMetadata() {
    val file = write(myFiles, "a.pdf", ByteArray(10))
    file.setLastModified(1_600_000_000_000)
    val result = ops().renameFile(file.path, "b.pdf")
    assertEquals(File(myFiles, "b.pdf").path, result.path)
    assertEquals("b.pdf", result.name)
    assertEquals(10L, result.size)
    assertEquals(File(myFiles, "b.pdf").lastModified(), result.mtime)
    assertEquals(1_600_000_000_000 / 1000, result.mtime / 1000)
    assertFalse(file.exists())
  }

  @Test
  fun renameRefusesExistingNamesAndInvalidNames() {
    val a = write(myFiles, "a.pdf")
    write(myFiles, "b.pdf")
    expectCode(FileOpCodes.ERR_NAME_EXISTS) { ops().renameFile(a.path, "b.pdf") }
    expectCode(FileOpCodes.ERR_NAME_INVALID) { ops().renameFile(a.path, "x/y.pdf") }
    expectCode(FileOpCodes.ERR_NAME_INVALID) { ops().renameFile(a.path, "..") }
    assertEquals("a.pdf", String(a.readBytes()))
  }

  @Test
  fun renameAllowsACaseOnlyChange() {
    val file = write(myFiles, "report.pdf")
    val result = ops().renameFile(file.path, "Report.pdf")
    assertEquals("Report.pdf", result.name)
    assertEquals(setOf("Report.pdf"), visibleNames(myFiles))
    assertEquals("report.pdf", String(File(myFiles, "Report.pdf").readBytes()))
  }

  @Test
  fun renameNeverReplacesANameTakenMeanwhile() {
    val file = write(myFiles, "a.pdf", "mine".toByteArray())
    val racing = ops(
      createLink = { link, _ ->
        Files.write(link, "theirs".toByteArray())
        throw FileAlreadyExistsException(link.toString())
      },
    )
    expectCode(FileOpCodes.ERR_NAME_EXISTS) { racing.renameFile(file.path, "b.pdf") }
    assertEquals("mine", file.readText())
    assertEquals("theirs", File(myFiles, "b.pdf").readText())
  }

  @Test
  fun renameWorksWhereHardLinksAreUnsupported() {
    val file = write(shared, "a.pdf")
    val result = ops(createLink = { _, _ -> throw UnsupportedOperationException() }).renameFile(file.path, "b.pdf")
    assertEquals("b.pdf", result.name)
    assertEquals(setOf("b.pdf"), visibleNames(shared))
  }

  @Test
  fun renameUndoesTheLinkWhenTheOldNameCannotBeRemoved() {
    val file = write(myFiles, "a.pdf")
    val stubborn = ops(deletePath = { if (it == file.toPath()) throw AccessDeniedException(it.toString()) else Files.delete(it) })
    try {
      stubborn.renameFile(file.path, "b.pdf")
      fail("expected failure")
    } catch (_: AccessDeniedException) {
      // Mapped to PERMISSION_DENIED by the module.
    }
    assertEquals(setOf("a.pdf"), visibleNames(myFiles))
  }

  @Test
  fun renameToTheSameNameIsANoOp() {
    val file = write(myFiles, "a.pdf")
    assertEquals(file.path, ops().renameFile(file.path, " a.pdf ").path)
  }

  @Test
  fun renameReportsMissingFilesAndRefusesFolders() {
    expectCode(ErrorCode.NOT_FOUND.name) { ops().renameFile(File(myFiles, "gone.pdf").path, "x.pdf") }
    val dir = File(myFiles, "dir").apply { mkdir() }
    expectCode(FileOpCodes.ERR_FILE_OP_FAILED) { ops().renameFile(dir.path, "x") }
  }

  @Test
  fun renameInSharedStorageNotifiesBothPaths() {
    val file = write(shared, "a.pdf")
    ops().renameFile(file.path, "b.pdf")
    assertEquals(listOf(file.path, File(shared, "b.pdf").path), sharedChanges)
  }

  // endregion

  // region move

  @Test
  fun moveLinksIntoAFreeNameWithoutReplacing() {
    val dest = File(myFiles, "dest").apply { mkdir() }
    write(dest, "doc.pdf", "old".toByteArray())
    val source = write(shared, "doc.pdf", "new".toByteArray())
    val result = ops().moveFile(source.path, dest.path)
    assertEquals("doc (1).pdf", result.name)
    assertEquals("new", File(dest, "doc (1).pdf").readText())
    assertEquals("old", File(dest, "doc.pdf").readText())
    assertFalse(source.exists())
    assertEquals(listOf(source.path), sharedChanges)
  }

  @Test
  fun moveRetriesWhenTheFreeNameIsTakenMeanwhile() {
    val source = write(shared, "doc.pdf", "mine".toByteArray())
    var first = true
    val racing = ops(
      createLink = { link, existing ->
        if (first) {
          // Another writer takes the name between the check and the link.
          first = false
          Files.write(link, "theirs".toByteArray())
        }
        Files.createLink(link, existing)
        Unit
      },
    )
    val result = racing.moveFile(source.path, myFiles.path)
    assertEquals("doc (1).pdf", result.name)
    assertEquals("theirs", File(myFiles, "doc.pdf").readText())
    assertEquals("mine", File(myFiles, "doc (1).pdf").readText())
  }

  @Test
  fun moveSyncsTheFolderBeforeDeletingTheSource() {
    for (linker in listOf<((Path, Path) -> Unit)?>(null, noLinks)) {
      val source = write(shared, "doc.pdf")
      val events = ArrayList<String>()
      val recording = ops(
        createLink = linker,
        syncDirectory = { events.add("sync:${it.name}") },
        deletePath = { events.add("delete:${it.fileName}"); Files.delete(it) },
      )
      val result = recording.moveFile(source.path, myFiles.path)
      val syncAt = events.indexOf("sync:${myFiles.name}")
      assertTrue(events.toString(), syncAt >= 0)
      assertTrue(events.toString(), syncAt < events.indexOf("delete:doc.pdf"))
      File(result.path).delete()
    }
  }

  @Test
  fun failedFolderSyncKeepsOnlyTheSource() {
    for (linker in listOf<((Path, Path) -> Unit)?>(null, noLinks)) {
      val source = write(shared, "doc.pdf")
      val failing = ops(createLink = linker, syncDirectory = { throw IOException("EIO") })
      try {
        failing.moveFile(source.path, myFiles.path)
        fail("expected failure")
      } catch (_: IOException) {
        // Mapped by the module.
      }
      assertTrue(source.exists())
      assertEquals(emptySet<String>(), visibleNames(myFiles))
    }
  }

  @Test
  fun moveFallsBackToVerifiedCopyAcrossFilesystems() {
    val bytes = ByteArray(200_000) { (it % 251).toByte() }
    val source = write(shared, "big.pdf", bytes)
    source.setLastModified(1_500_000_000_000)
    val result = ops(createLink = noLinks).moveFile(source.path, myFiles.path)
    val moved = File(result.path)
    assertArrayEquals(bytes, moved.readBytes())
    assertEquals(1_500_000_000_000 / 1000, moved.lastModified() / 1000)
    assertFalse(source.exists())
    assertEquals(setOf("big.pdf"), visibleNames(myFiles))
  }

  @Test
  fun moveKeepsOnlyTheOriginalWhenTheSourceCannotBeDeleted() {
    for (linker in listOf<((Path, Path) -> Unit)?>(null, noLinks)) {
      val source = write(shared, "doc.pdf")
      val stubborn = ops(
        createLink = linker,
        deletePath = { if (it == source.toPath()) throw AccessDeniedException(it.toString()) else Files.delete(it) },
      )
      try {
        stubborn.moveFile(source.path, myFiles.path)
        fail("expected failure")
      } catch (_: AccessDeniedException) {
        // Mapped to PERMISSION_DENIED by the module.
      }
      assertTrue(source.exists())
      assertEquals(emptySet<String>(), visibleNames(myFiles))
    }
  }

  @Test
  fun moveReportsADuplicateWhenTheNewCopyCannotBeRemoved() {
    for (linker in listOf<((Path, Path) -> Unit)?>(null, noLinks)) {
      val source = write(shared, "doc.pdf")
      val stuck = ops(
        createLink = linker,
        deletePath = { if (it.fileName.toString().startsWith(".")) Files.delete(it) else throw AccessDeniedException(it.toString()) },
      )
      expectCode(FileOpCodes.ERR_DUPLICATE_LEFT) { stuck.moveFile(source.path, myFiles.path) }
      assertTrue(source.exists())
      assertEquals(setOf("doc.pdf"), visibleNames(myFiles))
      File(myFiles, "doc.pdf").delete()
    }
  }

  @Test
  fun moveOnlyTargetsMyFiles() {
    val source = write(myFiles, "doc.pdf")
    val otherShared = File(shared, "folder").apply { mkdir() }
    expectCode(ErrorCode.PERMISSION_DENIED.name) { ops().moveFile(source.path, otherShared.path) }
    expectCode(ErrorCode.NOT_FOUND.name) { ops().moveFile(source.path, File(myFiles, "missing").path) }
    assertTrue(source.exists())
  }

  @Test
  fun moveIntoItsOwnFolderChangesNothing() {
    val source = write(myFiles, "doc.pdf")
    assertEquals(source.path, ops().moveFile(source.path, myFiles.path).path)
    assertTrue(source.exists())
  }

  // endregion

  // region copy

  @Test
  fun copyInTheSameFolderUsesCopySuffixes() {
    val source = write(shared, "doc.pdf")
    assertEquals("doc (copy).pdf", ops().copyFile(source.path, shared.path).name)
    assertEquals("doc (copy 2).pdf", ops().copyFile(source.path, shared.path).name)
    assertEquals("doc.pdf", File(shared, "doc (copy 2).pdf").readText())
    assertTrue(source.exists())
  }

  @Test
  fun copyIntoMyFilesUsesNumberSuffixes() {
    val source = write(shared, "doc.pdf")
    write(myFiles, "doc.pdf")
    assertEquals("doc (1).pdf", ops().copyFile(source.path, myFiles.path).name)
  }

  @Test
  fun copyRefusesOtherSharedFolders() {
    val source = write(shared, "doc.pdf")
    val other = File(shared, "other").apply { mkdir() }
    expectCode(ErrorCode.PERMISSION_DENIED.name) { ops().copyFile(source.path, other.path) }
    assertEquals(emptySet<String>(), visibleNames(other))
  }

  @Test
  fun failedCopyLeavesNoPartialOrTempFile() {
    val source = write(myFiles, "doc.pdf", ByteArray(300_000))
    val dest = File(myFiles, "dest").apply { mkdir() }
    val failing = ops(openInput = { FailingStream(150_000) })
    try {
      failing.copyFile(source.path, dest.path)
      fail("expected failure")
    } catch (_: IOException) {
      // Expected: the injected stream fails half-way.
    }
    assertEquals(emptySet<String>(), visibleNames(dest))
  }

  @Test
  fun copyDetectsATruncatedSource() {
    val source = write(myFiles, "doc.pdf", ByteArray(1000))
    val dest = File(myFiles, "dest").apply { mkdir() }
    val short = ops(openInput = { ByteArray(10).inputStream() })
    expectCode(FileOpCodes.ERR_FILE_OP_FAILED) { short.copyFile(source.path, dest.path) }
    assertEquals(emptySet<String>(), visibleNames(dest))
  }

  @Test
  fun cancellationRemovesTheTempFile() {
    val source = write(myFiles, "doc.pdf", ByteArray(300_000))
    val dest = File(myFiles, "dest").apply { mkdir() }
    var calls = 0
    val cancelling = FileOps(
      myFilesRoot = myFiles,
      sharedRoots = emptyList(),
      checkCancelled = { if (++calls > 2) throw IllegalStateException("cancelled") },
    )
    try {
      cancelling.copyFile(source.path, dest.path)
      fail("expected cancellation")
    } catch (_: IllegalStateException) {
      // Expected.
    }
    assertEquals(emptySet<String>(), visibleNames(dest))
  }

  @Test
  fun spaceCheckReportsNoSpace() {
    expectCode(ErrorCode.NO_SPACE.name) { ops().ensureSpace(myFiles, Long.MAX_VALUE - FileOps.SPACE_MARGIN_BYTES) }
    ops().ensureSpace(myFiles, 1)
  }

  @Test
  fun copyChecksTheInjectedFreeSpaceBeforeWriting() {
    val source = write(shared, "doc.pdf", ByteArray(1000))
    val tight = FileOps(myFiles, listOf(shared), freeSpace = { FileOps.SPACE_MARGIN_BYTES + 999 })
    expectCode(ErrorCode.NO_SPACE.name) { tight.copyFile(source.path, myFiles.path) }
    assertEquals(emptySet<String>(), visibleNames(myFiles))
    val unknown = FileOps(myFiles, listOf(shared), freeSpace = { 0L })
    assertEquals("doc.pdf", unknown.copyFile(source.path, myFiles.path).name)
  }

  // endregion

  // region delete

  @Test
  fun deleteRemovesTheFile() {
    val file = write(shared, "doc.pdf")
    ops().deleteFile(file.path)
    assertFalse(file.exists())
    assertEquals(listOf(file.path), sharedChanges)
    expectCode(ErrorCode.NOT_FOUND.name) { ops().deleteFile(file.path) }
  }

  @Test
  fun deleteFileRefusesFolders() {
    val dir = File(myFiles, "dir").apply { mkdir() }
    expectCode(FileOpCodes.ERR_FILE_OP_FAILED) { ops().deleteFile(dir.path) }
    assertTrue(dir.isDirectory)
  }

  // endregion

  // region folders

  @Test
  fun listsFoldersFirstThenNamesIgnoringCase() {
    write(myFiles, "b.pdf")
    write(myFiles, "A.pdf")
    File(myFiles, "zeta").mkdir()
    File(myFiles, "Alpha").mkdir()
    write(myFiles, NameRules.tempName("c.pdf", System.currentTimeMillis(), "123456"))
    val (path, entries) = ops().listFolder(myFiles.path)
    assertEquals(myFiles.path, path)
    assertEquals(listOf("Alpha", "zeta", "A.pdf", "b.pdf"), entries.map { it.name })
    assertEquals(listOf(true, true, false, false), entries.map { it.isDirectory })
    assertEquals(0L, entries[0].size)
    assertEquals(5L, entries[2].size)
  }

  @Test
  fun listRemovesStaleTempFilesByTheirEmbeddedTime() {
    val now = 1_800_000_000_000L
    val twoDays = 2L * 24 * 60 * 60 * 1000
    // Old stamp, fresh mtime: stale.
    val stale = write(myFiles, NameRules.tempName("old.pdf", now - twoDays, "aaaaaa"))
    // Fresh stamp, old mtime (a move copies the source's mtime): kept.
    val fresh = write(myFiles, NameRules.tempName("new.pdf", now - 1000, "bbbbbb"))
    fresh.setLastModified(now - twoDays)
    // Rename temps are never cleaned up by age.
    val renameTemp = write(myFiles, NameRules.renameTempName(now - twoDays, "cccccc"))
    ops(clock = { now }).listFolder(myFiles.path)
    assertFalse(stale.exists())
    assertTrue(fresh.exists())
    assertTrue(renameTemp.exists())
  }

  @Test
  fun listNeverWaitsForTheWriteLockAndSkipsCleanupWhenBusy() {
    val lock = ReentrantLock()
    val stale = write(myFiles, NameRules.tempName("old.pdf", 1, "aaaaaa"))
    write(myFiles, "a.pdf")
    val held = CountDownLatch(1)
    val release = CountDownLatch(1)
    val holder = Thread {
      lock.lock()
      try {
        held.countDown()
        release.await()
      } finally {
        lock.unlock()
      }
    }.apply { start() }
    held.await()
    try {
      val (_, entries) = ops(lock = lock).listFolder(myFiles.path)
      assertEquals(listOf("a.pdf"), entries.map { it.name })
      assertTrue(stale.exists())
    } finally {
      release.countDown()
      holder.join()
    }
    ops(lock = lock).listFolder(myFiles.path)
    assertFalse(stale.exists())
  }

  @Test
  fun copiesStreamWithoutHoldingTheWriteLock() {
    val lock = ReentrantLock()
    val source = write(myFiles, "doc.pdf", ByteArray(1000))
    val dest = File(myFiles, "dest").apply { mkdir() }
    var lockedWhileStreaming = true
    val copying = ops(lock = lock, openInput = { lockedWhileStreaming = lock.isLocked; it.inputStream() })
    copying.copyFile(source.path, dest.path)
    assertFalse(lockedWhileStreaming)
    val moving = ops(lock = lock, createLink = noLinks, openInput = { lockedWhileStreaming = lock.isLocked; it.inputStream() })
    lockedWhileStreaming = true
    moving.moveFile(source.path, dest.path)
    assertFalse(lockedWhileStreaming)
  }

  @Test
  fun copiesAreJournaledWhileTheyRun() {
    val journalDir = temp.newFolder("journal")
    val source = write(myFiles, "doc.pdf")
    val dest = File(myFiles, "dest").apply { mkdir() }
    var during = -1
    ops(journal = OpJournal(journalDir), openInput = { during = journalDir.list()!!.size; it.inputStream() })
      .copyFile(source.path, dest.path)
    assertEquals(1, during)
    assertEquals(0, journalDir.list()!!.size)
    try {
      ops(journal = OpJournal(journalDir), openInput = { FailingStream(10) }).copyFile(source.path, dest.path)
      fail("expected failure")
    } catch (_: IOException) {
      // Expected.
    }
    assertEquals(0, journalDir.list()!!.size)
  }

  @Test
  fun movedAndCopiedNamesCanNeverLookLikeTemps() {
    val tricky = write(shared, NameRules.tempName("x.pdf", 1, "aaaaaa"), "data".toByteArray())
    val copy = ops().copyFile(tricky.path, myFiles.path)
    assertFalse(copy.name.startsWith("."))
    // A listing long after must not treat it as a stale temp file.
    ops(clock = { Long.MAX_VALUE / 2 }).listFolder(myFiles.path)
    assertTrue(File(copy.path).exists())
    val sub = File(myFiles, "sub").apply { mkdir() }
    val moved = ops().moveFile(tricky.path, sub.path)
    assertFalse(moved.name.startsWith("."))
    assertEquals("data", File(moved.path).readText())
  }

  @Test
  fun caseOnlyRenameChangesTheSpellingInPlaceWhenPossible() {
    assumeCaseInsensitive()
    val journalDir = temp.newFolder("journal")
    val file = write(myFiles, "report.pdf")
    var moved = false
    ops(journal = OpJournal(journalDir), movePath = { s, t -> moved = true; Files.move(s, t); Unit })
      .renameFile(file.path, "Report.pdf")
    assertEquals(setOf("Report.pdf"), visibleNames(myFiles))
    assertFalse(moved)
    assertEquals(0, journalDir.list()!!.size)
  }

  @Test
  fun caseOnlyRenameFallsBackToAJournaledTempName() {
    assumeCaseInsensitive()
    val journalDir = temp.newFolder("journal")
    val events = ArrayList<String>()
    val file = write(myFiles, "report.pdf")
    ops(
      journal = OpJournal(journalDir) { events.add("sync-journal") },
      directRename = { _, _ -> false },
      syncDirectory = { events.add("sync:${it.name}") },
      movePath = { s, t -> events.add("move"); Files.move(s, t); Unit },
    ).renameFile(file.path, "Report.pdf")
    assertEquals(setOf("Report.pdf"), visibleNames(myFiles))
    assertEquals(listOf("sync-journal", "move", "move", "sync:${myFiles.name}"), events)
    assertEquals(0, journalDir.list()!!.size)
  }

  @Test
  fun interruptedCaseOnlyRenameIsRepairedByTheReplay() {
    assumeCaseInsensitive()
    val journalDir = temp.newFolder("journal")
    val file = write(myFiles, "report.pdf", "content".toByteArray())
    var moves = 0
    val crashing = ops(
      journal = OpJournal(journalDir),
      directRename = { _, _ -> false },
      movePath = { s, t -> if (++moves >= 2) throw IOException("crash"); Files.move(s, t); Unit },
    )
    try {
      crashing.renameFile(file.path, "Report.pdf")
      fail("expected failure")
    } catch (_: IOException) {
      // Expected: the second step and the undo both fail.
    }
    // Parked under the hidden temp name: not listed, journal entry kept.
    assertEquals(emptyList<String>(), ops().listFolder(myFiles.path).second.map { it.name })
    assertEquals(1, journalDir.list()!!.size)

    ops(journal = OpJournal(journalDir)).replayJournal()
    assertEquals(listOf("report.pdf"), ops().listFolder(myFiles.path).second.map { it.name })
    assertEquals("content", File(myFiles, "report.pdf").readText())
    assertEquals(0, journalDir.list()!!.size)
  }

  @Test
  fun replayRestoresUnderAFreeNameWhenTheOriginalIsTaken() {
    val journalDir = temp.newFolder("journal")
    val journal = OpJournal(journalDir)
    val parked = write(shared, NameRules.renameTempName(1, "aaaaaa"), "mine".toByteArray())
    write(shared, "report.pdf", "other".toByteArray())
    journal.abandon(journal.begin(OpJournal.Entry.Rename(parked, File(shared, "report.pdf"))))
    ops(journal = journal).replayJournal()
    assertEquals("mine", File(shared, "report (1).pdf").readText())
    assertEquals("other", File(shared, "report.pdf").readText())
    assertFalse(parked.exists())
    assertEquals(0, journalDir.list()!!.size)
  }

  @Test
  fun replayDeletesUnfinishedCopyTempsButNotRunningOnes() {
    val journalDir = temp.newFolder("journal")
    val journal = OpJournal(journalDir)
    val dead = write(shared, NameRules.tempName("a.pdf", 1, "aaaaaa"))
    val live = write(myFiles, NameRules.tempName("b.pdf", 1, "bbbbbb"))
    journal.abandon(journal.begin(OpJournal.Entry.CopyTemp(dead)))
    val liveId = journal.begin(OpJournal.Entry.CopyTemp(live))
    try {
      ops(journal = journal).replayJournal()
      assertFalse(dead.exists())
      assertTrue(live.exists())
      assertEquals(1, journalDir.list()!!.size)
    } finally {
      journal.end(liveId)
    }
  }

  @Test
  fun replayDropsEntriesOutsideMyFilesAndEveryKnownVolume() {
    val journalDir = temp.newFolder("journal")
    val journal = OpJournal(journalDir)
    val victim = write(outside, NameRules.tempName("x.pdf", 1, "cccccc"))
    val parked = write(outside, NameRules.renameTempName(1, "dddddd"))
    journal.abandon(journal.begin(OpJournal.Entry.CopyTemp(victim)))
    journal.abandon(journal.begin(OpJournal.Entry.Rename(parked, File(outside, "x.pdf"))))
    ops(journal = journal, knownVolumes = emptyList()).replayJournal()
    // Not ours to touch: left alone, and the entries are dropped.
    assertTrue(victim.exists())
    assertTrue(parked.exists())
    assertEquals(0, journalDir.list()!!.size)
  }

  @Test
  fun replayKeepsEntriesOnAVolumeThatIsNotMountedNow() {
    val journalDir = temp.newFolder("journal")
    val journal = OpJournal(journalDir)
    // An SD card under a known volume parent but not among the current shared roots.
    val volumes = temp.newFolder("volumes")
    val card = File(volumes, "1A2B-3C4D").apply { mkdirs() }
    val parked = write(card, NameRules.renameTempName(1, "eeeeee"), "mine".toByteArray())
    val copyTemp = write(card, NameRules.tempName("y.pdf", 1, "ffffff"))
    journal.abandon(journal.begin(OpJournal.Entry.Rename(parked, File(card, "report.pdf"))))
    journal.abandon(journal.begin(OpJournal.Entry.CopyTemp(copyTemp)))
    ops(journal = journal, knownVolumes = listOf(volumes)).replayJournal()
    assertTrue(parked.exists())
    assertTrue(copyTemp.exists())
    assertEquals(2, journalDir.list()!!.size)
  }

  @Test
  fun replayKeepsSharedEntriesWhileSharedAccessIsMissing() {
    val journalDir = temp.newFolder("journal")
    val journal = OpJournal(journalDir)
    val parked = write(shared, NameRules.renameTempName(1, "gggggg"), "mine".toByteArray())
    journal.abandon(journal.begin(OpJournal.Entry.Rename(parked, File(shared, "report.pdf"))))
    val denied = { throw FileOpFailure(ErrorCode.PERMISSION_DENIED.name, "no access") }
    ops(journal = journal, sharedAccess = denied).replayJournal()
    assertTrue(parked.exists())
    assertEquals(1, journalDir.list()!!.size)
    // Once access is back, the entry is repaired.
    ops(journal = journal).replayJournal()
    assertEquals("mine", File(shared, "report.pdf").readText())
    assertEquals(0, journalDir.list()!!.size)
  }

  @Test
  fun replayKeepsEntriesWhoseExistenceCannotBeTold() {
    val journalDir = temp.newFolder("journal")
    val journal = OpJournal(journalDir)
    val parked = write(myFiles, NameRules.renameTempName(1, "hhhhhh"))
    val copyTemp = write(myFiles, NameRules.tempName("z.pdf", 1, "iiiiii"))
    journal.abandon(journal.begin(OpJournal.Entry.Rename(parked, File(myFiles, "report.pdf"))))
    journal.abandon(journal.begin(OpJournal.Entry.CopyTemp(copyTemp)))
    ops(journal = journal, pathExists = { null }).replayJournal()
    assertTrue(parked.exists())
    assertTrue(copyTemp.exists())
    assertEquals(2, journalDir.list()!!.size)
  }

  @Test
  fun replayDropsEntriesWhoseTempIsDefinitelyGone() {
    val journalDir = temp.newFolder("journal")
    val journal = OpJournal(journalDir)
    journal.abandon(journal.begin(OpJournal.Entry.Rename(File(myFiles, NameRules.renameTempName(1, "jjjjjj")), File(myFiles, "a.pdf"))))
    journal.abandon(journal.begin(OpJournal.Entry.CopyTemp(File(myFiles, NameRules.tempName("b.pdf", 1, "kkkkkk")))))
    ops(journal = journal).replayJournal()
    assertEquals(0, journalDir.list()!!.size)
    assertEquals(emptySet<String>(), visibleNames(myFiles))
  }

  @Test
  fun moveKeepsBothWhenTheSourceChangesWhileStreaming() {
    val source = write(shared, "doc.pdf", "original".toByteArray())
    source.setLastModified(1_500_000_000_000)
    val changing = ops(
      createLink = noLinks,
      openInput = {
        // Another app rewrites the file (same length) after the move started.
        it.writeBytes("replaced".toByteArray())
        it.setLastModified(1_600_000_000_000)
        it.inputStream()
      },
    )
    expectCode(FileOpCodes.ERR_DUPLICATE_LEFT) { changing.moveFile(source.path, myFiles.path) }
    assertEquals("replaced", source.readText())
    assertEquals(setOf("doc.pdf"), visibleNames(myFiles))
  }

  @Test
  fun providerSizesOnlyFailShortStreams() {
    val dir = File(myFiles, "imports").apply { mkdir() }
    val atLeast = ops()
    val longer = atLeast.writeAtomically(dir, "a.pdf", NameRules.Style.MOVE, 10, null, sizeCheck = SizeCheck.AT_LEAST) {
      ByteArray(20).inputStream()
    }
    assertEquals(20L, longer.length())
    expectCode(FileOpCodes.ERR_FILE_OP_FAILED) {
      atLeast.writeAtomically(dir, "b.pdf", NameRules.Style.MOVE, 10, null, sizeCheck = SizeCheck.AT_LEAST) {
        ByteArray(5).inputStream()
      }
    }
    // Local copies stay exact.
    expectCode(FileOpCodes.ERR_FILE_OP_FAILED) {
      atLeast.writeAtomically(dir, "c.pdf", NameRules.Style.MOVE, 10, null) { ByteArray(20).inputStream() }
    }
    assertEquals(setOf("a.pdf"), visibleNames(dir))
  }

  private fun assumeCaseInsensitive() {
    val probe = write(myFiles, "probe.txt")
    val insensitive = File(myFiles, "PROBE.TXT").exists()
    probe.delete()
    assumeTrue("filesystem is case-sensitive", insensitive)
  }

  @Test
  fun createFolderRefusesExistingNames() {
    val entry = ops().createFolder(myFiles.path, "Work")
    assertTrue(entry.isDirectory)
    assertEquals(File(myFiles, "Work").path, entry.path)
    expectCode(FileOpCodes.ERR_NAME_EXISTS) { ops().createFolder(myFiles.path, "Work") }
    write(myFiles, "file")
    expectCode(FileOpCodes.ERR_NAME_EXISTS) { ops().createFolder(myFiles.path, "file") }
    expectCode(FileOpCodes.ERR_NAME_INVALID) { ops().createFolder(myFiles.path, "a:b") }
    expectCode(FileOpCodes.ERR_NAME_INVALID) { ops().createFolder(myFiles.path, ".hidden") }
    expectCode(ErrorCode.NOT_FOUND.name) { ops().createFolder(File(myFiles, "missing").path, "x") }
  }

  @Test
  fun renameFolderFollowsTheRenameRules() {
    val dir = File(myFiles, "Old").apply { mkdir() }
    write(dir, "inside.pdf")
    File(myFiles, "Taken").mkdir()
    expectCode(FileOpCodes.ERR_NAME_EXISTS) { ops().renameFolder(dir.path, "Taken") }
    val renamed = ops().renameFolder(dir.path, "New")
    assertEquals("New", renamed.name)
    assertTrue(File(myFiles, "New/inside.pdf").exists())
    assertEquals("NEW", ops().renameFolder(renamed.path, "NEW").name)
    expectCode(ErrorCode.PERMISSION_DENIED.name) { ops().renameFolder(myFiles.path, "Other") }
  }

  @Test
  fun folderStatsCountsEverythingBelow() {
    val a = File(myFiles, "a").apply { mkdir() }
    val b = File(a, "b").apply { mkdir() }
    write(a, "one.pdf", ByteArray(3))
    write(b, "two.pdf", ByteArray(4))
    write(myFiles, "three.pdf", ByteArray(5))
    write(b, NameRules.tempName("x", 1, "cccccc"), ByteArray(100))
    write(a, NameRules.renameTempName(1, "dddddd"), ByteArray(50))
    val stats = ops().folderStats(myFiles.path)
    assertEquals(3L, stats.fileCount)
    assertEquals(2L, stats.folderCount)
    assertEquals(12L, stats.totalBytes)
  }

  @Test
  fun deleteFolderRemovesTheTreeButRefusesTheRoot() {
    val a = File(myFiles, "a").apply { mkdir() }
    val b = File(a, "b").apply { mkdir() }
    write(b, "deep.pdf")
    write(a, "top.pdf")
    expectCode(ErrorCode.PERMISSION_DENIED.name) { ops().deleteFolder(myFiles.path) }
    ops().deleteFolder(a.path)
    assertFalse(a.exists())
    assertTrue(myFiles.isDirectory)
    expectCode(ErrorCode.NOT_FOUND.name) { ops().deleteFolder(a.path) }
  }

  @Test
  fun deleteFolderDoesNotFollowSymlinks() {
    val kept = write(outside, "keep.pdf")
    val keptInMyFiles = File(myFiles, "keep").apply { mkdir() }
    write(keptInMyFiles, "also.pdf")
    val dir = File(myFiles, "dir").apply { mkdir() }
    assumeTrue("symlinks not creatable here", tryCreateSymlink(File(dir, "out"), outside))
    assumeTrue(tryCreateSymlink(File(dir, "in"), keptInMyFiles))
    ops().deleteFolder(dir.path)
    assertFalse(dir.exists())
    assertTrue(kept.exists())
    assertTrue(File(keptInMyFiles, "also.pdf").exists())
  }

  @Test
  fun deleteFolderRefusesASymlinkedFolder() {
    val real = File(myFiles, "real").apply { mkdir() }
    val link = File(myFiles, "alias")
    assumeTrue("symlinks not creatable here", tryCreateSymlink(link, real))
    expectCode(ErrorCode.PERMISSION_DENIED.name) { ops().deleteFolder(link.path) }
    assertTrue(real.isDirectory)
  }

  // endregion

  private fun tryCreateSymlink(link: File, target: File): Boolean = try {
    Files.createSymbolicLink(link.toPath(), target.toPath())
    true
  } catch (_: IOException) {
    false
  } catch (_: UnsupportedOperationException) {
    false
  } catch (_: SecurityException) {
    false
  }

  /** Delivers [failAfter] zero bytes, then fails like a dying provider. */
  private class FailingStream(private val failAfter: Int) : InputStream() {
    private var delivered = 0

    override fun read(): Int {
      if (delivered >= failAfter) throw IOException("stream broke")
      delivered++
      return 0
    }

    override fun read(b: ByteArray, off: Int, len: Int): Int {
      if (delivered >= failAfter) throw IOException("stream broke")
      val n = minOf(len, failAfter - delivered)
      b.fill(0, off, off + n)
      delivered += n
      return n
    }
  }
}
