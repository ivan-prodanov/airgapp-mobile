import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyBleError,
  createBondWedgeDetector,
  WEDGE_CONSECUTIVE_CONNECT_FAILURES,
  bondWedgeBody,
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

test('guidance names the car by its Bluetooth name, as the official copy does', () => {
  // {{name}} is the vehicle display name, which Tesla propagates into the BLE
  // GAP name — so it matches exactly what iOS shows on the pairing sheet.
  const body = bondWedgeBody('🔑 CHUŠKOPEK');
  assert.match(body, /Remove "🔑 CHUŠKOPEK" in Settings > Bluetooth/);
  assert.match(body, /not affected/i, 'reassures the key survives');
  assert.match(body, /do not need your key card/i);
  assert.match(body, /does not need to be unlocked/i, 'corrects the unlock assumption');
  // Degrades sensibly when we do not know the name.
  assert.match(bondWedgeBody(null), /Remove "your car"/);
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
