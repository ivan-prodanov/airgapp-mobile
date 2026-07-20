import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyBleError,
  createBondWedgeDetector,
  WEDGE_CONSECUTIVE_CONNECT_FAILURES,
  bondWedgeInstruction,
  remedyFor,
} from './bondWedge';

test('classifies the explicit iOS peer-removed-bond signal', () => {
  // ble-plx wraps the CBError, so we match on text across message/reason.
  assert.equal(
    classifyBleError({ message: 'Error Domain=CBErrorDomain Code=14 peerRemovedPairingInformation' }),
    'peer-removed-bond',
  );
  assert.equal(classifyBleError({ reason: 'Peer removed pairing information' }), 'peer-removed-bond');
});

test('a failed SCAN is out-of-range, never a wedge accusation', () => {
  // The car simply is not there. Counting this toward a wedge would tell users
  // to re-pair every time they walk away from the car.
  assert.equal(classifyBleError(new Error('no vehicle found for VIN …844019')), 'out-of-range');
  assert.equal(classifyBleError(new Error('BLE scan timed out after 6000ms')), 'out-of-range');
});

test('one connect failure is NOT a wedge (car asleep / user walked off)', () => {
  const d = createBondWedgeDetector();
  const s = d.noteConnectFailure(new Error('Device X connection failed'));
  assert.equal(s.wedged, false, 'must be conservative — a single failure is ordinary');
  assert.equal(s.consecutiveConnectFailures, 1);
});

test('sustained scan-ok/connect-fail IS flagged (the 2026-07-20 signature)', () => {
  const d = createBondWedgeDetector();
  let s = d.state();
  for (let i = 0; i < WEDGE_CONSECUTIVE_CONNECT_FAILURES; i += 1) {
    s = d.noteConnectFailure(new Error('connect timed out after 10000ms (link wedged)'));
  }
  assert.equal(s.wedged, true);
  assert.equal(s.kind, 'other', 'no explicit OS signal — inferred from behaviour');
});

test('the explicit signal flags IMMEDIATELY, without waiting for a run', () => {
  const d = createBondWedgeDetector();
  const s = d.noteConnectFailure({ message: 'peerRemovedPairingInformation' });
  assert.equal(s.wedged, true, 'definitive signal needs no corroboration');
});

test('an out-of-range failure RESETS the run (no false accumulation)', () => {
  const d = createBondWedgeDetector();
  d.noteConnectFailure(new Error('connection failed'));
  d.noteConnectFailure(new Error('connection failed'));
  const s = d.noteConnectFailure(new Error('no vehicle found'));
  assert.equal(s.consecutiveConnectFailures, 0, 'walking away must not build a wedge case');
  assert.equal(s.wedged, false);
});

test('a successful connect clears the state, including the explicit flag', () => {
  const d = createBondWedgeDetector();
  d.noteConnectFailure({ message: 'peerRemovedPairingInformation' });
  assert.equal(d.state().wedged, true);
  d.noteConnectSuccess();
  assert.equal(d.state().wedged, false, 'recovery must clear the warning');
});

test('guidance names the car by its BLUETOOTH name, not its display name', () => {
  // These are DIFFERENT strings and the distinction is the whole point: the
  // user is scanning Settings > Bluetooth by eye. Tesla lists the GAP name
  // ("🔑 CHUŠKOPEK"); the vehicle display name ("Red Velvet") does not appear
  // there at all, so printing it sends them hunting for an entry that is not
  // in the list. We shipped exactly that bug once.
  const line = bondWedgeInstruction('🔑 CHUŠKOPEK');
  assert.equal(line, "Remove '🔑 CHUŠKOPEK' in Settings > Bluetooth and try again");
  // ONE line — the official row states the action and nothing else. An earlier
  // multi-paragraph explainer read as an error dialog in a row this size.
  assert.ok(!line.includes('\n'), 'single line, no wall of text');
});

test('an unknown name DROPS the quoted token rather than inventing one', () => {
  // RE #5 Q4: quoting the wrong name is worse than quoting none — that was the
  // "Red Velvet" bug, and a placeholder like 'your car' repeats its exact shape
  // by quoting a string Settings will never list. Tesla ships no nameless
  // variant (their row is unreachable without a bond, which guarantees a
  // cached name), so this wording is ours.
  const line = bondWedgeInstruction(null);
  assert.ok(!line.includes("'"), 'no quoted token at all when we do not know it');
  assert.match(line, /Settings > Bluetooth/);
});

// The two failure modes need OPPOSITE remedies, and getting this backwards is
// the user-hostile outcome: demanding a card tap for a transport problem.
test('remedy: a wedge with the key present ⇒ forget-device, never a card', () => {
  assert.equal(remedyFor({ wedged: true, keyOnWhitelist: true }), 'forget-bluetooth-device');
});

test('remedy: UNKNOWN whitelist during a wedge still ⇒ forget-device, never a card', () => {
  // We could not read the whitelist (e.g. no Pi). Guessing "wiped" here would
  // send the user for their card over a stale bond.
  assert.equal(remedyFor({ wedged: true, keyOnWhitelist: null }), 'forget-bluetooth-device');
});

test('remedy: only a KNOWN-absent key justifies asking for the card', () => {
  assert.equal(remedyFor({ wedged: false, keyOnWhitelist: false }), 're-enroll-with-card');
  assert.equal(remedyFor({ wedged: true, keyOnWhitelist: false }), 're-enroll-with-card');
});

test('remedy: healthy state asks for nothing', () => {
  assert.equal(remedyFor({ wedged: false, keyOnWhitelist: true }), 'none');
  assert.equal(remedyFor({ wedged: false, keyOnWhitelist: null }), 'none');
});

test('walking out of range does NOT clear an already-proven wedge', () => {
  // The 2026-07-20 regression: this branch returned wedged:false
  // unconditionally, so one out-of-range attempt after a confirmed
  // peer-removed-bond made the recovery card vanish while the bond was still
  // broken. Only a successful connect may clear a wedge.
  const d = createBondWedgeDetector();
  assert.equal(d.noteConnectFailure({ reason: 'Peer removed pairing information' }).wedged, true);
  const after = d.noteConnectFailure(new Error('no vehicle found — scan timed out'));
  assert.equal(after.wedged, true, 'still wedged: the car being away fixes nothing');
  assert.equal(d.state().wedged, true, 'and state() agrees with what was published');
});

test('a successful connect is the ONE thing that clears a wedge', () => {
  const d = createBondWedgeDetector();
  d.noteConnectFailure({ reason: 'Peer removed pairing information' });
  assert.equal(d.state().wedged, true);
  d.noteConnectSuccess();
  assert.equal(d.state().wedged, false);
});

test('markWedged restores a verdict proven in an earlier process', () => {
  // The OS bond table outlives our process; relaunching must not present a
  // broken car as healthy.
  const d = createBondWedgeDetector();
  assert.equal(d.state().wedged, false, 'fresh process starts with no opinion');
  d.markWedged('peer-removed-bond');
  assert.equal(d.state().wedged, true);
  assert.equal(d.state().kind, 'peer-removed-bond');
  // ...and it still clears properly once the link genuinely works.
  d.noteConnectSuccess();
  assert.equal(d.state().wedged, false);
});

test('a bare connect timeout run trips the wedge — no iosErrorCode 14 needed', () => {
  // THE REAL on-car case (2026-07-20, second round): iOS stops reporting
  // peerRemovedPairingInformation after the first failures, so the wedge
  // degrades to a plain timeout with reason:null. If this fallback cannot fire,
  // a genuinely bricked bond is invisible — which is exactly what happened.
  const d = createBondWedgeDetector();
  const timeout = new Error('BLE connection closed — connect timed out after 10000ms (link wedged)');
  assert.equal(classifyBleError(timeout), 'other', 'no explicit OS signal to lean on');
  assert.equal(d.noteConnectFailure(timeout).wedged, false, 'one run is not yet evidence');
  assert.equal(
    d.noteConnectFailure(timeout).wedged,
    true,
    'two runs = 4 refused connects after a SUCCESSFUL scan — the car is there and saying no',
  );
});

test('the threshold is reachable in the few attempts the selector actually grants BLE', () => {
  // Guards the calibration itself. Once the Pi connects, the sticky selector
  // stops trying BLE — so a threshold the counter cannot reach in a couple of
  // attempts is a threshold that never fires at all.
  assert.ok(
    WEDGE_CONSECUTIVE_CONNECT_FAILURES <= 2,
    'must trip within the ~2 BLE attempts a Pi-backed install gets',
  );
});
