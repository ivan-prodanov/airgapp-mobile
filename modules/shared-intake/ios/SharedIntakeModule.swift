import ExpoModulesCore

// Bridges the App Group between the Share Extension and the app.
//
// The extension APPENDS shared places to a durable outbox file; the app reads it,
// sends what is pending, and writes back the updated queue. The item shape is
// owned by TypeScript (src/state/shareOutbox.ts) — this bridge moves opaque JSON
// so the two sides cannot drift.
public class SharedIntakeModule: Module {
  private let suite = "group.local.airgapp.mobile"
  private let intentKey = "pendingSharedIntent"
  private let legacyKey = "pendingSharedLocation"

  public func definition() -> ModuleDefinition {
    Name("SharedIntake")

    // The app publishes whether it holds a live BLE link to the car; the Share
    // Extension reads it to choose a transport. See CarPresence for why a missing
    // or stale value must mean "in range" rather than "out of range".
    AsyncFunction("writeCarPresence") { (linkUp: Bool) -> Void in
      CarPresence.write(linkUp: linkUp)
    }

    // What the Share Extension recorded about its own runs — the only window into
    // a process with no console. Read-only; the extension writes it.
    AsyncFunction("readShareTrace") { () -> String in
      ShareTrace.readTrace()
    }

    // Legacy single-slot intent. Kept only to drain anything queued by a build
    // that predates the outbox; the extension no longer writes it. Remove once no
    // installed build can still be holding one.
    AsyncFunction("consumeSharedIntent") { () -> String? in
      guard let defaults = UserDefaults(suiteName: self.suite) else { return nil }
      defaults.removeObject(forKey: self.legacyKey)
      guard let json = defaults.string(forKey: self.intentKey) else { return nil }
      defaults.removeObject(forKey: self.intentKey)
      defaults.synchronize()
      return json.isEmpty ? nil : json
    }
  }
}
