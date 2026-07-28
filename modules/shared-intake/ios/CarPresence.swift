import Foundation

// CarPresence — is the car within passive-entry range right now?
//
// The Share Extension needs this to choose a transport, and it cannot compute it:
// ranging and the BLE link both live in the app's process. So the app publishes
// what it knows into the App Group and the extension reads it.
//
// The signal is "the app holds a live BLE link to the car", not a region
// crossing. It is the stronger statement — a link that is UP is proof of
// proximity, where a region enter can be minutes stale — and it is also the exact
// condition the gate exists to protect: taking the radio for a share while the
// app is holding a link next to the car is the case we must not do.
//
// ── The staleness rule, and why it points this way ──
//
// A missing or stale value means "IN RANGE" (i.e. prefer the Pi), NEVER "out of
// range". The app may not have run for hours, so absence carries no information —
// and the two ways of being wrong are not symmetric. Wrongly believing we are out
// of range takes the BLE radio next to the car, which is the one case this gate
// was built for. Wrongly believing we are in range costs a Pi attempt that fails
// over to BLE anyway. Fail toward the cheap mistake.
public enum CarPresence {
  public static let fileName = "car-presence.json"

  // Generous, because the app writes on CHANGE rather than on a timer: a value
  // can be legitimately old and still perfectly accurate. Past this we stop
  // trusting it — and per the rule above, not trusting it means "in range".
  public static let stalenessSeconds: TimeInterval = 15 * 60

  private static var url: URL? {
    FileManager.default
      .containerURL(forSecurityApplicationGroupIdentifier: ShareTrace.appGroup)?
      .appendingPathComponent(fileName)
  }

  public struct Snapshot {
    public let linkUp: Bool
    public let at: TimeInterval  // epoch seconds
    public let stale: Bool

    // What the arbiter actually asks. Note both `stale` and "no value at all"
    // land here as true.
    public var treatAsInRange: Bool { stale || linkUp }
  }

  public static func write(linkUp: Bool) {
    guard let url = url else { return }
    let payload: [String: Any] = ["linkUp": linkUp, "at": Date().timeIntervalSince1970]
    guard let data = try? JSONSerialization.data(withJSONObject: payload) else { return }
    try? data.write(to: url, options: .atomic)
  }

  public static func read() -> Snapshot {
    guard
      let url = url,
      let data = try? Data(contentsOf: url),
      let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
      let at = obj["at"] as? TimeInterval
    else {
      // No value: unknown, which by the rule above is in-range.
      return Snapshot(linkUp: false, at: 0, stale: true)
    }
    let age = Date().timeIntervalSince1970 - at
    return Snapshot(linkUp: obj["linkUp"] as? Bool ?? false, at: at, stale: age > stalenessSeconds)
  }
}
