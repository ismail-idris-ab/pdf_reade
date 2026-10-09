package com.ismailidris.pdfreader.fileindex

import android.content.ContentResolver
import android.database.Cursor
import android.net.Uri
import android.provider.DocumentsContract
import android.provider.OpenableColumns

/** Provider metadata of one content:// document; null where unknown. */
class ProviderMetadata(val name: String?, val size: Long?, val mtime: Long?)

/** Metadata queries against content providers. Never throw for a provider's refusal. */
object ProviderQueries {
  private val EMPTY = ProviderMetadata(null, null, null)

  /**
   * DISPLAY_NAME, SIZE and (when the provider supports it) LAST_MODIFIED.
   * Anything the provider refuses or lacks is null.
   */
  fun metadata(resolver: ContentResolver, uri: Uri): ProviderMetadata {
    val withMtime = arrayOf(
      OpenableColumns.DISPLAY_NAME,
      OpenableColumns.SIZE,
      DocumentsContract.Document.COLUMN_LAST_MODIFIED,
    )
    val basic = arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE)
    return try {
      val cursor = try {
        resolver.query(uri, withMtime, null, null, null)
      } catch (_: IllegalArgumentException) {
        // Provider rejects the last-modified column: retry without it.
        resolver.query(uri, basic, null, null, null)
      }
      cursor?.use {
        if (it.moveToFirst()) {
          ProviderMetadata(
            name = it.stringOrNull(OpenableColumns.DISPLAY_NAME)?.takeIf { name -> name.isNotBlank() },
            size = it.longOrNull(OpenableColumns.SIZE)?.takeIf { size -> size >= 0 },
            mtime = it.longOrNull(DocumentsContract.Document.COLUMN_LAST_MODIFIED)?.takeIf { time -> time > 0 },
          )
        } else {
          null
        }
      } ?: EMPTY
    } catch (_: SecurityException) {
      EMPTY
    } catch (_: IllegalArgumentException) {
      EMPTY
    } catch (_: UnsupportedOperationException) {
      EMPTY
    }
  }

  /** DocumentsContract flags of a document, or null when unavailable. */
  fun documentFlags(resolver: ContentResolver, uri: Uri): Int? = try {
    resolver.query(uri, arrayOf(DocumentsContract.Document.COLUMN_FLAGS), null, null, null)?.use {
      if (it.moveToFirst()) it.longOrNull(DocumentsContract.Document.COLUMN_FLAGS)?.toInt() else null
    }
  } catch (_: SecurityException) {
    null
  } catch (_: IllegalArgumentException) {
    null
  } catch (_: UnsupportedOperationException) {
    null
  }

  private fun Cursor.stringOrNull(column: String): String? {
    val index = getColumnIndex(column)
    return if (index >= 0 && !isNull(index)) getString(index) else null
  }

  private fun Cursor.longOrNull(column: String): Long? {
    val index = getColumnIndex(column)
    return if (index >= 0 && !isNull(index)) getLong(index) else null
  }
}
