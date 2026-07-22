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

    Events("log", "frame", "connectionState", "bondRemoved")

    // Wire the foreground event sinks. When JS is running, native log lines and
    // the byte-pipe streams reach the JS transport; in a background relaunch
    // these stay nil (JS is suspended) and only the file log records — by design.
    OnCreate {
      PassiveEntryCentral.shared.onLog = { [weak self] line in
        self?.sendEvent("log", ["line": line])
      }
      // model (b) byte-pipe: every raw 0213 notification (foreground pipe mode).
      PassiveEntryCentral.shared.onFrame = { [weak self] bytes in
        self?.sendEvent("frame", ["dataB64": Data(bytes).base64EncodedString()])
      }
      PassiveEntryCentral.shared.onConnectionState = { [weak self] state, mtu in
        self?.sendEvent("connectionState", ["state": state, "mtu": mtu])
      }
      // The car's LE bond was removed (user forgot the device) — JS flips to Set-Up.
      PassiveEntryCentral.shared.onBondRemoved = { [weak self] in
        self?.sendEvent("bondRemoved", [:])
      }
    }

    // Byte-pipe write: `frameB64` is already framed+chunked by TS bleFraming;
    // native writes it raw to 0212 (.withResponse), split to the negotiated MTU.
    Function("writeFrame") { (frameB64: String) -> Bool in
      guard let data = Data(base64Encoded: frameB64) else { return false }
      PassiveEntryCentral.shared.writeRaw([UInt8](data))
      return true
    }

    // Link state for the TS transport to gate its handshake + seed blockLength.
    Function("connectionState") { () -> [String: Any] in
      let s = PassiveEntryCentral.shared.connectionSnapshot()
      return ["state": s.state, "mtu": s.mtu]
    }

    // The single-writer gate: true = foreground (TS signs via the pipe),
    // false = background (native self-signs). Driven by whoMaySign/AppState.
    Function("setForegroundResponderActive") { (active: Bool) in
      PassiveEntryCentral.shared.setForegroundResponderActive(active)
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
