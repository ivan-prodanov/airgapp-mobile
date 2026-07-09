import ExpoModulesCore

// Bridges the App Group between the Share Extension and the app: reads the resolved shared intent the
// extension queued, and mirrors whether a saved trip exists so the extension can enable "Add to Trip".
public class SharedIntakeModule: Module {
  private let suite = "group.local.airgapp.mobile"
  private let intentKey = "pendingSharedIntent"
  private let legacyKey = "pendingSharedLocation"

  public func definition() -> ModuleDefinition {
    Name("SharedIntake")

    AsyncFunction("consumeSharedIntent") { () -> String? in
      guard let defaults = UserDefaults(suiteName: self.suite) else { return nil }
      defaults.removeObject(forKey: self.legacyKey) // discard any pre-popup payload format
      guard let json = defaults.string(forKey: self.intentKey) else { return nil }
      defaults.removeObject(forKey: self.intentKey)
      defaults.synchronize()
      return json.isEmpty ? nil : json
    }

    AsyncFunction("setSavedTrip") { (exists: Bool, name: String?) in
      guard let defaults = UserDefaults(suiteName: self.suite) else { return }
      defaults.set(exists, forKey: "savedTripExists")
      if let name = name { defaults.set(name, forKey: "savedTripName") }
      else { defaults.removeObject(forKey: "savedTripName") }
      defaults.synchronize()
    }
  }
}
