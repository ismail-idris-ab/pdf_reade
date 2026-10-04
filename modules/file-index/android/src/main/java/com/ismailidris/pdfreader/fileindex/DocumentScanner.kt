package com.ismailidris.pdfreader.fileindex

import java.io.File
import java.io.IOException
import java.nio.file.Files
import java.nio.file.InvalidPathException
import java.nio.file.LinkOption
import java.nio.file.Path
import java.nio.file.attribute.BasicFileAttributes
import java.util.Locale

/** One matching document found on disk. */
data class ScannedFile(
  /** Absolute path as reached by the walk (symlinks are not resolved). */
  val path: String,
  val name: String,
  /** Lowercase extension without the dot. */
  val ext: String,
  /** Size in bytes. */
  val size: Long,
  /** Last-modified time in milliseconds since the epoch. */
  val mtime: Long,
)

/** Totals for one scan. */
data class ScanSummary(
  /** Matching files seen, whether or not they were emitted. */
  val scanned: Int,
  /** Files delivered through the batch callback. */
  val emitted: Int,
  /** Known paths that no longer exist under a fully scanned area. Empty when cancelled. */
  val deleted: List<String>,
  /** Directories that could not be listed (unreadable, I/O error, refused). */
  val skippedDirs: Int,
  val durationMs: Long,
  val cancelled: Boolean,
)

/**
 * Walks storage roots looking for documents. Pure JVM code (no Android
 * dependencies) so it is unit-testable; the module runs it on Dispatchers.IO.
 *
 * - Iterative depth-first walk with an explicit stack (deep trees cannot
 *   overflow the thread stack).
 * - Skips `Android/data` and `Android/obb` directly under a root (compared
 *   case-insensitively) and every hidden entry (name starting with ".").
 * - Follows at most [MAX_SYMLINK_DEPTH] nested symlinks and never lists the
 *   same real directory twice, so link loops terminate.
 * - Emits only files whose extension is in [extensions] and whose mtime
 *   differs from [knownMtimes] (or that are unknown), in batches of
 *   [batchSize].
 * - A known path with a matching extension is reported deleted only when it
 *   was not seen, lies under a root that was listed, does not lie under a
 *   directory that could not be listed, and no longer exists on disk. The
 *   existence check keeps files that were merely skipped (excluded folders,
 *   deep symlinks, a second path to an already listed folder) from being
 *   reported deleted.
 * - Unreadable directories are counted in [ScanSummary.skippedDirs]; they
 *   never throw.
 *
 * Cost per directory entry: one attribute read without following links
 * (type, size and mtime in a single call); a symlink costs one more read and
 * one real-path resolution. Real paths of ordinary directories are derived
 * from their parent's real path, so they need no extra filesystem call.
 */
class DocumentScanner(
  private val roots: List<File>,
  extensions: Set<String>,
  private val knownMtimes: Map<String, Long>,
  private val batchSize: Int = DEFAULT_BATCH_SIZE,
  private val isCancelled: () -> Boolean = { false },
  private val onBatch: (List<ScannedFile>) -> Unit,
) {
  private val extensions: Set<String> = extensions.map { it.lowercase(Locale.ROOT) }.toSet()

  init {
    require(batchSize > 0) { "batchSize must be positive" }
  }

  /**
   * A directory waiting to be listed. [realPath] is null for roots (resolved
   * when popped); otherwise it is the directory's path with all links resolved.
   */
  private class DirEntry(
    val dir: File,
    val realPath: String?,
    val relativePath: String,
    val symlinkDepth: Int,
  )

  fun scan(): ScanSummary {
    val startNanos = System.nanoTime()
    val seen = HashSet<String>()
    val scannedRootPrefixes = ArrayList<String>()
    val skippedPrefixes = ArrayList<String>()
    val visitedReal = HashSet<String>()
    val pending = ArrayList<ScannedFile>(batchSize)
    var scanned = 0
    var emitted = 0
    var skippedDirs = 0
    var cancelled = false

    fun flush() {
      if (pending.isEmpty()) return
      val batch = ArrayList(pending)
      pending.clear()
      onBatch(batch)
      emitted += batch.size
    }

    fun skip(dir: File) {
      skippedDirs++
      skippedPrefixes.add(prefixOf(dir.path))
    }

    val stack = ArrayDeque<DirEntry>()
    for (root in roots.asReversed()) {
      stack.addLast(DirEntry(root.absoluteFile, null, "", 0))
    }

    walk@ while (stack.isNotEmpty()) {
      if (isCancelled()) {
        cancelled = true
        break
      }
      val entry = stack.removeLast()
      val isRoot = entry.relativePath.isEmpty()
      if (isRoot && !entry.dir.isDirectory) {
        // A missing root (e.g. a volume that just unmounted) is simply not scanned.
        continue
      }

      val realPath = entry.realPath ?: realPathOrNull(entry.dir)
      if (realPath == null) {
        skip(entry.dir)
        continue
      }
      if (!visitedReal.add(realPath)) continue

      val names = listOrNull(entry.dir)
      if (names == null) {
        skip(entry.dir)
        continue
      }
      if (isRoot) scannedRootPrefixes.add(prefixOf(entry.dir.path))

      for (name in names) {
        if (isCancelled()) {
          cancelled = true
          break@walk
        }
        if (name.startsWith(".")) continue

        val child = File(entry.dir, name)
        val childPath = pathOrNull(child) ?: continue
        var attrs = readAttributesOrNull(childPath, followLinks = false) ?: continue
        val isLink = attrs.isSymbolicLink
        val symlinkDepth = if (isLink) entry.symlinkDepth + 1 else entry.symlinkDepth
        if (isLink) {
          if (symlinkDepth > MAX_SYMLINK_DEPTH) continue
          // Broken or unreadable link targets are ignored.
          attrs = readAttributesOrNull(childPath, followLinks = true) ?: continue
        }

        if (attrs.isDirectory) {
          val relativePath = if (entry.relativePath.isEmpty()) name else "${entry.relativePath}/$name"
          if (isExcluded(relativePath)) continue
          // An ordinary child's real path is its real parent plus its name;
          // only a link needs the filesystem to resolve it.
          val childReal = if (isLink) realPathOrNull(child) else File(realPath, name).path
          if (childReal == null) {
            skip(child)
            continue
          }
          if (childReal in visitedReal) continue
          stack.addLast(DirEntry(child, childReal, relativePath, symlinkDepth))
        } else if (attrs.isRegularFile) {
          val ext = extensionOf(name)
          if (ext.isEmpty() || ext !in extensions) continue
          val path = child.path
          if (!seen.add(path)) continue
          scanned++
          val mtime = attrs.lastModifiedTime().toMillis()
          val known = knownMtimes[path]
          if (known == null || known != mtime) {
            pending.add(ScannedFile(path, name, ext, attrs.size(), mtime))
            if (pending.size >= batchSize) flush()
          }
        }
      }
    }

    val deleted = if (cancelled) {
      emptyList()
    } else {
      flush()
      knownMtimes.keys.filter { path ->
        path !in seen &&
          extensionOf(File(path).name) in extensions &&
          scannedRootPrefixes.any { path.startsWith(it) } &&
          skippedPrefixes.none { path.startsWith(it) } &&
          !existsSafely(File(path))
      }
    }

    return ScanSummary(
      scanned = scanned,
      emitted = emitted,
      deleted = deleted,
      skippedDirs = skippedDirs,
      durationMs = (System.nanoTime() - startNanos) / 1_000_000,
      cancelled = cancelled,
    )
  }

  private fun isExcluded(relativePath: String): Boolean {
    val lower = relativePath.lowercase(Locale.ROOT)
    return lower == "android/data" || lower == "android/obb"
  }

  companion object {
    const val DEFAULT_BATCH_SIZE = 200
    const val MAX_SYMLINK_DEPTH = 5

    /** Lowercase extension without the dot, or "" when the name has none. */
    fun extensionOf(name: String): String {
      val dot = name.lastIndexOf('.')
      if (dot <= 0 || dot == name.length - 1) return ""
      return name.substring(dot + 1).lowercase(Locale.ROOT)
    }

    private fun prefixOf(dirPath: String): String =
      if (dirPath.endsWith(File.separatorChar)) dirPath else dirPath + File.separatorChar

    /**
     * Real path with every symlink resolved. Path.toRealPath is used rather
     * than File.canonicalPath because the latter does not resolve links on
     * every platform (notably Windows), which would defeat loop detection.
     */
    private fun realPathOrNull(dir: File): String? = try {
      dir.toPath().toRealPath().toString()
    } catch (_: IOException) {
      null
    } catch (_: InvalidPathException) {
      null
    } catch (_: SecurityException) {
      null
    }

    private fun listOrNull(dir: File): Array<String>? = try {
      dir.list()
    } catch (_: SecurityException) {
      null
    }

    private fun pathOrNull(file: File): Path? = try {
      file.toPath()
    } catch (_: InvalidPathException) {
      null
    }

    private val NO_FOLLOW = arrayOf(LinkOption.NOFOLLOW_LINKS)
    private val FOLLOW = emptyArray<LinkOption>()

    private fun readAttributesOrNull(path: Path, followLinks: Boolean): BasicFileAttributes? = try {
      Files.readAttributes(path, BasicFileAttributes::class.java, *(if (followLinks) FOLLOW else NO_FOLLOW))
    } catch (_: IOException) {
      null
    } catch (_: SecurityException) {
      null
    }

    private fun existsSafely(file: File): Boolean = try {
      file.exists()
    } catch (_: SecurityException) {
      // Cannot tell: do not claim the file is gone.
      true
    }
  }
}
