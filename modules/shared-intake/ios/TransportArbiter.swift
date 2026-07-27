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
    public let make: () -> EngineTransport?

    public init(name: String, make: @escaping () -> EngineTransport?) {
      self.name = name
      self.make = make
    }
  }

  public struct Attempt {
    public let arm: String
    public let result: Result<EngineSendResult, Error>
  }

  private let arms: [Arm]
  private let engineFor: (EngineTransport) -> AirgappEngine

  public init(arms: [Arm], engineFor: @escaping (EngineTransport) -> AirgappEngine) {
    self.arms = arms
    self.engineFor = engineFor
  }

  // Build the ordered arm list for the current presence reading.
  public static func order(inRange: Bool, pi: Arm?, ble: Arm?) -> [Arm] {
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
  public func send(vin: String, lat: Double, lon: Double, label: String?, privateScalarHex: String,
                   completion: @escaping (Result<EngineSendResult, Error>, [Attempt]) -> Void) {
    var attempts: [Attempt] = []
    var remaining = arms[...]

    func next() {
      guard let arm = remaining.first else {
        let failure = attempts.last?.result
          ?? .failure(EngineError.threw("no transport is configured — enrol the Pi or pair over BLE"))
        return completion(failure, attempts)
      }
      remaining = remaining.dropFirst()

      guard let transport = arm.make() else {
        ShareOutboxStore.trace("arbiter: \(arm.name) unavailable (not configured) → next")
        return next()
      }

      engineFor(transport).sendNavigation(
        vin: vin, lat: lat, lon: lon, label: label, privateScalarHex: privateScalarHex
      ) { result in
        attempts.append(Attempt(arm: arm.name, result: result))
        switch result {
        case .success(let sent) where sent.verdict == "accepted" || sent.verdict == "refused":
          ShareOutboxStore.trace("arbiter: \(arm.name) → \(sent.verdict)")
          completion(result, attempts)
        case .success(let sent):
          ShareOutboxStore.trace("arbiter: \(arm.name) → \(sent.verdict) (\(sent.reason ?? "-")) → next")
          next()
        case .failure(let error):
          ShareOutboxStore.trace("arbiter: \(arm.name) FAILED — \(error.localizedDescription) → next")
          next()
        }
      }
    }

    next()
  }
}
