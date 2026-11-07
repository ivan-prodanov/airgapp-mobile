// generation.test.ts — a gateway generation must END when it is retired.
//
// Measured on-device 2026-11-07: after replacing the relay token it took ~45s to
// reconnect, with the new token valid and the radio free. The previous gateway's
// retry loop kept running after reload(): it held the shared command queue for
// ~12s, and later found the NEW generation's cached session, called its own dead
// selector, classified the resulting "no active transport" as `unreachable`, and
// evicted the session that was working.
//
// Everything below runs the REAL gateway, session cache, queue and selector. Only
// the leaf transports are fake, with timings from that device log.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isCancelledError } from './cancelled';
import { ConnectWaiters } from './connectWaiters';
import { createCarGateway } from './gateway';
import { wrapPiClient } from './piSessionOrphan';
import { __resetSessionCaches, closeAllCachedSessions, peekPiSessionId } from './session';
import { SessionQueue, sharedSessionQueue } from './queue';
import { bleWaitBudgetMs, createSelectingTransport } from './transportSelector';
import { TransportError } from './transport';
import type { CarTransport, SecretStore } from './types';
import { FakeCar, VIN, makeDeviceKeys } from './__testutils__/fakeCar';

const PREFER_PI = { preferred: () => 'pi' };

const never = <T>(lifetime?: AbortSignal): Promise<T> =>
  new Promise<T>((_, reject) => {
    lifetime?.addEventListener('abort', () => reject(new TransportError('cancelled', 'request cancelled')));
  });

// ── The old generation stops ────────────────────────────────────────────────

test('retiring a generation ends its in-flight read at once and frees the queue', async () => {
  __resetSessionCaches();
  const lifetime = new AbortController();
  const hungPi: CarTransport = {
    openSession: () => never<string>(lifetime.signal),
    exchange: () => never<string>(lifetime.signal),
    closeSession: async () => {},
  };
  const oldGateway = createCarGateway({
    transport: createSelectingTransport([{ name: 'pi', make: () => hungPi }], undefined, {
      ...PREFER_PI,
      lifetime: lifetime.signal,
    }),
    vin: VIN,
    deviceKeys: makeDeviceKeys(),
    lifetime: lifetime.signal,
  });

  const oldRead = oldGateway.readVcsecStatus();
  await new Promise((r) => setTimeout(r, 5));
  lifetime.abort();
  await assert.rejects(oldRead, isCancelledError, 'a retired read reports as cancelled, not as a failure');

  // The queue is the thing the old loop was holding. A new generation must run now.
  const car = new FakeCar();
  const newGateway = createCarGateway({ transport: car, vin: VIN, deviceKeys: makeDeviceKeys() });
  const outcome = await newGateway.runCommand({ type: 'lock' });
  assert.equal(outcome.ok, true);
});

test('a job the retired generation had QUEUED never reaches the transport', async () => {
  __resetSessionCaches();
  const lifetime = new AbortController();
  const car = new FakeCar();
  const gateway = createCarGateway({
    transport: car,
    vin: VIN,
    deviceKeys: makeDeviceKeys(),
    lifetime: lifetime.signal,
  });

  // Something else owns the queue while the job waits behind it.
  let release = () => {};
  const occupant = sharedSessionQueue.enqueue(VIN, () => new Promise<void>((r) => (release = r)));

  const queuedCommand = gateway.runCommand({ type: 'lock' });
  const queuedSync = gateway.awakeSync({ states: ['charge'] });
  lifetime.abort();
  release();
  await occupant;

  const outcome = await queuedCommand;
  assert.equal(outcome.ok === false && outcome.kind, 'cancelled');
  await assert.rejects(queuedSync, isCancelledError);
  assert.equal(car.openCount, 0, 'no session was opened on behalf of a retired generation');
});

test('a retired gateway never evicts the session a newer generation is using', async () => {
  __resetSessionCaches();
  const lifetime = new AbortController();
  const oldCar = new FakeCar();
  const oldGateway = createCarGateway({
    transport: oldCar,
    vin: VIN,
    deviceKeys: makeDeviceKeys(),
    lifetime: lifetime.signal,
  });
  lifetime.abort();

  const newCar = new FakeCar();
  const keys = makeDeviceKeys();
  const newGateway = createCarGateway({ transport: newCar, vin: VIN, deviceKeys: keys });
  assert.equal((await newGateway.runCommand({ type: 'lock' })).ok, true);

  const outcome = await oldGateway.runCommand({ type: 'lock' });
  assert.equal(outcome.ok === false && outcome.kind, 'cancelled');
  assert.equal(newCar.closeCount, 0, 'the working session must survive');

  assert.equal((await newGateway.runCommand({ type: 'lock' })).ok, true);
  assert.equal(newCar.openCount, 1, 'and be reused, not re-opened');
});

test('an attempt that fails after retiring does not evict what a newer generation cached', async () => {
  __resetSessionCaches();
  const keys = makeDeviceKeys();

  // The new generation has a working session in the shared cache.
  const newCar = new FakeCar();
  const newGateway = createCarGateway({ transport: newCar, vin: VIN, deviceKeys: keys });
  assert.equal((await newGateway.runCommand({ type: 'lock' })).ok, true);

  // The old generation's attempt is still out on the wire, and comes back failing
  // once it has been retired. Its own queue, so the two can truly overlap.
  const lifetime = new AbortController();
  let failOldExchange = (_e: Error) => {};
  const oldTransport: CarTransport = {
    openSession: async () => 'old-session',
    exchange: () => new Promise<string>((_, reject) => (failOldExchange = reject)),
    closeSession: async () => {},
  };
  const oldGateway = createCarGateway({
    transport: oldTransport,
    vin: VIN,
    deviceKeys: keys,
    queue: new SessionQueue(),
    lifetime: lifetime.signal,
  });
  const oldCommand = oldGateway.runCommand({ type: 'lock' });
  await new Promise((r) => setTimeout(r, 5));

  lifetime.abort();
  failOldExchange(new Error('closed pipe'));

  assert.equal((await oldCommand).ok === false, true);
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(newCar.closeCount, 0, 'the working session must survive');
  assert.equal((await newGateway.runCommand({ type: 'lock' })).ok, true);
  assert.equal(newCar.openCount, 1);
});

test('a Pi request in flight is cancelled through wrapPiClient', async (t) => {
  const store: SecretStore = {
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  };
  const realFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = realFetch;
  });
  globalThis.fetch = ((_url: string, init: { signal: AbortSignal }) =>
    new Promise((_, reject) => {
      init.signal.addEventListener('abort', () => {
        const e = new Error('aborted');
        e.name = 'AbortError';
        reject(e);
      });
    })) as unknown as typeof fetch;

  const lifetime = new AbortController();
  const pi = wrapPiClient({ baseUrl: 'https://relay.example.ts.net', token: 't' }, store, lifetime.signal);
  const opening = pi.openSession(VIN);
  lifetime.abort();
  await assert.rejects(opening, isCancelledError);
});

// ── Errors keep their meaning through the selector ──────────────────────────

test('a revoked token through the selector is terminal: one attempt, kind=auth', async () => {
  __resetSessionCaches();
  let piOpens = 0;
  const revokedPi: CarTransport = {
    openSession: async () => {
      piOpens += 1;
      throw new TransportError('auth', 'unauthorized', 401);
    },
    exchange: async () => {
      throw new TransportError('auth', 'unauthorized', 401);
    },
    closeSession: async () => {},
  };
  const deadBle: CarTransport = {
    openSession: async () => {
      throw new Error('BLE connection closed — native central did not connect within 0ms');
    },
    exchange: async () => {
      throw new Error('not connected');
    },
    closeSession: async () => {},
  };
  const gateway = createCarGateway({
    transport: createSelectingTransport(
      [
        { name: 'ble', make: () => deadBle },
        { name: 'pi', make: () => revokedPi },
      ],
      undefined,
      PREFER_PI,
    ),
    vin: VIN,
    deviceKeys: makeDeviceKeys(),
    sleep: async () => {},
  });

  const outcome = await gateway.runCommand({ type: 'lock' });

  assert.equal(outcome.ok === false && outcome.kind, 'auth');
  assert.equal(piOpens, 1, 'a re-handshake cannot fix a revoked token');
});

// The relay as it looks to a phone whose token has just been removed.
function revocableRelay(car: FakeCar) {
  const relay = {
    revoked: false,
    openAttempts: 0,
    transport: {
      openSession: async (vin: string) => {
        relay.openAttempts += 1;
        if (relay.revoked) throw new TransportError('auth', 'unauthorized', 401);
        return car.openSession(vin);
      },
      exchange: async (id: string, payload: string, timeoutMs: number) => {
        if (relay.revoked) throw new TransportError('auth', 'unauthorized', 401);
        return car.exchange(id, payload, timeoutMs);
      },
      closeSession: async (id: string) => {
        if (relay.revoked) throw new TransportError('auth', 'unauthorized', 401);
        await car.closeSession(id);
      },
    } as CarTransport,
  };
  return relay;
}

test('a token removed mid-session leaves nothing cached, so the event stream stops retrying', async () => {
  __resetSessionCaches();
  const relay = revocableRelay(new FakeCar());
  const gateway = createCarGateway({ transport: relay.transport, vin: VIN, deviceKeys: makeDeviceKeys() });
  assert.equal((await gateway.runCommand({ type: 'lock' })).ok, true);
  assert.notEqual(peekPiSessionId(VIN), null);

  relay.revoked = true;
  const outcome = await gateway.runCommand({ type: 'lock' });

  assert.equal(outcome.ok === false && outcome.kind, 'auth');
  // useCarLink's scheduleReconnect stops when this is null.
  assert.equal(peekPiSessionId(VIN), null);
  assert.equal(relay.openAttempts, 1, 'a 401 is still not retried');
});

test('the read path that skips the retry loop also drops the session on a 401', async () => {
  __resetSessionCaches();
  const relay = revocableRelay(new FakeCar());
  const gateway = createCarGateway({ transport: relay.transport, vin: VIN, deviceKeys: makeDeviceKeys() });
  assert.equal((await gateway.runCommand({ type: 'lock' })).ok, true);

  relay.revoked = true;
  await assert.rejects(gateway.awakeSync({ states: ['charge'] }));

  assert.equal(peekPiSessionId(VIN), null);
});

test('a dropped session comes back by itself once the relay accepts the phone again', async () => {
  __resetSessionCaches();
  const relay = revocableRelay(new FakeCar());
  const gateway = createCarGateway({ transport: relay.transport, vin: VIN, deviceKeys: makeDeviceKeys() });
  assert.equal((await gateway.runCommand({ type: 'lock' })).ok, true);
  relay.revoked = true;
  assert.equal((await gateway.runCommand({ type: 'lock' })).ok, false);
  assert.equal(peekPiSessionId(VIN), null);

  relay.revoked = false;

  // syncStream starts the stream on whatever session this leaves cached.
  assert.equal((await gateway.runCommand({ type: 'lock' })).ok, true);
  assert.notEqual(peekPiSessionId(VIN), null);
});

test('everything unreachable is capped by the evict budget, not retried to the deadline', async () => {
  __resetSessionCaches();
  let bleOpens = 0;
  const deadBle: CarTransport = {
    openSession: async () => {
      bleOpens += 1;
      throw new Error('BLE connection closed — native central did not connect within 6000ms');
    },
    exchange: async () => {
      throw new Error('not connected');
    },
    closeSession: async () => {},
  };
  const gateway = createCarGateway({
    transport: createSelectingTransport([{ name: 'ble', make: () => deadBle }]),
    vin: VIN,
    deviceKeys: makeDeviceKeys(),
    sleep: async () => {},
  });

  const outcome = await gateway.runCommand({ type: 'lock' });

  assert.equal(outcome.ok === false && outcome.kind, 'unreachable');
  assert.equal(bleOpens, 3, '1 attempt + 2 evict-retries, each opening once');
});

test('a cached session whose selector lost its transport re-opens on the same attempt', async () => {
  __resetSessionCaches();
  const car = new FakeCar();
  const selector = createSelectingTransport([{ name: 'pi', make: () => car }]);
  const gateway = createCarGateway({ transport: selector, vin: VIN, deviceKeys: makeDeviceKeys() });
  assert.equal((await gateway.runCommand({ type: 'lock' })).ok, true);

  await selector.closeSession('');

  // A cache miss, not an unreachable car: no evict-retry round, just a fresh open.
  const outcome = await gateway.runCommand({ type: 'lock' });
  assert.deepEqual(outcome, { ok: true, attempts: 1 });
  assert.equal(car.openCount, 2);
});

// ── The whole re-enrol, end to end ──────────────────────────────────────────

test('re-enrol: one open, no eviction, live within seconds of tapping Connect', async () => {
  __resetSessionCaches();
  const SCALE = 20; // Real-scale milliseconds below; each run takes about a second.
  const wait = (realMs: number) => new Promise<void>((r) => setTimeout(r, realMs / SCALE));
  const started = Date.now();
  const elapsed = () => (Date.now() - started) * SCALE;

  // The BLE arm, doing what BridgedBleTransport does: wait for the native link,
  // which stays down throughout, like the car parked beside a relay.
  const bleCandidate = (lifetime: AbortSignal) => ({
    name: 'ble',
    make: (prior: Parameters<typeof bleWaitBudgetMs>[0]) => {
      const budget = bleWaitBudgetMs(prior, { hasPi: true, budgetMs: 6000 }) / SCALE;
      const dead: CarTransport = {
        openSession: async () => {
          await new ConnectWaiters().wait(budget, lifetime);
          return VIN;
        },
        exchange: async () => {
          throw new Error('not connected');
        },
        closeSession: async () => {},
      };
      return dead;
    },
  });

  // Generation 1: the token that has just been removed on the Pi.
  const generation1 = new AbortController();
  const revokedPi: CarTransport = {
    openSession: async () => {
      await wait(490);
      throw new TransportError('auth', 'unauthorized', 401);
    },
    exchange: async () => {
      throw new TransportError('auth', 'unauthorized', 401);
    },
    closeSession: async () => {},
  };
  const selector1 = createSelectingTransport(
    [bleCandidate(generation1.signal), { name: 'pi', make: () => revokedPi }],
    undefined,
    { ...PREFER_PI, lifetime: generation1.signal },
  );
  const oldGateway = createCarGateway({
    transport: selector1,
    vin: VIN,
    deviceKeys: makeDeviceKeys(),
    sleep: wait,
    commandDeadlineMs: 25000 / SCALE,
    lifetime: generation1.signal,
  });

  // The app returns from the camera: the poll starts with the OLD config.
  const oldPoll = oldGateway.readVcsecStatus().catch(() => {});
  await wait(2000);

  // Connect: what useCarLink's retireGeneration + reload do.
  const connectedAt = elapsed();
  closeAllCachedSessions();
  generation1.abort();
  selector1.closeSession('').catch(() => {});

  // Generation 2: the new token, with a free radio.
  const generation2 = new AbortController();
  const car = new FakeCar();
  let piOpens = 0;
  let piCloses = 0;
  const livePi: CarTransport = {
    openSession: async (vin) => {
      piOpens += 1;
      await wait(1950);
      return car.openSession(vin);
    },
    exchange: async (id, payload, timeoutMs) => {
      await wait(400);
      return car.exchange(id, payload, timeoutMs);
    },
    closeSession: async (id) => {
      piCloses += 1;
      await car.closeSession(id);
    },
  };
  const newGateway = createCarGateway({
    transport: createSelectingTransport(
      [bleCandidate(generation2.signal), { name: 'pi', make: () => livePi }],
      undefined,
      { ...PREFER_PI, lifetime: generation2.signal },
    ),
    vin: VIN,
    deviceKeys: makeDeviceKeys(),
    sleep: wait,
    commandDeadlineMs: 25000 / SCALE,
    lifetime: generation2.signal,
  });

  // useEnrolIntake's two kicks.
  let liveAt: number | null = null;
  const kick = async () => {
    const outcome = await newGateway.runCommand({ type: 'wake' });
    if (outcome.ok && liveAt === null) liveAt = elapsed();
    return outcome;
  };
  await wait(700);
  const kick1 = kick();
  await wait(1300);
  const kick2 = kick();
  await Promise.all([oldPoll, kick1, kick2]);

  // Well after the point where the old loop used to come back and evict.
  await wait(14000);
  const later = await kick();

  assert.equal(later.ok, true);
  assert.equal(piOpens, 1, 'one open, not a reconnect after an eviction');
  assert.equal(piCloses, 0, 'nothing tears the working session down');
  assert.ok(liveAt !== null);
  assert.ok(
    (liveAt as number) - connectedAt < 8000,
    `live ${(liveAt as number) - connectedAt}ms after Connect; it took 14510ms in this scenario before the fix`,
  );
});
