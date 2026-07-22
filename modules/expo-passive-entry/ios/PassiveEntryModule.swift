import ExpoModulesCore

// PassiveEntryModule — the JS↔native bridge for background passive entry.
//
// Task 2: owns a PassiveEntryCentral (the restorable CoreBluetooth central).
// `start(vin)` brings the central up and holds the car link; `stop()` tears it
// down. Every native lifecycle event streams over `log` (foreground) and is also
// written to airgapp-native.log (survives JS suspension). Challenge answering +
// signing land in later tasks.
public class PassiveEntryModule: Module {
  // The central is a process-wide singleton (PassiveEntryCentral.shared) so the
  // AppDelegate subscriber can create it at launch for state restoration; the
  // module just streams its log to JS while the app is in the foreground.
  private var central: PassiveEntryCentral { PassiveEntryCentral.shared }

  public func definition() -> ModuleDefinition {
    Name("PassiveEntry")

    Events("log")

    // Wire the foreground event sink. When JS is running, native log lines also
    // stream to the harness; in a background relaunch onLog stays nil (JS is
    // suspended) and only the file log records — by design.
    OnCreate {
      PassiveEntryCentral.shared.onLog = { [weak self] line in
        self?.sendEvent("log", ["line": line])
      }
    }

    Function("start") { (vin: String) in
      self.central.start(vin: vin)
    }

    Function("stop") {
      self.central.stop()
    }

    Function("isRunning") { () -> Bool in
      self.central.isRunning
    }

    // Verify the native routable seal reproduces the TS golden byte-for-byte.
    // Pure crypto — no car, no key — so it's safe to run anywhere.
    Function("sealGolden") { () -> String in
      VcsecSigner.goldenSelfTest()
    }

    // Verify native P-256 ECDH + SHA1-KDF matches TS. Pure crypto, no car.
    Function("ecdhGolden") { () -> String in
      VcsecSigner.ecdhGoldenSelfTest()
    }

    Function("handshakeGolden") { () -> String in
      VcsecSigner.handshakeGoldenSelfTest()
    }

    // Hand native its own durable, background-readable copy of the enrolled key
    // (32-byte private scalar as hex). Call once from the foreground.
    Function("setDeviceKey") { (privHex: String) -> Bool in
      KeychainKey.setKeyHex(privHex)
    }

    // Read the stored key back, derive its public key, and return the fingerprint
    // (SHA256(pub)[:8] colon-hex) — must equal JS deviceKeyFingerprint to prove
    // native holds the same key. Returns "no key" when none is stored.
    Function("deviceFingerprint") { () -> String in
      guard let hex = KeychainKey.getKeyHex(),
            let pub = VcsecSigner.devicePublicKey(privHex: hex) else { return "no key" }
      return VcsecSigner.fingerprint(pub: pub)
    }
  }
}
