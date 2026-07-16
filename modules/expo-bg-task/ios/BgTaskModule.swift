import ExpoModulesCore
import UIKit

// Thin, crash-safe wrapper around UIApplication's background-task assertion
// ("finish what you started", ~30s of wall clock after the app is backgrounded).
// This is NOT a background mode — no UIBackgroundModes entry is required.
//
// Threading: `beginBackgroundTask(withName:expirationHandler:)` and
// `endBackgroundTask(_:)` are both documented as safe to call from a non-main
// thread, so we call them straight from the caller's thread (Expo runs a
// synchronous `Function` on the JS thread). Hopping to the main queue with a
// blocking `DispatchQueue.main.sync` would risk deadlocking the JS thread
// against the main thread for no benefit. `live` is guarded by a lock because
// the expiration handler is invoked on the main thread.
private final class BgTaskRegistry {
  static let shared = BgTaskRegistry()

  private let lock = NSLock()
  // Raw identifiers of assertions we've taken and not yet ended. Membership is
  // what makes `end` idempotent: ending an unknown/already-ended/invalid id is
  // a silent no-op rather than the hard crash UIKit would give us for a stale
  // identifier.
  private var live = Set<Int>()

  // Boxes the identifier so the expiration handler (created *before*
  // beginBackgroundTask returns) can read the id it belongs to.
  private final class Box {
    var id: UIBackgroundTaskIdentifier = .invalid
  }

  func begin(name: String) -> Int? {
    let box = Box()
    box.id = UIApplication.shared.beginBackgroundTask(withName: name) { [weak self] in
      // MUST end the task here — if the expiration handler returns without
      // ending it, iOS terminates the app.
      self?.end(rawValue: box.id.rawValue)
    }
    guard box.id != .invalid else { return nil }

    let raw = box.id.rawValue
    lock.lock()
    live.insert(raw)
    lock.unlock()
    return raw
  }

  func end(rawValue: Int) {
    lock.lock()
    let known = live.remove(rawValue) != nil
    lock.unlock()
    // Not ours (or already ended, possibly by the expiration handler) → no-op.
    guard known else { return }
    UIApplication.shared.endBackgroundTask(UIBackgroundTaskIdentifier(rawValue: rawValue))
  }
}

public class BgTaskModule: Module {
  public func definition() -> ModuleDefinition {
    Name("BgTask")

    // Returns the raw UIBackgroundTaskIdentifier, or nil when the assertion
    // couldn't be taken (`.invalid`) — callers must treat nil as "no assertion"
    // and still do their work.
    Function("beginBackgroundTask") { (name: String) -> Int? in
      BgTaskRegistry.shared.begin(name: name)
    }

    // Idempotent: safe with an already-ended, expired or bogus id.
    Function("endBackgroundTask") { (id: Int) in
      BgTaskRegistry.shared.end(rawValue: id)
    }
  }
}
