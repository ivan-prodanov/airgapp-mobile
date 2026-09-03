package expo.modules.passiveentry

import android.util.Base64
import androidx.core.os.bundleOf
import expo.modules.interfaces.permissions.PermissionsResponseListener
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Android counterpart of ios/PassiveEntryModule.swift. The TS contract in
 * modules/expo-passive-entry/index.ts is frozen and shared, so every function and event name here
 * mirrors the Swift one exactly. The module is a thin bridge: the process-wide runtime owns the
 * central, the service and persistence, and exists whether or not JS is running.
 */
class PassiveEntryModule : Module() {
  private fun runtime(): PassiveEntryRuntime.Instance =
    PassiveEntryRuntime.ensure(requireNotNull(appContext.reactContext) { "no react context" })

  override fun definition() = ModuleDefinition {
    Name("PassiveEntry")

    // bondRemoved is part of the shared contract; it never fires on Android (nothing bonds with the car).
    Events("log", "frame", "connectionState", "bondRemoved")

    OnCreate {
      val rt = runtime()
      rt.log.sink = { line -> sendEvent("log", bundleOf("line" to line)) }
      // model (b) byte pipe: every raw 0213 notification, base64 so it crosses the bridge intact.
      rt.central.onFrame = { bytes -> sendEvent("frame", bundleOf("dataB64" to Base64.encodeToString(bytes, Base64.NO_WRAP))) }
      rt.onConnectionState = { state, mtu -> sendEvent("connectionState", bundleOf("state" to state, "mtu" to mtu)) }
    }

    OnDestroy {
      PassiveEntryRuntime.peek()?.let {
        it.log.sink = null
        it.central.onFrame = null
        it.onConnectionState = null
      }
    }

    // The share sheet's activity is going away: an ephemeral central must not outlive it.
    OnActivityDestroys {
      PassiveEntryRuntime.peek()?.let { if (it.mode == PassiveEntryCentral.Mode.EPHEMERAL) it.stop() }
    }

    // ── lifecycle ────────────────────────────────────────────────────────────

    Function("start") { vin: String ->
      val rt = runtime()
      val missing = BleGuards.missingPermissions(rt.app)
      if (missing.isEmpty()) {
        rt.start(vin)
        askForNotificationsOnce(rt)
        return@Function
      }
      if (rt.mode == PassiveEntryCentral.Mode.EPHEMERAL) {
        rt.log.log("start: BLE permissions missing in the share process — open the app once to grant them")
        return@Function
      }
      val pm = appContext.permissions
      if (pm == null) {
        rt.log.log("start: no permissions manager — cannot ask for ${missing.joinToString()}")
        return@Function
      }
      val ask = missing + BleGuards.optionalPermissions(rt.app)
      rt.store.notificationsAsked = true
      rt.log.log("start: asking for ${ask.joinToString()}")
      pm.askForPermissions(
        PermissionsResponseListener {
          if (BleGuards.hasScanPermissions(rt.app)) rt.start(vin)
          else rt.log.log("start: BLE permissions DENIED — passive entry unavailable until granted in Settings")
        },
        *ask.toTypedArray(),
      )
    }

    Function("stop") { runtime().stop() }

    Function("isRunning") { runtime().central.snapshot.state == PassiveEntryCentral.State.READY }

    // ── byte pipe ────────────────────────────────────────────────────────────

    Function("writeFrame") { frameB64: String ->
      val bytes = runCatching { Base64.decode(frameB64, Base64.DEFAULT) }.getOrNull() ?: return@Function false
      runtime().central.writeRaw(bytes)
    }

    Function("connectionState") {
      val (state, mtu) = runtime().central.connectionSnapshot()
      bundleOf("state" to state, "mtu" to mtu)
    }

    Function("setForegroundResponderActive") { active: Boolean -> runtime().setForegroundResponderActive(active) }

    // ── device key ───────────────────────────────────────────────────────────

    Function("setDeviceKey") { privHex: String -> KeystoreKey.setKeyHex(runtime().app, privHex) }

    Function("deviceFingerprint") {
      val hex = KeystoreKey.getKeyHex(runtime().app) ?: return@Function "no key"
      val pub = VcsecSigner.devicePublicKey(hex) ?: return@Function "no key"
      VcsecSigner.fingerprint(pub)
    }

    // ── goldens (pure crypto, no car, no key) ────────────────────────────────

    Function("sealGolden") { VcsecSigner.goldenSelfTest() }
    Function("ecdhGolden") { VcsecSigner.ecdhGoldenSelfTest() }
    Function("handshakeGolden") { VcsecSigner.handshakeGoldenSelfTest() }

    // ── notifications + wake sources ─────────────────────────────────────────

    Function("postCpdWarning") { Notifier.postCpd(runtime().app) }

    // Stored for a later geofence leg (spec §5 Q2); reboot/process death are covered by the boot
    // receiver and the PendingIntent beacon scan, which need no location permission.
    Function("setCarLocation") { lat: Double, lon: Double -> runtime().store.setCarLocation(lat, lon) }

    Function("requestAlwaysLocation") {
      runtime().log.log("requestAlwaysLocation: no geofence leg on Android yet — boot receiver + background scan carry the wake")
    }
  }

  /** POST_NOTIFICATIONS (Android 13+) — asked once, never nagged; a denial only mutes the reminders. */
  private fun askForNotificationsOnce(rt: PassiveEntryRuntime.Instance) {
    if (rt.mode != PassiveEntryCentral.Mode.PERSISTENT || rt.store.notificationsAsked) return
    val optional = BleGuards.optionalPermissions(rt.app)
    if (optional.isEmpty()) return
    val pm = appContext.permissions ?: return
    rt.store.notificationsAsked = true
    pm.askForPermissions(PermissionsResponseListener { }, *optional.toTypedArray())
  }
}
