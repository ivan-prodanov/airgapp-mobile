import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createCarGateway, MAX_BLE_ATTEMPTS } from './gateway';
import {
  __resetSessionCaches,
  DOMAIN_INFOTAINMENT,
  DOMAIN_VEHICLE_SECURITY,
} from './session';
import { FromVCSECMessage, Response, encodeMessage } from './proto';
import { TransportError } from './transport';
import { FakeCar, VIN, makeDeviceKeys, type CommandProgram } from './__testutils__/fakeCar';

// recordingSleep is the injected, instantaneous delay used everywhere below —
// it resolves synchronously (no real timers) but records every delay so the
// retry-policy timing can still be asserted deterministically.
function recordingSleep(): { sleep: (ms: number) => Promise<void>; delays: number[] } {
  const delays: number[] = [];
  return {
    delays,
    sleep: async (ms: number) => {
      delays.push(ms);
    },
  };
}

function makeGateway(script: CommandProgram[], opts: Partial<Record<string, unknown>> = {}) {
  const car = new FakeCar({ script, ...opts });
  const timer = recordingSleep();
  const gateway = createCarGateway({
    transport: car,
    vin: VIN,
    deviceKeys: makeDeviceKeys(),
    sleep: timer.sleep,
  });
  return { car, gateway, delays: timer.delays };
}

// ── runCommand: happy path ──────────────────────────────────────────────────

test('runCommand: lock succeeds on the first attempt', async () => {
  __resetSessionCaches();
  const { car, gateway } = makeGateway([{ kind: 'ok' }]);

  const outcome = await gateway.runCommand({ type: 'lock' });

  assert.deepEqual(outcome, { ok: true, attempts: 1 });
  // The car saw exactly one command, on the VCSEC domain.
  assert.equal(car.decryptedCommands.length, 1);
  assert.deepEqual(car.handshakeDomains, [DOMAIN_VEHICLE_SECURITY]);
});

// ── runCommand: semantic fault → stop, no retry ─────────────────────────────

test('runCommand: a semantic fault stops after one attempt (no retry)', async () => {
  __resetSessionCaches();
  const { car, gateway } = makeGateway([{ kind: 'fault', fault: 7 }]);

  const outcome = await gateway.runCommand({ type: 'lock' });

  assert.deepEqual(outcome, {
    ok: false,
    kind: 'fault',
    fault: 7,
    faultName: 'INSUFFICIENT_PRIVILEGES',
    message: '[lock] fault 7 (INSUFFICIENT_PRIVILEGES)',
  });
  assert.equal(car.decryptedCommands.length, 1); // stopped immediately
});

// ── runCommand: session-stale → in-place refresh, then success ──────────────

test('runCommand: session-stale fault refreshes in place then succeeds', async () => {
  __resetSessionCaches();
  const { car, gateway } = makeGateway([{ kind: 'fault', fault: 5 }, { kind: 'ok' }]);

  const outcome = await gateway.runCommand({ type: 'lock' });

  assert.deepEqual(outcome, { ok: true, attempts: 2 });
  assert.equal(car.decryptedCommands.length, 2);
  // Refresh happened in place on the warm BLE link: the Pi's openSession was
  // called exactly once (no cold re-handshake). This is the refetch /
  // refreshCachedSession carry-forward.
  assert.equal(car.openCount, 1);
});

// ── runCommand: transient → delay, then success ─────────────────────────────

test('runCommand: a transient fault retries after a 100ms delay then succeeds', async () => {
  __resetSessionCaches();
  const { car, gateway, delays } = makeGateway([{ kind: 'fault', fault: 1 }, { kind: 'ok' }]);

  const outcome = await gateway.runCommand({ type: 'lock' });

  assert.deepEqual(outcome, { ok: true, attempts: 2 });
  assert.equal(car.decryptedCommands.length, 2);
  assert.ok(delays.includes(100), `expected a 100ms transient delay, saw ${delays}`);
});

// ── runCommand: transport-dead → evict + cold re-handshake ──────────────────

test('runCommand: a transport-dead error evicts and cold-reconnects then succeeds', async () => {
  __resetSessionCaches();
  const { car, gateway } = makeGateway([
    { kind: 'throw', error: new Error('BLE send: read/write on closed pipe') },
    { kind: 'ok' },
  ]);

  const outcome = await gateway.runCommand({ type: 'lock' });

  assert.deepEqual(outcome, { ok: true, attempts: 2 });
  // Cold re-handshake: the Pi opened a fresh session on the second attempt
  // (evict tore the first one down).
  assert.equal(car.openCount, 2);
});

// ── runCommand: stale-frame → retry ─────────────────────────────────────────

test('runCommand: a stale-frame (mismatched uuid) is retried then succeeds', async () => {
  __resetSessionCaches();
  const { car, gateway, delays } = makeGateway([{ kind: 'staleUuid' }, { kind: 'ok' }]);

  const outcome = await gateway.runCommand({ type: 'lock' });

  assert.deepEqual(outcome, { ok: true, attempts: 2 });
  assert.equal(car.decryptedCommands.length, 2);
  assert.ok(delays.includes(100), `expected a 100ms stale-frame delay, saw ${delays}`);
});

// ── runCommand: exhausted ───────────────────────────────────────────────────

test('runCommand: a persistent transient fault exhausts all attempts', async () => {
  __resetSessionCaches();
  const script: CommandProgram[] = Array.from({ length: MAX_BLE_ATTEMPTS }, () => ({
    kind: 'fault' as const,
    fault: 1,
  }));
  const { car, gateway } = makeGateway(script);

  const outcome = await gateway.runCommand({ type: 'lock' });

  assert.equal(outcome.ok, false);
  assert.equal(outcome.ok === false && outcome.kind, 'exhausted');
  assert.equal(car.decryptedCommands.length, MAX_BLE_ATTEMPTS);
});

// ── runCommand: transport error classification ──────────────────────────────

test('runCommand: an auth TransportError classifies as kind=auth', async () => {
  __resetSessionCaches();
  const { gateway } = makeGateway([
    { kind: 'throw', error: new TransportError('auth', 'token revoked', 401) },
  ]);

  const outcome = await gateway.runCommand({ type: 'lock' });

  assert.equal(outcome.ok, false);
  assert.equal(outcome.ok === false && outcome.kind, 'auth');
});

test('runCommand: a timeout TransportError classifies as kind=timeout', async () => {
  __resetSessionCaches();
  const { gateway } = makeGateway([
    { kind: 'throw', error: new TransportError('timeout', 'Pi did not respond', 504) },
  ]);

  const outcome = await gateway.runCommand({ type: 'lock' });

  assert.equal(outcome.ok, false);
  assert.equal(outcome.ok === false && outcome.kind, 'timeout');
});

// ── Domain lockstep ─────────────────────────────────────────────────────────

test('runCommand: built.domain drives the session domain (no cross-domain)', async () => {
  __resetSessionCaches();
  // honk is an INFOTAINMENT command; lock is VCSEC. Run both on the same
  // gateway (shared queue) and confirm each handshook only its own domain.
  const car = new FakeCar({ script: [{ kind: 'ok' }, { kind: 'ok' }] });
  const timer = recordingSleep();
  const gateway = createCarGateway({
    transport: car,
    vin: VIN,
    deviceKeys: makeDeviceKeys(),
    sleep: timer.sleep,
  });

  const honk = await gateway.runCommand({ type: 'honk' });
  const lock = await gateway.runCommand({ type: 'lock' });

  assert.deepEqual(honk, { ok: true, attempts: 1 });
  assert.deepEqual(lock, { ok: true, attempts: 1 });
  assert.deepEqual(car.handshakeDomains, [DOMAIN_INFOTAINMENT, DOMAIN_VEHICLE_SECURITY]);
});

// ── readVcsecStatus (+ decrypt-fail retry + FLAG_ENCRYPT_RESPONSE round-trip)─

function vcsecStatusBytes(): Uint8Array {
  // vehicleLockState=1 LOCKED, vehicleSleepStatus=2 ASLEEP, and a closure.
  return encodeMessage(FromVCSECMessage, {
    vehicleStatus: {
      vehicleLockState: 1,
      vehicleSleepStatus: 2,
      userPresence: 1,
      closureStatuses: { frontTrunk: 1 /* OPEN */, rearTrunk: 0 /* CLOSED */ },
    },
  });
}

test('readVcsecStatus: decodes an encrypted VCSEC status payload', async () => {
  __resetSessionCaches();
  const { gateway } = makeGateway([{ kind: 'ok', response: vcsecStatusBytes() }]);

  const status = await gateway.readVcsecStatus();

  assert.equal(status.lockState, 'locked');
  assert.equal(status.sleepStatus, 'asleep');
  assert.equal(status.closures.frontTrunk, 'open');
  assert.equal(status.closures.rearTrunk, 'closed');
});

test('readVcsecStatus: a decrypt-fail on the encrypted read is retried, not surfaced', async () => {
  __resetSessionCaches();
  // First exchange corrupts the sealed response tag → the engine raises a
  // stale-frame (decrypt-fail-as-stale-frame). The gateway must retry, not
  // surface it. This is the Phase-1 decrypt-fail carry-forward.
  const { car, gateway, delays } = makeGateway([
    { kind: 'decryptFail' },
    { kind: 'ok', response: vcsecStatusBytes() },
  ]);

  const status = await gateway.readVcsecStatus();

  assert.equal(status.lockState, 'locked');
  assert.equal(car.decryptedCommands.length, 2); // retried once
  assert.ok(delays.includes(100), `expected a stale-frame retry delay, saw ${delays}`);
});

// ── awakeSync ───────────────────────────────────────────────────────────────

test('awakeSync: merges charge + climate + drive + location on one session', async () => {
  __resetSessionCaches();
  const chargeResp = encodeMessage(Response, {
    vehicleData: { chargeState: { batteryLevel: 72, batteryRange: 100, chargeLimitSoc: 90 } },
  });
  const climateResp = encodeMessage(Response, {
    vehicleData: { climateState: { insideTempCelsius: 21, isClimateOn: true } },
  });
  const driveResp = encodeMessage(Response, { vehicleData: { driveState: {} } });
  const locationResp = encodeMessage(Response, {
    vehicleData: { locationState: { latitude: 40.1, longitude: -74.2 } },
  });
  const { car, gateway } = makeGateway([
    { kind: 'ok', response: chargeResp },
    { kind: 'ok', response: climateResp },
    { kind: 'ok', response: driveResp },
    { kind: 'ok', response: locationResp },
  ]);

  const snap = await gateway.awakeSync();

  assert.equal(snap.charge?.soc, 72);
  assert.equal(snap.charge?.chargeLimitSoc, 90);
  assert.equal(snap.climate?.insideTempC, 21);
  assert.equal(snap.climate?.isOn, true);
  // latitude/longitude are proto float32 — compare with tolerance.
  assert.ok(Math.abs((snap.location?.lat ?? 0) - 40.1) < 1e-3);
  assert.ok(Math.abs((snap.location?.lon ?? 0) - -74.2) < 1e-3);
  // All four reads ran on ONE warm INFOTAINMENT session.
  assert.equal(car.openCount, 1);
  assert.equal(car.decryptedCommands.length, 4);
  assert.deepEqual(car.handshakeDomains, [DOMAIN_INFOTAINMENT]);
});

test('awakeSync: all four reads fault (car asleep/unreachable) → rejects, no silent empty snapshot', async () => {
  __resetSessionCaches();
  const { car, gateway } = makeGateway([
    { kind: 'fault', fault: 2 }, // TIMEOUT
    { kind: 'fault', fault: 2 },
    { kind: 'fault', fault: 2 },
    { kind: 'fault', fault: 2 },
  ]);

  await assert.rejects(() => gateway.awakeSync(), /no vehicle data|awake/);
  // All four reads were attempted on the one warm session before rejecting.
  assert.equal(car.decryptedCommands.length, 4);
});

test('awakeSync: partial success (charge + climate ok, drive + location fault) returns a partial snapshot', async () => {
  __resetSessionCaches();
  const chargeResp = encodeMessage(Response, {
    vehicleData: { chargeState: { batteryLevel: 55, batteryRange: 80, chargeLimitSoc: 80 } },
  });
  const climateResp = encodeMessage(Response, {
    vehicleData: { climateState: { insideTempCelsius: 19, isClimateOn: false } },
  });
  const { car, gateway } = makeGateway([
    { kind: 'ok', response: chargeResp },
    { kind: 'ok', response: climateResp },
    { kind: 'fault', fault: 2 },
    { kind: 'fault', fault: 2 },
  ]);

  const snap = await gateway.awakeSync();

  assert.equal(snap.charge?.soc, 55);
  assert.equal(snap.climate?.insideTempC, 19);
  assert.equal(snap.drive, undefined);
  assert.equal(snap.location, undefined);
  assert.equal(car.decryptedCommands.length, 4);
});

// ── wake ────────────────────────────────────────────────────────────────────

test('wake: runs the VCSEC wake command', async () => {
  __resetSessionCaches();
  const { car, gateway } = makeGateway([{ kind: 'ok' }]);

  const outcome = await gateway.wake();

  assert.deepEqual(outcome, { ok: true, attempts: 1 });
  assert.deepEqual(car.handshakeDomains, [DOMAIN_VEHICLE_SECURITY]);
});
