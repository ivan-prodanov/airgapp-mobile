package expo.modules.passiveentry

import android.app.Activity
import android.util.Base64
import androidx.core.app.ActivityCompat
import androidx.core.os.bundleOf
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Android counterpart of `ios/PassiveEntryModule.swift`.
 *
 * The TS contract in `modules/expo-passive-entry/index.ts` is frozen and shared, so every
 * function and event name here mirrors the Swift one exactly. Foreground pipe mode is complete;
 * the background-autonomy surface (the three crypto goldens, the geofence) is Phase 4 and
 * ABSTAINS rather than lying — a diagnostic that reports a false pass is worse than one that
 * says it has no answer.
 */
class PassiveEntryModule : Module() {

  private val central: PassiveEntryCentral by lazy {
    PassiveEntryCentral(requireNotNull(appContext.reactContext) { "no react context" })
  }

  override fun definition() = ModuleDefinition {
    Name("PassiveEntry")

    Events("log", "frame", "connectionState", "bondRemoved")

    OnCreate {
      central.onLog = { line -> sendEvent("log", bundleOf("line" to line)) }
      // model (b) byte-pipe: every raw 0213 notification, base64 so it crosses the bridge
      // without byte mangling (same encoding the iOS module uses).
      central.onFrame = { bytes ->
        sendEvent("frame", bundleOf("dataB64" to Base64.encodeToString(bytes, Base64.NO_WRAP)))
      }
      central.onConnectionState = { state, mtu ->
        sendEvent("connectionState", bundleOf("state" to state, "mtu" to mtu))
      }
    }

    OnDestroy {
      central.onLog = null
      central.onFrame = null
      central.onConnectionState = null
    }

    // ── lifecycle ────────────────────────────────────────────────────────────

    Function("start") { vin: String ->
      // Ask for the runtime permissions up front. A scan without BLUETOOTH_SCAN returns zero
      // results silently on Android 12+, so a missing grant must never look like "no car".
      val activity: Activity? = appContext.currentActivity
      val missing = appContext.reactContext?.let { BleGuards.missingPermissions(it) }.orEmpty()
      if (missing.isNotEmpty() && activity != null) {
        ActivityCompat.requestPermissions(activity, missing.toTypedArray(), 4711)
      }
      central.start(vin)
    }

    Function("stop") { central.stop() }

    Function("isRunning") { central.isRunning }

    // ── byte pipe ────────────────────────────────────────────────────────────

    Function("writeFrame") { frameB64: String ->
      val bytes = runCatching { Base64.decode(frameB64, Base64.DEFAULT) }.getOrNull()
        ?: return@Function false
      central.writeRaw(bytes)
    }

    Function("connectionState") {
      val (state, mtu) = central.connectionSnapshot()
      bundleOf("state" to state, "mtu" to mtu)
    }

    Function("setForegroundResponderActive") { active: Boolean ->
      central.setForegroundResponderActive(active)
    }

    // ── device key ───────────────────────────────────────────────────────────

    Function("setDeviceKey") { privHex: String ->
      val ctx = appContext.reactContext ?: return@Function false
      KeystoreKey.setKeyHex(ctx, privHex)
    }

    // ── Phase 4 surface — abstains rather than reporting a false pass ─────────

    Function("deviceFingerprint") {
      // Deriving this needs P-256 point multiplication, which arrives with VcsecSigner in
      // Phase 4. Returning a placeholder that LOOKS like a fingerprint would let a real key
      // mismatch pass unnoticed, so say plainly that there is no answer yet.
      val ctx = appContext.reactContext
      if (ctx != null && KeystoreKey.getKeyHex(ctx) != null) {
        "android: key stored, fingerprint pending Phase 4"
      } else {
        "no key"
      }
    }

    Function("sealGolden") { "android: not implemented (Phase 4)" }
    Function("ecdhGolden") { "android: not implemented (Phase 4)" }
    Function("handshakeGolden") { "android: not implemented (Phase 4)" }

    Function("postCpdWarning") {
      // The CPD alert needs a notification channel; lands with Notifier.kt in Phase 4.
    }

    Function("setCarLocation") { _: Double, _: Double ->
      // Geofence re-arm is Phase 4 (CarRegionMonitor.kt).
    }

    Function("requestAlwaysLocation") {
      // Background-location prompt is Phase 4, alongside the foreground service.
    }
  }
}
