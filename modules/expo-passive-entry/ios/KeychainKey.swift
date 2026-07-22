import Foundation
import Security

// KeychainKey — native's OWN copy of the enrolled device key (the 32-byte P-256
// private scalar, as hex — the exact string expo-secure-store holds under
// `ble.deviceKey.v1`).
//
// WHY native keeps its own item rather than reading expo-secure-store's: the
// background responder must access the key while JS is SUSPENDED, and depending
// on expo-secure-store's internal Keychain layout (service/account naming) is
// fragile and version-specific. Instead JS hands the key to native once
// (foreground, via setKeyHex), native stores it under a Keychain item IT
// controls with `AfterFirstUnlockThisDeviceOnly` accessibility — readable in the
// background, this-device-only, no biometric gate. Same key material, same
// keyId; native just owns a durable, background-readable copy.
enum KeychainKey {
  static let service = "airgapp.passiveentry"
  static let account = "deviceKeyHex"

  @discardableResult
  static func setKeyHex(_ hex: String) -> Bool {
    let base: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
    ]
    SecItemDelete(base as CFDictionary) // idempotent overwrite
    var add = base
    add[kSecValueData as String] = Data(hex.utf8)
    add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    return SecItemAdd(add as CFDictionary, nil) == errSecSuccess
  }

  static func getKeyHex() -> String? {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
      kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]
    var out: CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary, &out) == errSecSuccess,
          let d = out as? Data, let s = String(data: d, encoding: .utf8)
    else { return nil }
    return s
  }
}
