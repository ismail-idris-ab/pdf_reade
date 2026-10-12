package com.ismailidris.pdfreader.fileindex

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class SharedWriteAccessTest {
  private val write = "android.permission.WRITE_EXTERNAL_STORAGE"
  private val read = "android.permission.READ_EXTERNAL_STORAGE"
  private val unused: () -> Boolean = { fail("must not be consulted for this SDK level"); false }

  @Test
  fun android11AndLaterUseAllFilesAccessOnly() {
    for (sdk in listOf(30, 33, 36)) {
      assertTrue(SharedWriteAccess.allowed(sdk, isExternalStorageManager = { true }, writePermissionGranted = unused))
      assertFalse(SharedWriteAccess.allowed(sdk, isExternalStorageManager = { false }, writePermissionGranted = unused))
    }
  }

  @Test
  fun android8To10UseTheWritePermissionOnly() {
    for (sdk in 26..29) {
      assertTrue(SharedWriteAccess.allowed(sdk, isExternalStorageManager = unused, writePermissionGranted = { true }))
      assertFalse(SharedWriteAccess.allowed(sdk, isExternalStorageManager = unused, writePermissionGranted = { false }))
    }
  }

  @Test
  fun promptsOnlyBelowAndroid11WhenNotYetAllowed() {
    assertTrue(SharedWriteAccess.needsPrompt(sdk = 26, alreadyAllowed = false))
    assertTrue(SharedWriteAccess.needsPrompt(sdk = 29, alreadyAllowed = false))
    assertFalse(SharedWriteAccess.needsPrompt(sdk = 29, alreadyAllowed = true))
    assertFalse(SharedWriteAccess.needsPrompt(sdk = 30, alreadyAllowed = false))
    assertFalse(SharedWriteAccess.needsPrompt(sdk = 36, alreadyAllowed = true))
  }

  @Test
  fun resultWithoutPromptIsGrantedOrDenied() {
    assertEquals("granted", SharedWriteAccess.resultWithoutPrompt(allowed = true))
    assertEquals("denied", SharedWriteAccess.resultWithoutPrompt(allowed = false))
  }

  @Test
  fun promptResultMapsGrantDenialAndBlock() {
    assertEquals("granted", SharedWriteAccess.resultAfterPrompt(granted = true, canAskAgain = true))
    // A grant wins even if the service still reports the old blocked flag.
    assertEquals("granted", SharedWriteAccess.resultAfterPrompt(granted = true, canAskAgain = false))
    assertEquals("denied", SharedWriteAccess.resultAfterPrompt(granted = false, canAskAgain = true))
    assertEquals("blocked", SharedWriteAccess.resultAfterPrompt(granted = false, canAskAgain = false))
  }

  @Test
  fun readIsRequestedAlongOnlyWhenMissing() {
    assertEquals(listOf(write), SharedWriteAccess.permissionsToRequest(readGranted = true))
    assertEquals(listOf(write, read), SharedWriteAccess.permissionsToRequest(readGranted = false))
  }
}
