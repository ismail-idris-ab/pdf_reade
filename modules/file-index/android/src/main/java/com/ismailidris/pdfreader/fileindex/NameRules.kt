package com.ismailidris.pdfreader.fileindex

/**
 * Validation and clash-free naming for user-chosen file and folder names.
 * Pure JVM code so it is unit-testable.
 */
object NameRules {
  /** Linux and FAT/exFAT both cap one name at 255 bytes. */
  const val MAX_NAME_BYTES = 255

  /** Attempts before giving up on finding a free name. */
  const val MAX_FREE_NAME_ATTEMPTS = 10_000

  /**
   * Characters refused everywhere: "/" and NUL are invalid on every
   * filesystem; the rest are refused by FAT/exFAT SD cards, so rejecting them
   * everywhere keeps a name valid wherever the file is moved later.
   */
  private const val FORBIDDEN_CHARS = "/\\:*?\"<>|"

  enum class Style {
    /** "Name.ext", then "Name (1).ext", "Name (2).ext"… */
    MOVE,

    /** "Name (copy).ext", then "Name (copy 2).ext", "Name (copy 3).ext"… */
    COPY,
  }

  /**
   * The name to use for [raw] (surrounding whitespace removed), or null when
   * it is invalid: empty, starting with "." (hidden names, "." and ".."; it
   * also keeps user names apart from this module's hidden temp files),
   * containing a forbidden or control character, or longer than
   * [MAX_NAME_BYTES] in UTF-8.
   */
  fun normalize(raw: String): String? {
    val name = raw.trim()
    if (name.isEmpty() || name.startsWith(".")) return null
    for (ch in name) {
      if (ch.code < 0x20 || ch.code == 0x7f || FORBIDDEN_CHARS.indexOf(ch) >= 0) return null
    }
    if (FileNames.utf8Length(name) > MAX_NAME_BYTES) return null
    return name
  }

  /** [normalize] that throws ERR_NAME_INVALID instead of returning null. */
  fun requireValid(raw: String): String =
    normalize(raw) ?: throw FileOpFailure(FileOpCodes.ERR_NAME_INVALID, "The name is not valid")

  /**
   * Splits [name] into base and extension (with its dot). Only the last dot
   * counts; a leading dot (hidden name) or a trailing dot is not an extension.
   */
  fun splitExtension(name: String): Pair<String, String> {
    val dot = name.lastIndexOf('.')
    return if (dot > 0 && dot < name.length - 1) {
      name.substring(0, dot) to name.substring(dot)
    } else {
      name to ""
    }
  }

  /**
   * The [attempt]-th candidate (0-based) for [name] in [style]. The base is
   * shortened when needed so the candidate stays within [MAX_NAME_BYTES].
   */
  fun candidate(name: String, style: Style, attempt: Int): String {
    val suffix = when (style) {
      Style.MOVE -> if (attempt == 0) return name else " ($attempt)"
      Style.COPY -> if (attempt == 0) " (copy)" else " (copy ${attempt + 1})"
    }
    val (base, ext) = splitExtension(name)
    val full = base + suffix + ext
    if (FileNames.utf8Length(full) <= MAX_NAME_BYTES) return full
    val room = MAX_NAME_BYTES - FileNames.utf8Length(suffix + ext)
    return FileNames.truncateUtf8(base, room.coerceAtLeast(0)) + suffix + ext
  }

  /**
   * First candidate for [name] in [style] that [taken] does not report as
   * used. Throws ERR_FILE_OP_FAILED after [MAX_FREE_NAME_ATTEMPTS].
   */
  fun freeName(name: String, style: Style, taken: (String) -> Boolean): String {
    for (attempt in 0 until MAX_FREE_NAME_ATTEMPTS) {
      val next = candidate(name, style, attempt)
      if (!taken(next)) return next
    }
    throw FileOpFailure(FileOpCodes.ERR_FILE_OP_FAILED, "No free name is available")
  }

  /** Marker of the hidden temp files written during copies. */
  private const val TEMP_MARKER = ".tmp-"

  /** Prefix of the hidden temp entries used by case-only renames. */
  private const val RENAME_PREFIX = ".rename-"

  /**
   * Name of the hidden temp file for an in-progress copy of [name], stamped
   * with its creation time [nowMs] so cleanup does not depend on the mtime
   * (which a move copies from the source).
   */
  fun tempName(name: String, nowMs: Long, random: String): String =
    "." + FileNames.truncateUtf8(name, MAX_NAME_BYTES - 64) + TEMP_MARKER + nowMs + "-" + random

  /** Creation time stamped into a [tempName], or null when [name] is not one. */
  fun tempCreatedAt(name: String): Long? {
    if (!name.startsWith(".")) return null
    val marker = name.lastIndexOf(TEMP_MARKER)
    if (marker < 0) return null
    return name.substring(marker + TEMP_MARKER.length).substringBefore('-').toLongOrNull()
  }

  /**
   * Hidden name an entry takes for the middle step of a case-only rename.
   * The original name is not part of it (it may not fit in 255 bytes); it is
   * recorded in the app-private operation journal instead.
   */
  fun renameTempName(nowMs: Long, random: String): String = "$RENAME_PREFIX$nowMs-$random"

  /** True for every hidden entry this module writes; listings hide them. */
  fun isTempName(name: String): Boolean =
    name.startsWith(RENAME_PREFIX) || (name.startsWith(".") && name.contains(TEMP_MARKER))
}

/** Codes outside the shared ErrorCode list used by file actions. */
object FileOpCodes {
  const val ERR_NAME_INVALID = "ERR_NAME_INVALID"
  const val ERR_NAME_EXISTS = "ERR_NAME_EXISTS"
  const val ERR_FILE_OP_FAILED = "ERR_FILE_OP_FAILED"

  /** A move failed and its new copy could not be removed: two copies now exist. */
  const val ERR_DUPLICATE_LEFT = "ERR_DUPLICATE_LEFT"
}

/**
 * A file action failure with the code JS receives (a shared ErrorCode name or
 * an ERR_* code). [message] is static text: never a path or a file name.
 */
class FileOpFailure(val code: String, message: String) : Exception(message)
