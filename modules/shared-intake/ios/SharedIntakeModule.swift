import ExpoModulesCore

// Atomically reads and clears the shared-location payload the Share Extension wrote into the App Group.
public class SharedIntakeModule: Module {
  private let suite = "group.local.airgapp.mobile"
  private let key = "pendingSharedLocation"

  public func definition() -> ModuleDefinition {
    Name("SharedIntake")

    AsyncFunction("consumePendingShare") { () -> String? in
      guard let defaults = UserDefaults(suiteName: self.suite),
            let json = defaults.string(forKey: self.key) else { return nil }
      defaults.removeObject(forKey: self.key)
      defaults.synchronize()
      guard let data = json.data(using: .utf8),
            let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let raw = obj["raw"] as? String, !raw.isEmpty else { return nil }
      return raw
    }
  }
}
