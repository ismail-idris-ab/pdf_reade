package com.ismailidris.pdfreader.fileindex

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.Environment
import androidx.core.content.ContextCompat
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * Shared-storage write access on a real device. The manifest checks read the
 * test APK, which carries this module's merged manifest (the app's merged
 * manifest is checked at build time).
 */
class SharedWriteAccessInstrumentedTest {
  private lateinit var context: Context

  @Before
  fun setUp() {
    context = InstrumentationRegistry.getInstrumentation().targetContext
  }

  @Test
  fun hasMatchesThePlatformCheckForThisSdk() {
    val expected = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      Environment.isExternalStorageManager()
    } else {
      ContextCompat.checkSelfPermission(context, Manifest.permission.WRITE_EXTERNAL_STORAGE) ==
        PackageManager.PERMISSION_GRANTED
    }
    assertEquals(expected, SharedWriteAccess.has(context))
  }

  @Test
  fun writePermissionIsDeclaredUpToAndroid10Only() {
    // The platform drops a <uses-permission> whose maxSdkVersion is below the
    // device SDK, so the declaration is visible on API 26-29 only.
    @Suppress("DEPRECATION")
    val requested = context.packageManager
      .getPackageInfo(context.packageName, PackageManager.GET_PERMISSIONS)
      .requestedPermissions
      .orEmpty()
      .toList()
    val declared = requested.contains(Manifest.permission.WRITE_EXTERNAL_STORAGE)
    if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.Q) {
      assertTrue("WRITE_EXTERNAL_STORAGE must be declared on API ${Build.VERSION.SDK_INT}", declared)
    } else {
      assertFalse("WRITE_EXTERNAL_STORAGE must stop at maxSdkVersion 29", declared)
    }
  }
}
