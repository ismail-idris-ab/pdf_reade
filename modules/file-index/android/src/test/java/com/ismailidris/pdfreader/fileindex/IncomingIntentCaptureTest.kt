package com.ismailidris.pdfreader.fileindex

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Before
import org.junit.Test

/**
 * The hand-off relay between MainActivity and the module. Reading a real
 * Intent needs the framework, so that part is covered by the instrumented
 * test; this pins the delivery rules, which are what order-sensitive bugs
 * actually come from.
 */
class IncomingIntentCaptureTest {
  private fun handOff(uri: String) =
    IncomingIntents.Parsed(IncomingIntents.REPORTED_VIEW, listOf(uri), "application/pdf")

  @Before
  @After
  fun reset() {
    IncomingIntentCapture.setListener(null)
    IncomingIntentCapture.take()
    IncomingIntentCapture.takeLaunch()
  }

  @Test
  fun aLaunchHandOffIsNeverPushedToAnAttachedListener() {
    // A fresh activity in a live process: the module (and its listener) is
    // still attached, but the old JS root has unsubscribed and the new one
    // is not mounted yet, so an event sent now would be dropped.
    val seen = mutableListOf<IncomingIntents.Parsed>()
    IncomingIntentCapture.setListener { seen.add(it) }

    val parsed = handOff("content://a/launch")
    IncomingIntentCapture.holdLaunch(parsed)

    assertEquals(emptyList<IncomingIntents.Parsed>(), seen)
    assertSame(parsed, IncomingIntentCapture.takeLaunch())
    assertNull(IncomingIntentCapture.takeLaunch())
  }

  @Test
  fun aLaunchHandOffHeldBeforeTheModuleAttachesWaitsToBeTaken() {
    val parsed = handOff("file:///sdcard/Download/launch.pdf")
    IncomingIntentCapture.holdLaunch(parsed)

    val seen = mutableListOf<IncomingIntents.Parsed>()
    IncomingIntentCapture.setListener { seen.add(it) }

    assertEquals(emptyList<IncomingIntents.Parsed>(), seen)
    // Kept apart from warm hand-offs.
    assertNull(IncomingIntentCapture.take())
    assertSame(parsed, IncomingIntentCapture.takeLaunch())
  }

  @Test
  fun aHandOffClaimedBeforeTheModuleAttachesWaitsToBeTakenRatherThanSent() {
    // The module attaches at its own start, before any JS can subscribe, so
    // pushing the waiting hand-off to the listener then would drop it.
    val parsed = handOff("content://a/1")
    IncomingIntentCapture.deliver(parsed)

    val seen = mutableListOf<IncomingIntents.Parsed>()
    IncomingIntentCapture.setListener { seen.add(it) }

    assertEquals(emptyList<IncomingIntents.Parsed>(), seen)
    assertSame(parsed, IncomingIntentCapture.take())
  }

  @Test
  fun aLaunchWithNoHandOffClearsAnOlderHeldOne() {
    // A hand-off held for a launch whose JS never asked for it must not
    // surface on a later, ordinary launch.
    IncomingIntentCapture.holdLaunch(handOff("content://a/stale"))
    IncomingIntentCapture.holdLaunch(null)

    assertNull(IncomingIntentCapture.takeLaunch())
  }

  @Test
  fun aHandOffGoesStraightToAnAttachedListener() {
    val seen = mutableListOf<IncomingIntents.Parsed>()
    IncomingIntentCapture.setListener { seen.add(it) }

    val parsed = handOff("content://a/2")
    IncomingIntentCapture.deliver(parsed)

    assertEquals(listOf(parsed), seen)
    assertNull(IncomingIntentCapture.take())
  }

  @Test
  fun takeHandsAWaitingHandOffOverExactlyOnce() {
    val parsed = handOff("file:///sdcard/Download/a.pdf")
    IncomingIntentCapture.deliver(parsed)

    assertSame(parsed, IncomingIntentCapture.take())
    assertNull(IncomingIntentCapture.take())
  }

  @Test
  fun aHandOffDeliveredAfterTheListenerIsDetachedWaitsForTheNextOne() {
    val seen = mutableListOf<IncomingIntents.Parsed>()
    IncomingIntentCapture.setListener { seen.add(it) }
    IncomingIntentCapture.setListener(null)

    val parsed = handOff("content://a/3")
    IncomingIntentCapture.deliver(parsed)

    assertEquals(emptyList<IncomingIntents.Parsed>(), seen)
    assertSame(parsed, IncomingIntentCapture.take())
  }

  @Test
  fun onlyTheLatestWaitingHandOffIsKept() {
    IncomingIntentCapture.deliver(handOff("content://a/old"))
    val newest = handOff("content://a/new")
    IncomingIntentCapture.deliver(newest)

    assertSame(newest, IncomingIntentCapture.take())
  }
}
