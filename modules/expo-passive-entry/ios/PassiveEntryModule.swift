import ExpoModulesCore

// PassiveEntryModule — the JS↔native bridge for background passive entry.
//
// Task 2: owns a PassiveEntryCentral (the restorable CoreBluetooth central).
// `start(vin)` brings the central up and holds the car link; `stop()` tears it
// down. Every native lifecycle event streams over `log` (foreground) and is also
// written to airgapp-native.log (survives JS suspension). Challenge answering +
// signing land in later tasks.
public class PassiveEntryModule: Module {
  private var central: PassiveEntryCentral?

  public func definition() -> ModuleDefinition {
    Name("PassiveEntry")

    Events("log")

    Function("start") { (vin: String) in
      if self.central == nil {
        self.central = PassiveEntryCentral(onLog: { [weak self] line in
          self?.sendEvent("log", ["line": line])
        })
      }
      self.central?.start(vin: vin)
    }

    Function("stop") {
      self.central?.stop()
    }

    Function("isRunning") { () -> Bool in
      self.central?.isRunning ?? false
    }
  }
}
