package com.ismailidris.pdfreader.fileindex

import java.io.File

/** File-name helpers shared by import and share. Pure JVM code. */
object FileNames {
  const val FALLBACK_NAME = "document"

  /** Most filesystems cap a name at 255 bytes; stay well below. */
  const val MAX_NAME_BYTES = 200

  private const val MAX_EXTENSION_CHARS = 16

  /**
   * Turns an untrusted display name into a single safe path segment: drops
   * path separators and control characters, strips leading dots (so the
   * result is never "." or ".." and never hidden), trims whitespace and caps
   * the UTF-8 length while keeping a short extension. Returns
   * [FALLBACK_NAME] when nothing usable remains.
   */
  fun sanitize(raw: String?): String {
    if (raw == null) return FALLBACK_NAME
    val cleaned = buildString(raw.length) {
      for (ch in raw) {
        if (ch == '/' || ch == '\\' || ch.code < 0x20 || ch.code == 0x7f) continue
        append(ch)
      }
    }.trim().trimStart('.').trim()
    if (cleaned.isEmpty()) return FALLBACK_NAME
    if (utf8Length(cleaned) <= MAX_NAME_BYTES) return cleaned

    val dot = cleaned.lastIndexOf('.')
    val ext = if (dot > 0 && cleaned.length - dot - 1 in 1..MAX_EXTENSION_CHARS) cleaned.substring(dot) else ""
    val base = if (ext.isEmpty()) cleaned else cleaned.substring(0, dot)
    val truncated = truncateUtf8(base, MAX_NAME_BYTES - utf8Length(ext)).trim()
    return if (truncated.isEmpty()) FALLBACK_NAME else truncated + ext
  }

  /**
   * Returns a name not yet present in [dir] by appending " (2)", " (3)", ...
   * before the extension.
   */
  fun uniqueIn(dir: File, name: String): String {
    if (!File(dir, name).exists()) return name
    val dot = name.lastIndexOf('.')
    val base = if (dot > 0) name.substring(0, dot) else name
    val ext = if (dot > 0) name.substring(dot) else ""
    var counter = 2
    while (true) {
      val candidate = "$base ($counter)$ext"
      if (!File(dir, candidate).exists()) return candidate
      counter++
    }
  }

  internal fun utf8Length(value: String): Int = value.toByteArray(Charsets.UTF_8).size

  /** Longest prefix of [value] whose UTF-8 encoding fits [maxBytes], never splitting a code point. */
  internal fun truncateUtf8(value: String, maxBytes: Int): String {
    var bytes = 0
    var index = 0
    while (index < value.length) {
      val codePoint = value.codePointAt(index)
      val size = when {
        codePoint < 0x80 -> 1
        codePoint < 0x800 -> 2
        codePoint < 0x10000 -> 3
        else -> 4
      }
      if (bytes + size > maxBytes) break
      bytes += size
      index += Character.charCount(codePoint)
    }
    return value.substring(0, index)
  }
}
