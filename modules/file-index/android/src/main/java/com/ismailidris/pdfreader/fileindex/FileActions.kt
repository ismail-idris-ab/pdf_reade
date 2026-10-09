package com.ismailidris.pdfreader.fileindex

import android.Manifest
import android.content.ContentResolver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.MediaScannerConnection
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.storage.StorageManager
import android.provider.DocumentsContract
import android.system.ErrnoException
import android.system.Os
import android.system.OsConstants
import android.webkit.MimeTypeMap
import androidx.core.content.ContextCompat
import androidx.core.net.toUri
import expo.modules.kotlin.exception.CodedException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileNotFoundException
import java.io.IOException

/** Per-item result of an import: [file] on success, otherwise [errorCode]. */
data class ImportItem(val uri: String, val file: FileInfo?, val errorCode: String?)

/** Rename result of a content:// document. */
data class RenamedDocument(val uri: String, val name: String, val renamed: Boolean)

data class DocumentCaps(val canRename: Boolean, val canDelete: Boolean)

/**
 * File actions with their Android wiring: the My Files root, the allowed
 * shared-storage roots, the write-access check, media-scanner updates and
 * content:// documents. Every suspend function runs its work on
 * Dispatchers.IO, honours coroutine cancellation and rejects with a
 * [CodedException] whose message holds no path or name.
 */
class FileActions(private val context: Context) {
  /** Canonical My Files root, created when missing. */
  fun myFilesRoot(): File {
    val root = File(context.filesDir, MY_FILES_DIR)
    if (!root.isDirectory && !root.mkdirs() && !root.isDirectory) {
      throw CodedException(FileOpCodes.ERR_FILE_OP_FAILED, "Cannot create the My Files folder", null)
    }
    return FileOps.canonicalOrNull(root) ?: root.absoluteFile
  }

  suspend fun renameFile(path: String, newName: String): FileInfo =
    run("Cannot rename this file") { it.renameFile(path, newName) }

  suspend fun moveFile(path: String, destDir: String): FileInfo =
    run("Cannot move this file") { it.moveFile(path, destDir) }

  suspend fun copyFile(path: String, destDir: String): FileInfo =
    run("Cannot copy this file") { it.copyFile(path, destDir) }

  suspend fun deleteFile(path: String) = run("Cannot delete this file") { it.deleteFile(path) }

  suspend fun listFolder(path: String): Pair<String, List<FolderEntryInfo>> =
    run("Cannot open this folder") { it.listFolder(path) }

  suspend fun folderStats(path: String): FolderStatsInfo =
    run("Cannot read this folder") { it.folderStats(path) }

  /**
   * Repairs what operations interrupted by a crash left behind (journaled
   * case-only renames and copy temp files), in My Files and shared storage.
   * Called once when the module is created; never throws.
   */
  suspend fun replayJournal() {
    try {
      run("Cannot repair interrupted file actions") { it.replayJournal() }
    } catch (e: CancellationException) {
      throw e
    } catch (_: Exception) {
      // Entries stay in the journal for the next start.
    }
  }

  suspend fun createFolder(parent: String, name: String): FolderEntryInfo =
    run("Cannot create the folder") { it.createFolder(parent, name) }

  suspend fun renameFolder(path: String, newName: String): FolderEntryInfo =
    run("Cannot rename this folder") { it.renameFolder(path, newName) }

  suspend fun deleteFolder(path: String) = run("Cannot delete this folder") { it.deleteFolder(path) }

  /**
   * Real path of a file that may be read for printing: it must lie in shared
   * storage or My Files (PERMISSION_DENIED otherwise). Reading needs no
   * all-files check here; an unreadable file fails when it is opened.
   */
  fun resolveReadablePath(path: String): File = try {
    FileOps(myFilesRoot(), sharedRoots().mapNotNull { FileOps.canonicalOrNull(it) })
      .resolve(path, allowShared = true)
  } catch (e: Throwable) {
    throw IoFailures.map(e, FileOpCodes.ERR_FILE_OP_FAILED, "Cannot open this document")
  }

  /**
   * Copies each content:// document into [destDir] (inside My Files), one
   * after the other. An invalid [destDir] rejects the whole call; a failing
   * item only gets an error code. Cancellation stops the whole call.
   */
  suspend fun importDocuments(uris: List<String>, destDir: String): List<ImportItem> =
    withContext(Dispatchers.IO) { importAll(uris, destDir) }

  private suspend fun importAll(uris: List<String>, destDir: String): List<ImportItem> {
    val ops = ops()
    val dir = try {
      ops.resolve(destDir, allowShared = false).also {
        if (!it.isDirectory) throw FileOpFailure(ErrorCode.NOT_FOUND.name, "The folder no longer exists")
      }
    } catch (e: Throwable) {
      throw IoFailures.map(e, FileOpCodes.ERR_FILE_OP_FAILED, "Cannot import into this folder")
    }
    return uris.map { uri ->
      currentCoroutineContext().ensureActive()
      try {
        ImportItem(uri, importOne(ops, uri.toUri(), dir), null)
      } catch (e: CancellationException) {
        throw e
      } catch (e: Throwable) {
        ImportItem(uri, null, IoFailures.codeOf(e, FileOpCodes.ERR_FILE_OP_FAILED))
      }
    }
  }

  private fun importOne(ops: FileOps, uri: Uri, dir: File): FileInfo {
    if (uri.scheme != ContentResolver.SCHEME_CONTENT) {
      throw FileIndexException(ErrorCode.UNSUPPORTED, "Only content URIs can be imported")
    }
    val resolver = context.contentResolver
    val meta = ProviderQueries.metadata(resolver, uri)
    val mime = try {
      resolver.getType(uri)
    } catch (_: SecurityException) {
      null
    } catch (_: IllegalArgumentException) {
      null
    }
    var name = FileNames.sanitize(meta.name)
    if (meta.name == null) {
      val ext = mime?.let { MimeTypeMap.getSingleton().getExtensionFromMimeType(it) }
      if (!ext.isNullOrEmpty()) name = FileNames.sanitize("$name.$ext")
    }
    meta.size?.let { ops.ensureSpace(dir, it) }
    // A stream shorter than the reported size (a cloud download cut short)
    // fails the item; a longer one is fine (stale or pre-transcoding size).
    val expectedSize = meta.size?.takeIf { it > 0 }
    val target = ops.writeAtomically(dir, name, NameRules.Style.MOVE, expectedSize, meta.mtime, sizeCheck = SizeCheck.AT_LEAST) {
      resolver.openInputStream(uri) ?: throw FileNotFoundException("Provider returned no stream")
    }
    return FileInfo(target.path, target.name, target.length(), target.lastModified())
  }

  /** What the provider allows for [uriString]. Never throws: failures give false/false. */
  suspend fun documentCapabilities(uriString: String): DocumentCaps = withContext(Dispatchers.IO) {
    try {
      val uri = uriString.toUri()
      if (!isDocument(uri)) return@withContext NO_CAPS
      val flags = ProviderQueries.documentFlags(context.contentResolver, uri) ?: return@withContext NO_CAPS
      val writable = holdsWriteGrant(uri)
      DocumentCaps(
        canRename = writable && flags and DocumentsContract.Document.FLAG_SUPPORTS_RENAME != 0,
        canDelete = writable && flags and DocumentsContract.Document.FLAG_SUPPORTS_DELETE != 0,
      )
    } catch (e: CancellationException) {
      throw e
    } catch (_: Throwable) {
      NO_CAPS
    }
  }

  /**
   * Renames a document through its provider. The provider may pick another
   * name (e.g. on a clash) or a new URI; the result reports both. When the URI
   * changes, the persisted grant moves to the new URI. When access under the
   * new name cannot be kept at the mode held before, the document is renamed
   * back (`renamed = false`). See [DocumentRename] for every case.
   */
  suspend fun renameDocument(uriString: String, newName: String): RenamedDocument =
    withContext(Dispatchers.IO) {
      try {
        val name = NameRules.requireValid(newName)
        val uri = uriString.toUri()
        if (!isDocument(uri)) throw FileIndexException(ErrorCode.UNSUPPORTED, "Not a document")
        val resolver = context.contentResolver
        val originalName = ProviderQueries.metadata(resolver, uri).name
        val outcome = DocumentRename.rename(
          original = uri,
          required = heldGrant(uri).coerceAtLeast(GrantMode.READ),
          rename = { DocumentsContract.renameDocument(resolver, it, name) },
          renameBack = { current ->
            val back = originalName
              ?: throw FileOpFailure(FileOpCodes.ERR_FILE_OP_FAILED, "The original name is unknown")
            DocumentsContract.renameDocument(resolver, current, back)
          },
          persist = { persistGrant(it) },
          release = { releaseGrant(it) },
        )
        val fallbackName = if (outcome.renamed) name else originalName ?: name
        val finalName = ProviderQueries.metadata(resolver, outcome.uri).name ?: fallbackName
        RenamedDocument(outcome.uri.toString(), finalName, outcome.renamed)
      } catch (e: Throwable) {
        throw IoFailures.map(e, FileOpCodes.ERR_FILE_OP_FAILED, "Cannot rename this document")
      }
    }

  /** Deletes a document through its provider, then gives up its grant. */
  suspend fun deleteDocument(uriString: String) = withContext(Dispatchers.IO) {
    try {
      val uri = uriString.toUri()
      if (!isDocument(uri)) throw FileIndexException(ErrorCode.UNSUPPORTED, "Not a document")
      if (!DocumentsContract.deleteDocument(context.contentResolver, uri)) {
        throw CodedException(FileOpCodes.ERR_FILE_OP_FAILED, "Cannot delete this document", null)
      }
      releaseGrant(uri)
    } catch (e: Throwable) {
      throw IoFailures.map(e, FileOpCodes.ERR_FILE_OP_FAILED, "Cannot delete this document")
    }
  }

  /**
   * Persists read+write for [uri], or read only when the provider refuses
   * write. Returns the mode obtained (NONE when nothing could be persisted).
   */
  fun persistGrant(uri: Uri, tryWrite: Boolean = true): GrantMode {
    val resolver = context.contentResolver
    if (tryWrite) {
      try {
        resolver.takePersistableUriPermission(
          uri,
          Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION,
        )
        return GrantMode.READ_WRITE
      } catch (_: SecurityException) {
        // No persistable write grant: fall back to read only.
      }
    }
    return try {
      resolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
      GrantMode.READ
    } catch (_: SecurityException) {
      GrantMode.NONE
    }
  }

  /** Mode of the persisted grant currently held for [uri]. */
  private fun heldGrant(uri: Uri): GrantMode {
    val held = try {
      context.contentResolver.persistedUriPermissions.firstOrNull { it.uri == uri }
    } catch (_: SecurityException) {
      null
    }
    return when {
      held == null -> GrantMode.NONE
      held.isWritePermission -> GrantMode.READ_WRITE
      held.isReadPermission -> GrantMode.READ
      else -> GrantMode.NONE
    }
  }

  /** Releases every persisted grant held for [uri]; a grant that is not held is ignored. */
  fun releaseGrant(uri: Uri) {
    val resolver = context.contentResolver
    val held = try {
      resolver.persistedUriPermissions.firstOrNull { it.uri == uri }
    } catch (_: SecurityException) {
      null
    } ?: return
    var flags = 0
    if (held.isReadPermission) flags = flags or Intent.FLAG_GRANT_READ_URI_PERMISSION
    if (held.isWritePermission) flags = flags or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
    if (flags == 0) return
    try {
      resolver.releasePersistableUriPermission(uri, flags)
    } catch (_: SecurityException) {
      // Released meanwhile.
    } catch (_: IllegalArgumentException) {
      // Not a URI the resolver accepts: nothing to release.
    }
  }

  private fun holdsWriteGrant(uri: Uri): Boolean =
    context.contentResolver.persistedUriPermissions.any { it.uri == uri && it.isWritePermission }

  private fun isDocument(uri: Uri): Boolean =
    uri.scheme == ContentResolver.SCHEME_CONTENT && DocumentsContract.isDocumentUri(context, uri)

  /**
   * Runs [block] on Dispatchers.IO with a fresh [FileOps]; failures become
   * coded exceptions. FileOps itself serialises changes to names behind its
   * process-wide lock (never while streaming data).
   */
  private suspend fun <T> run(message: String, block: (FileOps) -> T): T =
    withContext(Dispatchers.IO) {
      try {
        block(ops())
      } catch (e: Throwable) {
        throw IoFailures.map(e, FileOpCodes.ERR_FILE_OP_FAILED, message)
      }
    }

  private suspend fun ops(): FileOps {
    val coroutine = currentCoroutineContext()
    return FileOps(
      myFilesRoot = myFilesRoot(),
      sharedRoots = sharedRoots().mapNotNull { FileOps.canonicalOrNull(it) },
      requireSharedAccess = ::requireSharedWriteAccess,
      onSharedChanged = ::scanMedia,
      checkCancelled = { coroutine.ensureActive() },
      journal = OpJournal(File(context.filesDir, JOURNAL_DIR), ::syncDirectory),
      freeSpace = ::allocatableBytes,
      knownVolumes = knownVolumes(),
      syncDirectory = ::syncDirectory,
    )
  }

  /**
   * fsync of a directory, so a new entry survives power loss before a source
   * is deleted. Filesystems that cannot sync directories (EINVAL, ENOTSUP,
   * ENOSYS, EROFS; e.g. some FUSE or FAT mounts) are skipped; other errors
   * (EIO…) fail the operation.
   */
  private fun syncDirectory(dir: File) {
    val fd = try {
      Os.open(dir.path, OsConstants.O_RDONLY, 0)
    } catch (e: ErrnoException) {
      if (isSyncUnsupported(e.errno)) return
      throw IOException("Cannot open the folder to sync it", e)
    }
    try {
      Os.fsync(fd)
    } catch (e: ErrnoException) {
      if (!isSyncUnsupported(e.errno)) {
        throw IOException("Cannot sync the folder", e)
      }
    } finally {
      try {
        Os.close(fd)
      } catch (_: ErrnoException) {
        // Nothing was written through this descriptor.
      }
    }
  }

  private fun isSyncUnsupported(errno: Int): Boolean =
    errno == OsConstants.EINVAL ||
      errno == OsConstants.ENOTSUP ||
      errno == OsConstants.EOPNOTSUPP ||
      errno == OsConstants.ENOSYS ||
      errno == OsConstants.EROFS

  /**
   * Bytes that can be written in [dir], counting cache the system would clear
   * for us (getAllocatableBytes). Volumes the StorageManager cannot map
   * (e.g. some SD cards) fall back to plain usable space.
   */
  private fun allocatableBytes(dir: File): Long {
    val storageManager = context.getSystemService(StorageManager::class.java) ?: return FileOps.usableSpaceOf(dir)
    return try {
      storageManager.getAllocatableBytes(storageManager.getUuidForPath(dir))
    } catch (_: IOException) {
      FileOps.usableSpaceOf(dir)
    } catch (_: IllegalArgumentException) {
      FileOps.usableSpaceOf(dir)
    } catch (_: SecurityException) {
      FileOps.usableSpaceOf(dir)
    }
  }

  /**
   * Shared storage is written directly, which needs all-files access on
   * API 30+ and WRITE_EXTERNAL_STORAGE below. Fails early with
   * PERMISSION_DENIED instead of half-way through an operation.
   */
  private fun requireSharedWriteAccess() {
    val allowed = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      Environment.isExternalStorageManager()
    } else {
      ContextCompat.checkSelfPermission(context, Manifest.permission.WRITE_EXTERNAL_STORAGE) ==
        PackageManager.PERMISSION_GRANTED
    }
    if (!allowed) throw FileIndexException(ErrorCode.PERMISSION_DENIED, "No write access to shared storage")
  }

  /** Tells the media store about changed shared-storage paths; best effort. */
  private fun scanMedia(paths: List<String>) {
    try {
      MediaScannerConnection.scanFile(context, paths.toTypedArray(), null, null)
    } catch (_: RuntimeException) {
      // The media store catches up on its own next scan.
    }
  }

  /**
   * Folders under which storage volumes live, mounted or not: the standard
   * mount parents (/storage covers /storage/<uuid> of an SD card that is out
   * right now) plus every directory the StorageManager reports. Used so the
   * journal replay keeps, rather than drops, entries it cannot reach now.
   */
  private fun knownVolumes(): List<File> {
    val volumes = ArrayList(FileOps.DEFAULT_VOLUME_PARENTS)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      try {
        context.getSystemService(StorageManager::class.java)?.storageVolumes?.forEach { volume ->
          volume.directory?.let { volumes.add(it) }
        }
      } catch (_: SecurityException) {
        // The standard mount parents still apply.
      }
    }
    return volumes
  }

  /** Primary shared storage plus, on API 30+, every other mounted volume. */
  // getExternalStorageDirectory is deprecated for scoped apps but is the
  // documented primary root for apps holding all-files access.
  @Suppress("DEPRECATION")
  fun sharedRoots(): List<File> {
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

  companion object {
    const val MY_FILES_DIR = "MyFiles"
    private val NO_CAPS = DocumentCaps(canRename = false, canDelete = false)

    /** App-private folder of the operation journal (see [OpJournal]). */
    const val JOURNAL_DIR = ".file-ops-journal"
  }
}
