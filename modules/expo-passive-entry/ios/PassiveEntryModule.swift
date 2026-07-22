import ExpoModulesCore

// PassiveEntryModule — the JS↔native bridge for background passive entry.
//
// Task 1 (scaffold): a stub that proves the module builds, autolinks, and loads
// on the standalone Release binary — with the `log` event channel we'll stream
// native diagnostics over once CoreBluetooth lands (Task 2). No CoreBluetooth
// yet; `start`/`stop` just echo so we can confirm the JS↔native round-trip from
// the carlink harness.
public class PassiveEntryModule: Module {
  public func definition() -> ModuleDefinition {
    Name("PassiveEntry")

    // Native → JS log stream. Once the central lands, every CB lifecycle
    // callback + the wake/answer timeline flows over this (and is also written
    // to the diagnostics file so it survives with JS suspended).
    Events("log")

    Function("start") { (vin: String) in
      self.sendEvent("log", ["line": "PassiveEntry.start(\(vin)) — scaffold, no central yet"])
    }

    Function("stop") {
      self.sendEvent("log", ["line": "PassiveEntry.stop() — scaffold"])
    }

    // Cheap liveness check for the harness, mirrors BgTask's return-value shape.
    Function("isRunning") { () -> Bool in
      false
    }
  }
}
