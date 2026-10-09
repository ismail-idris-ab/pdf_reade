package com.ismailidris.pdfreader.fileindex

import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException
import java.io.InputStream
import java.nio.file.FileAlreadyExistsException
import java.nio.file.FileVisitResult
import java.nio.file.Files
import java.nio.file.InvalidPathException
import java.nio.file.LinkOption
import java.nio.file.NoSuchFileException
import java.nio.file.Path
import java.nio.file.SimpleFileVisitor
import java.nio.file.attribute.BasicFileAttributes
import java.util.UUID
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock

/** Where a file lives after an operation, with fresh metadata. */
data class FileInfo(val path: String, val name: String, val size: Long, val mtime: Long)

data class FolderEntryInfo(
  val path: String,
  val name: String,
  val isDirectory: Boolean,
  val size: Long,
  val mtime: Long,
)

data class FolderStatsInfo(val fileCount: Long, val folderCount: Long, val totalBytes: Long)

/** How [FileOps.writeAtomically] compares the bytes written with the expected size. */
enum class SizeCheck {
  /** Local sources: the size is known exactly. */
  EXACT,

  /** Provider sources: the reported size may be stale or pre-transcoding; only a short stream fails. */
  AT_LEAST,
}

/**
 * File and folder actions on real paths. Pure JVM code (java.io / java.nio,
 * no Android types) so it is unit-testable; the module supplies the roots
 * and runs it on Dispatchers.IO.
 *
 * Safety rules:
 * - Every path is resolved to its real path (symlinks resolved) and must lie
 *   inside [myFilesRoot] or, where allowed, one of [sharedRoots]; anything
 *   else fails with PERMISSION_DENIED. Folder actions only work inside
 *   [myFilesRoot].
 * - An existing entry is never replaced. Files get their new name through a
 *   hard link (which fails when the name is taken) followed by removal of the
 *   old name. Where hard links are unsupported (FAT, emulated storage), a
 *   rename runs right after an existence check; a move falls back to a copy.
 * - Data is never written in place: copies stream into a hidden temp file in
 *   the destination folder, are fsynced and size-checked, renamed to a free
 *   name, and the folder is synced before any source is deleted. Temp files
 *   are removed on every failure path and recorded in the [journal] so a
 *   crash cannot leave them behind for good.
 * - Changes to names happen under [lock] (one process-wide lock): choosing a
 *   free name, linking/renaming, syncing and deleting. Streaming data never
 *   holds it, and listing never waits for it.
 * - Messages are static text; no path or file name ends up in an exception.
 *
 * @param myFilesRoot real path of the My Files root.
 * @param sharedRoots real paths of the shared-storage roots (empty when not allowed).
 * @param requireSharedAccess throws when shared storage cannot be written
 *   right now (e.g. all-files access revoked); called before any action that
 *   touches a shared-storage path.
 * @param onSharedChanged receives the old and new paths of a change in shared
 *   storage (for the media scanner).
 * @param checkCancelled throws to abort a long operation (coroutine
 *   cancellation); called between copy buffers and tree entries.
 * @param journal records operations in flight; null disables recording.
 * @param lock serialises every change to names (process-wide by default).
 * @param createLink creates hard link `link` to `existing`; throws
 *   FileAlreadyExistsException when `link` exists, another IOException or
 *   UnsupportedOperationException when links are not possible there.
 * @param movePath renames without options (fails when the target exists).
 * @param directRename plain rename(2) used for case-only renames; false when
 *   it did not happen.
 * @param openInput opens a source file for reading. Replaceable for tests.
 * @param deletePath deletes one path. Replaceable for tests.
 * @param freeSpace bytes that can be written in a folder (0 when unknown).
 * @param syncDirectory flushes a folder's entries to storage (fsync of the
 *   directory); a no-op by default, the module passes the real one.
 * @param clock current time in epoch milliseconds.
 * @param knownVolumes folders under which storage volumes live, mounted or
 *   not (e.g. /storage, every StorageVolume directory). The journal replay
 *   keeps entries under them that it cannot repair right now instead of
 *   dropping them.
 * @param pathExists true when a path definitely exists, false when it
 *   definitely does not, null when that cannot be told (e.g. no access).
 */
class FileOps(
  val myFilesRoot: File,
  private val sharedRoots: List<File>,
  private val requireSharedAccess: () -> Unit = {},
  private val onSharedChanged: (List<String>) -> Unit = {},
  private val checkCancelled: () -> Unit = {},
  private val journal: OpJournal? = null,
  private val lock: ReentrantLock = WRITE_LOCK,
  private val createLink: (Path, Path) -> Unit = { link, existing -> Files.createLink(link, existing) },
  private val movePath: (Path, Path) -> Unit = { source, target -> Files.move(source, target) },
  private val directRename: (File, File) -> Boolean = { source, target -> source.renameTo(target) },
  private val openInput: (File) -> InputStream = { FileInputStream(it) },
  private val deletePath: (Path) -> Unit = { Files.delete(it) },
  private val freeSpace: (File) -> Long = ::usableSpaceOf,
  private val syncDirectory: (File) -> Unit = {},
  private val clock: () -> Long = System::currentTimeMillis,
  private val knownVolumes: List<File> = DEFAULT_VOLUME_PARENTS,
  private val pathExists: (Path) -> Boolean? = ::existenceOf,
) {
  // region files

  /** Renames a file in place. The mtime is kept (a rename does not change it). */
  fun renameFile(path: String, newName: String): FileInfo {
    val source = resolve(path, allowShared = true)
    val name = NameRules.requireValid(newName)
    return lock.withLock {
      requireRegularFile(source)
      if (name == source.name) return@withLock fileInfo(source)
      val target = File(source.parentFile, name)
      renameEntry(source, target)
      notifyIfShared(source, target)
      fileInfo(target)
    }
  }

  /**
   * Moves a file into [destDir] (inside My Files) under a free name
   * ("Name (1).ext"…; the name is cleaned so it can never look hidden). On the
   * same filesystem: hard link under the new name, folder sync, then removal
   * of the old name. Otherwise (or where links are unsupported): verified
   * copy (mtime kept), then deletion of the source. When the source cannot be
   * deleted the new entry is removed again so the user keeps exactly the
   * original; if even that fails the call rejects with ERR_DUPLICATE_LEFT.
   */
  fun moveFile(path: String, destDir: String): FileInfo {
    val source = resolve(path, allowShared = true)
    requireRegularFile(source)
    val dir = resolve(destDir, allowShared = false)
    requireDirectory(dir)
    if (source.parentFile == dir) return fileInfo(source)
    val baseName = FileNames.sanitize(source.name)
    checkCancelled()

    val linked = lock.withLock {
      for (attempt in 0 until RENAME_ATTEMPTS) {
        val target = File(dir, NameRules.freeName(baseName, NameRules.Style.MOVE) { File(dir, it).exists() })
        when (tryLink(target, source)) {
          LinkResult.EXISTS -> continue
          LinkResult.UNSUPPORTED -> return@withLock null
          LinkResult.LINKED -> {
            try {
              syncDirectory(dir)
              deletePath(source.toPath())
            } catch (_: NoSuchFileException) {
              // Someone else removed the source meanwhile: the new name is now the only one.
            } catch (e: Exception) {
              removeOrReportDuplicate(target, e)
            }
            return@withLock target
          }
        }
      }
      throw noFreeName()
    }
    val moved = linked ?: copyThenDelete(source, dir, baseName)
    notifyIfShared(source, moved)
    return fileInfo(moved)
  }

  private fun copyThenDelete(source: File, dir: File, baseName: String): File {
    val size = source.length()
    val mtime = source.lastModified()
    ensureSpace(dir, size)
    // Streaming runs outside the lock: the source must still be the same
    // file when it is deleted, or the copy would not be a copy of it.
    val identity = identityOf(source) ?: throw FileOpFailure(ErrorCode.NOT_FOUND.name, "The file no longer exists")
    return writeAtomically(
      dir = dir,
      name = baseName,
      style = NameRules.Style.MOVE,
      expectedSize = size,
      mtime = mtime,
      onPublished = { copy ->
        val now = identityOf(source)
        if (now != null && now != identity) {
          // Replaced or modified meanwhile: keep both rather than delete a file we did not copy.
          throw FileOpFailure(FileOpCodes.ERR_DUPLICATE_LEFT, "The file changed while it was moved; both copies were kept")
        }
        try {
          deletePath(source.toPath())
        } catch (_: NoSuchFileException) {
          // Someone else removed the source meanwhile: the verified copy is
          // now the only one, so keep it.
        } catch (e: Exception) {
          removeOrReportDuplicate(copy, e)
        }
      },
    ) { openInput(source) }
  }

  /**
   * Copies a file into [destDir]: the file's own folder ("Name (copy).ext",
   * "Name (copy 2).ext"…) or a My Files folder ("Name (1).ext"…); the name is
   * cleaned so it can never look hidden. The copy is a new file, so it gets
   * the current time as mtime.
   */
  fun copyFile(path: String, destDir: String): FileInfo {
    val source = resolve(path, allowShared = true)
    requireRegularFile(source)
    val dir = resolve(destDir, allowShared = true)
    val sameDir = dir == source.parentFile
    if (!sameDir && !isWithin(dir, myFilesRoot)) throw denied()
    requireDirectory(dir)
    val size = source.length()
    ensureSpace(dir, size)
    val style = if (sameDir) NameRules.Style.COPY else NameRules.Style.MOVE
    val copy = writeAtomically(dir, FileNames.sanitize(source.name), style, size, null) { openInput(source) }
    notifyIfShared(copy)
    return fileInfo(copy)
  }

  fun deleteFile(path: String) {
    val source = resolve(path, allowShared = true)
    lock.withLock {
      requireRegularFile(source)
      deletePath(source.toPath())
    }
    notifyIfShared(source)
  }

  // endregion

  // region folders (My Files only)

  /**
   * Entries sorted folders first, then by name ignoring case. Hidden entries
   * of this module are not listed. Never waits for the write lock: copy
   * temp files older than a day are removed only when the lock is free.
   */
  fun listFolder(path: String): Pair<String, List<FolderEntryInfo>> {
    val dir = resolve(path, allowShared = false)
    requireDirectory(dir)
    val names = dir.list() ?: throw cannotList()
    val now = clock()
    val stale = ArrayList<File>()
    val entries = ArrayList<FolderEntryInfo>(names.size)
    for (name in names) {
      checkCancelled()
      if (NameRules.isTempName(name)) {
        val created = NameRules.tempCreatedAt(name)
        // Left behind by a crash mid-copy: no copy runs for a day.
        if (created != null && now - created > STALE_TEMP_MS) stale.add(File(dir, name))
        continue
      }
      val child = File(dir, name)
      val attrs = readAttributes(child.toPath()) ?: continue
      if (attrs.isSymbolicLink) continue
      entries.add(
        FolderEntryInfo(
          path = child.path,
          name = name,
          isDirectory = attrs.isDirectory,
          size = if (attrs.isDirectory) 0L else attrs.size(),
          mtime = attrs.lastModifiedTime().toMillis(),
        ),
      )
    }
    if (stale.isNotEmpty() && lock.tryLock()) {
      try {
        stale.forEach { it.delete() }
      } finally {
        lock.unlock()
      }
    }
    entries.sortWith(compareBy<FolderEntryInfo> { !it.isDirectory }.thenBy(String.CASE_INSENSITIVE_ORDER) { it.name })
    return dir.path to entries
  }

  /** Counts without following symlinks; this module's hidden entries are not counted. */
  fun folderStats(path: String): FolderStatsInfo {
    val dir = resolve(path, allowShared = false)
    requireDirectory(dir)
    val start = dir.toPath()
    var files = 0L
    var folders = 0L
    var bytes = 0L
    Files.walkFileTree(
      start,
      object : SimpleFileVisitor<Path>() {
        override fun preVisitDirectory(dir: Path, attrs: BasicFileAttributes): FileVisitResult {
          checkCancelled()
          if (dir != start) folders++
          return FileVisitResult.CONTINUE
        }

        override fun visitFile(file: Path, attrs: BasicFileAttributes): FileVisitResult {
          checkCancelled()
          if (attrs.isRegularFile && !NameRules.isTempName(file.fileName.toString())) {
            files++
            bytes += attrs.size()
          }
          return FileVisitResult.CONTINUE
        }

        // An unreadable entry is left out of the totals rather than failing them.
        override fun visitFileFailed(file: Path, exc: IOException): FileVisitResult = FileVisitResult.CONTINUE
      },
    )
    return FolderStatsInfo(files, folders, bytes)
  }

  fun createFolder(parent: String, name: String): FolderEntryInfo {
    val dir = resolve(parent, allowShared = false)
    val folderName = NameRules.requireValid(name)
    return lock.withLock {
      requireDirectory(dir)
      val target = File(dir, folderName)
      if (target.exists() || listedNames(dir).contains(folderName)) throw nameExists()
      try {
        // mkdir(2) never replaces an existing entry.
        Files.createDirectory(target.toPath())
      } catch (_: FileAlreadyExistsException) {
        throw nameExists()
      }
      folderEntry(target)
    }
  }

  fun renameFolder(path: String, newName: String): FolderEntryInfo {
    val name = NameRules.requireValid(newName)
    return lock.withLock {
      val dir = resolveFolderForChange(path)
      if (name == dir.name) return@withLock folderEntry(dir)
      val target = File(dir.parentFile, name)
      renameEntry(dir, target)
      folderEntry(target)
    }
  }

  /**
   * Deletes the folder and everything in it, bottom-up. Symlinks are deleted
   * as links; their targets are never entered. The My Files root is refused.
   * A failure part-way leaves the entries not yet deleted in place.
   */
  fun deleteFolder(path: String) = lock.withLock {
    val dir = resolveFolderForChange(path)
    Files.walkFileTree(
      dir.toPath(),
      object : SimpleFileVisitor<Path>() {
        override fun preVisitDirectory(dir: Path, attrs: BasicFileAttributes): FileVisitResult {
          checkCancelled()
          return FileVisitResult.CONTINUE
        }

        override fun visitFile(file: Path, attrs: BasicFileAttributes): FileVisitResult {
          checkCancelled()
          deletePath(file)
          return FileVisitResult.CONTINUE
        }

        override fun postVisitDirectory(dir: Path, exc: IOException?): FileVisitResult {
          if (exc != null) throw exc
          deletePath(dir)
          return FileVisitResult.CONTINUE
        }
      },
    )
    Unit
  }

  // endregion

  // region atomic writes

  /**
   * Writes [open]'s stream into [dir] under a free name derived from [name]:
   * hidden temp file (journaled) → fsync → length check (against
   * [expectedSize] when given, per [sizeCheck]) → then, under the lock: rename without
   * replacing anything → folder sync → optional [mtime] → [onPublished]. The
   * temp file never survives a failure, and neither does the final file when
   * the folder sync fails. Returns the final file.
   */
  fun writeAtomically(
    dir: File,
    name: String,
    style: NameRules.Style,
    expectedSize: Long?,
    mtime: Long?,
    onPublished: (File) -> Unit = {},
    sizeCheck: SizeCheck = SizeCheck.EXACT,
    open: () -> InputStream,
  ): File {
    val temp = File(dir, NameRules.tempName(name, clock(), randomToken()))
    val journalId = journal?.begin(OpJournal.Entry.CopyTemp(temp))
    try {
      val copied = open().use { input ->
        FileOutputStream(temp).use { output ->
          val total = copyStream(input, output)
          output.flush()
          output.fd.sync()
          total
        }
      }
      if (expectedSize != null) {
        val ok = when (sizeCheck) {
          SizeCheck.EXACT -> copied == expectedSize
          SizeCheck.AT_LEAST -> copied >= expectedSize
        }
        if (!ok) throw incomplete()
      }
      if (temp.length() != copied) throw incomplete()

      return lock.withLock {
        for (attempt in 0 until RENAME_ATTEMPTS) {
          checkCancelled()
          val target = File(dir, NameRules.freeName(name, style) { File(dir, it).exists() })
          if (!renameFileNoReplace(temp, target, sourceMustGo = false)) continue
          try {
            syncDirectory(dir)
          } catch (e: Exception) {
            removeOrReportDuplicate(target, e)
          }
          if (mtime != null && mtime > 0) target.setLastModified(mtime)
          onPublished(target)
          return@withLock target
        }
        throw noFreeName()
      }
    } finally {
      if (temp.exists()) temp.delete()
      if (journalId != null) journal?.end(journalId)
    }
  }

  /** NO_SPACE when [dir]'s volume lacks [size] plus a safety margin. */
  fun ensureSpace(dir: File, size: Long) {
    val usable = freeSpace(dir)
    // 0 means "unknown" (e.g. no access to the volume details): let the write decide.
    if (usable > 0 && usable < size + SPACE_MARGIN_BYTES) {
      throw FileOpFailure(ErrorCode.NO_SPACE.name, "Not enough free space")
    }
  }

  private fun copyStream(input: InputStream, output: FileOutputStream): Long {
    val buffer = ByteArray(COPY_BUFFER_BYTES)
    var total = 0L
    while (true) {
      checkCancelled()
      val read = input.read(buffer)
      if (read < 0) break
      output.write(buffer, 0, read)
      total += read
    }
    return total
  }

  // endregion

  // region no-replace renames

  private enum class LinkResult { LINKED, EXISTS, UNSUPPORTED }

  /** Hard link [target] → [source]. A missing source still fails (NOT_FOUND). */
  private fun tryLink(target: File, source: File): LinkResult = try {
    createLink(target.toPath(), source.toPath())
    LinkResult.LINKED
  } catch (_: FileAlreadyExistsException) {
    LinkResult.EXISTS
  } catch (e: NoSuchFileException) {
    throw e
  } catch (_: IOException) {
    // Cross-filesystem (EXDEV) or a filesystem without hard links (FAT, FUSE).
    LinkResult.UNSUPPORTED
  } catch (_: UnsupportedOperationException) {
    LinkResult.UNSUPPORTED
  }

  /**
   * Renames regular file [source] to [target] in the same folder without
   * replacing an existing entry. False when [target] is taken. When
   * [sourceMustGo], failing to remove the old name after linking undoes the
   * link (or reports ERR_DUPLICATE_LEFT); otherwise a leftover old name is
   * left for the caller to clean up.
   */
  private fun renameFileNoReplace(source: File, target: File, sourceMustGo: Boolean): Boolean =
    when (tryLink(target, source)) {
      LinkResult.EXISTS -> false
      LinkResult.UNSUPPORTED -> renameChecked(source, target)
      LinkResult.LINKED -> {
        try {
          deletePath(source.toPath())
        } catch (_: NoSuchFileException) {
          // Already gone.
        } catch (e: Exception) {
          if (sourceMustGo) removeOrReportDuplicate(target, e)
        }
        true
      }
    }

  /**
   * rename(2) right after an existence check, for directories and for
   * filesystems without hard links. Changes to names are serialised by
   * [lock], so only another app could take the name in between.
   */
  private fun renameChecked(source: File, target: File): Boolean {
    if (Files.exists(target.toPath(), LinkOption.NOFOLLOW_LINKS)) return false
    return try {
      movePath(source.toPath(), target.toPath())
      true
    } catch (_: FileAlreadyExistsException) {
      false
    }
  }

  /**
   * Renames [source] to [target] in the same folder without replacing
   * anything. A case-only change ("a.pdf" → "A.pdf") of the same entry is
   * allowed even where the filesystem treats both spellings as one name.
   */
  private fun renameEntry(source: File, target: File) {
    val dir = source.parentFile ?: throw denied()
    val caseOnly = target.name.equals(source.name, ignoreCase = true)
    if (listedNames(dir).contains(target.name)) throw nameExists()
    val targetExists = target.exists()
    if (targetExists && !caseOnly) throw nameExists()
    if (caseOnly && targetExists) {
      caseOnlyRename(source, target)
      return
    }
    val renamed = if (source.isDirectory) {
      renameChecked(source, target)
    } else {
      renameFileNoReplace(source, target, sourceMustGo = true)
    }
    if (!renamed) throw nameExists()
  }

  /**
   * Case-only rename on a case-insensitive filesystem. A plain rename(2)
   * changes the spelling in place on most of them (ext4 casefold behind
   * FUSE, vfat, NTFS); the folder listing confirms it. Otherwise the entry
   * goes through a hidden temp name, journaled first so a crash between the
   * two steps is repaired by [replayJournal] on the next start.
   */
  private fun caseOnlyRename(source: File, target: File) {
    val dir = source.parentFile ?: throw denied()
    if (directRename(source, target) && listedNames(dir).contains(target.name)) return

    val temp = File(dir, NameRules.renameTempName(clock(), randomToken()))
    val journalId = journal?.begin(OpJournal.Entry.Rename(temp, source))
    try {
      movePath(source.toPath(), temp.toPath())
    } catch (e: Throwable) {
      if (journalId != null) journal?.end(journalId)
      throw e
    }
    try {
      movePath(temp.toPath(), target.toPath())
    } catch (e: Throwable) {
      try {
        movePath(temp.toPath(), source.toPath())
        if (journalId != null) journal?.end(journalId)
      } catch (_: IOException) {
        // The journal entry stays for the replay, which puts the entry back.
        if (journalId != null) journal?.abandon(journalId)
      }
      throw e
    }
    try {
      syncDirectory(dir)
    } catch (_: IOException) {
      // The rename itself is done; keep the entry so a replay double-checks.
      if (journalId != null) journal?.abandon(journalId)
      return
    }
    if (journalId != null) journal?.end(journalId)
  }

  /**
   * Repairs what interrupted operations left behind (run once at start-up):
   * an entry parked under a rename temp name goes back to its original name,
   * or to a free variant ("Name (1).ext") when that name was taken
   * meanwhile; unfinished copy temp files are deleted.
   *
   * An entry is dropped only when the outcome is certain: its temp entry is
   * definitely gone, it was repaired, or its path lies outside My Files and
   * outside every known volume (not ours to touch). Anything uncertain is
   * kept for the next start: a volume that is not mounted now, shared
   * storage without access right now, an existence check that cannot tell,
   * or a repair that fails.
   */
  fun replayJournal() {
    val log = journal ?: return
    lock.withLock {
      for ((id, entry) in log.pending()) {
        val done = try {
          replay(entry)
        } catch (_: IOException) {
          false
        } catch (_: SecurityException) {
          false
        }
        if (done) log.end(id)
      }
    }
  }

  private enum class Place { MY_FILES, SHARED, UNAVAILABLE_VOLUME, FOREIGN }

  private fun placeOf(file: File): Place = when {
    isWithin(file, myFilesRoot) -> Place.MY_FILES
    sharedRoots.any { isWithin(file, it) } -> Place.SHARED
    knownVolumes.any { isWithin(file, it) } -> Place.UNAVAILABLE_VOLUME
    else -> Place.FOREIGN
  }

  private fun hasSharedAccess(): Boolean = try {
    requireSharedAccess()
    true
  } catch (_: Exception) {
    false
  }

  /** True when the entry is finished with (repaired or nothing left to do); false to keep it. */
  private fun replay(entry: OpJournal.Entry): Boolean {
    val temp = when (entry) {
      is OpJournal.Entry.CopyTemp -> entry.temp
      is OpJournal.Entry.Rename -> entry.temp
    }
    when (placeOf(temp)) {
      Place.FOREIGN -> return true
      Place.UNAVAILABLE_VOLUME -> return false
      Place.SHARED -> if (!hasSharedAccess()) return false
      Place.MY_FILES -> Unit
    }
    // Only this module's hidden temp entries are ever touched.
    if (!NameRules.isTempName(temp.name)) return true
    when (pathExists(temp.toPath())) {
      false -> return true
      null -> return false
      true -> Unit
    }
    when (entry) {
      is OpJournal.Entry.CopyTemp -> Files.delete(temp.toPath())
      is OpJournal.Entry.Rename -> {
        val dir = temp.parentFile ?: return false
        if (entry.original.parentFile != dir) return false
        val target = File(dir, NameRules.freeName(entry.original.name, NameRules.Style.MOVE) { File(dir, it).exists() })
        if (!renameChecked(temp, target)) return false
        syncDirectory(dir)
      }
    }
    return true
  }

  /**
   * Removes [extra] (a new entry that must not survive [cause]) and rethrows
   * [cause]; when [extra] cannot be removed, rejects with ERR_DUPLICATE_LEFT
   * because the user now has two copies.
   */
  private fun removeOrReportDuplicate(extra: File, cause: Exception): Nothing {
    try {
      deletePath(extra.toPath())
    } catch (_: NoSuchFileException) {
      // Already gone.
    } catch (_: Exception) {
      throw FileOpFailure(FileOpCodes.ERR_DUPLICATE_LEFT, "A second copy of the file was left behind")
    }
    throw cause
  }

  // endregion

  // region helpers

  /** A My Files folder that may be renamed or deleted: not the root, not a link. */
  private fun resolveFolderForChange(path: String): File {
    val given = File(path)
    if (given.isAbsolute) {
      val attrs = readAttributes(given.toPath())
      if (attrs != null && attrs.isSymbolicLink) throw denied()
    }
    val dir = resolve(path, allowShared = false)
    if (dir == myFilesRoot) throw denied()
    requireDirectory(dir)
    return dir
  }

  /**
   * Real path of [path] when it lies inside an allowed root; otherwise
   * PERMISSION_DENIED. Relative paths are refused.
   */
  fun resolve(path: String, allowShared: Boolean): File {
    val raw = File(path)
    if (path.isEmpty() || !raw.isAbsolute) throw denied()
    val canonical = canonicalOrNull(raw) ?: throw denied()
    if (isWithin(canonical, myFilesRoot)) return canonical
    if (allowShared && sharedRoots.any { isWithin(canonical, it) }) {
      requireSharedAccess()
      return canonical
    }
    throw denied()
  }

  fun isShared(file: File): Boolean = !isWithin(file, myFilesRoot) && sharedRoots.any { isWithin(file, it) }

  /**
   * What identifies a file's content for the move check: the filesystem key
   * (device + inode on Linux) when available, plus size and mtime, so both a
   * replacement and an in-place change are noticed. Null when unreadable.
   */
  private data class Identity(val key: Any?, val size: Long, val mtime: Long)

  private fun identityOf(file: File): Identity? {
    val attrs = readAttributes(file.toPath()) ?: return null
    return Identity(attrs.fileKey(), attrs.size(), attrs.lastModifiedTime().toMillis())
  }

  private fun notifyIfShared(vararg files: File) {
    val shared = files.filter { isShared(it) }.map { it.path }
    if (shared.isNotEmpty()) onSharedChanged(shared)
  }

  private fun requireRegularFile(file: File) {
    if (!file.exists()) throw FileOpFailure(ErrorCode.NOT_FOUND.name, "The file no longer exists")
    if (!file.isFile) throw FileOpFailure(FileOpCodes.ERR_FILE_OP_FAILED, "Not a file")
  }

  private fun requireDirectory(dir: File) {
    if (!dir.exists()) throw FileOpFailure(ErrorCode.NOT_FOUND.name, "The folder no longer exists")
    if (!dir.isDirectory) throw FileOpFailure(FileOpCodes.ERR_FILE_OP_FAILED, "Not a folder")
  }

  private fun listedNames(dir: File): Set<String> = dir.list()?.toHashSet() ?: throw cannotList()

  private fun fileInfo(file: File) = FileInfo(file.path, file.name, file.length(), file.lastModified())

  private fun folderEntry(dir: File) = FolderEntryInfo(dir.path, dir.name, true, 0L, dir.lastModified())

  private fun readAttributes(path: Path): BasicFileAttributes? = try {
    Files.readAttributes(path, BasicFileAttributes::class.java, LinkOption.NOFOLLOW_LINKS)
  } catch (_: IOException) {
    null
  }

  private fun randomToken(): String = UUID.randomUUID().toString().replace("-", "").take(12)

  private fun denied() = FileOpFailure(ErrorCode.PERMISSION_DENIED.name, "This location is not allowed")

  private fun nameExists() = FileOpFailure(FileOpCodes.ERR_NAME_EXISTS, "An item with this name already exists")

  private fun noFreeName() = FileOpFailure(FileOpCodes.ERR_FILE_OP_FAILED, "No free name is available")

  private fun cannotList() = FileOpFailure(FileOpCodes.ERR_FILE_OP_FAILED, "Cannot list the folder")

  private fun incomplete() = FileOpFailure(FileOpCodes.ERR_FILE_OP_FAILED, "The copy is incomplete")

  // endregion

  companion object {
    /** Free space kept on top of the bytes to write. */
    const val SPACE_MARGIN_BYTES = 1L * 1024 * 1024

    /** Age after which a copy temp file is treated as left behind by a crash. */
    const val STALE_TEMP_MS = 24L * 60 * 60 * 1000

    /** Process-wide lock for every change to names. */
    val WRITE_LOCK = ReentrantLock()

    /** Where Android mounts storage volumes (/storage/emulated/0, /storage/<uuid>, …). */
    val DEFAULT_VOLUME_PARENTS: List<File> = listOf(File("/storage"), File("/mnt/media_rw"))

    /** Files.exists / Files.notExists without following links; null when neither is certain. */
    fun existenceOf(path: Path): Boolean? = try {
      when {
        Files.exists(path, LinkOption.NOFOLLOW_LINKS) -> true
        Files.notExists(path, LinkOption.NOFOLLOW_LINKS) -> false
        else -> null
      }
    } catch (_: SecurityException) {
      null
    }

    private const val COPY_BUFFER_BYTES = 64 * 1024
    private const val RENAME_ATTEMPTS = 8

    /**
     * Plain usable space of [dir]'s volume (0 when unknown). On Android the
     * module passes a source that also counts clearable cache.
     */
    @Suppress("UsableSpace")
    fun usableSpaceOf(dir: File): Long = try {
      dir.usableSpace
    } catch (_: SecurityException) {
      0L
    }

    /** True when real [child] is [root] or lies below it. A filesystem root never counts as a root. */
    fun isWithin(child: File, root: File): Boolean {
      val rootPath = root.path
      if (root.parentFile == null) return false
      if (child.path == rootPath) return true
      val prefix = if (rootPath.endsWith(File.separatorChar)) rootPath else rootPath + File.separatorChar
      return child.path.startsWith(prefix)
    }

    /**
     * [file] with every symlink resolved, or null when it cannot be resolved.
     * The deepest existing ancestor goes through Path.toRealPath (unlike
     * File.canonicalFile it resolves links on every platform); the missing
     * rest is appended as is. "." or ".." below a missing component is
     * refused (null), since it cannot be resolved against the real tree.
     */
    fun canonicalOrNull(file: File): File? {
      try {
        var existing: Path = file.absoluteFile.toPath()
        val missing = ArrayDeque<String>()
        while (true) {
          try {
            existing = existing.toRealPath()
            break
          } catch (_: NoSuchFileException) {
            val name = existing.fileName?.toString() ?: return null
            missing.addFirst(name)
            existing = existing.parent ?: return null
          }
        }
        if (missing.any { it == "." || it == ".." }) return null
        return missing.fold(existing.toFile()) { dir, name -> File(dir, name) }
      } catch (_: IOException) {
        return null
      } catch (_: InvalidPathException) {
        return null
      } catch (_: SecurityException) {
        return null
      }
    }
  }
}
