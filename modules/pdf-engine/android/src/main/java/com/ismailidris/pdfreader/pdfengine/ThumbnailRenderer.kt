package com.ismailidris.pdfreader.pdfengine

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.ParcelFileDescriptor
import android.provider.DocumentsContract
import android.system.ErrnoException
import android.system.OsConstants
import androidx.core.graphics.createBitmap
import androidx.core.net.toUri
import expo.modules.kotlin.exception.CodedException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext
import java.io.Closeable
import java.io.File
import java.io.FileNotFoundException
import java.io.FileOutputStream
import java.io.IOException

internal fun ThumbnailResult.toMap(): Map<String, Any> = mapOf(
  "uri" to file.toUri().toString(),
  "width" to width,
  "height" to height,
)

/**
 * File, provider and PDFium work behind renderThumbnail. Provider IPC, file
 * checks, copies and encoding run on [ioDispatcher]; only PDFium calls run on
 * [pdfiumDispatcher]. Error messages are static so no path or URI reaches JS
 * or Sentry.
 */
internal class ThumbnailRenderer(
  context: Context,
  private val ioDispatcher: CoroutineDispatcher = Dispatchers.IO,
  private val pdfiumDispatcher: CoroutineDispatcher = PdfiumThread.dispatcher,
  private val cacheCapBytes: Long = CacheTrimPlan.THUMBNAIL_CACHE_CAP_BYTES,
  private val copyCapBytes: Long = MAX_SOURCE_COPY_BYTES,
) : ThumbnailStages<Bitmap> {
  private val appContext = context.applicationContext
  val cacheDir = File(appContext.cacheDir, CACHE_DIR_NAME)
  private val copyDir = File(cacheDir, COPY_DIR_NAME)

  /** A source opened on IO, ready for PDFium to open by [pdfiumPath]. */
  private class OpenedSource(
    val pdfiumPath: String,
    /** Set for content:// sources, which may fall back to a private copy. */
    val contentUri: Uri?,
    /** Size reported by the provider, or -1 when unknown. */
    val declaredSize: Long,
    private val descriptor: ParcelFileDescriptor?,
  ) : Closeable {
    fun exists() = contentUri != null || File(pdfiumPath).exists()

    override fun close() {
      descriptor?.close()
    }
  }

  fun cacheFile(key: String) = File(cacheDir, key + THUMB_SUFFIX)

  override fun cached(job: ThumbnailJob): ThumbnailResult? = cached(job.key)

  /**
   * The cached thumbnail for [key], touched as most recently used, or null on
   * a miss. An unreadable cache file is deleted and reported as a miss.
   */
  fun cached(key: String): ThumbnailResult? {
    val file = cacheFile(key)
    if (!file.isFile) return null
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(file.path, bounds)
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) {
      file.delete()
      return null
    }
    file.setLastModified(System.currentTimeMillis())
    return ThumbnailResult(file, bounds.outWidth, bounds.outHeight)
  }

  // Called on the IO dispatcher (see ThumbnailStages.render), so code outside
  // the withContext(pdfiumDispatcher) blocks runs on IO. Cleanup in finally
  // runs inline: a withContext there would be skipped once cancelled.
  override suspend fun render(job: ThumbnailJob): Bitmap {
    // NonCancellable: an opened descriptor or finished copy is always handed back
    // here to be closed or deleted, never dropped by a cancelled resume.
    val source = withContext(ioDispatcher + NonCancellable) { openSource(job.source) }
    val direct = try {
      withContext(pdfiumDispatcher) {
        renderOnPdfium(source.pdfiumPath, job.widthPx, source::exists, copyFallback = source.contentUri != null)
      }
    } finally {
      source.close()
    }
    if (direct != null) return direct
    // The provider's descriptor cannot be reopened by path (pipe, socket):
    // render a bounded private copy instead.
    val uri = source.contentUri ?: throw corrupt()
    val copy = withContext(ioDispatcher + NonCancellable) { copyToCache(uri, source.declaredSize) }
    try {
      return withContext(pdfiumDispatcher) {
        renderOnPdfium(copy.path, job.widthPx, copy::exists, copyFallback = false)
      } ?: throw corrupt()
    } finally {
      copy.delete()
    }
  }

  override fun write(rendered: Bitmap, job: ThumbnailJob): ThumbnailResult = write(rendered, job.key)

  override fun release(rendered: Bitmap) {
    if (!rendered.isRecycled) rendered.recycle()
  }

  // usableSpace only classifies an encode that already failed; nothing is
  // being allocated, so getAllocatableBytes/allocateBytes do not apply.
  /** Encodes [bitmap] as WebP to a temp file, verifies it, then renames it into place. */
  @SuppressLint("UsableSpace")
  fun write(bitmap: Bitmap, key: String): ThumbnailResult {
    try {
      if (!cacheDir.isDirectory && !cacheDir.mkdirs() && !cacheDir.isDirectory) {
        throw IOException("Cannot create thumbnail directory")
      }
      val temp = File.createTempFile("$key.", TEMP_SUFFIX, cacheDir)
      try {
        FileOutputStream(temp).use { out ->
          if (!bitmap.compress(webpFormat(), WEBP_QUALITY, out)) throw IOException("WebP encoding failed")
          out.flush()
          out.fd.sync()
        }
        if (temp.length() <= 0L) throw IOException("WebP output is empty")
        val target = cacheFile(key)
        if (!temp.renameTo(target)) throw IOException("Cannot move thumbnail into place")
        return ThumbnailResult(target, bitmap.width, bitmap.height)
      } finally {
        if (temp.exists()) temp.delete()
      }
    } catch (e: IOException) {
      if (isNoSpace(e) || cacheDir.usableSpace in 0 until LOW_SPACE_BYTES) {
        throw PdfEngineException(ErrorCode.NO_SPACE, "Not enough storage to save the thumbnail")
      }
      throw e
    }
  }

  /**
   * Keeps the cache under [cacheCapBytes] (LRU by lastModified, down to 80%)
   * and removes temp files and source copies left by interrupted work.
   */
  fun trim() {
    val now = System.currentTimeMillis()
    val files = cacheDir.listFiles() ?: return
    val thumbs = ArrayList<CacheEntry>()
    val temps = ArrayList<CacheEntry>()
    for (file in files) {
      if (!file.isFile) continue
      val entry = CacheEntry(file.name, file.length(), file.lastModified())
      when {
        file.name.endsWith(THUMB_SUFFIX) -> thumbs.add(entry)
        file.name.endsWith(TEMP_SUFFIX) -> temps.add(entry)
      }
    }
    copyDir.listFiles()?.forEach { file ->
      if (file.isFile) temps.add(CacheEntry("$COPY_DIR_NAME/${file.name}", file.length(), file.lastModified()))
    }
    CacheTrimPlan.staleTemps(temps, now).forEach { File(cacheDir, it.name).delete() }
    CacheTrimPlan.evictions(thumbs, capBytes = cacheCapBytes).forEach { File(cacheDir, it.name).delete() }
  }

  /** Maps any render failure to a coded exception with a static message and no cause. */
  override fun mapFailure(error: Throwable): CodedException {
    val pdfiumCode = if (error is IOException) PdfiumErrors.parseCode(error.message) else null
    return when {
      error is CodedException -> error
      error is OutOfMemoryError ->
        PdfEngineException(ErrorCode.OUT_OF_MEMORY, "Not enough memory to render the thumbnail")
      pdfiumCode != null -> pdfiumFailure(pdfiumCode, fileExists = true)
      isNoSpace(error) -> PdfEngineException(ErrorCode.NO_SPACE, "Not enough storage to save the thumbnail")
      error is SecurityException -> permissionDenied()
      else -> CodedException(ERR_THUMBNAIL_FAILED, "Could not create the thumbnail", null)
    }
  }

  /** IO only: resolves [source] to something PDFium can open by path. */
  private fun openSource(source: String): OpenedSource {
    if (source.startsWith(CONTENT_PREFIX)) return openContent(source.toUri())
    val path = if (source.startsWith(FILE_PREFIX)) source.toUri().path ?: throw notFound() else source
    if (!File(path).isFile) throw notFound()
    return OpenedSource(path, contentUri = null, declaredSize = -1, descriptor = null)
  }

  private fun openContent(uri: Uri): OpenedSource {
    if (isVirtualDocument(uri)) throw unavailable()
    val descriptor = try {
      appContext.contentResolver.openFileDescriptor(uri, "r")
    } catch (e: SecurityException) {
      throw permissionDenied()
    } catch (e: FileNotFoundException) {
      throw notFound()
    } ?: throw unavailable()
    return OpenedSource("/proc/self/fd/${descriptor.fd}", uri, descriptor.statSize, descriptor)
  }

  /**
   * True for documents with no byte representation of their own (e.g. cloud
   * docs that only export); opening those could trigger a download.
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

  /** IO only: copies [uri] into cacheDir/thumbs/tmp, refusing sources over [copyCapBytes]. */
  private fun copyToCache(uri: Uri, declaredSize: Long): File {
    if (declaredSize > copyCapBytes) throw tooLarge()
    if (!copyDir.isDirectory && !copyDir.mkdirs() && !copyDir.isDirectory) {
      throw IOException("Cannot create copy directory")
    }
    val copy = File.createTempFile("source.", ".pdf", copyDir)
    try {
      val input = try {
        appContext.contentResolver.openInputStream(uri)
      } catch (e: SecurityException) {
        throw permissionDenied()
      } catch (e: FileNotFoundException) {
        throw notFound()
      } ?: throw unavailable()
      input.use { stream ->
        FileOutputStream(copy).use { out ->
          val buffer = ByteArray(COPY_BUFFER_BYTES)
          var total = 0L
          while (true) {
            val read = stream.read(buffer)
            if (read < 0) break
            total += read
            if (total > copyCapBytes) throw tooLarge()
            out.write(buffer, 0, read)
          }
        }
      }
      return copy
    } catch (e: Throwable) {
      copy.delete()
      if (e is IOException && isNoSpace(e)) {
        throw PdfEngineException(ErrorCode.NO_SPACE, "Not enough storage to read the file")
      }
      throw e
    }
  }

  /**
   * PDFium thread only: renders page 1 to a new bitmap the caller must
   * recycle. Returns null only when [copyFallback] is set and PDFium could not
   * open [path] as a file.
   */
  private fun renderOnPdfium(path: String, width: Int, fileExists: () -> Boolean, copyFallback: Boolean): Bitmap? {
    val handle = try {
      PdfiumNative.open(path)
    } catch (e: IOException) {
      val code = PdfiumErrors.parseCode(e.message) ?: throw e
      if (copyFallback && code == PdfiumErrors.FPDF_ERR_FILE) return null
      throw pdfiumFailure(code, fileExists())
    }
    return withPdfiumDocument(handle) { doc ->
      if (PdfiumNative.pageCount(doc) <= 0) throw corrupt()
      val size = PdfiumNative.pageSize(doc, 0)
      val geometry = ThumbnailMath.geometryFor(width, size[0], size[1])
      val bitmap = createBitmap(geometry.bitmapWidth, geometry.bitmapHeight, Bitmap.Config.ARGB_8888)
      try {
        bitmap.eraseColor(Color.WHITE)
        // Full-page scale anchored top-left: a tall page is top-cropped.
        PdfiumNative.renderPage(doc, 0, bitmap, geometry.renderWidth, geometry.renderHeight)
      } catch (e: Throwable) {
        bitmap.recycle()
        throw e
      }
      bitmap
    }
  }

  private fun pdfiumFailure(code: Int, fileExists: Boolean): CodedException =
    when (PdfiumErrors.errorCodeFor(code, fileExists)) {
      ErrorCode.PASSWORD_REQUIRED -> PdfEngineException(ErrorCode.PASSWORD_REQUIRED, "The document is password protected")
      ErrorCode.CORRUPT_FILE -> corrupt()
      ErrorCode.NOT_FOUND -> notFound()
      ErrorCode.UNSUPPORTED -> PdfEngineException(ErrorCode.UNSUPPORTED, "The document uses unsupported security")
      else -> CodedException(ERR_THUMBNAIL_FAILED, "Could not create the thumbnail", null)
    }

  private fun corrupt() = PdfEngineException(ErrorCode.CORRUPT_FILE, "The document is damaged or not a PDF")

  private fun notFound() = PdfEngineException(ErrorCode.NOT_FOUND, "The document could not be found")

  private fun permissionDenied() = PdfEngineException(ErrorCode.PERMISSION_DENIED, "Access to the file was refused")

  private fun tooLarge() = CodedException(ERR_THUMBNAIL_TOO_LARGE, "The document is too large to preview", null)

  private fun unavailable() =
    CodedException(ERR_THUMBNAIL_UNAVAILABLE, "No preview is available for this document", null)

  // WEBP is deprecated from API 30 in favour of WEBP_LOSSY; minSdk is 26.
  @Suppress("DEPRECATION")
  private fun webpFormat(): Bitmap.CompressFormat =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) Bitmap.CompressFormat.WEBP_LOSSY else Bitmap.CompressFormat.WEBP

  /** True when ENOSPC appears in the cause chain, as ErrnoException or in a message. */
  private fun isNoSpace(error: Throwable): Boolean {
    var current: Throwable? = error
    while (current != null) {
      if (current is CancellationException) return false
      if (current is ErrnoException && current.errno == OsConstants.ENOSPC) return true
      val text = current.message
      if (text != null && (text.contains("ENOSPC") || text.contains("No space left on device"))) return true
      current = current.cause
    }
    return false
  }

  companion object {
    const val CACHE_DIR_NAME = "thumbs"
    const val COPY_DIR_NAME = "tmp"
    const val THUMB_SUFFIX = ".webp"
    const val TEMP_SUFFIX = ".tmp"

    /** Largest content:// source copied privately when its descriptor cannot be opened by path. */
    const val MAX_SOURCE_COPY_BYTES = 50L * 1024 * 1024

    private const val CONTENT_PREFIX = "content://"
    private const val FILE_PREFIX = "file://"
    private const val WEBP_QUALITY = 80
    private const val COPY_BUFFER_BYTES = 64 * 1024

    // Bitmap.compress reports write failures only as `false`; below this much
    // free space a failed encode is reported as NO_SPACE.
    private const val LOW_SPACE_BYTES = 2L * 1024 * 1024
  }
}
