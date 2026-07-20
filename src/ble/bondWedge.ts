// bondWedge.ts — detect the stale-LE-bond wedge that freezes BLE for EVERY client.
//
// THE MECHANISM (RE RESPONSE #3, Addendum — verified against the official apps):
// there are two independent security layers on the same BLE link:
//
//   • VCSEC application session — ECDH + AES-GCM over chars 0212/0213/0214.
//     Gated purely by whitelist membership. This is what commands and passive
//     entry actually use.
//   • OS LE bond (SMP) — LTK/IRK over chars 0301/0302. Exists ONLY for UWB
//     ranging. Downstream of the whitelist key, never a precondition of it.
//
// Once an LTK exists the OS auto-encrypts the link on EVERY reconnect. If the
// car drops or rotates its side (reboot, BLE-stack wedge, IRK rotation) while
// the phone still holds the stale LTK, CoreBluetooth fails the CONNECT itself
// with CBErrorPeerRemovedPairingInformation — which blocks the VCSEC chars too.
// So a bond that exists only for UWB, when stale, collaterally kills commands
// and passive entry for every client holding it. That is the 2026-07-20
// all-client outage, and the whitelist entry was intact the whole time.
//
// AIRGAPP NEVER BONDS (we only ever touch 0212/0213), so we cannot create this.
// But the OS bond table is per-phone and SHARED: the official Tesla app may have
// bonded this handset, and we inherit the wedge. Hence detect + guide.
//
// We cannot clear a bond programmatically on either OS — the only fix is the
// user forgetting the device in Bluetooth settings. So detection exists purely
// to tell them that, instead of leaving them to guess (or reach for the Tesla
// app, which is what this is meant to replace).
//
// Pure — no I/O — so the classification is node-testable.

// iOS surfaces the real cause; ble-plx wraps it, so match on substrings across
// the message/reason rather than a code that may not survive the wrapper.
const IOS_PEER_REMOVED_PATTERNS = [
  'peerremovedpairinginformation',
  'peer removed pairing',
  'removed pairing information',
];

// The behavioural signature when no explicit error surfaces: the car IS
// advertising (scan succeeds) but connect fails over and over. Out-of-range
// looks different — the SCAN fails. This is what our 2026-07-20 logs showed:
// "scan ok → connect timed out after 10000ms" on every attempt.
export const WEDGE_CONSECUTIVE_CONNECT_FAILURES = 4;

export type BleFailureKind =
  | 'peer-removed-bond' // explicit iOS signal — definitive
  | 'suspected-bond-wedge' // scan works, connect keeps failing
  | 'out-of-range' // scan itself failed — car simply isn't there
  | 'other';

export function classifyBleError(err: unknown): BleFailureKind {
  const text = `${(err as { message?: string })?.message ?? ''} ${
    (err as { reason?: string })?.reason ?? ''
  }`.toLowerCase();
  if (!text.trim()) return 'other';
  if (IOS_PEER_REMOVED_PATTERNS.some((p) => text.includes(p))) return 'peer-removed-bond';
  // Our own scan-timeout wording — the car never advertised to us.
  if (text.includes('no vehicle found') || text.includes('scan timed out')) return 'out-of-range';
  return 'other';
}

export interface BondWedgeState {
  // Definitive or strongly-suspected wedge — worth telling the user about.
  wedged: boolean;
  kind: BleFailureKind;
  consecutiveConnectFailures: number;
}

// createBondWedgeDetector tracks connect outcomes and decides when to surface
// guidance. Deliberately conservative: a single failed connect is ordinary (car
// asleep, walked away), so we only claim a wedge on an explicit OS signal or a
// sustained scan-ok/connect-fail run.
export function createBondWedgeDetector() {
  let consecutive = 0;
  let kind: BleFailureKind = 'other';
  let explicit = false;

  return {
    noteConnectFailure(err: unknown): BondWedgeState {
      const k = classifyBleError(err);
      if (k === 'out-of-range') {
        // Not evidence of a wedge — the car isn't there. Don't let it
        // accumulate toward a false accusation.
        consecutive = 0;
        kind = k;
        return { wedged: false, kind, consecutiveConnectFailures: 0 };
      }
      consecutive += 1;
      kind = k;
      if (k === 'peer-removed-bond') explicit = true;
      return {
        wedged: explicit || consecutive >= WEDGE_CONSECUTIVE_CONNECT_FAILURES,
        kind,
        consecutiveConnectFailures: consecutive,
      };
    },
    noteConnectSuccess(): void {
      consecutive = 0;
      explicit = false;
      kind = 'other';
    },
    state(): BondWedgeState {
      return {
        wedged: explicit || consecutive >= WEDGE_CONSECUTIVE_CONNECT_FAILURES,
        kind,
        consecutiveConnectFailures: consecutive,
      };
    },
  };
}

// The user-facing guidance. Neither OS lets an app delete a bond, so this is
// instructions, not a button we can perform for them.
//
// IMPORTANT: this must NOT tell the user to re-enroll / tap their key card. A
// stale bond leaves the whitelist entry fully intact, and demanding a card tap
// for a transport-layer problem is exactly the user-hostile mistake RE #3
// warns about. Only a PERSISTENTLY absent whitelist entry justifies a card.
// Copy mirrors the official VehicleSuggestRemoveBondRow — "Remove '{{name}}' in
// Settings > Bluetooth and try again" — where {{name}} is the vehicle display
// name, which Tesla propagates into the BLE GAP name, so it matches exactly what
// iOS shows on the pairing sheet (e.g. "🔑 CHUŠKOPEK").
//
// Instructional text ONLY: there is no working iOS deep-link to the Bluetooth
// pane (App-Prefs:/prefs:root=Bluetooth are zero-hit in the official binary and
// Apple removed them), so we must not render a button that silently no-ops.
export const BOND_WEDGE_TITLE = 'Reconnect Bluetooth';

export function bondWedgeBody(vehicleBleName: string | null): string {
  const name = vehicleBleName ?? 'your car';
  return (
    `Remove "${name}" in Settings > Bluetooth, then return here.\n\n` +
    'Your phone is holding stale Bluetooth pairing data, which blocks every app ' +
    'from connecting to the car — not just this one.\n\n' +
    'Your phone key is NOT affected. You do not need your key card, and the car ' +
    'does not need to be unlocked.'
  );
}

// Do NOT retry the encrypted connect in a tight loop while wedged — every
// attempt dies at the encryption step before any GATT, so the retries buy
// nothing. Tesla's own cadence is a 30s cooldown with bounded retry, so match it.
//
// (An earlier version of this comment blamed the two lockouts on hammering the
// controller. That was INFERENCE, not RE: RESPONSE-3 Q3 returned UNCERTAIN and
// found no lockout, rate-limit, or attempt counter in authd/command-router. The
// cooldown is justified by "pointless retries" alone; don't let it calcify into
// a causal story we never established.)
export const BOND_WEDGE_COOLDOWN_MS = 30_000;

// What the user must actually do next. Distinguishing these matters: a stale
// bond and a wiped key need OPPOSITE remedies, and airgapp can tell them apart
// (we read the whitelist over the Pi) where the official app cannot — it
// collapses both into one "Set Up Phone Key" state because it can't see the
// whitelist through a dead link.
export type RecoveryRemedy =
  | 'forget-bluetooth-device' // bond wedge — key intact
  | 're-enroll-with-card' // genuine wipe — key gone
  | 'none';

export function remedyFor(opts: {
  wedged: boolean;
  keyOnWhitelist: boolean | null; // null = unknown (couldn't read)
}): RecoveryRemedy {
  // A confirmed-present key with a wedge is unambiguous.
  if (opts.wedged && opts.keyOnWhitelist !== false) return 'forget-bluetooth-device';
  // Only a KNOWN-absent key justifies demanding a card — never on unknown.
  if (opts.keyOnWhitelist === false) return 're-enroll-with-card';
  return 'none';
}
