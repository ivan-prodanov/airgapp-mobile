import Foundation

// PeerRemovedBackoff — how long to wait before re-arming the standing connect after
// the car REFUSES our LE keys (CBError.peerRemovedPairingInformation).
//
// WHY (walk-up 2026-11-07, bluetoothd log from `log collect`): the car answered our
// link-layer encryption with HCI "PIN or Key Missing" (bluetoothd: `Failed to encrypt
// connection STATUS 706`, `Encryption failed, peer removed keys`), which CoreBluetooth
// reports as peerRemovedPairingInformation. We re-armed instantly, each attempt was
// refused ~0.5 s later, and after 11 refusals in 7 s iOS put the car on its outgoing
// LE connection DENY LIST:
//
//   LeConnectionDenyList: evaluateOutgoingDisconnection ... increasing counter to 10
//   Warning: LeConnectionDenyList: Device 194E94F7-… is currently blocked, ignoring request
//
// iOS then silently ignored our pending connect, so direct BLE was dead for the whole
// walk-up: no passive entry with the app closed, no direct link with it open. The
// refusal is a car-side state that cleared on its own, with the same iOS bond, in every
// earlier episode (07-28 twice, 10-01, 10-17). The block is what turned it into minutes.
//
// THE RULE, from bluetoothd's defaults (LeConnectionManager constructor, macOS
// bluetoothd 2026; the phone logs the same counter and 180 s maintenance timer): when
// outgoing connections to a device end in a peer-removed-keys disconnect (result 4833)
// 10 times, each within 10 s, iOS blocks it for 1800 s. Override keys:
// ConnectionDenyList{CountThreshold,IntervalSeconds,TimeoutSeconds}Override.
// Edge-of-range encryption TIMEOUTS (result 4834) do not count; the walk-up log shows
// the counter skipping them, so this only paces the peer-removed case.
//
// THE SCHEDULE: a few quick retries, because the refusal can clear in seconds and a
// walk-up is latency-bound. Then retries spaced well past the deny-list interval so
// the counter starts over before it can climb. A refusal lasting minutes backs off
// further, so a car that really dropped our bond doesn't wake us every 15 s for hours.
struct PeerRemovedBackoff {
  // bluetoothd LeConnectionDenyList defaults (fLeConnectionDenyListIntervalSec,
  // fLeConnectionDenyListCountThreshold). The tests prove the schedule stays clear.
  static let denyListIntervalSec: TimeInterval = 10
  static let denyListCountThreshold = 10

  // Three quick retries: at most 3 of the 10 counts the block needs.
  static let quickLadder: [TimeInterval] = [1, 2, 4]
  // Then strictly beyond the interval, with margin in case an iOS build uses a
  // longer one, so every further refusal starts a fresh window.
  static let steadyDelay: TimeInterval = 15
  // After this many refusals in one episode (about 5 min of continuous refusal) the
  // car is not coming back soon; retry once a minute.
  static let longEpisodeAfter = 23
  static let longDelay: TimeInterval = 60
  // A refusal this long after the previous one is a NEW episode (the user walked away
  // and came back), so it gets the quick retries again, not a minute at the car door.
  static let newEpisodeGap: TimeInterval = 120

  private(set) var streak = 0
  private var lastRefusal: Date?

  // Record one refusal and return how long to wait before re-arming.
  mutating func noteRefused(at now: Date) -> TimeInterval {
    if let last = lastRefusal, now.timeIntervalSince(last) > PeerRemovedBackoff.newEpisodeGap {
      streak = 0
    }
    lastRefusal = now
    streak += 1
    return PeerRemovedBackoff.delay(forStreak: streak)
  }

  // A successful connect ends the episode.
  mutating func reset() {
    streak = 0
    lastRefusal = nil
  }

  static func delay(forStreak n: Int) -> TimeInterval {
    guard n >= 1 else { return 0 }
    if n <= quickLadder.count { return quickLadder[n - 1] }
    return n > longEpisodeAfter ? longDelay : steadyDelay
  }
}
