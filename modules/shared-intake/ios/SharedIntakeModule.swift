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

    // The durable outbox. readOutbox never clears anything: an item leaves only
    // when the app writes back a queue without it, and only after the CAR
    // confirmed the destination. Reading is not consuming — that distinction is
    // the whole point, since the old consumeSharedIntent cleared the slot BEFORE
    // anything was sent, so every downstream failure lost the place.
    AsyncFunction("readOutbox") { () -> String in
      ShareOutboxStore.readRaw()
    }

    AsyncFunction("writeOutbox") { (json: String) -> Bool in
      ShareOutboxStore.writeRaw(json)
    }

    // What the Share Extension recorded about its own runs — the only window into
    // a process with no console. Read-only; the extension writes it.
    AsyncFunction("readShareTrace") { () -> String in
      ShareOutboxStore.readTrace()
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
