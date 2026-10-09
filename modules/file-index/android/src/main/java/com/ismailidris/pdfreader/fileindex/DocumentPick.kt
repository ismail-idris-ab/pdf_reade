package com.ismailidris.pdfreader.fileindex

/**
 * Pure helpers for the system document picker. They take plain values (no
 * Android framework types) so they can be unit tested on the JVM.
 */
object DocumentPick {
  const val ANY_TYPE = "*/*"

  /** Intent type plus the EXTRA_MIME_TYPES value (null when none is needed). */
  data class TypeFilter(val type: String, val extraMimeTypes: List<String>?)

  /**
   * Builds the picker type filter: no usable types -> any type; exactly one ->
   * that type as the intent type; several -> any type narrowed by the extra.
   */
  fun typeFilter(mimeTypes: List<String>): TypeFilter {
    val types = mimeTypes.map { it.trim() }.filter { it.isNotEmpty() }.distinct()
    return when {
      types.isEmpty() || types.contains(ANY_TYPE) -> TypeFilter(ANY_TYPE, null)
      types.size == 1 -> TypeFilter(types[0], null)
      else -> TypeFilter(ANY_TYPE, types)
    }
  }

  /**
   * URIs of a picker result: the ClipData items when there are any (multiple
   * selection), otherwise the single data URI. Blank entries and duplicates are
   * dropped; order is kept.
   */
  fun collectUris(clipUris: List<String?>, dataUri: String?): List<String> {
    val fromClip = clipUris.filterNotNull().filter { it.isNotBlank() }
    val all = fromClip.ifEmpty { listOfNotNull(dataUri?.takeIf { it.isNotBlank() }) }
    return all.distinct()
  }

  /**
   * Grant to persist for a picked document: NONE when the caller asked not to
   * persist (the temporary read grant of the result is used as is), READ_WRITE
   * when the picker granted write (falling back to read), otherwise READ.
   */
  fun persistMode(persistRequested: Boolean, writeGranted: Boolean): GrantMode = when {
    !persistRequested -> GrantMode.NONE
    writeGranted -> GrantMode.READ_WRITE
    else -> GrantMode.READ
  }

  /** Read-granted entries of the persisted URI permission list. */
  fun readGranted(permissions: List<Pair<String, Boolean>>): List<String> =
    permissions.filter { it.second }.map { it.first }.distinct()

  /**
   * Result item for JS. Values the provider did not report, or reported as
   * unusable (blank name, negative size, non-positive mtime), become null.
   * [persisted] tells whether the read grant survives an app restart; when
   * false the URI is usable only in the current session.
   */
  fun pickedDocument(
    uri: String,
    name: String?,
    size: Long?,
    mime: String?,
    mtime: Long?,
    persisted: Boolean,
  ): Map<String, Any?> =
    mapOf(
      "uri" to uri,
      "name" to name?.takeIf { it.isNotBlank() },
      "size" to size?.takeIf { it >= 0 }?.toDouble(),
      "mime" to mime?.trim()?.takeIf { it.isNotEmpty() },
      "mtime" to mtime?.takeIf { it > 0 }?.toDouble(),
      "persisted" to persisted,
    )

  /**
   * Request codes used for picker launches. Each launch gets the next code in
   * this range so a late result from a replaced picker is not mistaken for the
   * current one. The range fits in 16 bits (FragmentActivity requirement) and
   * stays below 0x10000, where Expo's activity-result registry starts its codes.
   */
  const val REQUEST_CODE_BASE = 0x4600
  const val REQUEST_CODE_COUNT = 0x100

  fun requestCodeFor(sequence: Int): Int = REQUEST_CODE_BASE + Math.floorMod(sequence, REQUEST_CODE_COUNT)

  fun isPickRequestCode(code: Int): Boolean = code in REQUEST_CODE_BASE until REQUEST_CODE_BASE + REQUEST_CODE_COUNT
}
