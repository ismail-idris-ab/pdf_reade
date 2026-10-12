package com.ismailidris.pdfreader.fileindex

/**
 * Pure parsing of the intents another app uses to hand files to this one
 * ("Open with" for a single VIEW, share for SEND/SEND_MULTIPLE). Takes plain
 * values (no Android framework types) so it can be unit tested on the JVM;
 * [FileIndexModule] only pulls these values out of the real [android.content.Intent]
 * and wires the result into the module/event shape described by
 * `IncomingIntent` in FileIndexModule.ts.
 */
object IncomingIntents {
  const val ACTION_VIEW = "android.intent.action.VIEW"
  const val ACTION_SEND = "android.intent.action.SEND"
  const val ACTION_SEND_MULTIPLE = "android.intent.action.SEND_MULTIPLE"
  const val ACTION_MAIN = "android.intent.action.MAIN"
  const val CATEGORY_LAUNCHER = "android.intent.category.LAUNCHER"

  /**
   * Whether an activity was started by the user opening the app from the
   * launcher. Only such a launch drops a held hand-off nobody asked for: the
   * app also restarts its own activity (the dev client does, after a server
   * is picked) while a cold-start hand-off is still waiting for JS.
   */
  fun isLauncherOpen(action: String?, categories: Set<String>?): Boolean =
    action == ACTION_MAIN && categories?.contains(CATEGORY_LAUNCHER) == true

  /** `IncomingIntent.action` values on the JS side. */
  const val REPORTED_VIEW = "view"
  const val REPORTED_SEND = "send"

  /**
   * The only schemes a handed-over file may use, matching the schemes the
   * manifest's VIEW filters declare. Anything else is a different kind of
   * intent that happens to share the action: the app's own deep links arrive
   * as ACTION_VIEW too (`pdfreader://…`, including the dev client's launch
   * URL). Reporting one of those as a document would fail the cache copy and
   * consume a link expo-router still has to handle.
   */
  private val FILE_SCHEMES = setOf("content", "file")

  /** Mirrors the `IncomingIntent` TS shape. [uris] is never empty. */
  data class Parsed(val action: String, val uris: List<String>, val mimeType: String?)

  /**
   * Parses one incoming intent.
   *
   * Returns null when [action] is not one this app handles, or when it is but
   * no usable URI survives (a VIEW with no data, a SEND/SEND_MULTIPLE with
   * nothing readable in EXTRA_STREAM or clipData) - an intent that reports no
   * files is not reported at all.
   *
   * [dataUri] is `intent.data` (ACTION_VIEW). [streamUri] is EXTRA_STREAM read
   * as a single Uri (ACTION_SEND only; pass null otherwise). [streamUris] is
   * EXTRA_STREAM read as an ArrayList<Uri> (ACTION_SEND_MULTIPLE only; pass
   * null otherwise). [clipDataUris] is the fallback source, in `intent.clipData`
   * order, used when EXTRA_STREAM carried nothing usable. Sender order is kept
   * throughout; blank entries, and any URI whose scheme is not in
   * [FILE_SCHEMES], are dropped.
   */
  fun parse(
    action: String?,
    dataUri: String?,
    streamUri: String?,
    streamUris: List<String?>?,
    clipDataUris: List<String?>,
    mimeType: String?,
  ): Parsed? {
    val cleanMime = mimeType?.trim()?.takeIf { it.isNotEmpty() }
    return when (action) {
      ACTION_VIEW -> {
        val uri = cleanUri(dataUri) ?: return null
        Parsed(REPORTED_VIEW, listOf(uri), cleanMime)
      }
      ACTION_SEND -> {
        val uris = cleanUris(listOfNotNull(streamUri)).ifEmpty { cleanUris(clipDataUris) }
        if (uris.isEmpty()) null else Parsed(REPORTED_SEND, uris, cleanMime)
      }
      ACTION_SEND_MULTIPLE -> {
        val uris = cleanUris(streamUris ?: emptyList()).ifEmpty { cleanUris(clipDataUris) }
        if (uris.isEmpty()) null else Parsed(REPORTED_SEND, uris, cleanMime)
      }
      else -> null
    }
  }

  /** Trims a URI and keeps it only when it names a file this app can read. */
  private fun cleanUri(raw: String?): String? {
    val uri = raw?.trim()?.takeIf { it.isNotEmpty() } ?: return null
    val scheme = uri.substringBefore(':', missingDelimiterValue = "").lowercase()
    return if (scheme in FILE_SCHEMES) uri else null
  }

  private fun cleanUris(raw: List<String?>): List<String> = raw.mapNotNull { cleanUri(it) }
}
