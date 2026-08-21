package expo.modules.sharedintake

import android.content.Intent
import android.util.Log

/**
 * The shared text, handed from ShareActivity to JS without going through `currentActivity`.
 *
 * Two bugs made this necessary, both of which showed up as the sheet reporting "Nothing was shared":
 *
 * 1. RACE. `consumeSharedIntent` used to read `appContext.currentActivity`, which is backed by the
 *    React context's current activity and is only set once the host resumes. On a COLD start of the
 *    `:share` process the sheet's JS runs almost immediately (measured: intent → `Running
 *    "shareSheet"`), so it could ask before the activity was registered and get null. Warm starts
 *    won, cold starts lost — which is exactly the kind of intermittent that looks like "sharing is
 *    broken sometimes".
 *
 * 2. STALE INTENT. ShareActivity is `singleTop`, so a second share reuses the instance and arrives
 *    via `onNewIntent` — and `Activity.onNewIntent` does NOT update `getIntent()`. React Native's
 *    delegate does not call `setIntent` either. The reused sheet therefore re-read the PREVIOUS
 *    intent, which this module deliberately neuters after a successful read, so it saw nothing.
 *
 * Capturing the text in `ShareActivity.onCreate`/`onNewIntent` — before any of that machinery is
 * involved — sidesteps both. The slot is process-static because ShareActivity and the module live
 * in the same (`:share`) process; it is single-slot and consume-once, matching the iOS store.
 */
object ShareIntentBus {
  private const val TAG = "ShareIntake"

  @Volatile
  private var pending: String? = null

  /** Called when a new sheet mounts while one is already up, so the sheet can restart its flow. */
  @Volatile
  var onNewIntent: (() -> Unit)? = null

  /**
   * Pull the shared text out of an ACTION_SEND intent.
   *
   * EXTRA_TEXT is the documented carrier for `text/plain`, but not every app sets it — some put the
   * payload only in the ClipData — so fall back rather than reporting "nothing was shared" for a
   * share that plainly had something in it.
   */
  fun textOf(intent: Intent?): String? {
    if (intent == null || intent.action != Intent.ACTION_SEND) return null
    intent.getStringExtra(Intent.EXTRA_TEXT)?.takeIf { it.isNotBlank() }?.let { return it }
    val clip = intent.clipData ?: return null
    for (i in 0 until clip.itemCount) {
      val t = clip.getItemAt(i)?.coerceToText(null)?.toString()
      if (!t.isNullOrBlank()) return t
    }
    return null
  }

  /** Record what a share delivered. Ignores a blank payload so it cannot clear a live one. */
  fun offer(intent: Intent?) {
    val text = textOf(intent)
    if (text.isNullOrBlank()) {
      Log.w(TAG, "share intent carried no text (action=${intent?.action}, clip=${intent?.clipData?.itemCount ?: 0})")
      return
    }
    pending = text
    Log.i(TAG, "share intent captured, ${text.length} chars")
  }

  /** Read once and clear — a re-foreground must not re-deliver the same share. */
  fun consume(): String? {
    val t = pending
    pending = null
    if (t == null) Log.w(TAG, "consume(): nothing pending")
    return t
  }
}
