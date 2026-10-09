package com.ismailidris.pdfreader.fileindex

/** Access a persisted URI grant gives. Ordered: a later value includes the earlier ones. */
enum class GrantMode { NONE, READ, READ_WRITE }

/**
 * Grant handling around a provider rename, kept free of Android types so the
 * decisions are unit-testable.
 *
 * AOSP's DocumentsProvider revokes every grant on the old document as soon as
 * a rename changes its id, and gives the caller only a temporary grant on the
 * new URI. So after any rename (or rename-back) the URI that is live has to be
 * persisted again, and the old URI cannot be relied on any more.
 */
object DocumentRename {
  data class Outcome<U>(
    /** URI that is live now and holds a persisted grant. */
    val uri: U,
    /** False when the document was renamed back to its original name. */
    val renamed: Boolean,
  )

  /**
   * Renames the document at [original] and returns the URI to keep.
   *
   * 1. Rename; persist the live URI (even when it did not change). When the
   *    granted mode is at least [required], done: `renamed = true`.
   * 2. Otherwise rename back (on the live URI) and persist the restored URI:
   *    with any grant, `renamed = false`.
   * 3. Rename-back impossible: keep the renamed URI if it holds any grant
   *    (`renamed = true`, with less access than before).
   * 4. No live URI with a persisted grant: ERR_FILE_OP_FAILED. Access to the
   *    document is then lost (the provider already revoked the old grant);
   *    the user has to pick it again.
   *
   * Grants on URIs that are no longer live are released (best effort).
   *
   * @param required mode held on [original] before the rename.
   * @param rename renames to the new name; returns the new URI, or null when
   *   the provider kept the URI. Its failures propagate unchanged (nothing
   *   was renamed).
   * @param renameBack renames the document at the given URI to its original
   *   name; same return convention. Throws when that is not possible.
   * @param persist takes a persisted grant and returns the mode obtained.
   * @param release gives up a persisted grant; never throws.
   */
  fun <U : Any> rename(
    original: U,
    required: GrantMode,
    rename: (U) -> U?,
    renameBack: (U) -> U?,
    persist: (U) -> GrantMode,
    release: (U) -> Unit,
  ): Outcome<U> {
    val renamed = rename(original) ?: original
    val renamedMode = persist(renamed)
    if (renamedMode != GrantMode.NONE && renamedMode >= required) {
      if (renamed != original) release(original)
      return Outcome(renamed, true)
    }

    val restored = try {
      renameBack(renamed) ?: renamed
    } catch (_: Exception) {
      if (renamedMode != GrantMode.NONE) {
        if (renamed != original) release(original)
        return Outcome(renamed, true)
      }
      throw lost()
    }
    if (persist(restored) == GrantMode.NONE) throw lost()
    if (renamed != restored) release(renamed)
    if (original != restored && original != renamed) release(original)
    return Outcome(restored, false)
  }

  private fun lost() =
    FileOpFailure(FileOpCodes.ERR_FILE_OP_FAILED, "Access to the document could not be kept after renaming")
}
