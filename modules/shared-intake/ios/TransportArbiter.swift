import Foundation

// TransportArbiter — chooses the order to try transports in, and walks the list.
//
// Modelled on the one part of Tesla's share extension worth copying: their
// `CommandCenter.transports` is PLURAL, an ordered list with the extension
// walking it, rather than a single hard-wired path. Every transport-selection
// question then becomes "what order", which is a much smaller question than "which
// one", and a dead arm costs a failover rather than a lost share.
//
// ── The order ──
//
// BLE-first matches the app, so there is one less divergence between the two
// processes. But the presence gate inverts it while the car is in passive-entry
// range, and that is the common case for this feature: the whole scenario is
// getting into the car, opening Maps, and sharing. So in practice the Pi runs and
// the BLE arm is the no-cellular / Pi-down fallback rather than the fast path.
//
// That is deliberate, not an accident of ordering. Reaching for the BLE radio
// while standing next to the car means contending with the link the app holds for
// passive entry, for a send the Pi can do without touching the radio at all.
public final class TransportArbiter {
  public struct Arm {
    public let name: String
    // The most this arm should ever be given, even with budget to spare. BLE
    // either reaches a car that is nearby in about a second or it is not going to;
    // the Pi legitimately needs longer for a cold Pi-side scan. Without a cap the
    // first arm can swallow the whole budget and starve the second.
    public let capMs: Int
    // Builds the engine for this arm. Each arm knows how it reaches the car —
    // the Pi behind a Swift EngineTransport, BLE through a JS transport over a
    // dumb byte pipe — and the arbiter only cares that it produces a verdict.
    public let make: () -> (engine: AirgappEngine, transport: String)?

    public init(name: String, capMs: Int, make: @escaping () -> (engine: AirgappEngine, transport: String)?) {
      self.name = name
      self.capMs = capMs
      self.make = make
    }
  }

  public struct Attempt {
    public let arm: String
    public let result: Result<EngineSendResult, Error>
  }

  private let arms: [Arm]

  public init(arms: [Arm]) {
    self.arms = arms
  }

  // TEMPORARY: force BLE first regardless of presence.
  //
  // Set 2026-07-28 at Ivan's request so the BLE arm actually gets exercised in
  // the field — with the gate on, the common case (in range) always chose the Pi
  // and the BLE path would have shipped essentially untested.
  //
  // Safe enough to leave on for now: cross-process central contention is not the
  // hazard it looked like (one ACL link, owned by bluetoothd), and BLE is the
  // faster arm on a warm link. Revert to the gate once BLE has real field time —
  // the Pi is the arm that works when the car is NOT nearby, and BLE-first costs
  // a scan timeout in that case.
  public static let forceBleFirst = true

  // Build the ordered arm list for the current presence reading.
  public static func order(inRange: Bool, pi: Arm?, ble: Arm?) -> [Arm] {
    if forceBleFirst { return [ble, pi].compactMap { $0 } }
    let ordered = inRange ? [pi, ble] : [ble, pi]
    return ordered.compactMap { $0 }
  }

  // Walk the arms until one produces a VERDICT from the car.
  //
  // 'accepted' and 'refused' both stop the walk: the car answered, and asking a
  // second transport to re-ask a question the car already answered would send the
  // destination twice on a refusal that was about the destination itself.
  //
  // 'failed' and 'unverified' fall through to the next arm. Unverified is the
  // subtle one — the send may well have landed, so a fallover can duplicate it.
  // That is the right trade here: a destination arriving twice is a visible
  // annoyance, and one that never arrives while we report success is a silent
  // loss of the thing the user asked for.
  // onArm fires before each attempt so the UI can say what it is doing. The
  // walk can take twelve seconds on a cold scan before it even reaches the second
  // arm, and a spinner that never changes is indistinguishable from a hang.
  // Below this there is no point starting an arm: a session cannot be opened and
  // a command exchanged in the time left, so it would fail on the clock rather
  // than on its merits and waste the seconds the caller could spend saying so.
  private static let minimumUsefulMs = 4_000

  // totalBudget is the WHOLE walk, and each arm gets min(its cap, what is left).
  //
  // This exists because three layers were independently guessing: the sheet's
  // deadline, the transports' own timeouts, and the engine's 25s per-command
  // default. Two arms wanting 25s each inside a 30s sheet meant the second one
  // could never finish — a fallback that exists on paper only. One budget,
  // divided, is the only arrangement where that cannot happen.
  public func send(vin: String, lat: Double, lon: Double, label: String?, privateScalarHex: String,
                   totalBudgetMs: Int, onArm: ((String) -> Void)? = nil,
                   completion: @escaping (Result<EngineSendResult, Error>, [Attempt]) -> Void) {
    var attempts: [Attempt] = []
    var remaining = arms[...]
    let startedAt = Date()
    func remainingMs() -> Int { totalBudgetMs - Int(Date().timeIntervalSince(startedAt) * 1000) }

    func next() {
      guard let arm = remaining.first else {
        let failure = attempts.last?.result
          ?? .failure(EngineError.threw("no transport is configured — enrol the Pi or pair over BLE"))
        return completion(failure, attempts)
      }
      remaining = remaining.dropFirst()

      let budget = min(arm.capMs, remainingMs())
      if budget < Self.minimumUsefulMs {
        ShareTrace.trace("arbiter: \(arm.name) SKIPPED — only \(remainingMs())ms left of \(totalBudgetMs)ms")
        return next()
      }
      onArm?(arm.name)

      guard let built = arm.make() else {
        ShareTrace.trace("arbiter: \(arm.name) unavailable (not configured) → next")
        return next()
      }

      ShareTrace.trace("arbiter: \(arm.name) starting with \(budget)ms (\(remainingMs())ms left)")
      built.engine.sendNavigation(
        vin: vin, lat: lat, lon: lon, label: label,
        privateScalarHex: privateScalarHex, transport: built.transport,
        commandDeadlineMs: budget
      ) { result in
        attempts.append(Attempt(arm: arm.name, result: result))
        switch result {
        case .success(let sent) where sent.verdict == "accepted" || sent.verdict == "refused":
          ShareTrace.trace("arbiter: \(arm.name) → \(sent.verdict)")
          completion(result, attempts)
        case .success(let sent):
          ShareTrace.trace("arbiter: \(arm.name) → \(sent.verdict) (\(sent.reason ?? "-")) → next")
          next()
        case .failure(let error):
          ShareTrace.trace("arbiter: \(arm.name) FAILED — \(error.localizedDescription) → next")
          next()
        }
      }
    }

    next()
  }
}
