package com.ismailidris.pdfreader.fileindex

import android.content.Context
import android.os.Environment
import androidx.core.content.FileProvider
import androidx.test.platform.app.InstrumentationRegistry
import expo.modules.kotlin.exception.CodedException
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Assume.assumeFalse
import org.junit.Before
import org.junit.Test
import java.io.File
import java.util.UUID

/**
 * File actions against the real Android filesystem, content resolver and
 * this module's FileProvider. Shared storage is only checked for refusals:
 * the test APK never holds all-files access.
 */
class FileActionsTest {
  private lateinit var context: Context
  private lateinit var actions: FileActions
  private lateinit var root: File
  private lateinit var shareDir: File

  @Before
  fun setUp() {
    context = InstrumentationRegistry.getInstrumentation().targetContext
    actions = FileActions(context)
    File(context.filesDir, FileActions.MY_FILES_DIR).deleteRecursively()
    root = actions.myFilesRoot()
    shareDir = File(context.cacheDir, "share/test-${UUID.randomUUID()}").apply { mkdirs() }
  }

  @After
  fun tearDown() {
    File(context.filesDir, FileActions.MY_FILES_DIR).deleteRecursively()
    shareDir.deleteRecursively()
  }

  private fun write(dir: File, name: String, bytes: ByteArray = name.toByteArray()): File =
    File(dir, name).apply { writeBytes(bytes) }

  private fun expectCode(code: String, block: suspend () -> Unit) {
    try {
      runBlocking { block() }
      fail("expected $code")
    } catch (e: CodedException) {
      assertEquals(code, e.code)
    }
  }

  @Test
  fun myFilesRootIsCreatedInsideAppStorage() {
    File(context.filesDir, FileActions.MY_FILES_DIR).deleteRecursively()
    val created = actions.myFilesRoot()
    assertTrue(created.isDirectory)
    assertEquals(FileActions.MY_FILES_DIR, created.name)
    assertEquals(File(context.filesDir, FileActions.MY_FILES_DIR).canonicalPath, created.path)
    // Idempotent.
    assertEquals(created.path, actions.myFilesRoot().path)
  }

  @Test
  fun folderLifecycle() = runBlocking {
    val work = actions.createFolder(root.path, "Work")
    assertTrue(work.isDirectory)
    actions.createFolder(root.path, "archive")
    write(root, "b.pdf")
    expectCode(FileOpCodes.ERR_NAME_EXISTS) { actions.createFolder(root.path, "Work") }
    expectCode(FileOpCodes.ERR_NAME_INVALID) { actions.createFolder(root.path, "a/b") }

    val (listed, entries) = actions.listFolder(root.path)
    assertEquals(root.path, listed)
    assertEquals(listOf("archive", "Work", "b.pdf"), entries.map { it.name })

    val renamed = actions.renameFolder(work.path, "Jobs")
    assertEquals(File(root, "Jobs").path, renamed.path)
    write(File(renamed.path), "inside.pdf", ByteArray(7))
    val stats = actions.folderStats(root.path)
    assertEquals(2L, stats.fileCount)
    assertEquals(2L, stats.folderCount)

    actions.deleteFolder(renamed.path)
    assertFalse(File(renamed.path).exists())
    expectCode(ErrorCode.PERMISSION_DENIED.name) { actions.deleteFolder(root.path) }
    assertTrue(root.isDirectory)
  }

  @Test
  fun fileActionsInMyFiles() = runBlocking {
    val bytes = ByteArray(150_000) { (it % 199).toByte() }
    val source = write(root, "Report.pdf", bytes)
    val sub = File(actions.createFolder(root.path, "Sub").path)

    val copy = actions.copyFile(source.path, root.path)
    assertEquals("Report (copy).pdf", copy.name)
    assertArrayEquals(bytes, File(copy.path).readBytes())

    val moved = actions.moveFile(copy.path, sub.path)
    assertEquals(File(sub, "Report (copy).pdf").path, moved.path)
    assertFalse(File(copy.path).exists())

    val renamed = actions.renameFile(moved.path, "Final.pdf")
    assertEquals("Final.pdf", renamed.name)
    assertEquals(bytes.size.toLong(), renamed.size)
    expectCode(FileOpCodes.ERR_NAME_EXISTS) { actions.renameFile(source.path, "Sub") }

    actions.deleteFile(renamed.path)
    assertFalse(File(renamed.path).exists())
    expectCode(ErrorCode.NOT_FOUND.name) { actions.deleteFile(renamed.path) }
    assertArrayEquals(bytes, source.readBytes())
  }

  @Test
  fun importsFromAContentUri() = runBlocking {
    val bytes = ByteArray(80_000) { (it % 97).toByte() }
    val file = write(shareDir, "Scan.pdf", bytes)
    val authority = FileIndexFileProvider.authority(context.packageName)
    val uri = FileProvider.getUriForFile(context, authority, file).toString()
    val missing = FileProvider.getUriForFile(context, authority, File(shareDir, "missing.pdf")).toString()
    write(root, "Scan.pdf")

    val results = actions.importDocuments(listOf(uri, "file:///sdcard/x.pdf", missing), root.path)
    assertEquals(listOf(uri, "file:///sdcard/x.pdf", missing), results.map { it.uri })

    val imported = results[0].file
    assertNotNull(imported)
    assertNull(results[0].errorCode)
    assertEquals("Scan (1).pdf", imported!!.name)
    assertArrayEquals(bytes, File(imported.path).readBytes())

    assertEquals(ErrorCode.UNSUPPORTED.name, results[1].errorCode)
    assertEquals(ErrorCode.NOT_FOUND.name, results[2].errorCode)
    assertNull(results[2].file)
    // No temp files left behind.
    assertEquals(setOf("Scan.pdf", "Scan (1).pdf"), root.list()!!.toSet())
  }

  @Test
  fun importRejectsADestinationOutsideMyFiles() {
    expectCode(ErrorCode.PERMISSION_DENIED.name) {
      actions.importDocuments(listOf("content://x/y"), context.cacheDir.path)
    }
  }

  @Test
  fun nonDocumentUrisHaveNoCapabilities() = runBlocking {
    val file = write(shareDir, "a.pdf")
    val uri = FileProvider.getUriForFile(context, FileIndexFileProvider.authority(context.packageName), file)
    val caps = actions.documentCapabilities(uri.toString())
    assertFalse(caps.canRename)
    assertFalse(caps.canDelete)
    val garbage = actions.documentCapabilities("not a uri")
    assertFalse(garbage.canRename || garbage.canDelete)
  }

  @Test
  fun refusesPathsOutsideTheAllowedRoots() {
    val cacheFile = write(context.cacheDir, "private.pdf")
    try {
      expectCode(ErrorCode.PERMISSION_DENIED.name) { actions.renameFile(cacheFile.path, "x.pdf") }
      expectCode(ErrorCode.PERMISSION_DENIED.name) { actions.deleteFile(cacheFile.path) }
      expectCode(ErrorCode.PERMISSION_DENIED.name) { actions.copyFile(cacheFile.path, root.path) }
      expectCode(ErrorCode.PERMISSION_DENIED.name) { actions.listFolder(context.filesDir.path) }
      expectCode(ErrorCode.PERMISSION_DENIED.name) { actions.listFolder("${root.path}/..") }
      expectCode(ErrorCode.PERMISSION_DENIED.name) { actions.deleteFile("/system/build.prop") }
      expectCode(ErrorCode.PERMISSION_DENIED.name) { actions.listFolder("/") }
      val inRoot = write(root, "a.pdf")
      expectCode(ErrorCode.PERMISSION_DENIED.name) { actions.moveFile(inRoot.path, context.cacheDir.path) }
      assertTrue(cacheFile.exists())
      assertTrue(inRoot.exists())
    } finally {
      cacheFile.delete()
    }
  }

  @Test
  fun printPathsMustLieInAllowedRoots() {
    val inRoot = write(root, "print.pdf")
    assertEquals(inRoot.path, actions.resolveReadablePath(inRoot.path).path)
    val cacheFile = write(context.cacheDir, "print-private.pdf")
    try {
      for (path in listOf(cacheFile.path, "${root.path}/../../cache/print-private.pdf", "relative.pdf", "/system/build.prop")) {
        try {
          actions.resolveReadablePath(path)
          fail("expected PERMISSION_DENIED")
        } catch (e: CodedException) {
          assertEquals(ErrorCode.PERMISSION_DENIED.name, e.code)
        }
      }
    } finally {
      cacheFile.delete()
    }
  }

  @Test
  fun leadingDotNamesAreRefused() {
    expectCode(FileOpCodes.ERR_NAME_INVALID) { actions.createFolder(root.path, ".hidden") }
  }

  @Test
  fun sharedStorageNeedsWriteAccess() {
    assumeFalse(SharedWriteAccess.has(context))
    @Suppress("DEPRECATION")
    val shared = File(Environment.getExternalStorageDirectory(), "Download/never-created.pdf")
    expectCode(ErrorCode.PERMISSION_DENIED.name) { actions.deleteFile(shared.path) }
    expectCode(ErrorCode.PERMISSION_DENIED.name) { actions.renameFile(shared.path, "x.pdf") }
  }
}
