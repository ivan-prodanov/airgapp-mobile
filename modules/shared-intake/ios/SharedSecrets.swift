import Foundation
import Security

// SharedSecrets — reads what the app stored with expo-secure-store, from the
// SHARED keychain access group.
//
// This is the whole reason the app's secrets moved to a grouped location: the
// extension is a different process and cannot see the app's private keychain
// items. There is ONE key on the device, in one place, readable by both.
//
// The layout below is expo-secure-store's own, mirrored exactly. It is not a
// convention we chose and it is not guessable — getting the service name wrong
// returns errSecItemNotFound, which is indistinguishable from "the device is not
// enrolled", so the extension would report a plausible, completely wrong reason.
// Verified against expo-secure-store@56.0.4's SecureStoreModule.swift.
public enum SharedSecrets {
  public static let accessGroup = "859B8N529C.local.airgapp.mobile.shared"

  public static let deviceKeyKey = "ble.deviceKey.v1"
  public static let carConfigKey = "ble.carConfig.v1"
  public static let piConfigKey = "ble.piConfig.v1"

  // expo-secure-store appends the auth requirement to the service name, and
  // writes with requireAuthentication=false by default — so our items are under
  // "app:no-auth". "app" is its pre-auth legacy layout. Its own read path tries
  // these in this order; matching that means an item written by any version the
  // app has ever used is still found.
  private static let services = ["app:no-auth", "app:auth", "app"]

  public static func string(_ key: String) -> String? {
    let account = Data(key.utf8)
    for service in services {
      let query: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: service,
        kSecAttrAccount as String: account,
        kSecAttrAccessGroup as String: accessGroup,
        kSecReturnData as String: true,
        kSecMatchLimit as String: kSecMatchLimitOne,
      ]
      var item: CFTypeRef?
      let status = SecItemCopyMatching(query as CFDictionary, &item)
      if status == errSecSuccess, let data = item as? Data,
         let text = String(data: data, encoding: .utf8), !text.isEmpty {
        return text
      }
      // -34018 is errSecMissingEntitlement: the access group is not in this
      // target's entitlements. Worth saying out loud — it looks exactly like an
      // unenrolled device and it is a build configuration problem, not a
      // user-facing one.
      if status == errSecMissingEntitlement {
        ShareTrace.trace("secrets: MISSING ENTITLEMENT for \(accessGroup) — the extension cannot read the keychain group")
        return nil
      }
    }
    return nil
  }

  // The device private scalar, as the hex the engine expects. Never stored
  // alongside a public key: a cached public key is one more thing that can
  // disagree with the scalar, and it is cheap to re-derive.
  public static func deviceKeyHex() -> String? { string(deviceKeyKey) }

  public struct CarConfig {
    public let vin: String
  }

  public struct PiConfig {
    public let baseUrl: String
    public let token: String
  }

  public static func carConfig() -> CarConfig? {
    guard
      let raw = string(carConfigKey), let data = raw.data(using: .utf8),
      let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
      let vin = obj["vin"] as? String, !vin.isEmpty
    else { return nil }
    return CarConfig(vin: vin)
  }

  public static func piConfig() -> PiConfig? {
    guard
      let raw = string(piConfigKey), let data = raw.data(using: .utf8),
      let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
      let baseUrl = obj["baseUrl"] as? String, !baseUrl.isEmpty,
      let token = obj["token"] as? String, !token.isEmpty
    else { return nil }
    return PiConfig(baseUrl: baseUrl, token: token)
  }
}
