package com.ismailidris.pdfreader.fileindex

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class IncomingIntentsTest {
  private fun parse(
    action: String?,
    dataUri: String? = null,
    streamUri: String? = null,
    streamUris: List<String?>? = null,
    clipDataUris: List<String?> = emptyList(),
    mimeType: String? = null,
  ) = IncomingIntents.parse(action, dataUri, streamUri, streamUris, clipDataUris, mimeType)

  @Test
  fun aLauncherOpenIsMainWithTheLauncherCategory() {
    assertTrue(
      IncomingIntents.isLauncherOpen(
        IncomingIntents.ACTION_MAIN,
        setOf(IncomingIntents.CATEGORY_LAUNCHER),
      ),
    )
  }

  @Test
  fun anInAppRestartIsNotALauncherOpen() {
    // The dev client relaunches MainActivity with no action after the user
    // picks a server; that must not clear a cold-start hand-off still held.
    assertFalse(IncomingIntents.isLauncherOpen(null, null))
    assertFalse(IncomingIntents.isLauncherOpen(IncomingIntents.ACTION_MAIN, null))
    assertFalse(
      IncomingIntents.isLauncherOpen(
        IncomingIntents.ACTION_VIEW,
        setOf(IncomingIntents.CATEGORY_LAUNCHER),
      ),
    )
  }

  @Test
  fun viewTakesTheUriFromIntentData() {
    val result = parse(
      action = IncomingIntents.ACTION_VIEW,
      dataUri = "content://a/1",
      mimeType = "application/pdf",
    )
    assertEquals(
      IncomingIntents.Parsed("view", listOf("content://a/1"), "application/pdf"),
      result,
    )
  }

  @Test
  fun viewWithoutDataIsNotReported() {
    assertNull(parse(action = IncomingIntents.ACTION_VIEW, dataUri = null))
    assertNull(parse(action = IncomingIntents.ACTION_VIEW, dataUri = "  "))
  }

  @Test
  fun sendSingleReadsExtraStream() {
    val result = parse(
      action = IncomingIntents.ACTION_SEND,
      streamUri = "content://a/1",
      mimeType = "application/pdf",
    )
    assertEquals(
      IncomingIntents.Parsed("send", listOf("content://a/1"), "application/pdf"),
      result,
    )
  }

  @Test
  fun sendMultipleReadsExtraStreamAsAList() {
    val result = parse(
      action = IncomingIntents.ACTION_SEND_MULTIPLE,
      streamUris = listOf("content://a/1", "content://a/2", "content://a/3"),
      mimeType = "image/*",
    )
    assertEquals(
      IncomingIntents.Parsed("send", listOf("content://a/1", "content://a/2", "content://a/3"), "image/*"),
      result,
    )
  }

  @Test
  fun sendMultiplePreservesSenderOrder() {
    val result = parse(
      action = IncomingIntents.ACTION_SEND_MULTIPLE,
      streamUris = listOf("content://c", "content://a", "content://b"),
    )
    assertEquals(listOf("content://c", "content://a", "content://b"), result?.uris)
  }

  @Test
  fun missingExtraStreamFallsBackToClipDataForSend() {
    val result = parse(
      action = IncomingIntents.ACTION_SEND,
      streamUri = null,
      clipDataUris = listOf("content://a/1"),
    )
    assertEquals(listOf("content://a/1"), result?.uris)
  }

  @Test
  fun missingExtraStreamFallsBackToClipDataForSendMultiple() {
    val result = parse(
      action = IncomingIntents.ACTION_SEND_MULTIPLE,
      streamUris = null,
      clipDataUris = listOf("content://a/1", "content://a/2"),
    )
    assertEquals(listOf("content://a/1", "content://a/2"), result?.uris)
  }

  @Test
  fun emptyExtraStreamFallsBackToClipData() {
    val result = parse(
      action = IncomingIntents.ACTION_SEND_MULTIPLE,
      streamUris = emptyList(),
      clipDataUris = listOf("content://a/1"),
    )
    assertEquals(listOf("content://a/1"), result?.uris)
  }

  @Test
  fun blankAndMissingEntriesAreDropped() {
    val result = parse(
      action = IncomingIntents.ACTION_SEND_MULTIPLE,
      streamUris = listOf("content://a/1", null, "  ", "content://a/2"),
    )
    assertEquals(listOf("content://a/1", "content://a/2"), result?.uris)
  }

  @Test
  fun sendWithNothingUsableIsNotReported() {
    assertNull(
      parse(
        action = IncomingIntents.ACTION_SEND,
        streamUri = null,
        clipDataUris = listOf(null, "  "),
      ),
    )
  }

  @Test
  fun sendMultipleWithNothingUsableIsNotReported() {
    assertNull(
      parse(
        action = IncomingIntents.ACTION_SEND_MULTIPLE,
        streamUris = listOf(null, " "),
        clipDataUris = emptyList(),
      ),
    )
  }

  @Test
  fun unknownOrAbsentActionIsNotReported() {
    assertNull(parse(action = "android.intent.action.MAIN", dataUri = "content://a/1"))
    assertNull(parse(action = null, dataUri = "content://a/1"))
  }

  @Test
  fun missingMimeTypeIsReportedAsNull() {
    val result = parse(action = IncomingIntents.ACTION_VIEW, dataUri = "content://a/1", mimeType = null)
    assertNull(result?.mimeType)
  }

  @Test
  fun blankMimeTypeIsReportedAsNull() {
    val result = parse(action = IncomingIntents.ACTION_VIEW, dataUri = "content://a/1", mimeType = "   ")
    assertNull(result?.mimeType)
  }

  @Test
  fun aDeepLinkIsNotReportedAsADocument() {
    // The app's own links arrive as ACTION_VIEW as well, the dev client's
    // launch URL among them. Reporting one would consume a link expo-router
    // still has to handle.
    assertNull(parse(action = IncomingIntents.ACTION_VIEW, dataUri = "pdfreader://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081"))
    assertNull(parse(action = IncomingIntents.ACTION_VIEW, dataUri = "https://example.com/a.pdf"))
  }

  @Test
  fun fileUrisAreAcceptedAndSchemeMatchingIgnoresCase() {
    assertEquals(
      IncomingIntents.Parsed("view", listOf("file:///sdcard/Download/a.pdf"), null),
      parse(action = IncomingIntents.ACTION_VIEW, dataUri = "file:///sdcard/Download/a.pdf"),
    )
    assertEquals(
      IncomingIntents.Parsed("view", listOf("CONTENT://a/1"), null),
      parse(action = IncomingIntents.ACTION_VIEW, dataUri = "CONTENT://a/1"),
    )
  }

  @Test
  fun sharedUrisWithOtherSchemesAreDropped() {
    // A share can mix a file with a plain link; only the file is ours.
    assertEquals(
      IncomingIntents.Parsed("send", listOf("content://a/2"), null),
      parse(
        action = IncomingIntents.ACTION_SEND_MULTIPLE,
        streamUris = listOf("https://example.com/a.pdf", "content://a/2"),
      ),
    )
    assertNull(
      parse(action = IncomingIntents.ACTION_SEND, streamUri = "https://example.com/a.pdf"),
    )
  }
}
