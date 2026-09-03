package expo.modules.passiveentry

import android.content.Context
import android.content.SharedPreferences

/** Warm-session persistence seam so VcsecResponder is JVM-testable against an in-memory fake. */
interface WarmSessionStore {
  class WarmSession(val epochHex: String, val counter: Long, val clockBase: Long, val wallSec: Long, val carPubHex: String)

  fun warmSession(vin: String): WarmSession?
  fun saveWarmSession(vin: String, s: WarmSession)
}

/**
 * Everything native must remember across process death — the UserDefaults of
 * PassiveEntryCentral.swift. No key material lives here (that is KeystoreKey); the warm session
 * holds only the car's PUBLIC key and counters, exactly as on iOS, so plain SharedPreferences
 * (private to the app, encrypted at rest with the device) is sufficient.
 */
class PassiveEntryStore(context: Context) : WarmSessionStore {
  private val prefs: SharedPreferences =
    context.applicationContext.getSharedPreferences("passive_entry", Context.MODE_PRIVATE)

  /** The armed VIN. Present ⇔ passive entry is armed (iOS `isArmed()`); cleared by stop(). */
  var vin: String?
    get() = prefs.getString(KEY_VIN, null)?.takeIf { it.isNotEmpty() }
    set(value) {
      prefs.edit().apply { if (value.isNullOrEmpty()) remove(KEY_VIN) else putString(KEY_VIN, value) }.apply()
    }

  /** Keyed by VIN: a remembered address must never be reused for a different car. */
  fun rememberedMac(vin: String): String? = prefs.getString("peripheral_mac_$vin", null)

  fun rememberMac(vin: String, mac: String?) {
    prefs.edit().apply { if (mac == null) remove("peripheral_mac_$vin") else putString("peripheral_mac_$vin", mac) }.apply()
  }

  override fun warmSession(vin: String): WarmSessionStore.WarmSession? {
    val epoch = prefs.getString("sess.$vin.epoch", null) ?: return null
    val carPub = prefs.getString("sess.$vin.carPub", null) ?: return null
    return WarmSessionStore.WarmSession(
      epoch,
      prefs.getLong("sess.$vin.counter", 0),
      prefs.getLong("sess.$vin.clock", 0),
      prefs.getLong("sess.$vin.wall", 0),
      carPub,
    )
  }

  override fun saveWarmSession(vin: String, s: WarmSessionStore.WarmSession) {
    prefs.edit()
      .putString("sess.$vin.epoch", s.epochHex)
      .putLong("sess.$vin.counter", s.counter)
      .putLong("sess.$vin.clock", s.clockBase)
      .putLong("sess.$vin.wall", s.wallSec)
      .putString("sess.$vin.carPub", s.carPubHex)
      .apply()
  }

  /** "the repeating BT-off reminder is already scheduled" — once per off-episode, like iOS. */
  var btOffRepeatScheduled: Boolean
    get() = prefs.getBoolean("btOffRepeatScheduled", false)
    set(value) { prefs.edit().putBoolean("btOffRepeatScheduled", value).apply() }

  /** POST_NOTIFICATIONS is asked once, alongside the BLE grants; never nagged for. */
  var notificationsAsked: Boolean
    get() = prefs.getBoolean("notificationsAsked", false)
    set(value) { prefs.edit().putBoolean("notificationsAsked", value).apply() }

  /** The car's last parked position — stored for a later geofence leg (spec §5 Q2), not consumed yet. */
  fun carLocation(): Pair<Double, Double>? {
    if (!prefs.contains("car.lat") || !prefs.contains("car.lon")) return null
    return Double.fromBits(prefs.getLong("car.lat", 0)) to Double.fromBits(prefs.getLong("car.lon", 0))
  }

  fun setCarLocation(lat: Double, lon: Double) {
    prefs.edit().putLong("car.lat", lat.toBits()).putLong("car.lon", lon.toBits()).apply()
  }

  private companion object {
    const val KEY_VIN = "vin"
  }
}
