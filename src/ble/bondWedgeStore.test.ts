import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parsePersistedWedge } from './bondWedgeStore';

test('parsePersistedWedge round-trips a real verdict', () => {
  const p = parsePersistedWedge('{"wedged":true,"kind":"peer-removed-bond","at":123}');
  assert.deepEqual(p, { wedged: true, kind: 'peer-removed-bond', at: 123, bleName: null });
});

test('missing / malformed / older-schema storage degrades to no opinion, never throws', () => {
  // This runs at LAUNCH. A throw here would break app start for everyone whose
  // stored blob predates a schema change.
  for (const raw of [null, '', 'not json', '{}', '{"kind":"other"}', '[]']) {
    assert.doesNotThrow(() => parsePersistedWedge(raw));
    assert.equal(parsePersistedWedge(raw), null, `should be null for ${JSON.stringify(raw)}`);
  }
});

test('a stored HEALTHY verdict is still parsed (hydrate decides to ignore it)', () => {
  assert.deepEqual(parsePersistedWedge('{"wedged":false,"kind":"other","at":9}'), {
    wedged: false,
    kind: 'other',
    at: 9,
    bleName: null,
  });
});

test('a stored verdict with no timestamp defaults rather than dropping the wedge', () => {
  const p = parsePersistedWedge('{"wedged":true,"kind":"peer-removed-bond"}');
  assert.equal(p?.wedged, true, 'the WEDGE is the payload; `at` is diagnostics only');
  assert.equal(p?.at, 0);
});

test('the Bluetooth name round-trips — it is only learnable while the link WORKS', () => {
  // Stored even alongside a healthy verdict, because by the time we need it the
  // link is broken and we can no longer ask the peripheral for its name.
  const p = parsePersistedWedge('{"wedged":false,"kind":"other","at":1,"bleName":"\uD83D\uDD11 CHU\u0160KOPEK"}');
  assert.equal(p?.bleName, '🔑 CHUŠKOPEK');
});
