// transportSelector.test.ts — createSelectingTransport against fake
// CarTransports (plain objects driving a spy-tracked openSession/exchange/
// closeSession). No hardware, no ble-plx, no fetch — see transportSelector.ts's
// header comment for why this module must stay importable from node alone.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createSelectingTransport, type TransportCandidate } from './transportSelector';
import type { CarTransport } from './types';

// --- fake CarTransport ------------------------------------------------------

class FakeTransport implements CarTransport {
  openSessionCalls: string[] = [];
  exchangeCalls: { sessionId: string; payloadB64: string; timeoutMs: number }[] = [];
  closeSessionCalls: string[] = [];

  constructor(private readonly openBehavior: (vin: string) => Promise<string>) {}

  async openSession(vin: string): Promise<string> {
    this.openSessionCalls.push(vin);
    return this.openBehavior(vin);
  }

  async exchange(sessionId: string, payloadB64: string, timeoutMs: number): Promise<string> {
    this.exchangeCalls.push({ sessionId, payloadB64, timeoutMs });
    return `resp-from-${sessionId}`;
  }

  async closeSession(sessionId: string): Promise<void> {
    this.closeSessionCalls.push(sessionId);
  }
}

// makeCandidate builds a TransportCandidate whose make() mints a fresh
// FakeTransport (matching the real contract: "a fresh transport instance"
// per openSession attempt) while collecting every instance it ever created,
// so tests can assert BOTH which candidate was tried/skipped AND which
// specific instance ended up wired as the "active" transport.
function makeCandidate(
  name: string,
  openBehavior: (vin: string) => Promise<string>,
): { candidate: TransportCandidate; instances: FakeTransport[] } {
  const instances: FakeTransport[] = [];
  const candidate: TransportCandidate = {
    name,
    make: () => {
      const t = new FakeTransport(openBehavior);
      instances.push(t);
      return t;
    },
  };
  return { candidate, instances };
}

const succeeds = (id: string) => async () => id;
const fails = (message: string) => async () => {
  throw new Error(message);
};

// --- selection order + routing ----------------------------------------------

test('BLE-first success routes to BLE: ble is used, pi is never even constructed', async () => {
  const ble = makeCandidate('ble', succeeds('ble-sess-1'));
  const pi = makeCandidate('pi', succeeds('pi-sess-1'));
  const selected: string[] = [];

  const t = createSelectingTransport([ble.candidate, pi.candidate], (name) => selected.push(name));

  const id = await t.openSession('5YJ3XYZ');

  assert.equal(id, 'ble-sess-1');
  assert.deepEqual(selected, ['ble']);
  assert.equal(ble.instances.length, 1);
  assert.equal(pi.instances.length, 0, 'pi candidate must not be constructed once ble succeeds');

  await t.exchange('ble-sess-1', 'AAAA', 5000);
  assert.deepEqual(ble.instances[0].exchangeCalls, [{ sessionId: 'ble-sess-1', payloadB64: 'AAAA', timeoutMs: 5000 }]);

  await t.closeSession('ble-sess-1');
  assert.deepEqual(ble.instances[0].closeSessionCalls, ['ble-sess-1']);
});

test('BLE openSession rejects, Pi succeeds: falls back to pi, exchange routes to pi', async () => {
  const ble = makeCandidate('ble', fails('car not found (asleep or out of BLE range?)'));
  const pi = makeCandidate('pi', succeeds('pi-sess-1'));
  const selected: string[] = [];

  const t = createSelectingTransport([ble.candidate, pi.candidate], (name) => selected.push(name));

  const id = await t.openSession('5YJ3XYZ');

  assert.equal(id, 'pi-sess-1');
  assert.deepEqual(selected, ['pi']);
  assert.equal(ble.instances.length, 1, 'ble was tried once and failed');
  assert.equal(pi.instances.length, 1);

  await t.exchange('pi-sess-1', 'BBBB', 3000);
  assert.deepEqual(pi.instances[0].exchangeCalls, [{ sessionId: 'pi-sess-1', payloadB64: 'BBBB', timeoutMs: 3000 }]);
  // The BLE fake that failed openSession must never see an exchange call.
  assert.deepEqual(ble.instances[0].exchangeCalls, []);
});

test('both candidates reject: openSession throws an aggregate error naming both', async () => {
  const ble = makeCandidate('ble', fails('car not found'));
  const pi = makeCandidate('pi', fails('not configured/unreachable'));

  const t = createSelectingTransport([ble.candidate, pi.candidate]);

  await assert.rejects(t.openSession('5YJ3XYZ'), (e: unknown) => {
    assert.ok(e instanceof Error);
    assert.match(e.message, /ble/);
    assert.match(e.message, /car not found/);
    assert.match(e.message, /pi/);
    assert.match(e.message, /not configured\/unreachable/);
    return true;
  });
});

test('empty candidates list throws a clear "no transports configured" error', async () => {
  const t = createSelectingTransport([]);
  await assert.rejects(t.openSession('5YJ3XYZ'), /no transports configured/);
});

// --- re-selection after close -----------------------------------------------

test('after closeSession, a re-open still constructs a fresh instance of the chosen transport', async () => {
  const ble = makeCandidate('ble', succeeds('ble-sess-1'));
  const t = createSelectingTransport([ble.candidate]);
  await t.openSession('5YJ3XYZ');
  await t.closeSession('ble-sess-1');
  await t.openSession('5YJ3XYZ');
  assert.equal(ble.instances.length, 2, 're-open must mint a fresh instance, never reuse the closed one');
});

// --- sticky selection (the perf fix) ----------------------------------------

test('STICKY: once Pi wins (BLE down), later opens try Pi FIRST — BLE is not re-probed every open', async () => {
  const ble = makeCandidate('ble', fails('car not found — out of BLE range'));
  const pi = makeCandidate('pi', succeeds('pi-sess'));
  const selected: string[] = [];
  // reprobeEvery huge so no re-probe interferes with this assertion.
  const t = createSelectingTransport([ble.candidate, pi.candidate], (n) => selected.push(n), {
    reprobeEvery: 100,
  });

  await t.openSession('V'); // cold: declared order → ble fails, pi wins
  await t.closeSession('pi-sess');
  await t.openSession('V'); // sticky: pi first, ble NOT tried
  await t.closeSession('pi-sess');
  await t.openSession('V');

  assert.deepEqual(selected, ['pi', 'pi', 'pi']);
  assert.equal(ble.instances.length, 1, 'BLE tried once (the cold open), then skipped — no repeated 10s timeout');
  assert.equal(pi.instances.length, 3);
});

test('STICKY falls back: if the remembered transport later fails, the other is used', async () => {
  let piUp = true;
  const ble = makeCandidate('ble', succeeds('ble-sess'));
  const pi = makeCandidate('pi', async () => {
    if (piUp) return 'pi-sess';
    throw new Error('pi unreachable');
  });
  const selected: string[] = [];
  // Seed pi as last-good so pi is tried first; BLE is the fallback.
  const t = createSelectingTransport([ble.candidate, pi.candidate], (n) => selected.push(n), {
    reprobeEvery: 100,
    initialLastGood: 'pi',
  });

  await t.openSession('V'); // pi first, pi ok
  assert.deepEqual(selected, ['pi']);
  await t.closeSession('pi-sess');

  piUp = false;
  const id = await t.openSession('V'); // pi first fails → ble
  assert.equal(id, 'ble-sess');
  assert.deepEqual(selected, ['pi', 'ble']);
});

test('RE-PROBE: after reprobeEvery sticky opens the declared order is retried so recovered BLE is picked up', async () => {
  let bleUp = false;
  const ble = makeCandidate('ble', async () => {
    if (bleUp) return 'ble-sess';
    throw new Error('out of range');
  });
  const pi = makeCandidate('pi', succeeds('pi-sess'));
  const selected: string[] = [];
  // reprobeEvery=2: open #1 is the cold declared probe, #2 and #3 are sticky-pi,
  // #4 hits the re-probe (2 sticky opens elapsed) and retries the declared order.
  const t = createSelectingTransport([ble.candidate, pi.candidate], (n) => selected.push(n), {
    reprobeEvery: 2,
  });

  await t.openSession('V');
  await t.closeSession('pi-sess'); // #1 declared: ble fails → pi
  await t.openSession('V');
  await t.closeSession('pi-sess'); // #2 sticky pi
  bleUp = true; // BLE back in range
  await t.openSession('V');
  await t.closeSession('pi-sess'); // #3 STILL sticky pi (not due yet)
  assert.equal(selected[selected.length - 1], 'pi', 'not due for a re-probe yet → still Pi');
  await t.openSession('V'); // #4 re-probe declared order → ble now wins
  assert.equal(selected[selected.length - 1], 'ble', 'the re-probe open must pick BLE back up');
  assert.equal(ble.instances.length, 2, 'BLE constructed only on the cold open + the one re-probe — not every open');
});

test('SEED: initialLastGood makes the very first open try that transport first (skips cold BLE timeout)', async () => {
  const ble = makeCandidate('ble', fails('would time out ~10s'));
  const pi = makeCandidate('pi', succeeds('pi-sess'));
  const selected: string[] = [];
  const t = createSelectingTransport([ble.candidate, pi.candidate], (n) => selected.push(n), {
    initialLastGood: 'pi',
    reprobeEvery: 100,
  });

  await t.openSession('V');
  assert.deepEqual(selected, ['pi']);
  assert.equal(ble.instances.length, 0, 'seeded last-good Pi means BLE is not even constructed on the first open');
});

// --- guard rails --------------------------------------------------------

test('exchange before any openSession throws "no active transport"', async () => {
  const ble = makeCandidate('ble', succeeds('ble-sess-1'));
  const t = createSelectingTransport([ble.candidate]);
  await assert.rejects(t.exchange('nope', 'AAAA', 1000), /no active transport/);
});

test('exchange failures on the chosen transport propagate as-is (not swallowed / no fallback)', async () => {
  const instances: FakeTransport[] = [];
  const candidate: TransportCandidate = {
    name: 'ble',
    make: () => {
      const t = new FakeTransport(succeeds('sess-1'));
      t.exchange = async () => {
        throw new Error('BLE connection closed — write failed');
      };
      instances.push(t);
      return t;
    },
  };
  const t = createSelectingTransport([candidate]);
  await t.openSession('5YJ3XYZ');
  await assert.rejects(t.exchange('sess-1', 'AAAA', 1000), /BLE connection closed/);
});

test('closeSession clears the active transport even when the delegate rejects, so re-selection still happens', async () => {
  const ble = makeCandidate('ble', succeeds('ble-sess-1'));
  ble.candidate.make = () => {
    const inst = new FakeTransport(succeeds('ble-sess-1'));
    inst.closeSession = async () => {
      throw new Error('disconnect failed');
    };
    ble.instances.push(inst);
    return inst;
  };
  const pi = makeCandidate('pi', succeeds('pi-sess-1'));

  const t = createSelectingTransport([ble.candidate, pi.candidate]);
  await t.openSession('5YJ3XYZ');

  await assert.rejects(t.closeSession('ble-sess-1'), /disconnect failed/);

  // Even though closeSession rejected, the selector must have cleared its
  // active transport so the next openSession re-selects from scratch.
  const id = await t.openSession('5YJ3XYZ');
  assert.equal(id, 'ble-sess-1');
  assert.equal(ble.instances.length, 2, 'second openSession must construct a fresh instance, proving re-selection happened');
});
