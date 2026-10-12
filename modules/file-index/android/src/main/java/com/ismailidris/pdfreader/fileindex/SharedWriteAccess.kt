package com.ismailidris.pdfreader.fileindex

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.Environment
import androidx.core.content.ContextCompat

/**
 * Write access to shared storage for file actions (rename, move, copy,
 * delete): all-files access on API 30+, the legacy WRITE_EXTERNAL_STORAGE
 * runtime permission on API 26-29 (declared with maxSdkVersion 29).
 *
 * The decision functions take plain values so they can be unit tested on the
 * JVM; [has] wires them to the framework.
 */
object SharedWriteAccess {
  const val GRANTED = "granted"
  const val DENIED = "denied"

  /** Denied with "don't ask again": only the app's Settings page can grant it. */
  const val BLOCKED = "blocked"

  /** First SDK level where all-files access replaces WRITE_EXTERNAL_STORAGE. */
  const val ALL_FILES_ACCESS_SDK = 30

  /**
   * Whether shared storage may be written: [isExternalStorageManager] decides
   * on API 30+, [writePermissionGranted] below. Each is only consulted for the
   * SDK level it applies to.
   */
  fun allowed(sdk: Int, isExternalStorageManager: () -> Boolean, writePermissionGranted: () -> Boolean): Boolean =
    if (sdk >= ALL_FILES_ACCESS_SDK) isExternalStorageManager() else writePermissionGranted()

  /** Whether a runtime prompt can apply at all: only below API 30, and only when not already allowed. */
  fun needsPrompt(sdk: Int, alreadyAllowed: Boolean): Boolean = sdk < ALL_FILES_ACCESS_SDK && !alreadyAllowed

  /** Result without prompting (API 30+, or API 26-29 when already granted). */
  fun resultWithoutPrompt(allowed: Boolean): String = if (allowed) GRANTED else DENIED

  /**
   * Result of the WRITE_EXTERNAL_STORAGE prompt. [canAskAgain] is false when
   * the system will no longer show the dialog (denied with "don't ask again",
   * i.e. no rationale after a denial), which only Settings can undo.
   */
  fun resultAfterPrompt(granted: Boolean, canAskAgain: Boolean): String = when {
    granted -> GRANTED
    !canAskAgain -> BLOCKED
    else -> DENIED
  }

  /**
   * Permissions to request on API 26-29: WRITE_EXTERNAL_STORAGE, plus
   * READ_EXTERNAL_STORAGE (same permission group, so still one dialog) when
   * it is not held yet.
   */
  fun permissionsToRequest(readGranted: Boolean): List<String> =
    if (readGranted) {
      listOf(Manifest.permission.WRITE_EXTERNAL_STORAGE)
    } else {
      listOf(Manifest.permission.WRITE_EXTERNAL_STORAGE, Manifest.permission.READ_EXTERNAL_STORAGE)
    }

  /** Whether shared storage may be written right now on this device. */
  fun has(context: Context): Boolean =
    allowed(
      sdk = Build.VERSION.SDK_INT,
      isExternalStorageManager = {
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && Environment.isExternalStorageManager()
      },
      writePermissionGranted = { isGranted(context, Manifest.permission.WRITE_EXTERNAL_STORAGE) },
    )

  fun isGranted(context: Context, permission: String): Boolean =
    ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED
}
