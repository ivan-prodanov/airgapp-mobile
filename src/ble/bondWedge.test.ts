import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyBleError,
  createBondWedgeDetector,
  WEDGE_CONSECUTIVE_CONNECT_FAILURES,
  BOND_WEDGE_BODY,
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

test('guidance never tells the user to re-enroll or tap their card', () => {
  // A stale bond leaves the whitelist intact. Demanding a card tap for a
  // transport problem is the user-hostile mistake RE #3 explicitly warns about.
  assert.ok(!/key card|re-?enroll|tap your/i.test(BOND_WEDGE_BODY.replace(/do not need your key card/i, '')));
  assert.match(BOND_WEDGE_BODY, /Forget This Device/i, 'gives the ONE action that works');
  assert.match(BOND_WEDGE_BODY, /not affected/i, 'reassures the key survives');
});
