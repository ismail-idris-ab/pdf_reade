package com.ismailidris.pdfreader.fileindex

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeNoException
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.io.IOException
import java.nio.file.Files

class DocumentScannerTest {
  @get:Rule
  val temp = TemporaryFolder()

  private class Run(val summary: ScanSummary, val batches: List<List<ScannedFile>>) {
    val files: List<ScannedFile> get() = batches.flatten()
    val names: Set<String> get() = files.map { it.name }.toSet()
  }

  private fun scan(
    roots: List<File>,
    exts: Set<String> = setOf("pdf"),
    known: Map<String, Long> = emptyMap(),
    batchSize: Int = DocumentScanner.DEFAULT_BATCH_SIZE,
    isCancelled: () -> Boolean = { false },
  ): Run {
    val batches = ArrayList<List<ScannedFile>>()
    val summary = DocumentScanner(roots, exts, known, batchSize, isCancelled) { batches.add(it) }.scan()
    return Run(summary, batches)
  }

  private fun file(parent: File, relative: String, content: String = "x"): File {
    val target = File(parent, relative)
    target.parentFile!!.mkdirs()
    target.writeText(content)
    return target
  }

  private fun symlink(link: File, target: File) {
    try {
      Files.createSymbolicLink(link.toPath(), target.toPath())
    } catch (e: IOException) {
      assumeNoException("OS refused to create a symlink", e)
    } catch (e: UnsupportedOperationException) {
      assumeNoException("Filesystem has no symlinks", e)
    } catch (e: SecurityException) {
      assumeNoException("Not allowed to create a symlink", e)
    }
  }

  @Test
  fun filtersByExtensionCaseInsensitively() {
    val root = temp.newFolder("root")
    file(root, "a.pdf", "12345")
    file(root, "B.PDF")
    file(root, "c.txt")
    file(root, "docs/d.docx")
    file(root, "pdf")
    file(root, "trailing.")

    val run = scan(listOf(root), exts = setOf("pdf", "DOCX"))

    assertEquals(setOf("a.pdf", "B.PDF", "d.docx"), run.names)
    assertEquals(3, run.summary.scanned)
    assertEquals(3, run.summary.emitted)
    val a = run.files.single { it.name == "a.pdf" }
    assertEquals(File(root, "a.pdf").absolutePath, a.path)
    assertEquals("pdf", a.ext)
    assertEquals(5L, a.size)
    assertEquals(File(root, "a.pdf").lastModified(), a.mtime)
    assertEquals("pdf", run.files.single { it.name == "B.PDF" }.ext)
    assertFalse(run.summary.cancelled)
  }

  @Test
  fun skipsAndroidDataObbAndHiddenEntries() {
    val root = temp.newFolder("root")
    file(root, "Android/data/com.app/a.pdf")
    file(root, "android/OBB/com.app/b.pdf")
    file(root, "Android/media/com.whatsapp/c.pdf")
    file(root, "nested/Android/data/d.pdf")
    file(root, ".hidden/e.pdf")
    file(root, "visible/.f.pdf")
    file(root, "visible/g.pdf")

    val run = scan(listOf(root))

    assertEquals(setOf("c.pdf", "d.pdf", "g.pdf"), run.names)
  }

  @Test
  fun incrementalRescanEmitsOnlyChangedAndNewFiles() {
    val root = temp.newFolder("root")
    val unchanged = file(root, "unchanged.pdf")
    val changed = file(root, "changed.pdf")
    unchanged.setLastModified(1_600_000_000_000)
    changed.setLastModified(1_600_000_000_000)

    val first = scan(listOf(root))
    assertEquals(2, first.summary.emitted)
    val known = first.files.associate { it.path to it.mtime }

    assertTrue(changed.setLastModified(1_700_000_000_000))
    file(root, "sub/new.pdf")

    val second = scan(listOf(root), known = known)

    assertEquals(setOf("changed.pdf", "new.pdf"), second.names)
    assertEquals(3, second.summary.scanned)
    assertEquals(2, second.summary.emitted)
    assertTrue(second.summary.deleted.isEmpty())
  }

  @Test
  fun reportsKnownPathsThatDisappearedUnderScannedRoots() {
    val root = temp.newFolder("root")
    val other = temp.newFolder("other")
    val kept = file(root, "kept.pdf")
    val gone = File(root, "sub/gone.pdf").absolutePath
    val outsideRoot = File(other, "elsewhere.pdf").absolutePath
    val otherExtension = File(root, "gone.docx").absolutePath
    val known = mapOf(
      kept.absolutePath to kept.lastModified(),
      gone to 1L,
      outsideRoot to 1L,
      otherExtension to 1L,
    )

    val run = scan(listOf(root), known = known)

    assertEquals(listOf(gone), run.summary.deleted)
    assertEquals(0, run.summary.emitted)
  }

  @Test
  fun skippedButExistingKnownFilesAreNotReportedDeleted() {
    val root = temp.newFolder("root")
    val inData = file(root, "Android/data/com.app/a.pdf")
    val inObb = file(root, "Android/obb/com.app/b.pdf")
    val inHidden = file(root, ".hidden/c.pdf")
    val hiddenFile = file(root, "docs/.d.pdf")
    val removed = File(root, "docs/removed.pdf").absolutePath
    val known = listOf(inData, inObb, inHidden, hiddenFile)
      .associate { it.absolutePath to it.lastModified() } + (removed to 1L)

    val run = scan(listOf(root), known = known)

    assertEquals(listOf(removed), run.summary.deleted)
    assertTrue(run.files.isEmpty())
  }

  @Test
  fun fileReachableThroughTwoPathsIsNotReportedDeleted() {
    val root = temp.newFolder("root")
    val real = file(root, "real/doc.pdf")
    symlink(File(root, "link"), File(root, "real"))
    val viaLink = File(root, "link/doc.pdf")
    val removed = File(root, "real/removed.pdf").absolutePath
    val known = mapOf(
      real.absolutePath to real.lastModified(),
      viaLink.absolutePath to real.lastModified(),
      removed to 1L,
    )

    val run = scan(listOf(root), known = known)

    // The folder is listed once, so only one of the two paths is walked; the
    // other still exists and must not be reported deleted.
    assertEquals(1, run.summary.scanned)
    assertEquals(listOf(removed), run.summary.deleted)
  }

  @Test
  fun directoriesWithDottedNamesAreTraversed() {
    val root = temp.newFolder("root")
    file(root, "Android/media/com.whatsapp/WhatsApp Documents/a.pdf")
    file(root, "archive.pdf/inside.pdf")

    val run = scan(listOf(root))

    assertEquals(setOf("a.pdf", "inside.pdf"), run.names)
  }

  @Test
  fun missingRootIsNotScannedAndReportsNoDeletions() {
    val missing = File(temp.root, "unmounted")
    val known = mapOf(File(missing, "a.pdf").absolutePath to 1L)

    val run = scan(listOf(missing), known = known)

    assertEquals(0, run.summary.scanned)
    assertTrue(run.summary.deleted.isEmpty())
    assertEquals(0, run.summary.skippedDirs)
  }

  @Test
  fun deliversBatchesOfTheConfiguredSize() {
    val root = temp.newFolder("root")
    repeat(450) { file(root, "dir${it % 3}/f$it.pdf") }

    val run = scan(listOf(root), batchSize = 200)

    assertEquals(listOf(200, 200, 50), run.batches.map { it.size })
    assertEquals(450, run.summary.scanned)
    assertEquals(450, run.summary.emitted)
    assertEquals(450, run.names.size)
  }

  @Test
  fun stopsWhenCancelledAndReportsNoDeletions() {
    val root = temp.newFolder("root")
    repeat(450) { file(root, "f$it.pdf") }
    val known = mapOf(File(root, "gone.pdf").absolutePath to 1L)
    var batchesSeen = 0

    val batches = ArrayList<List<ScannedFile>>()
    val summary = DocumentScanner(
      roots = listOf(root),
      extensions = setOf("pdf"),
      knownMtimes = known,
      batchSize = 200,
      isCancelled = { batchesSeen >= 1 },
    ) {
      batches.add(it)
      batchesSeen++
    }.scan()

    assertTrue(summary.cancelled)
    assertEquals(1, batches.size)
    assertEquals(200, summary.emitted)
    assertTrue(summary.deleted.isEmpty())
  }

  @Test
  fun cancelledBeforeStartScansNothing() {
    val root = temp.newFolder("root")
    file(root, "a.pdf")

    val run = scan(listOf(root), isCancelled = { true })

    assertTrue(run.summary.cancelled)
    assertEquals(0, run.summary.scanned)
    assertTrue(run.batches.isEmpty())
  }

  @Test
  fun overlappingRootsAreListedOnce() {
    val root = temp.newFolder("root")
    file(root, "a.pdf")

    val run = scan(listOf(root, File(root.path + File.separator + ".")))

    assertEquals(1, run.summary.scanned)
  }

  @Test
  fun symlinkLoopTerminatesAndListsEachDirectoryOnce() {
    val root = temp.newFolder("root")
    file(root, "top.pdf")
    file(root, "a/inner.pdf")
    symlink(File(root, "a/loop"), root)
    symlink(File(root, "a/self"), File(root, "a"))

    val run = scan(listOf(root))

    assertEquals(setOf("top.pdf", "inner.pdf"), run.names)
    assertEquals(2, run.summary.scanned)
  }

  @Test
  fun followsAtMostFiveNestedSymlinks() {
    val root = temp.newFolder("root")
    val outside = temp.newFolder("outside")
    val dirs = (1..6).map { File(outside, "d$it").apply { mkdirs() } }
    dirs.forEachIndexed { index, dir -> file(dir, "f${index + 1}.pdf") }
    symlink(File(root, "l1"), dirs[0])
    for (i in 0 until dirs.size - 1) {
      symlink(File(dirs[i], "l${i + 2}"), dirs[i + 1])
    }

    val run = scan(listOf(root))

    assertEquals(setOf("f1.pdf", "f2.pdf", "f3.pdf", "f4.pdf", "f5.pdf"), run.names)
  }

  @Test
  fun followsSymlinkedFiles() {
    val root = temp.newFolder("root")
    val outside = temp.newFolder("outside")
    val target = file(outside, "real.pdf")
    symlink(File(root, "link.pdf"), target)

    val run = scan(listOf(root))

    assertEquals(setOf("link.pdf"), run.names)
    assertEquals(File(root, "link.pdf").absolutePath, run.files.single().path)
  }

  @Test
  fun unreadableDirectoryIsCountedNotThrown() {
    val root = temp.newFolder("root")
    file(root, "ok.pdf")
    val locked = File(root, "locked")
    val inside = file(locked, "hidden-by-perms.pdf")
    val lockedOk = locked.setReadable(false, false)
    try {
      assumeTrue("Cannot make a directory unreadable on this OS/user", lockedOk && locked.listFiles() == null)
      val known = mapOf(inside.absolutePath to inside.lastModified())

      val run = scan(listOf(root), known = known)

      assertEquals(setOf("ok.pdf"), run.names)
      assertEquals(1, run.summary.skippedDirs)
      // Files under a directory that could not be listed are not reported deleted.
      assertTrue(run.summary.deleted.isEmpty())
    } finally {
      locked.setReadable(true, false)
    }
  }

  @Test
  fun deepTreeDoesNotOverflowTheStack() {
    val root = temp.newFolder("root")
    // Deep enough to matter for recursion yet within Windows path limits.
    val deep = File(root, (1..60).joinToString(File.separator) { "d" })
    deep.mkdirs()
    assumeTrue("Filesystem refused the deep tree", deep.isDirectory)
    file(deep, "deep.pdf")

    val run = scan(listOf(root))

    assertEquals(setOf("deep.pdf"), run.names)
  }
}
