package com.ismailidris.pdfreader.pdfengine

import android.content.Context
import android.net.Uri
import android.os.StatFs
import android.provider.OpenableColumns
import android.provider.DocumentsContract
import androidx.core.net.toUri
import expo.modules.kotlin.exception.CodedException
import java.io.File
import java.io.FileNotFoundException
import java.io.FileOutputStream
import java.io.IOException
import java.util.concurrent.CancellationException

/** Where PDFium should open a source from; [copy] is a private cache copy owned by the caller. */
internal class ResolvedSource(val path: String, val copy: File?) {
  fun exists(): Boolean = File(path).isFile
}

/**
 * Resolves reader sources (absolute path, file:// or content://) to a local
 * path. content:// documents are always copied into [copyDir] first (CLAUDE.md:
 * content:// inputs are processed from the app cache). Blocking: call on IO.
 * Error messages are static so no path, name or URI reaches JS or logs.
 */
internal class ReaderSources(context: Context) {
  private val appContext = context.applicationContext
  val copyDir = File(appContext.cacheDir, COPY_DIR_NAME)

  /**
   * Returns a path PDFium can open. When a copy is made and anything after
   * that fails, the copy is deleted before the exception leaves. The copy
   * loop polls [isCancelled] per chunk and stops with CancellationException.
   */
  fun resolve(source: String, isCancelled: () -> Boolean = { false }): ResolvedSource {
    if (source.startsWith(CONTENT_PREFIX)) return copyContent(source.toUri(), isCancelled)
    val path = when {
      source.startsWith(FILE_PREFIX) -> source.toUri().path ?: throw notFound()
      source.startsWith("/") -> source
      else -> throw CodedException(ERR_INVALID_ARGUMENT, "The document source is not a path or URI", null)
    }
    val file = File(path)
    try {
      if (!file.isFile) throw notFound()
      if (!file.canRead()) throw permissionDenied()
    } catch (e: SecurityException) {
      throw permissionDenied()
    }
    return ResolvedSource(path, copy = null)
  }

  /**
   * Deletes copies left behind by an earlier process (crash or kill before
   * close). Runs once per process, before the first copy is made, when no
   * copy of this process can exist yet.
   */
  fun cleanStaleCopiesOnce() {
    synchronized(cleanupLock) {
      if (staleCopiesCleaned) return
      staleCopiesCleaned = true
      copyDir.listFiles()?.forEach { it.delete() }
    }
  }

  private fun copyContent(uri: Uri, isCancelled: () -> Boolean): ResolvedSource {
    if (isVirtualDocument(uri)) {
      throw PdfEngineException(ErrorCode.UNSUPPORTED, "This document has no file to open")
    }
    cleanStaleCopiesOnce()
    if (!copyDir.isDirectory && !copyDir.mkdirs() && !copyDir.isDirectory) {
      throw IOException("Cannot create the reader copy directory")
    }
    // Fail before copying anything when the provider's size cannot fit. An
    // unknown size is copied anyway; ENOSPC during the copy maps to NO_SPACE.
    if (!hasRoomForCopy(declaredSize(uri), StatFs(copyDir.path).availableBytes)) throw noSpace()
    val copy = File.createTempFile("doc.", ".pdf", copyDir)
    try {
      val input = try {
        appContext.contentResolver.openInputStream(uri)
      } catch (e: SecurityException) {
        throw permissionDenied()
      } catch (e: FileNotFoundException) {
        throw notFound()
      } ?: throw notFound()
      input.use { stream ->
        FileOutputStream(copy).use { out ->
          val buffer = ByteArray(COPY_BUFFER_BYTES)
          while (true) {
            if (isCancelled()) throw CancellationException("The open was cancelled")
            val read = stream.read(buffer)
            if (read < 0) break
            out.write(buffer, 0, read)
          }
          out.flush()
        }
      }
      return ResolvedSource(copy.path, copy)
    } catch (e: Throwable) {
      copy.delete()
      if (e is IOException && isNoSpace(e)) {
        throw noSpace()
      }
      if (e is SecurityException) throw permissionDenied()
      throw e
    }
  }

  /**
   * True for documents with no byte representation of their own (e.g. cloud
   * docs that only export); there is no PDF to read without converting them.
   */
  private fun isVirtualDocument(uri: Uri): Boolean {
    if (!DocumentsContract.isDocumentUri(appContext, uri)) return false
    val projection = arrayOf(DocumentsContract.Document.COLUMN_FLAGS)
    val cursor = try {
      appContext.contentResolver.query(uri, projection, null, null, null)
    } catch (e: SecurityException) {
      throw permissionDenied()
    } catch (e: IllegalArgumentException) {
      // Provider without a flags column: not a virtual document.
      return false
    } ?: return false
    cursor.use {
      if (!it.moveToFirst()) return false
      val index = it.getColumnIndex(DocumentsContract.Document.COLUMN_FLAGS)
      if (index < 0 || it.isNull(index)) return false
      return (it.getLong(index) and DocumentsContract.Document.FLAG_VIRTUAL_DOCUMENT.toLong()) != 0L
    }
  }

  /** The provider's OpenableColumns.SIZE, or -1 when it does not say. */
  private fun declaredSize(uri: Uri): Long {
    val cursor = try {
      appContext.contentResolver.query(uri, arrayOf(OpenableColumns.SIZE), null, null, null)
    } catch (e: SecurityException) {
      throw permissionDenied()
    } catch (e: IllegalArgumentException) {
      return -1
    } ?: return -1
    cursor.use {
      if (!it.moveToFirst()) return -1
      val index = it.getColumnIndex(OpenableColumns.SIZE)
      if (index < 0 || it.isNull(index)) return -1
      return it.getLong(index)
    }
  }

  private fun noSpace() = PdfEngineException(ErrorCode.NO_SPACE, "Not enough storage to open the document")

  private fun notFound() = PdfEngineException(ErrorCode.NOT_FOUND, "The document could not be found")

  private fun permissionDenied() = PdfEngineException(ErrorCode.PERMISSION_DENIED, "Access to the file was refused")

  companion object {
    const val COPY_DIR_NAME = "reader-docs"

    /** Free space kept beyond the copy itself, for PDFium and the rest of the app. */
    const val COPY_SPACE_MARGIN_BYTES = 16L * 1024 * 1024

    /** False only when the provider declared a size that, with the margin, exceeds [availableBytes]. */
    fun hasRoomForCopy(declaredSize: Long, availableBytes: Long): Boolean {
      if (declaredSize < 0) return true
      // Subtract from the available side: declaredSize + margin can overflow.
      if (availableBytes < COPY_SPACE_MARGIN_BYTES) return false
      return declaredSize <= availableBytes - COPY_SPACE_MARGIN_BYTES
    }

    private const val CONTENT_PREFIX = "content://"
    private const val FILE_PREFIX = "file://"
    private const val COPY_BUFFER_BYTES = 64 * 1024

    private val cleanupLock = Any()

    // Process-wide: a module re-created after a JS reload must not delete the
    // copies of documents the previous instance still has open.
    private var staleCopiesCleaned = false
  }
}
