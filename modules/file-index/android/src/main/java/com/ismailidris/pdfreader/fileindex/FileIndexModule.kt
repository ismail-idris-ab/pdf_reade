package com.ismailidris.pdfreader.fileindex

import android.Manifest
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.ContentResolver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.database.Cursor
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.storage.StorageManager
import android.provider.DocumentsContract
import android.provider.OpenableColumns
import android.provider.Settings
import android.system.ErrnoException
import android.system.OsConstants
import android.util.Log
import android.webkit.MimeTypeMap
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.core.net.toUri
import expo.modules.interfaces.permissions.PermissionsStatus
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineExceptionHandler
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileNotFoundException
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference

/** Argument of `startScan`. */
class ScanOptions : Record {
  /** Extensions to match, without the dot (case-insensitive). */
  @Field
  val exts: List<String> = emptyList()

  /** Absolute path -> last-modified time (ms) of files already indexed. */
  @Field
  val knownMtimes: Map<String, Double> = emptyMap()
}

/** Argument of `pickDocuments`. */
class PickOptions : Record {
  /** MIME types the picker offers; empty means any type. */
  @Field
  val mimeTypes: List<String> = emptyList()

  /** Whether the user may select several documents. */
  @Field
  val multiple: Boolean = false
}

class FileIndexModule : Module() {
  // Last-resort guard: every launch below catches its own failures, so this
  // only fires on a bug. Logs the exception class only (messages can hold paths).
  private val uncaughtHandler = CoroutineExceptionHandler { _, error ->
    Log.e(TAG, "Uncaught failure in file-index: ${error.javaClass.simpleName}")
  }
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO + uncaughtHandler)
  private val scanCancelFlags = ConcurrentHashMap<String, AtomicBoolean>()

  /** A picker launch waiting for its result. Identity matters: one per call. */
  private class PendingPick(val requestCode: Int, val promise: Promise)

  // Whoever removes a PendingPick from the slot owns settling its promise,
  // so each promise is settled exactly once.
  private val pendingPick = PendingSlot<PendingPick>()
  private val pickSequence = AtomicInteger(0)

  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("FileIndex")

    // Version of the JS-facing contract, exposed for diagnostics. Bump it
    // whenever the module API changes.
    Constant("apiVersion") {
      API_VERSION
    }

    Events(EVENT_SCAN_BATCH, EVENT_SCAN_COMPLETE, EVENT_SCAN_ERROR)

    OnDestroy {
      scanCancelFlags.values.forEach { it.set(true) }
      pendingPick.take()?.promise?.reject(moduleDestroyed())
      scope.cancel()
    }

    Function("hasAllFilesAccess") {
      hasAllFilesAccess()
    }

    AsyncFunction("openAllFilesAccessSettings") { promise: Promise ->
      openAllFilesAccessSettings(promise)
    }

    AsyncFunction("startScan") { options: ScanOptions ->
      startScan(options)
    }

    Function("cancelScan") { scanId: String ->
      scanCancelFlags[scanId]?.set(true)
      Unit
    }

    AsyncFunction("stat") Coroutine { path: String ->
      withContext(Dispatchers.IO) { stat(path) }
    }

    AsyncFunction("copyContentUriToCache") Coroutine { uri: String ->
      withContext(Dispatchers.IO) { copyContentUriToCache(uri) }
    }

    AsyncFunction("share") Coroutine { paths: List<String>, mime: String ->
      share(paths, mime)
    }

    AsyncFunction("pickDocuments") { options: PickOptions, promise: Promise ->
      pickDocuments(options, promise)
    }

    OnActivityResult { _, payload ->
      if (DocumentPick.isPickRequestCode(payload.requestCode)) {
        onPickResult(payload.requestCode, payload.resultCode, payload.data)
      }
    }

    Function("listPersistedUris") {
      listPersistedUris()
    }

    Function("releasePersistedUri") { uri: String ->
      releasePersistedUri(uri)
    }
  }

  private fun moduleDestroyed() = CodedException(ERR_MODULE_DESTROYED, "The file module is shutting down", null)

  // region permissions

  private fun hasAllFilesAccess(): Boolean =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      Environment.isExternalStorageManager()
    } else {
      ContextCompat.checkSelfPermission(context, Manifest.permission.READ_EXTERNAL_STORAGE) ==
        PackageManager.PERMISSION_GRANTED
    }

  /**
   * API 30+: opens the system "All files access" page (per-app first, then the
   * list). API 26-29: shows the runtime READ_EXTERNAL_STORAGE dialog through
   * the Expo permissions service; when the user has blocked further prompts,
   * or no permissions service is linked, opens the app's details page instead.
   * Resolves once the page/dialog has been handled; JS re-checks
   * hasAllFilesAccess() afterwards (e.g. on resume).
   */
  private fun openAllFilesAccessSettings(promise: Promise) {
    if (!scope.isActive) {
      promise.reject(moduleDestroyed())
      return
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      launchOnMain(promise) {
        val packageUri = Uri.fromParts("package", context.packageName, null)
        try {
          startActivity(Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION, packageUri))
        } catch (_: ActivityNotFoundException) {
          startActivity(Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION))
        }
      }
      return
    }

    val permission = Manifest.permission.READ_EXTERNAL_STORAGE
    val permissions = appContext.permissions
    if (permissions == null) {
      launchOnMain(promise) { openAppDetails() }
      return
    }
    try {
      permissions.askForPermissions({ result ->
        val response = result[permission]
        if (response != null && response.status != PermissionsStatus.GRANTED && !response.canAskAgain) {
          launchOnMain(promise) { openAppDetails() }
        } else {
          promise.resolve()
        }
      }, permission)
    } catch (e: Throwable) {
      if (e is CancellationException) throw e
      promise.reject(CodedException(ERR_SETTINGS_FAILED, "Could not request storage access", null))
    }
  }

  private fun openAppDetails() {
    val packageUri = Uri.fromParts("package", context.packageName, null)
    startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, packageUri))
  }

  private fun launchOnMain(promise: Promise, block: () -> Unit) {
    if (!scope.isActive) {
      promise.reject(moduleDestroyed())
      return
    }
    scope.launch(Dispatchers.Main) {
      try {
        block()
        promise.resolve()
      } catch (e: CancellationException) {
        throw e
      } catch (e: ActivityNotFoundException) {
        promise.reject(CodedException(ERR_NO_SETTINGS_SCREEN, "No settings screen available", e))
      } catch (e: SecurityException) {
        promise.reject(FileIndexException(ErrorCode.PERMISSION_DENIED, "Settings screen refused", e))
      } catch (e: CodedException) {
        promise.reject(e)
      } catch (_: Throwable) {
        promise.reject(CodedException(ERR_SETTINGS_FAILED, "Could not open the settings screen", null))
      }
    }
  }

  /** Starts [intent] from the current activity, or from the app context in a new task. */
  private fun startActivity(intent: Intent) {
    val activity = appContext.currentActivity
    if (activity != null) {
      activity.startActivity(intent)
    } else {
      context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
  }

  // endregion

  // region scan

  private fun startScan(options: ScanOptions): String {
    // A cancelled scope would silently drop the launch: reject instead.
    if (!scope.isActive) throw moduleDestroyed()
    val scanId = UUID.randomUUID().toString()
    val cancelFlag = AtomicBoolean(false)
    scanCancelFlags[scanId] = cancelFlag
    val extensions = options.exts.toSet()
    val knownMtimes = options.knownMtimes.mapValues { it.value.toLong() }

    scope.launch {
      val scanContext = coroutineContext
      try {
        if (!hasAllFilesAccess()) {
          sendEvent(
            EVENT_SCAN_ERROR,
            mapOf(
              "scanId" to scanId,
              "code" to ErrorCode.PERMISSION_DENIED.name,
              "message" to "All files access is not granted",
            ),
          )
          return@launch
        }
        val scanner = DocumentScanner(
          roots = storageRoots(),
          extensions = extensions,
          knownMtimes = knownMtimes,
          isCancelled = { cancelFlag.get() || !scanContext.isActive },
          onBatch = { batch ->
            sendEvent(
              EVENT_SCAN_BATCH,
              mapOf("scanId" to scanId, "files" to batch.map { it.toEventMap() }),
            )
          },
        )
        val summary = scanner.scan()
        // After OnDestroy there is no JS side left to notify.
        if (!scanContext.isActive) return@launch
        sendEvent(
          EVENT_SCAN_COMPLETE,
          mapOf(
            "scanId" to scanId,
            "scanned" to summary.scanned,
            "emitted" to summary.emitted,
            "deleted" to summary.deleted,
            "skippedDirs" to summary.skippedDirs,
            "durationMs" to summary.durationMs,
            "cancelled" to summary.cancelled,
          ),
        )
      } catch (e: CancellationException) {
        throw e
      } catch (e: SecurityException) {
        sendScanError(scanId, ErrorCode.PERMISSION_DENIED.name, "Storage access was refused", e)
      } catch (e: OutOfMemoryError) {
        sendScanError(scanId, ErrorCode.OUT_OF_MEMORY.name, "Not enough memory to finish the scan", e)
      } catch (e: Throwable) {
        // Not a file problem the user can fix: a non-shared code, shown in JS
        // as the generic UNKNOWN message (UNSUPPORTED would claim a bad file type).
        sendScanError(scanId, ERR_SCAN_FAILED, "The scan failed unexpectedly", e)
      } finally {
        scanCancelFlags.remove(scanId)
      }
    }
    return scanId
  }

  // code: a shared ErrorCode name, or an ERR_* code that JS maps to UNKNOWN.
  private fun sendScanError(scanId: String, code: String, message: String, cause: Throwable) {
    if (!scope.isActive) return
    try {
      sendEvent(
        EVENT_SCAN_ERROR,
        mapOf(
          "scanId" to scanId,
          "code" to code,
          // Exception class only: messages of file exceptions can contain paths.
          "message" to "$message (${cause.javaClass.simpleName})",
        ),
      )
    } catch (e: Exception) {
      // The JS side is gone (e.g. reload mid-scan); nothing left to notify.
      Log.w(TAG, "Could not deliver scan error: ${e.javaClass.simpleName}")
    }
  }

  /** Primary shared storage plus, on API 30+, every other mounted volume. */
  // getExternalStorageDirectory is deprecated for scoped apps but is the
  // documented primary root for apps holding all-files access.
  @Suppress("DEPRECATION")
  private fun storageRoots(): List<File> {
    val roots = ArrayList<File>()
    roots.add(Environment.getExternalStorageDirectory())
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      val storageManager = context.getSystemService(StorageManager::class.java)
      storageManager?.storageVolumes?.forEach { volume ->
        val state = volume.state
        if (state == Environment.MEDIA_MOUNTED || state == Environment.MEDIA_MOUNTED_READ_ONLY) {
          volume.directory?.let { roots.add(it) }
        }
      }
    }
    val seen = HashSet<String>()
    return roots.filter { root ->
      val key = try {
        root.canonicalPath
      } catch (_: IOException) {
        root.absolutePath
      }
      seen.add(key)
    }
  }

  private fun ScannedFile.toEventMap(): Map<String, Any?> = mapOf(
    "path" to path,
    "name" to name,
    "ext" to ext,
    "size" to size,
    "mtime" to mtime,
  )

  // endregion

  // region stat

  private fun stat(path: String): Map<String, Any?> {
    val file = File(path)
    return try {
      val exists = file.exists()
      val isFile = exists && file.isFile
      mapOf(
        "exists" to exists,
        "isFile" to isFile,
        "size" to if (isFile) file.length() else 0L,
        "mtime" to if (exists) file.lastModified() else 0L,
      )
    } catch (e: SecurityException) {
      throw FileIndexException(ErrorCode.PERMISSION_DENIED, "Cannot read file details", e)
    }
  }

  // endregion

  // region content:// import

  private suspend fun copyContentUriToCache(uriString: String): Map<String, Any?> {
    val uri = uriString.toUri()
    if (uri.scheme != ContentResolver.SCHEME_CONTENT) {
      throw FileIndexException(ErrorCode.UNSUPPORTED, "Only content URIs can be imported")
    }
    val importRoot = File(context.cacheDir, IMPORT_DIR)
    var dir: File? = null
    try {
      deleteStaleFolders(importRoot)
      val resolver = context.contentResolver

      val displayName = queryDisplayName(resolver, uri)
      val mime = try {
        resolver.getType(uri)
      } catch (_: SecurityException) {
        null
      }
      var name = FileNames.sanitize(displayName ?: uri.lastPathSegment)
      if (displayName == null && DocumentScanner.extensionOf(name).isEmpty()) {
        val ext = mime?.let { MimeTypeMap.getSingleton().getExtensionFromMimeType(it) }
        if (!ext.isNullOrEmpty()) name = FileNames.sanitize("$name.$ext")
      }

      val importDir = File(importRoot, UUID.randomUUID().toString())
      dir = importDir
      if (!importDir.mkdirs()) throw IOException("Cannot create import folder")
      val target = File(importDir, name)
      val input = resolver.openInputStream(uri)
        ?: throw FileNotFoundException("Provider returned no stream")
      val copied = input.use { source ->
        target.outputStream().use { sink -> copyCancellable(source, sink) }
      }
      return mapOf(
        "path" to target.absolutePath,
        "name" to name,
        "nameFromProvider" to (displayName != null),
        "size" to copied,
        "mime" to mime,
      )
    } catch (e: Throwable) {
      dir?.deleteRecursively()
      throw mapIoFailure(e, ERR_IMPORT_FAILED, "Cannot import this document")
    }
  }

  /** DISPLAY_NAME from the provider, or null when absent/blank/unsupported. */
  private fun queryDisplayName(resolver: ContentResolver, uri: Uri): String? = try {
    resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
      val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
      if (cursor.moveToFirst() && nameIndex >= 0 && !cursor.isNull(nameIndex)) {
        cursor.getString(nameIndex)?.takeIf { it.isNotBlank() }
      } else {
        null
      }
    }
  } catch (e: SecurityException) {
    throw FileIndexException(ErrorCode.PERMISSION_DENIED, "No permission to read this document", e)
  } catch (_: IllegalArgumentException) {
    // Provider without OpenableColumns support: the caller falls back to the URI.
    null
  } catch (_: UnsupportedOperationException) {
    null
  }

  // endregion

  // region share

  private suspend fun share(paths: List<String>, mime: String) {
    if (paths.isEmpty()) throw FileIndexException(ErrorCode.NOT_FOUND, "No files to share")
    try {
      val ctx = context
      val shareRoot = File(ctx.cacheDir, SHARE_DIR)

      val uris = withContext(Dispatchers.IO) {
        deleteStaleFolders(shareRoot)
        val sources = paths.map { File(it) }
        if (sources.any { !it.isFile }) {
          throw FileIndexException(ErrorCode.NOT_FOUND, "A file to share no longer exists")
        }
        val dir = File(shareRoot, UUID.randomUUID().toString())
        try {
          if (!dir.mkdirs()) throw IOException("Cannot create share folder")
          val authority = FileIndexFileProvider.authority(ctx.packageName)
          sources.map { source ->
            val target = File(dir, FileNames.uniqueIn(dir, FileNames.sanitize(source.name)))
            source.inputStream().use { input ->
              target.outputStream().use { output -> copyCancellable(input, output) }
            }
            FileProvider.getUriForFile(ctx, authority, target)
          }
        } catch (e: Throwable) {
          dir.deleteRecursively()
          throw e
        }
      }

      val send = if (uris.size == 1) {
        Intent(Intent.ACTION_SEND).putExtra(Intent.EXTRA_STREAM, uris[0])
      } else {
        Intent(Intent.ACTION_SEND_MULTIPLE).putParcelableArrayListExtra(Intent.EXTRA_STREAM, ArrayList(uris))
      }
      send.type = mime.ifBlank { "*/*" }
      // ClipData carries the read grant through the chooser to the target app.
      val clip = ClipData.newUri(ctx.contentResolver, FileNames.FALLBACK_NAME, uris[0])
      uris.drop(1).forEach { clip.addItem(ClipData.Item(it)) }
      send.clipData = clip
      send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      val chooser = Intent.createChooser(send, null)

      withContext(Dispatchers.Main) {
        try {
          startActivity(chooser)
        } catch (e: ActivityNotFoundException) {
          throw FileIndexException(ErrorCode.UNSUPPORTED, "No app can receive these files", e)
        }
      }
    } catch (e: Throwable) {
      throw mapIoFailure(e, ERR_SHARE_FAILED, "Cannot share these files")
    }
  }

  // endregion

  // region document picker

  /*
   * Known limitation: process death while the picker is open.
   * When Android kills the app process while the system picker is in front
   * (common on 2-3 GB phones), the result is delivered to a freshly created
   * activity and JS runtime that hold no pending promise, so that pick is
   * lost and the user has to pick again. Grants for that pick are not
   * persisted either.
   * expo-modules-core's registerForActivityResult fallback callback was
   * evaluated and not used. Its own source says the fallback "is not working"
   * (DefaultAppContextActivityResultCaller). Its registry also saves its state
   * only in onHostDestroy, which does not run when the process is killed in
   * the background. On top of that, ReactHost drops onActivityResult while the
   * new React context is not ready yet, which is the normal state right after
   * a cold restart. Recovering the result would need a host-activity hook
   * outside this module.
   */

  private fun pickDocuments(options: PickOptions, promise: Promise) {
    if (!scope.isActive) {
      promise.reject(moduleDestroyed())
      return
    }
    val pick = PendingPick(DocumentPick.requestCodeFor(pickSequence.getAndIncrement()), promise)
    // A newer call replaces a pending one, so a result the system never
    // delivered cannot block picking until restart. The replaced promise is
    // settled here; its late result, if any, no longer matches a request code.
    pendingPick.replace(pick)?.promise?.reject(
      FileIndexException(ErrorCode.CANCELLED, "Replaced by a newer document picker request"),
    )
    // OnDestroy may have run between the first check and the claim above.
    if (!scope.isActive) {
      if (pendingPick.release(pick)) promise.reject(moduleDestroyed())
      return
    }
    val filter = DocumentPick.typeFilter(options.mimeTypes)
    val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
      addCategory(Intent.CATEGORY_OPENABLE)
      type = filter.type
      filter.extraMimeTypes?.let { putExtra(Intent.EXTRA_MIME_TYPES, it.toTypedArray()) }
      putExtra(Intent.EXTRA_ALLOW_MULTIPLE, options.multiple)
      addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
    }
    // If the scope is cancelled before this runs, OnDestroy has already
    // rejected the pending promise.
    scope.launch(Dispatchers.Main) {
      val failure: CodedException? = try {
        val activity = appContext.currentActivity
        if (activity == null) {
          CodedException(ERR_NO_ACTIVITY, "No screen is available to show the document picker", null)
        } else {
          activity.startActivityForResult(intent, pick.requestCode)
          null
        }
      } catch (e: ActivityNotFoundException) {
        CodedException(ERR_NO_PICKER, "No document picker is available", e)
      } catch (_: Throwable) {
        CodedException(ERR_PICK_FAILED, "Could not open the document picker", null)
      }
      // release: if OnDestroy or a newer call already settled it, do nothing.
      if (failure != null && pendingPick.release(pick)) {
        promise.reject(failure)
      }
    }
  }

  /** Called on the main thread when a picker returns. */
  private fun onPickResult(requestCode: Int, resultCode: Int, data: Intent?) {
    // A result for a replaced launch is ignored: its promise is already settled.
    val promise = pendingPick.takeIf { it.requestCode == requestCode }?.promise ?: return
    if (resultCode != Activity.RESULT_OK || data == null) {
      promise.resolve(emptyList<Map<String, Any?>>())
      return
    }
    val clip = data.clipData
    val clipUris = if (clip == null) {
      emptyList()
    } else {
      (0 until clip.itemCount).map { clip.getItemAt(it).uri?.toString() }
    }
    val uris = DocumentPick.collectUris(clipUris, data.data?.toString())
    if (uris.isEmpty()) {
      promise.resolve(emptyList<Map<String, Any?>>())
      return
    }
    if (!scope.isActive) {
      promise.reject(moduleDestroyed())
      return
    }
    // Settled by whichever side takes it first: the job body, or the
    // completion handler when the scope is cancelled (OnDestroy) first.
    val owner = AtomicReference<Promise?>(promise)
    val job = scope.launch {
      try {
        val resolver = context.contentResolver
        val items = uris.map { describePicked(resolver, it) }
        owner.getAndSet(null)?.resolve(items)
      } catch (e: CancellationException) {
        throw e
      } catch (e: CodedException) {
        owner.getAndSet(null)?.reject(e)
      } catch (_: Throwable) {
        owner.getAndSet(null)?.reject(CodedException(ERR_PICK_FAILED, "Could not read the picked documents", null))
      }
    }
    job.invokeOnCompletion { owner.getAndSet(null)?.reject(moduleDestroyed()) }
  }

  /**
   * Tries to persist the read grant and reads the provider metadata of one
   * picked document. The item's `persisted` field is false when the provider
   * offered no persistable grant: the URI then works only in this session.
   * Metadata the provider refuses or lacks is returned as null.
   */
  private fun describePicked(resolver: ContentResolver, uriString: String): Map<String, Any?> {
    val uri = uriString.toUri()
    val persisted = try {
      resolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
      true
    } catch (_: SecurityException) {
      false
    }
    val mime = try {
      resolver.getType(uri)
    } catch (_: SecurityException) {
      null
    } catch (_: IllegalArgumentException) {
      null
    }
    val meta = queryPickedMetadata(resolver, uri)
    return DocumentPick.pickedDocument(uriString, meta.name, meta.size, mime, meta.mtime, persisted)
  }

  private class PickedMetadata(val name: String?, val size: Long?, val mtime: Long?)

  private fun queryPickedMetadata(resolver: ContentResolver, uri: Uri): PickedMetadata {
    val empty = PickedMetadata(null, null, null)
    val withMtime = arrayOf(
      OpenableColumns.DISPLAY_NAME,
      OpenableColumns.SIZE,
      DocumentsContract.Document.COLUMN_LAST_MODIFIED,
    )
    val basic = arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE)
    return try {
      val cursor = try {
        resolver.query(uri, withMtime, null, null, null)
      } catch (_: IllegalArgumentException) {
        // Provider rejects the last-modified column: retry without it.
        resolver.query(uri, basic, null, null, null)
      }
      cursor?.use {
        if (it.moveToFirst()) {
          PickedMetadata(
            name = it.stringOrNull(OpenableColumns.DISPLAY_NAME),
            size = it.longOrNull(OpenableColumns.SIZE),
            mtime = it.longOrNull(DocumentsContract.Document.COLUMN_LAST_MODIFIED),
          )
        } else {
          null
        }
      } ?: empty
    } catch (_: SecurityException) {
      empty
    } catch (_: IllegalArgumentException) {
      empty
    } catch (_: UnsupportedOperationException) {
      empty
    }
  }

  private fun Cursor.stringOrNull(column: String): String? {
    val index = getColumnIndex(column)
    return if (index >= 0 && !isNull(index)) getString(index) else null
  }

  private fun Cursor.longOrNull(column: String): Long? {
    val index = getColumnIndex(column)
    return if (index >= 0 && !isNull(index)) getLong(index) else null
  }

  private fun listPersistedUris(): List<String> =
    DocumentPick.readGranted(
      context.contentResolver.persistedUriPermissions.map { it.uri.toString() to it.isReadPermission },
    )

  /** Releases a persisted read grant; a grant that is not held is ignored. */
  private fun releasePersistedUri(uriString: String) {
    try {
      context.contentResolver.releasePersistableUriPermission(
        uriString.toUri(),
        Intent.FLAG_GRANT_READ_URI_PERMISSION,
      )
    } catch (_: SecurityException) {
      // Not held: already released or never granted.
    } catch (_: IllegalArgumentException) {
      // Not a URI the resolver accepts: nothing to release.
    }
  }

  // endregion

  // region io helpers

  /** Removes staging folders older than [STAGING_TTL_MS]; best effort. */
  private fun deleteStaleFolders(root: File) {
    val cutoff = System.currentTimeMillis() - STAGING_TTL_MS
    root.listFiles()?.forEach { entry ->
      if (entry.lastModified() < cutoff) entry.deleteRecursively()
    }
  }

  private suspend fun copyCancellable(input: InputStream, output: OutputStream): Long {
    val buffer = ByteArray(COPY_BUFFER_BYTES)
    var total = 0L
    while (true) {
      currentCoroutineContext().ensureActive()
      val read = input.read(buffer)
      if (read < 0) break
      output.write(buffer, 0, read)
      total += read
    }
    output.flush()
    return total
  }

  /**
   * Maps any failure to a coded exception with a static message, so no
   * exception text (which can hold URIs or paths) reaches JS. Errno checks run
   * before the FileNotFoundException branch because FileInputStream and
   * FileOutputStream report EACCES/EPERM/EROFS/ENOSPC as FileNotFoundException.
   * Anything unrecognised gets [fallbackCode], a non-shared ERR_* code.
   */
  private fun mapIoFailure(error: Throwable, fallbackCode: String, message: String): Throwable = when {
    error is CancellationException || error is CodedException -> error
    error is OutOfMemoryError -> FileIndexException(ErrorCode.OUT_OF_MEMORY, message)
    hasErrno(error, OsConstants.ENOSPC, "ENOSPC", "No space left on device") ->
      FileIndexException(ErrorCode.NO_SPACE, message)
    hasErrno(error, OsConstants.EACCES, "EACCES", "Permission denied") ||
      hasErrno(error, OsConstants.EPERM, "EPERM", "Operation not permitted") ||
      hasErrno(error, OsConstants.EROFS, "EROFS", "Read-only file system") ->
      FileIndexException(ErrorCode.PERMISSION_DENIED, message)
    error is SecurityException -> FileIndexException(ErrorCode.PERMISSION_DENIED, message)
    error is FileNotFoundException -> FileIndexException(ErrorCode.NOT_FOUND, message)
    else -> CodedException(fallbackCode, message, null)
  }

  /** True when [errno] (as ErrnoException) or one of [markers] appears in the cause chain. */
  private fun hasErrno(error: Throwable, errno: Int, vararg markers: String): Boolean {
    var current: Throwable? = error
    while (current != null) {
      if (current is ErrnoException && current.errno == errno) return true
      val text = current.message
      if (text != null && markers.any { text.contains(it) }) return true
      current = current.cause
    }
    return false
  }

  // endregion

  companion object {
    const val API_VERSION = 3

    private const val TAG = "FileIndex"

    private const val EVENT_SCAN_BATCH = "onScanBatch"
    private const val EVENT_SCAN_COMPLETE = "onScanComplete"
    private const val EVENT_SCAN_ERROR = "onScanError"

    private const val IMPORT_DIR = "imports"
    private const val SHARE_DIR = "share"
    private const val STAGING_TTL_MS = 24L * 60 * 60 * 1000
    private const val COPY_BUFFER_BYTES = 64 * 1024

    // Non-shared codes for failures that are not the user's file problem;
    // JS maps any code outside the shared ErrorCode list to UNKNOWN.
    private const val ERR_SCAN_FAILED = "ERR_SCAN_FAILED"
    private const val ERR_NO_SETTINGS_SCREEN = "ERR_NO_SETTINGS_SCREEN"
    private const val ERR_SETTINGS_FAILED = "ERR_SETTINGS_FAILED"
    private const val ERR_IMPORT_FAILED = "ERR_IMPORT_FAILED"
    private const val ERR_SHARE_FAILED = "ERR_SHARE_FAILED"
    private const val ERR_MODULE_DESTROYED = "ERR_MODULE_DESTROYED"
    private const val ERR_NO_ACTIVITY = "ERR_NO_ACTIVITY"
    private const val ERR_NO_PICKER = "ERR_NO_PICKER"
    private const val ERR_PICK_FAILED = "ERR_PICK_FAILED"
  }
}
