import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  openDirectSession,
  sendCommand,
  evaluateFault,
  isTransportDeadError,
  isStaleFrameError,
  withCachedSession,
  evictSession,
  closeAllCachedSessions,
  closeCachedSession,
  peekPiSessionId,
  honkAction,
  vcsecGetStatusAction,
  encodeInfotainmentAction,
  encodeVCSECMessage,
  __resetSessionCaches,
  DOMAIN_INFOTAINMENT,
  DOMAIN_VEHICLE_SECURITY,
} from './session';
import type { Domain } from './types';
import { deriveSessionKeyMaterial } from './crypto';
import { FakeCar, VIN, makeDeviceKeys } from './__testutils__/fakeCar';

// --- (a) evaluateFault table ------------------------------------------------

test('evaluateFault: session-stale family (4/5/6/15/17) → retryable, delay 0', () => {
  for (const f of [4, 5, 6, 15, 17]) {
    assert.deepEqual(evaluateFault(f), { category: 'session-stale', retryable: true, delayMs: 0 }, `fault ${f}`);
  }
});

test('evaluateFault: transient family (1/2/11) → retryable, delay 100', () => {
  for (const f of [1, 2, 11]) {
    assert.deepEqual(evaluateFault(f), { category: 'transient', retryable: true, delayMs: 100 }, `fault ${f}`);
  }
});

test('evaluateFault: everything else → semantic, non-retryable', () => {
  for (const f of [0, 3, 7, 8, 9, 10, 12, 13, 14, 16, 18, 99]) {
    assert.deepEqual(evaluateFault(f), { category: 'semantic', retryable: false, delayMs: 0 }, `fault ${f}`);
  }
});

// --- (b) transport-dead / stale-frame predicates ----------------------------

test('isTransportDeadError matches the Pi-side dead-link strings', () => {
  for (const msg of [
    'BLE send: send ATT request failed: io: read/write on closed pipe',
    'BLE connection closed',
    'BLE-SESSION not found',
    'session not found',
    'no peripherals',
    'device not connected',
  ]) {
    assert.equal(isTransportDeadError(new Error(msg)), true, msg);
  }
  assert.equal(isTransportDeadError(new Error('car returned BAD_PARAMETER')), false);
  assert.equal(isTransportDeadError(null), false);
});

test('isTransportDeadError matches the TYPED TransportError kind, not just message substrings', () => {
  // A real Pi 404 whose JSON error body text doesn't match any of the
  // substring fallbacks above (e.g. "no active session for vin") must still
  // be recognized as transport-dead via its `kind`.
  assert.equal(isTransportDeadError({ kind: 'session-gone', message: 'no active session for vin' }), true);
  // A Pi 502 (BLE error on the Pi) also means the link is dead.
  assert.equal(isTransportDeadError({ kind: 'ble', message: 'BLE error on the Pi' }), true);
  // Other typed kinds are NOT transport-dead (auth/timeout/http/network are
  // handled elsewhere in the retry policy).
  assert.equal(isTransportDeadError({ kind: 'auth', message: 'unauthorized' }), false);
  assert.equal(isTransportDeadError({ kind: 'timeout', message: 'Pi did not respond' }), false);
});

test('isStaleFrameError matches stale response / stale frame only', () => {
  assert.equal(isStaleFrameError(new Error('Pi returned stale response: sent uuid=…')), true);
  assert.equal(isStaleFrameError(new Error('Pi returned stale frame: expected from domain=3')), true);
  assert.equal(isStaleFrameError(new Error('closed pipe')), false);
});

// --- (c) handshake happy path -----------------------------------------------

test('openDirectSession completes the handshake and derives the shared key', async () => {
  __resetSessionCaches();
  const car = new FakeCar({ counter: 7, clockTime: 1_700_000_123 });
  const deviceKeys = makeDeviceKeys();

  const session = await openDirectSession({
    transport: car,
    vin: VIN,
    deviceKeys,
    domain: DOMAIN_INFOTAINMENT,
  });

  // The key the engine derived must equal ECDH(devicePriv, carPub) → sha1[:16],
  // recomputed independently here from the car's advertised pubkey.
  const expectedKey = deriveSessionKeyMaterial(deviceKeys.privateScalar, session.vehiclePubRaw);
  assert.deepEqual(new Uint8Array(session.keyBytes), expectedKey);
  assert.deepEqual(new Uint8Array(session.sessionKey), expectedKey);
  assert.equal(session.counter, 7);
  assert.equal(session.clockBase, 1_700_000_123);
  assert.equal(session.epoch.length, 16);
  assert.equal(session.domain, DOMAIN_INFOTAINMENT);
  assert.equal(session.vin, VIN);
  assert.equal(session.sessionId, 'pi-sess-1');
  assert.equal(car.openCount, 1);
  await session.close();
  assert.equal(car.closeCount, 1);
});

// --- (d) handshake MITM reject ----------------------------------------------

test('openDirectSession rejects a tampered SessionInfo HMAC tag (MITM)', async () => {
  __resetSessionCaches();
  const car = new FakeCar({ corruptTag: true });
  await assert.rejects(
    openDirectSession({ transport: car, vin: VIN, deviceKeys: makeDeviceKeys(), domain: DOMAIN_INFOTAINMENT }),
    /HMAC verification FAILED/,
  );
  // The failed handshake must have released the Pi session it opened.
  assert.equal(car.openCount, 1);
  assert.equal(car.closeCount, 1);
});

// --- (e) command round-trip -------------------------------------------------

test('sendCommand encrypts a honk, exchanges, and decrypts the response', async () => {
  __resetSessionCaches();
  const canned = new Uint8Array([1, 2, 3, 4, 5]);
  const car = new FakeCar({ cannedResponse: canned });
  const session = await openDirectSession({
    transport: car,
    vin: VIN,
    deviceKeys: makeDeviceKeys(),
    domain: DOMAIN_INFOTAINMENT,
  });

  const honk = honkAction();
  const { routable, decryptedPayload } = await sendCommand({
    transport: car,
    session,
    payloadBytes: honk.bytes,
    flags: honk.flags,
  });

  // The car decrypted our command to exactly the honk bytes → command AAD OK.
  assert.deepEqual(new Uint8Array(car.decryptedCommands[0]), new Uint8Array(honk.bytes));
  // And we decrypted its sealed response → response AAD (requestHash) OK.
  assert.deepEqual(decryptedPayload && new Uint8Array(decryptedPayload), canned);
  assert.ok(routable);
  await session.close();
});

// --- (f) counter monotonic --------------------------------------------------

test('sendCommand increments the wire counter on each call', async () => {
  __resetSessionCaches();
  const car = new FakeCar({ counter: 20 });
  const session = await openDirectSession({
    transport: car,
    vin: VIN,
    deviceKeys: makeDeviceKeys(),
    domain: DOMAIN_INFOTAINMENT,
  });
  const honk = honkAction();
  await sendCommand({ transport: car, session, payloadBytes: honk.bytes });
  await sendCommand({ transport: car, session, payloadBytes: honk.bytes });
  // Seed counter was 20; first send uses 21, second 22.
  assert.deepEqual(car.seenCommandCounters, [21, 22]);
  assert.equal(session.counter, 22);
  await session.close();
});

// --- (g) stale-frame throws -------------------------------------------------

test('sendCommand throws on a mismatched request_uuid (stale response)', async () => {
  __resetSessionCaches();
  const car = new FakeCar({ wrongRequestUuid: true });
  const session = await openDirectSession({
    transport: car,
    vin: VIN,
    deviceKeys: makeDeviceKeys(),
    domain: DOMAIN_INFOTAINMENT,
  });
  await assert.rejects(
    sendCommand({ transport: car, session, payloadBytes: honkAction().bytes }),
    /stale response/,
  );
  await session.close();
});

test('sendCommand throws on a from-domain mismatch (stale frame)', async () => {
  __resetSessionCaches();
  const car = new FakeCar({ wrongFromDomain: true });
  const session = await openDirectSession({
    transport: car,
    vin: VIN,
    deviceKeys: makeDeviceKeys(),
    domain: DOMAIN_INFOTAINMENT,
  });
  await assert.rejects(
    sendCommand({ transport: car, session, payloadBytes: honkAction().bytes }),
    /stale frame/,
  );
  await session.close();
});

// --- (h) withCachedSession reuse + refcount ---------------------------------

test('withCachedSession reuses a cached session for the same domain', async () => {
  __resetSessionCaches();
  const car = new FakeCar();
  const deviceKeys = makeDeviceKeys();
  const params = { transport: car, vin: VIN, deviceKeys, domain: DOMAIN_INFOTAINMENT as Domain };

  const seen: boolean[] = [];
  await withCachedSession(params, async (_s, cached) => {
    seen.push(cached);
  });
  await withCachedSession(params, async (_s, cached) => {
    seen.push(cached);
  });

  // Only ONE handshake / Pi openSession across two calls.
  assert.equal(car.openCount, 1);
  assert.deepEqual(seen, [false, true]);
  closeAllCachedSessions();
});

test('closeCachedSession evicts ONE domain and leaves the other cached', async () => {
  // The whole point of the narrow evict: the VCSEC session is where the
  // passive-entry responder lives, so a caller that wants a fresh infotainment
  // handshake must not take walk-up unlock down with it. Measured 2026-07-27 —
  // the nav bench cleared both and produced a run of
  // `auth DROPPED (no live VCSEC session)` for an entire test session.
  __resetSessionCaches();
  const car = new FakeCar();
  const deviceKeys = makeDeviceKeys();
  const vcsec = { transport: car, vin: VIN, deviceKeys, domain: DOMAIN_VEHICLE_SECURITY as Domain };
  const info = { transport: car, vin: VIN, deviceKeys, domain: DOMAIN_INFOTAINMENT as Domain };

  await withCachedSession(vcsec, async () => {});
  await withCachedSession(info, async () => {});

  closeCachedSession(DOMAIN_INFOTAINMENT);

  // Infotainment must re-handshake...
  const infoCached: boolean[] = [];
  await withCachedSession(info, async (_s, cached) => {
    infoCached.push(cached);
  });
  assert.deepEqual(infoCached, [false], 'evicted domain should NOT be cached');

  // ...while VCSEC is untouched and still warm.
  const vcsecCached: boolean[] = [];
  await withCachedSession(vcsec, async (_s, cached) => {
    vcsecCached.push(cached);
  });
  assert.deepEqual(vcsecCached, [true], 'VCSEC must survive an infotainment evict');

  closeAllCachedSessions();
});

test('both domains share one Pi session; closeSession fires only after the last release', async () => {
  __resetSessionCaches();
  const car = new FakeCar();
  const deviceKeys = makeDeviceKeys();

  await withCachedSession(
    { transport: car, vin: VIN, deviceKeys, domain: DOMAIN_VEHICLE_SECURITY },
    async () => {},
  );
  await withCachedSession(
    { transport: car, vin: VIN, deviceKeys, domain: DOMAIN_INFOTAINMENT },
    async () => {},
  );

  // Second domain reused the same Pi sessionId (refcount 2), so only one open.
  assert.equal(car.openCount, 1);
  assert.equal(car.closeCount, 0);

  // VIN-scoped evict releases BOTH cached domains; the Pi DELETE only fires
  // when the refcount reaches 0 — exactly once.
  await evictSession(VIN, DOMAIN_VEHICLE_SECURITY);
  assert.equal(car.closeCount, 1);
});

test('concurrent binds for the same VIN share ONE Pi openSession (in-flight dedup)', async () => {
  __resetSessionCaches();
  const car = new FakeCar();
  const deviceKeys = makeDeviceKeys();

  // Two domains bind CONCURRENTLY (the poll tick + the event-stream reconnect
  // racing in the same moment) before either has populated _domainCache. On the
  // single-session Pi a second open would preempt/kill the first mid-use, so
  // this must collapse to exactly one openSession.
  await Promise.all([
    withCachedSession(
      { transport: car, vin: VIN, deviceKeys, domain: DOMAIN_VEHICLE_SECURITY },
      async () => {},
    ),
    withCachedSession(
      { transport: car, vin: VIN, deviceKeys, domain: DOMAIN_INFOTAINMENT as Domain },
      async () => {},
    ),
  ]);

  assert.equal(car.openCount, 1);
  closeAllCachedSessions();
});

// --- (i) peekPiSessionId — non-opening session-id peek ----------------------

test('peekPiSessionId returns null when no session is cached for the VIN', () => {
  __resetSessionCaches();
  assert.equal(peekPiSessionId(VIN), null);
});

test('peekPiSessionId surfaces the cached Pi sessionId WITHOUT opening a new one', async () => {
  __resetSessionCaches();
  const car = new FakeCar();
  const deviceKeys = makeDeviceKeys();
  await withCachedSession(
    { transport: car, vin: VIN, deviceKeys, domain: DOMAIN_INFOTAINMENT as Domain },
    async () => {},
  );

  assert.equal(peekPiSessionId(VIN), 'pi-sess-1');
  // Purely a read — no additional Pi-side open.
  assert.equal(car.openCount, 1);

  // A different VIN has no cached session.
  assert.equal(peekPiSessionId('5YJ3E1EA1AAAA9999'), null);

  closeAllCachedSessions();
  assert.equal(peekPiSessionId(VIN), null);
});

// --- action builders sanity -------------------------------------------------

test('honkAction / vcsecGetStatusAction target the right domains + flags', () => {
  const honk = honkAction();
  assert.equal(honk.domain, DOMAIN_INFOTAINMENT);
  assert.deepEqual(
    new Uint8Array(honk.bytes),
    new Uint8Array(encodeInfotainmentAction({ vehicleControlHonkHornAction: {} })),
  );
  assert.ok(honk.flags === undefined || honk.flags === 0);

  const status = vcsecGetStatusAction();
  assert.equal(status.domain, DOMAIN_VEHICLE_SECURITY);
  assert.equal(status.flags, 1 << 1);
  assert.deepEqual(
    new Uint8Array(status.bytes),
    new Uint8Array(encodeVCSECMessage({ InformationRequest: { informationRequestType: 0 } })),
  );
});

// --- KEY_NOT_ON_WHITELIST detection -----------------------------------------

test('a car reporting KEY_NOT_ON_WHITELIST throws a typed, non-retryable error', async () => {
  __resetSessionCaches();
  const { KeyNotOnWhitelistError, SESSION_INFO_STATUS_KEY_NOT_ON_WHITELIST } = await import('./session');

  // The value must match the proto, or we would silently never detect it.
  assert.equal(SESSION_INFO_STATUS_KEY_NOT_ON_WHITELIST, 1);

  const err = new KeyNotOnWhitelistError();
  assert.equal(err.needsReEnrollment, true, 'callers can branch on this without string matching');
  assert.match(err.message, /re-enroll/i, 'the message tells the user the ONLY thing that fixes it');
  assert.equal(err.name, 'KeyNotOnWhitelistError');

  // It must NOT look like a transport-dead / stale-frame error, or the gateway
  // would evict-and-retry forever against a car that will never accept the key.
  assert.equal(isTransportDeadError(err), false, 'not a transport fault — retrying cannot fix it');
  assert.equal(isStaleFrameError(err), false);
});

// ── Typed errors win over message text ──────────────────────────────────────

test('isTransportDeadError: a typed kind decides, whatever the message says', () => {
  const typed = (kind: string, message: string) => Object.assign(new Error(message), { kind });

  assert.equal(isTransportDeadError(typed('session-gone', 'whatever')), true);
  assert.equal(isTransportDeadError(typed('ble', 'whatever')), true);
  // These all contain "BLE connection closed" or "not connected". A substring
  // match used to turn each one into a dead link, and so a retry.
  assert.equal(isTransportDeadError(typed('auth', 'BLE connection closed')), false);
  assert.equal(isTransportDeadError(typed('unreachable', 'all transports failed — BLE connection closed')), false);
  assert.equal(isTransportDeadError(typed('cancelled', 'not connected')), false);
  // Untyped errors keep the substring fallback.
  assert.equal(isTransportDeadError(new Error('BLE connection closed')), true);
});

// ── A retired generation leaves nothing behind ──────────────────────────────

test('withCachedSession: a session opened by a retired generation is closed, never cached', async () => {
  __resetSessionCaches();
  const lifetime = new AbortController();
  const car = new FakeCar();
  const retireDuringHandshake = {
    openSession: (vin: string) => car.openSession(vin),
    closeSession: (id: string) => car.closeSession(id),
    exchange: async (id: string, payload: string, timeoutMs: number) => {
      const response = await car.exchange(id, payload, timeoutMs);
      lifetime.abort();
      return response;
    },
  };
  const deviceKeys = makeDeviceKeys();
  let bodyRan = false;

  await assert.rejects(
    withCachedSession(
      {
        transport: retireDuringHandshake,
        vin: VIN,
        deviceKeys,
        domain: DOMAIN_VEHICLE_SECURITY,
        lifetime: lifetime.signal,
      },
      async () => {
        bodyRan = true;
      },
    ),
    (e: unknown) => (e as { kind?: unknown }).kind === 'cancelled',
  );

  assert.equal(bodyRan, false);
  assert.equal(car.closeCount, 1, 'the link it opened is released');
  assert.equal(peekPiSessionId(VIN), null, 'and nothing is left in the cache for the next generation');
});

test('withCachedSession: a retired generation does not evict or re-open after a dead link', async () => {
  __resetSessionCaches();
  const lifetime = new AbortController();
  const car = new FakeCar();
  const deviceKeys = makeDeviceKeys();
  const params = {
    transport: car,
    vin: VIN,
    deviceKeys,
    domain: DOMAIN_VEHICLE_SECURITY,
    lifetime: lifetime.signal,
  };
  await withCachedSession(params, async () => {});
  assert.equal(car.openCount, 1);

  await assert.rejects(
    withCachedSession(params, async () => {
      lifetime.abort();
      throw new Error('closed pipe');
    }),
    /closed pipe/,
  );

  assert.equal(car.openCount, 1, 'no fresh handshake on behalf of a retired generation');
  assert.equal(peekPiSessionId(VIN) !== null, true, 'the cache is left for retireGeneration to clear');
});

// ── A revoked token ─────────────────────────────────────────────────────────
//
// A 401 means the bearer is dead, so every session cached through it is useless,
// and the Pi has already closed them. Leaving one cached is not harmless: the app
// treats a cached session as "the relay is up", so the event stream reconnected
// every ~2.5s for as long as the app stayed open (seen on-device 2026-11-07).

const unauthorized = () => Object.assign(new Error('unauthorized'), { kind: 'auth' });

test('withCachedSession: a 401 drops the cached session and does not open another', async () => {
  __resetSessionCaches();
  const car = new FakeCar();
  const params = { transport: car, vin: VIN, deviceKeys: makeDeviceKeys(), domain: DOMAIN_VEHICLE_SECURITY };
  await withCachedSession(params, async () => {});
  assert.notEqual(peekPiSessionId(VIN), null);

  await assert.rejects(
    withCachedSession(params, async () => {
      throw unauthorized();
    }),
    (e: unknown) => (e as { kind?: unknown }).kind === 'auth',
  );

  assert.equal(peekPiSessionId(VIN), null);
  assert.equal(car.openCount, 1, 're-opening cannot fix a dead token');
});

test('withCachedSession: a 401 on one domain drops them all, since they share the bearer', async () => {
  __resetSessionCaches();
  const car = new FakeCar();
  const deviceKeys = makeDeviceKeys();
  const common = { transport: car, vin: VIN, deviceKeys };
  await withCachedSession({ ...common, domain: DOMAIN_VEHICLE_SECURITY }, async () => {});
  await withCachedSession({ ...common, domain: DOMAIN_INFOTAINMENT }, async () => {});

  await assert.rejects(
    withCachedSession({ ...common, domain: DOMAIN_INFOTAINMENT }, async () => {
      throw unauthorized();
    }),
  );

  assert.equal(peekPiSessionId(VIN), null);
});

test('withCachedSession: a 401 during a second domain\'s handshake drops the first domain too', async () => {
  __resetSessionCaches();
  const car = new FakeCar();
  let revoked = false;
  const transport = {
    openSession: (vin: string) => car.openSession(vin),
    closeSession: (id: string) => car.closeSession(id),
    exchange: async (id: string, payload: string, timeoutMs: number) => {
      if (revoked) throw unauthorized();
      return car.exchange(id, payload, timeoutMs);
    },
  };
  const deviceKeys = makeDeviceKeys();
  const common = { transport, vin: VIN, deviceKeys };
  await withCachedSession({ ...common, domain: DOMAIN_VEHICLE_SECURITY }, async () => {});

  revoked = true;
  await assert.rejects(withCachedSession({ ...common, domain: DOMAIN_INFOTAINMENT }, async () => {}));

  assert.equal(peekPiSessionId(VIN), null);
});

test('withCachedSession: other failures keep the session, as they did before', async () => {
  __resetSessionCaches();
  const car = new FakeCar();
  const params = { transport: car, vin: VIN, deviceKeys: makeDeviceKeys(), domain: DOMAIN_VEHICLE_SECURITY };
  await withCachedSession(params, async () => {});

  await assert.rejects(
    withCachedSession(params, async () => {
      throw Object.assign(new Error('Pi-side timeout'), { kind: 'timeout' });
    }),
  );

  assert.notEqual(peekPiSessionId(VIN), null);
});

test('withCachedSession: a retired generation\'s 401 leaves the cache alone', async () => {
  __resetSessionCaches();
  const lifetime = new AbortController();
  const car = new FakeCar();
  const params = {
    transport: car,
    vin: VIN,
    deviceKeys: makeDeviceKeys(),
    domain: DOMAIN_VEHICLE_SECURITY,
    lifetime: lifetime.signal,
  };
  await withCachedSession(params, async () => {});

  await assert.rejects(
    withCachedSession(params, async () => {
      lifetime.abort();
      throw unauthorized();
    }),
  );

  assert.notEqual(peekPiSessionId(VIN), null, 'it may by now belong to the next generation');
});
