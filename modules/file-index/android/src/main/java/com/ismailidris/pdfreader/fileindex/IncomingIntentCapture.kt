package com.ismailidris.pdfreader.fileindex

import android.content.Intent
import android.net.Uri
import android.os.Build
import java.util.concurrent.atomic.AtomicReference

/**
 * Takes files handed over by another app out of the intent that carried
 * them, and passes them to [FileIndexModule].
 *
 * A warm-start hand-off has to be claimed before React Native sees the
 * intent. RN reports the intent's URI to JS as a launch URL, and expo-router
 * then routes a `content://` or `file://` hand-off as a deep link, landing
 * on "Unmatched Route" instead of letting the app open the file. A module
 * has no "before JS" moment for a warm intent, so `MainActivity.onNewIntent`
 * calls [claim] ahead of `super` (wired by the config plugin in
 * app.config.ts) and the module collects the result from here.
 *
 * Only a real hand-off is ever claimed: a deep link does not parse as one
 * (see [IncomingIntents]) and is left untouched for whoever routes it.
 */
object IncomingIntentCapture {
  private val pending = AtomicReference<IncomingIntents.Parsed?>(null)
  private val listener = AtomicReference<((IncomingIntents.Parsed) -> Unit)?>(null)
  private val launch = AtomicReference<IncomingIntents.Parsed?>(null)

  /**
   * Claims the hand-off an activity was created with, from
   * `MainActivity.onCreate` ahead of `super`. Unlike [claim] it is only held
   * for the module's `getLaunchIntent`, never sent to the listener: when the
   * activity is recreated in a live process (the user backed out, then
   * opened a file), the module is still attached but no JS is listening
   * until the new root mounts, so an event would be dropped.
   *
   * A hand-off replaces whatever is held, and the user opening the app from
   * the launcher clears one an earlier launch's JS never asked for. Other
   * launches leave it alone: see [IncomingIntents.isLauncherOpen].
   */
  fun claimLaunch(intent: Intent): Boolean {
    val parsed = read(intent)
    if (parsed != null) {
      consume(intent)
      holdLaunch(parsed)
    } else if (IncomingIntents.isLauncherOpen(intent.action, intent.categories)) {
      holdLaunch(null)
    }
    return parsed != null
  }

  /** Holds [parsed] as the launch hand-off (null holds none), replacing any older one. */
  fun holdLaunch(parsed: IncomingIntents.Parsed?) {
    launch.set(parsed)
  }

  /** Takes the launch hand-off held by [claimLaunch], if any. */
  fun takeLaunch(): IncomingIntents.Parsed? = launch.getAndSet(null)

  /**
   * Claims the hand-off in [intent], if it holds one: clears it from the
   * intent and passes it on. Returns whether anything was claimed, and is
   * safe to call with any intent.
   */
  fun claim(intent: Intent): Boolean {
    val parsed = read(intent) ?: return false
    consume(intent)
    deliver(parsed)
    return true
  }

  /** Reads the plain values [IncomingIntents.parse] needs from an intent. */
  fun read(intent: Intent): IncomingIntents.Parsed? {
    val action = intent.action
    return IncomingIntents.parse(
      action = action,
      dataUri = intent.data?.toString(),
      streamUri = if (action == Intent.ACTION_SEND) readStreamUri(intent) else null,
      streamUris = if (action == Intent.ACTION_SEND_MULTIPLE) readStreamUris(intent) else null,
      clipDataUris = clipDataUris(intent),
      mimeType = intent.type,
    )
  }

  /** Strips the hand-off from [intent] so nothing else can route it. */
  fun consume(intent: Intent) {
    intent.data = null
    intent.removeExtra(Intent.EXTRA_STREAM)
    intent.clipData = null
  }

  /**
   * Hands [parsed] to the module: straight to its listener when one is
   * attached, otherwise held until the module calls [take].
   */
  fun deliver(parsed: IncomingIntents.Parsed) {
    val current = listener.get()
    if (current == null) pending.set(parsed) else current(parsed)
  }

  /**
   * Attaches the module's listener; pass null on teardown. A hand-off
   * claimed while nothing was listening is not sent to it: the module
   * attaches at its own start, before any JS can subscribe, so it would be
   * dropped. It stays for [take] (the module's `getLaunchIntent`) instead.
   */
  fun setListener(onHandOff: ((IncomingIntents.Parsed) -> Unit)?) {
    listener.set(onHandOff)
  }

  /** Takes a hand-off claimed while no listener was attached, if any. */
  fun take(): IncomingIntents.Parsed? = pending.getAndSet(null)

  private fun readStreamUri(intent: Intent): String? {
    val uri = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
    } else {
      @Suppress("DEPRECATION")
      intent.getParcelableExtra(Intent.EXTRA_STREAM)
    }
    return uri?.toString()
  }

  private fun readStreamUris(intent: Intent): List<String?>? {
    val uris = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java)
    } else {
      @Suppress("DEPRECATION")
      intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM)
    }
    return uris?.map { it?.toString() }
  }

  private fun clipDataUris(intent: Intent): List<String?> {
    val clip = intent.clipData ?: return emptyList()
    return (0 until clip.itemCount).map { clip.getItemAt(it).uri?.toString() }
  }
}
