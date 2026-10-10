package com.ismailidris.pdfreader.fileindex

import android.Manifest
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.ContentResolver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.CancellationSignal
import android.os.Environment
import android.os.ParcelFileDescriptor
import android.print.PageRange
import android.print.PrintAttributes
import android.print.PrintDocumentAdapter
import android.print.PrintDocumentInfo
import android.print.PrintManager
import android.provider.OpenableColumns
import android.provider.Settings
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
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileNotFoundException
import java.io.FileOutputStream
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

  /**
   * Whether to persist the grants of the picked documents (default). False
   * for one-off use: only the temporary read grant is used and every item
   * reports `persisted: false`.
   */
  @Field
  val persist: Boolean = true
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
  private class PendingPick(val requestCode: Int, val promise: Promise, val persist: Boolean)

  // Whoever removes a PendingPick from the slot owns settling its promise,
  // so each promise is settled exactly once.
  private val pendingPick = PendingSlot<PendingPick>()
  private val pickSequence = AtomicInteger(0)

  // The outstanding requestSharedWriteAccess promise, held the same way: the
  // permission listener and OnDestroy race for it, and only one can settle it.
  private val pendingWriteAccess = PendingSlot<OneShotPromise>()

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

    OnCreate {
      // Repairs what a crash left behind (interrupted case-only renames,
      // unfinished copies) once per module start, off the main thread.
      scope.launch {
        try {
          actions.replayJournal()
        } catch (e: CancellationException) {
          throw e
        } catch (e: Exception) {
          // Class only: messages of file exceptions can contain paths.
          Log.w(TAG, "Journal replay skipped: ${e.javaClass.simpleName}")
        }
      }
    }

    OnDestroy {
      scanCancelFlags.values.forEach { it.set(true) }
      pendingPick.take()?.promise?.reject(moduleDestroyed())
      // A storage-access dialog may still be showing; its listener will find
      // the promise already settled and do nothing.
      pendingWriteAccess.take()?.settle { it.reject(moduleDestroyed()) }
      scope.cancel()
    }

    Function("hasAllFilesAccess") {
      hasAllFilesAccess()
    }

    AsyncFunction("openAllFilesAccessSettings") { promise: Promise ->
      openAllFilesAccessSettings(promise)
    }

    // region shared-storage write access (apiVersion 5)

    Function("hasSharedWriteAccess") {
      SharedWriteAccess.has(context)
    }

    AsyncFunction("requestSharedWriteAccess") { promise: Promise ->
      requestSharedWriteAccess(promise)
    }

    // endregion

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

    // region file actions (apiVersion 4)

    Function("getMyFilesRoot") {
      try {
        actions.myFilesRoot().path
      } catch (e: Throwable) {
        throw IoFailures.map(e, FileOpCodes.ERR_FILE_OP_FAILED, "Cannot create the My Files folder")
      }
    }

    AsyncFunction("renameFile") Coroutine { path: String, newName: String ->
      actions.renameFile(path, newName).toMap()
    }

    AsyncFunction("moveFile") Coroutine { path: String, destDir: String ->
      actions.moveFile(path, destDir).toMap()
    }

    AsyncFunction("copyFile") Coroutine { path: String, destDir: String ->
      actions.copyFile(path, destDir).toMap()
    }

    AsyncFunction("deleteFile") Coroutine { path: String ->
      actions.deleteFile(path)
    }

    AsyncFunction("listFolder") Coroutine { path: String ->
      val (folder, entries) = actions.listFolder(path)
      mapOf("path" to folder, "entries" to entries.map { it.toMap() })
    }

    AsyncFunction("folderStats") Coroutine { path: String ->
      val stats = actions.folderStats(path)
      mapOf(
        "fileCount" to stats.fileCount.toDouble(),
        "folderCount" to stats.folderCount.toDouble(),
        "totalBytes" to stats.totalBytes.toDouble(),
      )
    }

    AsyncFunction("createFolder") Coroutine { parent: String, name: String ->
      actions.createFolder(parent, name).toMap()
    }

    AsyncFunction("renameFolder") Coroutine { path: String, newName: String ->
      actions.renameFolder(path, newName).toMap()
    }

    AsyncFunction("deleteFolder") Coroutine { path: String ->
      actions.deleteFolder(path)
    }

    AsyncFunction("importDocuments") Coroutine { uris: List<String>, destDir: String ->
      actions.importDocuments(uris, destDir).map { item ->
        buildMap<String, Any?> {
          put("uri", item.uri)
          item.file?.let { put("file", it.toMap()) }
          item.errorCode?.let { put("errorCode", it) }
        }
      }
    }

    AsyncFunction("documentCapabilities") Coroutine { uri: String ->
      val caps = actions.documentCapabilities(uri)
      mapOf("canRename" to caps.canRename, "canDelete" to caps.canDelete)
    }

    AsyncFunction("renameDocument") Coroutine { uri: String, newName: String ->
      val renamed = actions.renameDocument(uri, newName)
      mapOf("uri" to renamed.uri, "name" to renamed.name, "renamed" to renamed.renamed)
    }

    AsyncFunction("deleteDocument") Coroutine { uri: String ->
      actions.deleteDocument(uri)
    }

    AsyncFunction("printPdf") Coroutine { source: String, jobName: String ->
      printPdf(source, jobName)
    }

    // endregion
  }

  private val actions: FileActions
    get() = FileActions(context)

  private fun FileInfo.toMap(): Map<String, Any?> = mapOf(
    "path" to path,
    "name" to name,
    "size" to size.toDouble(),
    "mtime" to mtime.toDouble(),
  )

  private fun FolderEntryInfo.toMap(): Map<String, Any?> = mapOf(
    "path" to path,
    "name" to name,
    "isDirectory" to isDirectory,
    "size" to size.toDouble(),
    "mtime" to mtime.toDouble(),
  )

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

  /**
   * API 30+: resolves from all-files access without prompting. API 26-29:
   * resolves "granted" when WRITE_EXTERNAL_STORAGE is held, otherwise shows
   * the system dialog through the Expo permissions service (READ is asked
   * along when missing; same group, one dialog) and maps the answer with
   * [SharedWriteAccess.resultAfterPrompt]. Rejects ERR_NO_ACTIVITY when no
   * screen can host the dialog.
   */
  private fun requestSharedWriteAccess(promise: Promise) {
    if (!scope.isActive) {
      promise.reject(moduleDestroyed())
      return
    }
    val sdk = Build.VERSION.SDK_INT
    val allowed = SharedWriteAccess.has(context)
    if (!SharedWriteAccess.needsPrompt(sdk, allowed)) {
      promise.resolve(SharedWriteAccess.resultWithoutPrompt(allowed))
      return
    }
    val permissions = appContext.permissions
    if (permissions == null) {
      promise.reject(CodedException(ERR_SETTINGS_FAILED, "Could not request storage access", null))
      return
    }
    val toRequest = SharedWriteAccess.permissionsToRequest(
      readGranted = SharedWriteAccess.isGranted(context, Manifest.permission.READ_EXTERNAL_STORAGE),
    )
    // The answer arrives in a listener, after the coroutine body has already
    // returned, so the promise is held in a module-level slot: it is settled
    // by whichever side gets there first, the listener or OnDestroy. Without
    // the slot, a dialog still showing when the module goes away would leave
    // the promise hanging forever.
    val request = OneShotPromise(promise)
    // A newer call replaces a pending one, so an answer the system never
    // delivered cannot block storage access until restart.
    pendingWriteAccess.replace(request)?.settle {
      it.reject(FileIndexException(ErrorCode.CANCELLED, "Replaced by a newer storage access request"))
    }
    // OnDestroy may have run between the first check and the claim above.
    if (!scope.isActive) {
      pendingWriteAccess.release(request)
      request.settle { it.reject(moduleDestroyed()) }
      return
    }
    /** Settles this request, unless the listener or OnDestroy already did. */
    fun settle(block: (Promise) -> Unit) {
      pendingWriteAccess.release(request)
      request.settle(block)
    }
    // The dialog is requested from the main thread; the listener runs once
    // the user has answered.
    val job = scope.launch(Dispatchers.Main) {
      try {
        if (appContext.currentActivity == null) {
          settle { it.reject(CodedException(ERR_NO_ACTIVITY, "No screen is available to ask for storage access", null)) }
          return@launch
        }
        permissions.askForPermissions({ result ->
          val response = result[Manifest.permission.WRITE_EXTERNAL_STORAGE]
          val granted = response?.status == PermissionsStatus.GRANTED || SharedWriteAccess.has(context)
          settle {
            it.resolve(SharedWriteAccess.resultAfterPrompt(granted, canAskAgain = response?.canAskAgain ?: true))
          }
        }, *toRequest.toTypedArray())
      } catch (e: CancellationException) {
        throw e
      } catch (_: Throwable) {
        settle { it.reject(CodedException(ERR_SETTINGS_FAILED, "Could not request storage access", null)) }
      }
    }
    // Only a cancelled job settles here: a job that ran to completion has
    // merely shown the dialog, and its listener is still to come.
    job.invokeOnCompletion { cause ->
      if (cause != null) settle { it.reject(moduleDestroyed()) }
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
          roots = actions.sharedRoots(),
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
      throw IoFailures.map(e, ERR_IMPORT_FAILED, "Cannot import this document")
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
      throw IoFailures.map(e, ERR_SHARE_FAILED, "Cannot share these files")
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
    val pick = PendingPick(DocumentPick.requestCodeFor(pickSequence.getAndIncrement()), promise, options.persist)
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
      // Write is requested too so picked documents can be renamed/deleted
      // through their provider; providers that refuse it still grant read.
      addFlags(
        Intent.FLAG_GRANT_READ_URI_PERMISSION or
          Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
          Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION,
      )
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
    val pick = pendingPick.takeIf { it.requestCode == requestCode } ?: return
    val promise = pick.promise
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
        val writeGranted = data.flags and Intent.FLAG_GRANT_WRITE_URI_PERMISSION != 0
        val mode = DocumentPick.persistMode(pick.persist, writeGranted)
        val items = uris.map { describePicked(it, mode) }
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
   * Persists the grant per [mode] (see [DocumentPick.persistMode]) and reads
   * the provider metadata of one picked document. The item's `persisted`
   * field tells whether read is persisted; when false the URI works only in
   * this session. Metadata the provider refuses or lacks is returned as null.
   */
  private fun describePicked(uriString: String, mode: GrantMode): Map<String, Any?> {
    val resolver = context.contentResolver
    val uri = uriString.toUri()
    val persisted = mode != GrantMode.NONE &&
      actions.persistGrant(uri, tryWrite = mode == GrantMode.READ_WRITE) != GrantMode.NONE
    val mime = try {
      resolver.getType(uri)
    } catch (_: SecurityException) {
      null
    } catch (_: IllegalArgumentException) {
      null
    }
    val meta = ProviderQueries.metadata(resolver, uri)
    return DocumentPick.pickedDocument(uriString, meta.name, meta.size, mime, meta.mtime, persisted)
  }

  private fun listPersistedUris(): List<String> =
    DocumentPick.readGranted(
      context.contentResolver.persistedUriPermissions.map { it.uri.toString() to it.isReadPermission },
    )

  /** Releases every persisted grant (read and write) for a URI; one that is not held is ignored. */
  private fun releasePersistedUri(uriString: String) {
    try {
      actions.releaseGrant(uriString.toUri())
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

  // endregion

  // region print

  /**
   * Opens the system print dialog for a PDF (absolute path or content:// URI).
   * Resolves once the dialog is shown; the print job itself is not awaited.
   */
  private suspend fun printPdf(source: String, jobName: String) {
    val ctx = context
    val opener = withContext(Dispatchers.IO) {
      try {
        printSource(ctx, source)
      } catch (e: Throwable) {
        throw IoFailures.map(e, ERR_PRINT_FAILED, "Cannot print this document")
      }
    }
    withContext(Dispatchers.Main) {
      val activity = appContext.currentActivity
        ?: throw CodedException(ERR_NO_ACTIVITY, "No screen is available to show the print dialog", null)
      val printManager = activity.getSystemService(PrintManager::class.java)
        ?: throw FileIndexException(ErrorCode.UNSUPPORTED, "Printing is not available")
      val name = jobName.trim().ifEmpty { FileNames.FALLBACK_NAME }
      try {
        printManager.print(name, PdfPrintAdapter(name, opener, scope), null)
      } catch (e: Throwable) {
        throw IoFailures.map(e, ERR_PRINT_FAILED, "Cannot open the print dialog")
      }
    }
  }

  /**
   * Checks that [source] is a readable PDF and returns how to open it. Paths
   * must lie in shared storage or My Files (PERMISSION_DENIED otherwise) and
   * end in ".pdf"; content URIs must report application/pdf or a ".pdf"
   * display name.
   */
  private fun printSource(ctx: Context, source: String): () -> InputStream {
    val uri = source.toUri()
    if (uri.scheme == ContentResolver.SCHEME_CONTENT) {
      val resolver = ctx.contentResolver
      val mime = try {
        resolver.getType(uri)
      } catch (_: IllegalArgumentException) {
        null
      }
      val name = ProviderQueries.metadata(resolver, uri).name
      val isPdf = mime == PDF_MIME || (name != null && DocumentScanner.extensionOf(name) == PDF_EXT)
      if (!isPdf) throw FileIndexException(ErrorCode.UNSUPPORTED, "Only PDF documents can be printed")
      // Fails now (not inside the dialog) when the document is gone or not readable.
      (resolver.openInputStream(uri) ?: throw FileNotFoundException("Provider returned no stream")).close()
      return { resolver.openInputStream(uri) ?: throw FileNotFoundException("Provider returned no stream") }
    }
    // Same allowed roots as the other file actions (shared storage or My Files).
    val file = FileActions(ctx).resolveReadablePath(source)
    if (DocumentScanner.extensionOf(file.name) != PDF_EXT) {
      throw FileIndexException(ErrorCode.UNSUPPORTED, "Only PDF documents can be printed")
    }
    if (!file.isFile) throw FileIndexException(ErrorCode.NOT_FOUND, "The document no longer exists")
    if (!file.canRead()) throw FileIndexException(ErrorCode.PERMISSION_DENIED, "Cannot read this document")
    return { file.inputStream() }
  }

  /**
   * Streams a PDF into the print framework. Writing runs on Dispatchers.IO in
   * the module scope and stops when the framework cancels it; callbacks are
   * delivered on the main thread.
   */
  private class PdfPrintAdapter(
    private val name: String,
    private val open: () -> InputStream,
    private val scope: CoroutineScope,
  ) : PrintDocumentAdapter() {
    // Both only touched on the main thread (framework callbacks and delivery).
    private var writeJob: Job? = null
    private var writeGeneration = 0

    override fun onLayout(
      oldAttributes: PrintAttributes?,
      newAttributes: PrintAttributes,
      cancellationSignal: CancellationSignal,
      callback: LayoutResultCallback,
      extras: Bundle?,
    ) {
      if (cancellationSignal.isCanceled) {
        callback.onLayoutCancelled()
        return
      }
      val info = PrintDocumentInfo.Builder(name)
        .setContentType(PrintDocumentInfo.CONTENT_TYPE_DOCUMENT)
        .setPageCount(PrintDocumentInfo.PAGE_COUNT_UNKNOWN)
        .build()
      // The document does not depend on the attributes: only the first layout changes it.
      callback.onLayoutFinished(info, oldAttributes == null)
    }

    override fun onWrite(
      pages: Array<out PageRange>,
      destination: ParcelFileDescriptor,
      cancellationSignal: CancellationSignal,
      callback: WriteResultCallback,
    ) {
      // A newer write supersedes the running one: its outcome is ignored.
      val generation = ++writeGeneration
      writeJob?.cancel()
      if (!scope.isActive) {
        callback.onWriteFailed(null)
        return
      }
      // ATOMIC: the body always runs, even when cancelled before it starts,
      // so exactly one callback is delivered for this write.
      val job = scope.launch(Dispatchers.IO, start = CoroutineStart.ATOMIC) {
        val outcome = try {
          open().use { input ->
            FileOutputStream(destination.fileDescriptor).use { output ->
              val buffer = ByteArray(COPY_BUFFER_BYTES)
              while (true) {
                ensureActive()
                if (cancellationSignal.isCanceled) throw CancellationException("Print cancelled")
                val read = input.read(buffer)
                if (read < 0) break
                output.write(buffer, 0, read)
              }
              output.flush()
            }
          }
          WriteOutcome.FINISHED
        } catch (_: CancellationException) {
          WriteOutcome.CANCELLED
        } catch (e: Throwable) {
          // Class only: messages of file exceptions can contain paths.
          Log.w(TAG, "Print write failed: ${e.javaClass.simpleName}")
          WriteOutcome.FAILED
        }
        withContext(NonCancellable + Dispatchers.Main) {
          if (generation != writeGeneration) return@withContext
          when (outcome) {
            WriteOutcome.FINISHED -> callback.onWriteFinished(arrayOf(PageRange.ALL_PAGES))
            WriteOutcome.CANCELLED -> callback.onWriteCancelled()
            // null: no technical (untranslated) text in the system dialog.
            WriteOutcome.FAILED -> callback.onWriteFailed(null)
          }
        }
      }
      writeJob = job
      cancellationSignal.setOnCancelListener { job.cancel() }
    }

    override fun onFinish() {
      writeJob?.cancel()
      writeJob = null
    }

    private enum class WriteOutcome { FINISHED, CANCELLED, FAILED }
  }

  // endregion

  companion object {
    const val API_VERSION = 5

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
    private const val ERR_PRINT_FAILED = "ERR_PRINT_FAILED"

    private const val PDF_MIME = "application/pdf"
    private const val PDF_EXT = "pdf"
  }
}
