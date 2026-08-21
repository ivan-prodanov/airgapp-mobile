package expo.modules.sharedintake

import android.content.Intent
import androidx.core.os.bundleOf
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Android share intake — the counterpart of the iOS Share Extension, against the same frozen TS
 * contract (`modules/shared-intake/index.ts`).
 *
 * Android's model is far simpler than iOS's and the difference is worth stating, because it
 * explains why most of this class is short:
 *
 *   iOS runs a SEPARATE Share Extension process with its own JSC runtime, writes the shared place
 *   into an App Group container, and the app drains that container later. That process has no
 *   console, which is why `readShareTrace` exists at all.
 *
 *   Android just delivers an ACTION_SEND Intent to MainActivity — same process, no container, no
 *   handoff. So there is nothing to trace, and `writeCarPresence` (which exists so the iOS
 *   extension can decide between BLE and the Pi) has no second process to inform.
 *
 * The shared text is handed to JS as `{"raw": "..."}`; useSharedLocationIntake already resolves a
 * raw string through parseSharedLocation, which is platform-agnostic.
 */
class SharedIntakeModule : Module() {

  override fun definition() = ModuleDefinition {
    Name("SharedIntake")

    // Fired when a share arrives at an ALREADY-MOUNTED sheet. The React surface is not recreated
    // on onNewIntent, so without this the component would stay on its previous verdict.
    Events("onShareIntent")

    OnCreate {
      ShareIntentBus.onNewIntent = { sendEvent("onShareIntent", bundleOf()) }
    }

    OnDestroy {
      ShareIntentBus.onNewIntent = null
    }

    /**
     * Single-slot, consume-once — matching the iOS store's semantics.
     *
     * Reads EXTRA_TEXT off the activity's current Intent and CLEARS it, so a second call returns
     * null and a re-foreground does not re-deliver the same share. ReactActivity calls setIntent()
     * in onNewIntent, so this covers both a cold start into a share and a share arriving while the
     * app is already running.
     */
    AsyncFunction("consumeSharedIntent") {
      // ShareIntentBus FIRST. ShareActivity parks the text in onCreate/onNewIntent, before the
      // React context knows the activity exists — which is what makes this work on a cold start of
      // the :share process, where the sheet's JS asks almost immediately. Reading
      // `appContext.currentActivity` first was a race that failed exactly then, reported as
      // "Nothing was shared".
      val fromBus = ShareIntentBus.consume()
      if (fromBus != null) {
        """{"raw":${quoteJson(fromBus)}}"""
      } else {
        // Fallback for a share delivered to some other activity (the pre-ShareActivity path, and
        // anything that sets an ACTION_SEND intent on the current activity).
        val activity = appContext.currentActivity
        val intent = activity?.intent
        val text = ShareIntentBus.textOf(intent)
        if (activity == null || intent == null || text.isNullOrBlank()) {
          null
        } else {
          // Clear AFTER reading: the iOS store's clear-before-send behaviour once LOST places, so
          // we only drop it once JS is holding the value.
          intent.removeExtra(Intent.EXTRA_TEXT)
          intent.action = Intent.ACTION_MAIN
          activity.intent = intent
          """{"raw":${quoteJson(text)}}"""
        }
      }
    }

    AsyncFunction("readShareTrace") {
      // No separate extension process on Android, so there is no trace to read. Say so plainly
      // rather than returning "" — the carlink probe prints this verbatim.
      "android: shares arrive as an ACTION_SEND intent in-process; there is no extension to trace"
    }

    /**
     * Dismiss the share sheet's activity once ShareSheet.tsx has shown its verdict.
     *
     * The iOS extension ends itself with extensionContext.completeRequest, which JS cannot reach;
     * on Android the sheet IS an activity, so finishing it is the equivalent — and it has to come
     * from JS, because only the sheet knows when the send resolved and when its 1.6s of showing
     * the outcome is up.
     *
     * finish() must run on the UI thread. Guarded on ShareActivity by name so a stray call can
     * never close MainActivity out from under the user.
     */
    AsyncFunction("finishShare") {
      val activity = appContext.currentActivity
      if (activity != null && activity.javaClass.simpleName == "ShareActivity") {
        activity.runOnUiThread { activity.finish() }
      }
    }

    AsyncFunction("writeCarPresence") { _: Boolean ->
      // Advisory only, and only meaningful to the iOS extension deciding between BLE and the Pi.
      // Android has no second process to inform.
    }
  }
}

/** Minimal JSON string escaping — the payload is user-supplied shared text. */
private fun quoteJson(s: String): String {
  val sb = StringBuilder("\"")
  for (c in s) {
    when (c) {
      '"' -> sb.append("\\\"")
      '\\' -> sb.append("\\\\")
      '\n' -> sb.append("\\n")
      '\r' -> sb.append("\\r")
      '\t' -> sb.append("\\t")
      else -> if (c < ' ') sb.append("\\u%04x".format(c.code)) else sb.append(c)
    }
  }
  return sb.append("\"").toString()
}
