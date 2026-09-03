package expo.modules.passiveentry

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Native's OWN copy of the enrolled device key (the 32-byte P-256 private scalar, as hex — the exact
 * string expo-secure-store holds) — the Android counterpart of ios/KeychainKey.swift.
 *
 * WHY NOT A KEYSTORE EC KEY: a Keystore-held EC key can sign, but its raw scalar can never be
 * exported, and the VCSEC session key is SHA1(ECDH_X)[:16] over that scalar. So the scalar is
 * WRAPPED instead: an AES-256-GCM key that lives in the Android Keystore (never leaves the TEE)
 * encrypts the hex, and only the IV + ciphertext sit in SharedPreferences. That is exactly what
 * the deprecated androidx.security EncryptedSharedPreferences did internally, minus Tink.
 *
 * The wrapping key is created with no user-authentication requirement and is usable after the
 * first unlock while the device is locked — the same availability class as the iOS item
 * (`AfterFirstUnlockThisDeviceOnly`), which is what a walk-up with the phone in the pocket needs.
 */
object KeystoreKey {
  private const val PREFS = "airgapp.passiveentry.key"
  private const val KEY_BLOB = "deviceKeyHex.wrapped"
  private const val ALIAS = "airgapp.passiveentry.wrap"
  private const val IV_BYTES = 12

  fun setKeyHex(context: Context, hex: String): Boolean = runCatching {
    val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    // An empty string is the documented "wipe" path (JS calls setDeviceKey('') to unenroll).
    if (hex.isEmpty()) {
      prefs.edit().remove(KEY_BLOB).apply()
      return true
    }
    val c = Cipher.getInstance("AES/GCM/NoPadding")
    c.init(Cipher.ENCRYPT_MODE, wrappingKey()) // Keystore chooses the IV (randomized encryption)
    val iv = c.iv
    check(iv.size == IV_BYTES) { "unexpected GCM IV size ${iv.size}" }
    val ct = c.doFinal(hex.toByteArray(Charsets.UTF_8))
    prefs.edit().putString(KEY_BLOB, Base64.encodeToString(iv + ct, Base64.NO_WRAP)).apply()
    true
  }.getOrElse { false }

  fun getKeyHex(context: Context): String? = runCatching {
    val blob = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .getString(KEY_BLOB, null) ?: return null
    val bytes = Base64.decode(blob, Base64.NO_WRAP)
    if (bytes.size <= IV_BYTES) return null
    val c = Cipher.getInstance("AES/GCM/NoPadding")
    c.init(Cipher.DECRYPT_MODE, wrappingKey(), GCMParameterSpec(128, bytes.copyOf(IV_BYTES)))
    String(c.doFinal(bytes.copyOfRange(IV_BYTES, bytes.size)), Charsets.UTF_8)
  }.getOrNull()

  private fun wrappingKey(): SecretKey {
    val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    (ks.getEntry(ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
    val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
    gen.init(
      KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setKeySize(256)
        .build(),
    )
    return gen.generateKey()
  }
}
