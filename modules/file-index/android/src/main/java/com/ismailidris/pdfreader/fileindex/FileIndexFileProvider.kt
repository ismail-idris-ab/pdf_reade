package com.ismailidris.pdfreader.fileindex

import androidx.core.content.FileProvider

/**
 * Dedicated provider class so this module's manifest entry never collides
 * with another library's androidx FileProvider. Exposes only cache/share/.
 */
class FileIndexFileProvider : FileProvider(R.xml.file_index_paths) {
  companion object {
    /** Must match android:authorities in this module's AndroidManifest.xml. */
    fun authority(packageName: String): String = "$packageName.fileindex.provider"
  }
}
