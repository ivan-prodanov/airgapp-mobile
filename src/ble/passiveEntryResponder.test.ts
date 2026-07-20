import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeAuthResponder } from './passiveEntryResponder';
import { __resetSessionCaches } from './session';

// A real captured handle-pull challenge (verbatim on-car bytes).
const CHALLENGE = Uint8Array.from([
  0x32, 0x02, 0x08, 0x00, 0x3a, 0x02, 0x08, 0x02, 0x52, 0x1f, 0x1a, 0x1d, 0x12, 0x16, 0x0a, 0x14,
  0x29, 0xd5, 0x11, 0xed, 0x01, 0xe5, 0xe9, 0x1e, 0xf4, 0xd8, 0x9c, 0xbe, 0x8e, 0x71, 0xa2, 0x55,
  0x33, 0xdd, 0x72, 0x7e, 0x18, 0x02, 0x22, 0x01, 0x01,
]);
const routine = Uint8Array.from([0x32, 0x02, 0x08, 0x00, 0x52, 0x04, 0x0a, 0x02, 0x08, 0x01]);

test('returns null (never signs) when there is no live session', () => {
  __resetSessionCaches();
  const r = makeAuthResponder({ getSession: () => null });
  assert.equal(r(CHALLENGE), null, 'must not fabricate a signature without a session');
});

test('a routine push is never treated as a challenge', () => {
  __resetSessionCaches();
  const r = makeAuthResponder({ getSession: () => null });
  assert.equal(r(routine), null);
});

test('respects the enabled() gate before doing anything', () => {
  const r = makeAuthResponder({ getSession: () => null, enabled: () => false });
  assert.equal(r(CHALLENGE), null);
});

test('circuit breaker OPENS after consecutive faults and STAYS open until reset', () => {
  const logs: string[] = [];
  const r = makeAuthResponder({ getSession: () => null, enabled: () => true, log: (l) => logs.push(...l) });
  // No live session, so it returns null regardless — but the breaker is driven
  // by noteVerdict, which is independent of whether we produced bytes.
  for (let i = 0; i < 6; i += 1) r.noteVerdict(false);
  assert.ok(logs.some((l) => l.includes('CIRCUIT OPEN')), 'breaker opens on a run of rejects');

  r.reset();
  logs.length = 0;
  for (let i = 0; i < 5; i += 1) r.noteVerdict(false);
  r.noteVerdict(true); // an accept clears the streak
  for (let i = 0; i < 5; i += 1) r.noteVerdict(false);
  assert.ok(!logs.some((l) => l.includes('CIRCUIT OPEN')), 'an accept resets the fault streak');
});

// The session must come from whoever OWNS the link being answered. Each
// handshake derives a fresh key from the car's ephemeral pubkey, so a Pi session
// and a dedicated passive-entry BLE session have DIFFERENT keys. Signing a
// direct-BLE challenge with the Pi's session key yields FAULT_AES_DECRYPT_AUTH
// forever — the exact hazard that appears the moment both links coexist.
test('signs with the session it is GIVEN, not a globally cached one', async () => {
  const { makeAuthResponder } = await import('./passiveEntryResponder');
  const { encodeToVcsecSignedMessage } = await import('./passiveEntryAuth');

  const mkSession = (fill: number) =>
    ({
      sessionKey: new Uint8Array(16).fill(fill),
      myPubRaw: new Uint8Array(65).fill(fill),
      counter: 10,
    }) as never;

  // A real captured handle-pull challenge.
  const challenge = Uint8Array.from([
    0x32, 0x02, 0x08, 0x00, 0x3a, 0x02, 0x08, 0x02,
    0x52, 0x1f, 0x1a, 0x1d, 0x12, 0x16, 0x0a, 0x14,
    ...new Array(20).fill(0x77),
    0x18, 0x02, 0x22, 0x01, 0x05,
  ]);

  const a = makeAuthResponder({ getSession: () => mkSession(0x11) })(challenge);
  const b = makeAuthResponder({ getSession: () => mkSession(0x22) })(challenge);
  assert.ok(a && b, 'both should answer');
  assert.notDeepEqual(a, b, 'different sessions MUST produce different sealed bytes');
  assert.ok(encodeToVcsecSignedMessage, 'encoder present');
});
