package com.ismailidris.pdfreader.fileindex

import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * Durable record of operations in flight that can leave hidden entries
 * behind if the process dies: case-only renames (an entry parked under a temp
 * name) and copies (a temp file). One small file per operation in an
 * app-private folder, holding absolute paths, so entries in shared storage
 * are recovered too. Pure JVM code.
 *
 * Entries of operations still running in this process are never handed out
 * by [pending], so a replay (e.g. after a JS reload) cannot touch them.
 */
class OpJournal(private val dir: File, private val syncDirectory: (File) -> Unit = {}) {
  sealed class Entry {
    /** [temp] holds the entry that was named [original] (same folder). */
    data class Rename(val temp: File, val original: File) : Entry()

    /** [temp] is an unfinished copy. */
    data class CopyTemp(val temp: File) : Entry()
  }

  /**
   * Records [entry] durably (file fsynced, folder synced) before the
   * operation touches anything; returns the id to pass to [end].
   */
  fun begin(entry: Entry): String {
    if (!dir.isDirectory && !dir.mkdirs() && !dir.isDirectory) throw IOException("Cannot create the journal folder")
    val id = "${System.currentTimeMillis()}-${UUID.randomUUID().toString().replace("-", "").take(12)}"
    ACTIVE.add(id)
    try {
      FileOutputStream(File(dir, id + SUFFIX)).use { output ->
        output.write(encode(entry))
        output.flush()
        output.fd.sync()
      }
      syncDirectory(dir)
    } catch (e: Throwable) {
      end(id)
      throw e
    }
    return id
  }

  /**
   * Leaves the entry for [replay][FileOps.replayJournal]: the operation gave
   * up without being able to undo itself, so the entry is no longer "running".
   */
  fun abandon(id: String) {
    ACTIVE.remove(id)
  }

  /** Forgets an entry once its operation finished or was undone. */
  fun end(id: String) {
    File(dir, id + SUFFIX).delete()
    ACTIVE.remove(id)
  }

  /**
   * Entries left by operations that are no longer running. Unreadable
   * entries (a crash while the entry itself was written, before the
   * operation started) are deleted.
   */
  fun pending(): List<Pair<String, Entry>> {
    val names = dir.list() ?: return emptyList()
    val result = ArrayList<Pair<String, Entry>>()
    for (name in names.sorted()) {
      if (!name.endsWith(SUFFIX)) continue
      val id = name.removeSuffix(SUFFIX)
      if (id in ACTIVE) continue
      val file = File(dir, name)
      val entry = try {
        decode(file.readBytes())
      } catch (_: IOException) {
        null
      }
      if (entry == null) file.delete() else result.add(id to entry)
    }
    return result
  }

  companion object {
    private const val SUFFIX = ".op"
    private const val KIND_RENAME = "rename"
    private const val KIND_COPY = "copy"

    /** Ids of operations running in this process (shared by every journal). */
    private val ACTIVE: MutableSet<String> = ConcurrentHashMap.newKeySet()

    /** NUL-separated fields: NUL is the one byte no path can contain. */
    fun encode(entry: Entry): ByteArray {
      val fields = when (entry) {
        is Entry.Rename -> listOf(KIND_RENAME, entry.temp.path, entry.original.path)
        is Entry.CopyTemp -> listOf(KIND_COPY, entry.temp.path)
      }
      return fields.joinToString("\u0000").toByteArray(Charsets.UTF_8)
    }

    fun decode(bytes: ByteArray): Entry? {
      val fields = String(bytes, Charsets.UTF_8).split('\u0000')
      val paths = fields.drop(1).map { File(it) }
      if (paths.any { it.path.isEmpty() || !it.isAbsolute }) return null
      return when {
        fields[0] == KIND_RENAME && paths.size == 2 -> Entry.Rename(paths[0], paths[1])
        fields[0] == KIND_COPY && paths.size == 1 -> Entry.CopyTemp(paths[0])
        else -> null
      }
    }
  }
}
