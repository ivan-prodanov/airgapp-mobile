import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createCarGateway, MAX_BLE_ATTEMPTS, evictScopeFor } from './gateway';
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

// Fix 1 regression test: a real Pi 404 is tagged `TransportError('session-gone',
// <Pi JSON body message>, 404)` — the Pi's body text won't necessarily match
// any of isTransportDeadError's message substrings, so recovery MUST be
// driven by the typed `kind`, not the message. Before the fix this fell
// through to a terminal {ok:false,kind:'unreachable'}.
test('runCommand: a typed session-gone TransportError (Pi 404, non-matching body) evicts and cold-reconnects then succeeds', async () => {
  __resetSessionCaches();
  const { car, gateway } = makeGateway([
    { kind: 'throw', error: new TransportError('session-gone', 'no active session for vin', 404) },
    { kind: 'ok' },
  ]);

  const outcome = await gateway.runCommand({ type: 'lock' });

  assert.deepEqual(outcome, { ok: true, attempts: 2 });
  // Cold re-handshake: the Pi opened a fresh session on the second attempt
  // (evict tore the first one down) — proves the typed-kind path drove
  // recovery, not a message-substring match.
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

test('runCommand: a timeout evicts + re-handshakes then succeeds (transport fallback)', async () => {
  __resetSessionCaches();
  // A transport that can't reach the car (timeout) must not be terminal — it
  // evicts + re-opens (which re-selects the transport under a SelectingTransport,
  // e.g. a dead Pi falling over to BLE). Here the re-open just succeeds.
  const { car, gateway } = makeGateway([
    { kind: 'throw', error: new TransportError('timeout', 'Pi did not respond', 504) },
    { kind: 'ok' },
  ]);

  const outcome = await gateway.runCommand({ type: 'lock' });

  assert.deepEqual(outcome, { ok: true, attempts: 2 });
  assert.equal(car.openCount, 2); // cold re-handshake on the retry
});

test('runCommand: a persistent timeout classifies terminal kind=timeout after the evict cap', async () => {
  __resetSessionCaches();
  // Both transports down: the unreachable-evict cap (2) bounds the retries so it
  // fails in bounded time instead of spinning MAX attempts through full timeouts.
  const { car, gateway } = makeGateway([
    { kind: 'throw', error: new TransportError('timeout', 'Pi did not respond', 504) },
    { kind: 'throw', error: new TransportError('timeout', 'Pi did not respond', 504) },
    { kind: 'throw', error: new TransportError('timeout', 'Pi did not respond', 504) },
  ]);

  const outcome = await gateway.runCommand({ type: 'lock' });

  assert.equal(outcome.ok, false);
  assert.equal(outcome.ok === false && outcome.kind, 'timeout');
  // 1 initial attempt + 2 capped evict-retries = 3 handshakes, then terminal.
  assert.equal(car.openCount, 3);
});

test('runCommand: an auth TransportError is terminal immediately (no retry)', async () => {
  __resetSessionCaches();
  // Auth failures (bad/revoked bearer) must NOT evict+retry — a re-handshake
  // can't fix them; surface immediately.
  const { car, gateway } = makeGateway([
    { kind: 'throw', error: new TransportError('auth', 'unauthorized — token revoked', 401) },
  ]);

  const outcome = await gateway.runCommand({ type: 'lock' });

  assert.equal(outcome.ok, false);
  assert.equal(outcome.ok === false && outcome.kind, 'auth');
  assert.equal(car.openCount, 1); // no re-handshake
});

// ── Command deadline (25s, matching the official app) ───────────────────────

// slowCar wraps a FakeCar so every exchange "costs" perExchangeMs on an
// injectable fake clock. Nothing sleeps for real — the clock is just a number
// the gateway reads — so the deadline is asserted deterministically.
function slowCar(car: FakeCar, perExchangeMs: number) {
  let t = 0;
  const transport = {
    openSession: (vin: string) => car.openSession(vin),
    closeSession: (id: string) => car.closeSession(id),
    exchange: async (id: string, payload: string, timeoutMs: number) => {
      t += perExchangeMs;
      return car.exchange(id, payload, timeoutMs);
    },
  };
  return { transport, now: () => t };
}

test('runCommand: stops at the command deadline with kind=timeout (before MAX attempts)', async () => {
  __resetSessionCaches();
  // Every attempt faults transiently (retryable → the loop would otherwise run
  // all MAX_BLE_ATTEMPTS), and each round-trip burns 9s of the 25s budget.
  const car = new FakeCar({ script: Array.from({ length: MAX_BLE_ATTEMPTS }, () => ({ kind: 'fault', fault: 1 }) as const) });
  const { transport, now } = slowCar(car, 9_000);
  const gateway = createCarGateway({
    transport,
    vin: VIN,
    deviceKeys: makeDeviceKeys(),
    sleep: async () => {},
    now,
    commandDeadlineMs: 25_000,
  });

  const outcome = await gateway.runCommand({ type: 'lock' });

  assert.equal(outcome.ok, false);
  assert.equal(outcome.ok === false && outcome.kind, 'timeout');
  // Every exchange costs 9s — including attempt 1's handshake. So: attempt 1
  // burns handshake+command (t=18s), attempt 2 re-uses the cached session and
  // burns one command (t=27s), and attempt 3 sees 27s ≥ 25s and stops. Two
  // commands reached the car: it gave up EARLY, not after MAX_BLE_ATTEMPTS.
  assert.equal(car.decryptedCommands.length, 2);
  assert.ok(car.decryptedCommands.length < MAX_BLE_ATTEMPTS);
  assert.ok(now() < 36_000, 'must not start another attempt past the deadline');
});

test('runCommand: the deadline defaults to 25s', async () => {
  __resetSessionCaches();
  // Same script, same 9s-per-exchange clock, but NO explicit commandDeadlineMs:
  // the 25s default must bound it identically (2 commands, then timeout).
  const car = new FakeCar({ script: Array.from({ length: MAX_BLE_ATTEMPTS }, () => ({ kind: 'fault', fault: 1 }) as const) });
  const { transport, now } = slowCar(car, 9_000);
  const gateway = createCarGateway({ transport, vin: VIN, deviceKeys: makeDeviceKeys(), sleep: async () => {}, now });

  const outcome = await gateway.runCommand({ type: 'lock' });

  assert.equal(outcome.ok === false && outcome.kind, 'timeout');
  assert.equal(car.decryptedCommands.length, 2);
});

test('runCommand: a command that finishes inside the deadline is unaffected', async () => {
  __resetSessionCaches();
  // Two 9s attempts = 18s < 25s: the deadline must not fire on a slow-but-OK
  // command (no regression on the transient-retry path).
  const car = new FakeCar({ script: [{ kind: 'fault', fault: 1 }, { kind: 'ok' }] });
  const { transport, now } = slowCar(car, 9_000);
  const gateway = createCarGateway({
    transport,
    vin: VIN,
    deviceKeys: makeDeviceKeys(),
    sleep: async () => {},
    now,
    commandDeadlineMs: 25_000,
  });

  const outcome = await gateway.runCommand({ type: 'lock' });

  assert.deepEqual(outcome, { ok: true, attempts: 2 });
});

// ── Command deadline: the HARD guarantee (regression) ──────────────────────

// Regression for the hung-spinner bug: the between-attempt deadline check can
// only fire while the retry loop is RUNNING. A single attempt whose transport
// call never settles (a wedged native BLE connect/discover/write) never
// returns to that check, so the loop parked forever, runCommand never
// resolved, and useCarLink's `finally` never cleared `pending` — the control's
// spinner spun until the app was killed. runAction now races the whole loop
// against a real wall-clock timer, so the command ALWAYS terminates.
//
// These use a real (tiny) commandDeadlineMs so the race timer is genuinely
// exercised — not the injectable clock the tests above use.

test('runCommand: a transport whose exchange NEVER settles still times out', async () => {
  __resetSessionCaches();
  const car = new FakeCar({ script: [{ kind: 'ok' }] });
  const transport = {
    openSession: (vin: string) => car.openSession(vin),
    closeSession: (id: string) => car.closeSession(id),
    // Wedged link: the promise never resolves and never rejects.
    exchange: () => new Promise<string>(() => {}),
  };
  const gateway = createCarGateway({
    transport,
    vin: VIN,
    deviceKeys: makeDeviceKeys(),
    sleep: async () => {},
    commandDeadlineMs: 50,
  });

  const outcome = await gateway.runCommand({ type: 'lock' });

  assert.equal(outcome.ok, false);
  assert.equal(outcome.ok === false && outcome.kind, 'timeout');
});

test('runCommand: a transport whose openSession NEVER settles still times out', async () => {
  __resetSessionCaches();
  const car = new FakeCar({ script: [{ kind: 'ok' }] });
  const transport = {
    // Wedged handshake — hangs before any exchange is ever attempted.
    openSession: () => new Promise<string>(() => {}),
    closeSession: (id: string) => car.closeSession(id),
    exchange: (id: string, payload: string, timeoutMs: number) => car.exchange(id, payload, timeoutMs),
  };
  const gateway = createCarGateway({
    transport,
    vin: VIN,
    deviceKeys: makeDeviceKeys(),
    sleep: async () => {},
    commandDeadlineMs: 50,
  });

  const outcome = await gateway.runCommand({ type: 'lock' });

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

// ── C3: in-flight cancellation ──────────────────────────────────────────────

test('C3: an already-aborted signal cancels before the car is touched', async () => {
  __resetSessionCaches();
  // A script that would otherwise retry its way through the fault-recovery loop.
  const { car, gateway } = makeGateway(
    Array.from({ length: MAX_BLE_ATTEMPTS }, () => ({ kind: 'fault', fault: 1 }) as const),
  );

  const outcome = await gateway.runCommand({ type: 'lock' }, { signal: AbortSignal.abort() });

  assert.equal(outcome.ok, false);
  assert.equal(outcome.ok === false && outcome.kind, 'cancelled');
  // The whole point: a superseded command must stop retrying, not burn the
  // 25s deadline holding its lane while the user's newer value waits.
  assert.equal(car.openCount, 0, 'cancelled before opening a session — no round-trip to the car');
});

test('C3: cancelling mid-flight stops the retry loop instead of exhausting attempts', async () => {
  __resetSessionCaches();
  const ctrl = new AbortController();
  // Every attempt faults transiently, so WITHOUT cancellation this runs the full
  // MAX_BLE_ATTEMPTS and returns 'exhausted' (see the 'exhausted' test above).
  // Abort via the injected retry-delay timer: the gateway sleeps between
  // transient faults, so this fires while the loop is genuinely mid-retry.
  const car = new FakeCar({
    script: Array.from({ length: MAX_BLE_ATTEMPTS }, () => ({ kind: 'fault', fault: 1 }) as const),
  });
  const gateway = createCarGateway({
    transport: car,
    vin: VIN,
    deviceKeys: makeDeviceKeys(),
    sleep: async () => {
      ctrl.abort();
    },
  });

  const outcome = await gateway.runCommand({ type: 'lock' }, { signal: ctrl.signal });

  assert.equal(outcome.ok, false);
  assert.equal(
    outcome.ok === false && outcome.kind,
    'cancelled',
    'a cancel during the retry loop settles as cancelled, NOT exhausted/timeout — it is not a failure to show the user',
  );
  assert.ok(
    car.openCount < MAX_BLE_ATTEMPTS,
    `stopped early: used ${car.openCount} of ${MAX_BLE_ATTEMPTS} attempts instead of burning the whole deadline`,
  );
});

test('C3: no signal behaves exactly as before (parity, no behaviour change)', async () => {
  __resetSessionCaches();
  const { gateway } = makeGateway([{ kind: 'ok' }]);

  const outcome = await gateway.runCommand({ type: 'lock' });

  assert.equal(outcome.ok, true);
});

// --- evictScopeFor -----------------------------------------------------------

test('evictScopeFor: a TIMEOUT takes only its own domain', () => {
  // The regression PE-4 measured. A domain-3 read timing out was tearing down
  // the domain-2 session, so the next lock paid a cold handshake: 4171ms against
  // a warm 91ms. A timeout means no reply came back — not that the link died,
  // and the car answered VCSEC normally seconds later.
  assert.equal(evictScopeFor('timeout'), 'domain');
});

test('evictScopeFor: unreachable still tears down the whole link', () => {
  // Genuinely can't reach the car (Pi down, out of range) — every domain riding
  // that link is dead, and narrowing this would leave stale sessions behind.
  assert.equal(evictScopeFor('unreachable'), 'link');
});

test('evictScopeFor defaults to the SAFE side for anything unrecognised', () => {
  // Over-evicting costs a handshake; under-evicting leaves a dead session cached
  // and every later command fails on it. Unknown kinds must take the former.
  for (const kind of ['auth', 'fault', 'cancelled', '', 'something-new']) {
    assert.equal(evictScopeFor(kind), 'link', `${kind} must not be narrowed`);
  }
});
