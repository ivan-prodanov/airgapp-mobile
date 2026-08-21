package expo.modules.passiveentry

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * Durable storage for the enrolled device key — Android counterpart of `ios/KeychainKey.swift`.
 *
 * WHY NOT THE ANDROID KEYSTORE ITSELF: a Keystore-held EC key can sign, but its raw private
 * scalar can never be exported. Our protocol needs the scalar for the P-256 ECDH that derives the
 * VCSEC session key, so a hardware-bound key object cannot do the job. EncryptedSharedPreferences
 * is the honest equivalent of what iOS does — the secret is encrypted at rest under a Keystore
 * master key, but the plaintext scalar is recoverable by this app.
 *
 * Same trade-off `KeychainKey.swift` makes by not using a Secure Enclave key.
 */
object KeystoreKey {
  private const val FILE = "airgapp.passiveentry"
  private const val KEY = "deviceKeyHex"

  private fun prefs(context: Context): SharedPreferences {
    val master = MasterKey.Builder(context)
      .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
      .build()
    return EncryptedSharedPreferences.create(
      context,
      FILE,
      master,
      EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
      EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )
  }

  fun setKeyHex(context: Context, hex: String): Boolean = runCatching {
    val p = prefs(context)
    // An empty string is the documented "wipe" path (JS calls setDeviceKey('') to unenroll).
    if (hex.isEmpty()) p.edit().remove(KEY).apply() else p.edit().putString(KEY, hex).apply()
    true
  }.getOrElse { false }

  fun getKeyHex(context: Context): String? = runCatching {
    prefs(context).getString(KEY, null)
  }.getOrNull()
}
