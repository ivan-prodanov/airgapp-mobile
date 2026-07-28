import Foundation

// CarPresence — did the app hold a live BLE link to the car when it last looked?
//
// DIAGNOSTIC ONLY. It chose the transport once; it does not any more. BLE is
// always tried first now, by design and on measurement — see TransportArbiter.
//
// It is kept because it is the only thing that distinguishes a WARM measurement
// from a COLD one. "BLE took 1s" means very different things with the app holding
// an ACL link to the car and with the app force-closed, and on 2026-07-28 that
// distinction was the difference between an honest number and an overclaimed one:
// the first BLE timings looked cold and were not. Without this line in the trace
// there is no way to tell them apart after the fact.
//
// The signal is "the app holds a live BLE link", not a region crossing — a link
// that is UP is proof of proximity, where a region enter can be minutes stale.
//
// Written on CHANGE, so a value can be legitimately old and still accurate; `stale`
// says when it has aged past the point of being worth believing.
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
