import ExpoModulesCore

// Reads/clears the shared-location payload the Share Extension wrote into the App Group, plus a shared debug
// log (App Group file) that both the extension and the app append to; dumpLog() also mirrors it into the app's
// Documents dir so it can be pulled off-device with `devicectl device copy from`.
public class SharedIntakeModule: Module {
  private let suite = "group.local.airgapp.mobile"
  private let key = "pendingSharedLocation"

  private func logURL() -> URL? {
    FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: suite)?.appendingPathComponent("extlog.txt")
  }

  private func append(_ line: String) {
    guard let url = logURL() else { return }
    let entry = line + "\n"
    if FileManager.default.fileExists(atPath: url.path), let fh = try? FileHandle(forWritingTo: url) {
      fh.seekToEndOfFile()
      if let d = entry.data(using: .utf8) { fh.write(d) }
      try? fh.close()
    } else {
      try? entry.write(to: url, atomically: true, encoding: .utf8)
    }
  }

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

    AsyncFunction("appendLog") { (line: String) in
      self.append(line)
    }

    // Return the shared debug log AND mirror it into the app's Documents dir (pullable off-device).
    AsyncFunction("dumpLog") { () -> String in
      let content = (self.logURL().flatMap { try? String(contentsOf: $0, encoding: .utf8) }) ?? ""
      if let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first {
        try? content.write(to: docs.appendingPathComponent("sharedebug.log"), atomically: true, encoding: .utf8)
      }
      return content
    }

    AsyncFunction("clearLog") { () in
      if let url = self.logURL() { try? FileManager.default.removeItem(at: url) }
    }
  }
}
