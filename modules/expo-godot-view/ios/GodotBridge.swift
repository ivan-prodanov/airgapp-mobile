import Foundation

/// Host side of the `MobileComm.gd` ↔ native message bus.
///
/// On a real device this is the Swift counterpart that the (still-to-be-built) Godot 3.2 iOS
/// plugin — registered as the engine singleton named exactly `IOSGodotInterface` — forwards
/// GDScript calls to. The contract (see `src/godot/README.md` and `GODOT_INTEGRATION.md`):
///
///   | method                       | caller            | purpose                          |
///   |------------------------------|-------------------|----------------------------------|
///   | `addMessage(_:)`             | host (RN)         | host → Godot. enqueue JSON.       |
///   | `pendingMessagesCount()`     | GDScript (engine) | how many inbound messages queued |
///   | `getMessage()`               | GDScript (engine) | dequeue next inbound JSON         |
///   | `sendMessage(_:)`            | GDScript (engine) | Godot → host. forward to RN.      |
///
/// Messages are opaque JSON envelope strings `{ "type": ..., "data": ... }`. This layer never
/// parses them — it only ferries strings, matching the web `GodotRendererBridge` queue.
///
/// `@objcMembers` so the future Objective-C++ plugin can call these directly.
@objcMembers
final class GodotBridge: NSObject {
  static let shared = GodotBridge()
  private override init() { super.init() }

  /// Set by `ExpoGodotViewModule` to forward Godot → host messages to JS as `onGodotMessage`.
  var onMessageToHost: ((String) -> Void)?

  private let lock = NSLock()
  private var outbound: [String] = [] // host → Godot, drained by `getMessage()`

  // MARK: host → Godot (called from JS via `sendMessageToGodot`)

  func addMessage(_ json: String) {
    #if targetEnvironment(simulator)
    // No engine on the simulator (the 2020 libgodot fat lib has no arm64-sim slice).
    // No-op so RN/UI work still builds & runs. See GODOT_INTEGRATION.md.
    NSLog("[GodotBridge|sim] addMessage no-op: %@", json)
    #else
    lock.lock()
    outbound.append(json)
    lock.unlock()
    #endif
  }

  // MARK: called by the IOSGodotInterface plugin on the engine thread (device only)

  func pendingMessagesCount() -> Int {
    lock.lock(); defer { lock.unlock() }
    return outbound.count
  }

  func getMessage() -> String? {
    lock.lock(); defer { lock.unlock() }
    return outbound.isEmpty ? nil : outbound.removeFirst()
  }

  // MARK: Godot → host

  /// Forward a JSON envelope from the engine to the host. Called by the plugin on device, and
  /// by the simulator stub view to synthesize a `GODOT_READY` for UI development.
  func sendMessage(_ json: String) {
    onMessageToHost?(json)
  }
}
