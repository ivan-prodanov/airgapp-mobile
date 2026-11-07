// PeerRemovedBackoffTests — proves the re-arm schedule after a peer-removed refusal
// stays clear of iOS's outgoing LE connection deny list.
//
// Plain swiftc, no XCTest and no simulator: PeerRemovedBackoff is Foundation-only.
// The podspec compiles only ../*.swift, so this folder never ships in the app.
//
//   bash modules/expo-passive-entry/ios/Tests/run.sh

import Foundation

// A model of bluetoothd's LeConnectionDenyList for OUTGOING connections. The log
// strings say "disconnected now, started monitoring", "disconnected N seconds ago,
// increasing counter to K" and "disconnected N seconds ago, stop monitoring", but
// the phone redacts N, so it is unclear whether N is measured from the PREVIOUS
// disconnect or from the FIRST one in the window. The tests run both.
struct DenyListModel {
  enum Clock { case sincePrevious, sinceWindowStart }
  let clock: Clock
  let interval = PeerRemovedBackoff.denyListIntervalSec
  let threshold = PeerRemovedBackoff.denyListCountThreshold
  private var windowStart: TimeInterval?
  private var previous: TimeInterval?
  private(set) var counter = 0
  private(set) var blocked = false

  init(_ clock: Clock) { self.clock = clock }

  mutating func refusal(at t: TimeInterval) {
    guard !blocked else { return }
    defer { previous = t }
    guard let start = windowStart, let prev = previous else {
      windowStart = t; counter = 0; return // started monitoring
    }
    let ago = t - (clock == .sincePrevious ? prev : start)
    if ago <= interval {
      counter += 1
      if counter >= threshold { blocked = true }
    } else {
      windowStart = t; counter = 0 // stop monitoring; treat this one as a new window
    }
  }
}

// Drive `refusals` refusals: each arrives `latency` seconds after its re-arm, and the
// next re-arm waits `delay(n)` seconds. Returns whether the model blocked the car.
func simulate(_ clock: DenyListModel.Clock, latency: TimeInterval, refusals: Int,
              delay: (Int) -> TimeInterval) -> (blocked: Bool, maxCounter: Int, at: Int?) {
  var model = DenyListModel(clock)
  var t: TimeInterval = 0
  var maxCounter = 0
  for n in 1...refusals {
    t += latency
    model.refusal(at: t)
    maxCounter = max(maxCounter, model.counter)
    if model.blocked { return (true, maxCounter, n) }
    t += delay(n)
  }
  return (false, maxCounter, nil)
}

var failures = 0
func check(_ ok: Bool, _ what: String) {
  print("\(ok ? "ok  " : "FAIL") \(what)")
  if !ok { failures += 1 }
}

@main
enum PeerRemovedBackoffTests {
  static func main() {
    // 1. The model reproduces the 2026-11-07 walk-up: instant re-arm, refusals ~0.65 s
    //    apart, blocked on the 11th refusal (counter reached 10 at 11:00:53.308).
    for clock in [DenyListModel.Clock.sincePrevious, .sinceWindowStart] {
      let old = simulate(clock, latency: 0.65, refusals: 50) { _ in 0 }
      check(old.blocked && old.at == 11, "instant re-arm is blocked on refusal 11 (\(clock)), got \(String(describing: old.at))")
    }

    // 2. The schedule never trips the block, however fast the car refuses.
    for clock in [DenyListModel.Clock.sincePrevious, .sinceWindowStart] {
      for latency in [0.0, 0.3, 0.65, 2.0] {
        var b = PeerRemovedBackoff()
        var now = Date(timeIntervalSince1970: 0)
        let r = simulate(clock, latency: latency, refusals: 500) { _ in
          let d = b.noteRefused(at: now)
          now = now.addingTimeInterval(d + latency)
          return d
        }
        check(!r.blocked && r.maxCounter <= 3,
              "never blocked over 500 refusals (\(clock), latency \(latency)s), max counter \(r.maxCounter)")
      }
    }

    // 3. The first retry stays quick: a walk-up is latency-bound.
    check(PeerRemovedBackoff.delay(forStreak: 1) <= 1, "first retry within 1 s")

    // 4. Past the quick ladder every gap exceeds the deny-list interval with margin.
    let steady = (PeerRemovedBackoff.quickLadder.count + 1...200).map { PeerRemovedBackoff.delay(forStreak: $0) }
    check(steady.allSatisfy { $0 >= PeerRemovedBackoff.denyListIntervalSec * 1.5 },
          "steady retries are at least 1.5x the deny-list interval")

    // 5. A long refusal backs off to once a minute.
    check(PeerRemovedBackoff.delay(forStreak: PeerRemovedBackoff.longEpisodeAfter + 1) == 60, "long episode retries every 60 s")

    // 6. Coming back after a gap gets the quick ladder again, not a minute at the door.
    var b = PeerRemovedBackoff()
    var now = Date(timeIntervalSince1970: 0)
    for _ in 0..<40 { now = now.addingTimeInterval(b.noteRefused(at: now)) }
    check(b.noteRefused(at: now) == 60, "deep in a long episode")
    now = now.addingTimeInterval(PeerRemovedBackoff.newEpisodeGap + 1)
    check(b.noteRefused(at: now) == 1 && b.streak == 1, "a refusal after a long quiet gap starts a new episode")

    // 7. A successful connect resets the episode.
    b.reset()
    check(b.noteRefused(at: now) == 1, "reset returns to the quick ladder")

    print(failures == 0 ? "\nall passed" : "\n\(failures) FAILED")
    exit(failures == 0 ? 0 : 1)
  }
}
