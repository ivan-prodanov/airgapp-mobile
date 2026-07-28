import { test } from 'node:test';
import assert from 'node:assert/strict';

import { bondWedgeStore, parsePersistedWedge, type PersistedWedge } from './bondWedgeStore';

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

// ── the wedge must be CLEARABLE ─────────────────────────────────────────────
//
// Reported on-car 2026-07-28: the Set Up Phone Key card would not go away. The
// key was fine, the phone was bonded, BLE was connected and serving commands —
// and Retry did nothing.
//
// Cause: `noteConnectSuccess` had ZERO callers in the app. The wedge could be
// SET (native peerRemovedPairingInformation, or hydrated from storage) but
// nothing ever cleared it, so it was permanent. Retry called refresh(), which
// re-reads the car without touching the verdict — so it truly could not help.
test('a successful BLE connect clears a wedge, and persists the clear', () => {
  const persisted: PersistedWedge[] = [];
  bondWedgeStore.configure({ persist: (p) => persisted.push(p) });

  bondWedgeStore.noteBondRemoved();
  assert.equal(bondWedgeStore.getSnapshot().wedged, true, 'native signal wedges');
  assert.equal(persisted.at(-1)?.wedged, true, 'a definitive wedge is persisted');

  bondWedgeStore.noteConnectSuccess();
  assert.equal(bondWedgeStore.getSnapshot().wedged, false, 'a working link clears it');
  assert.equal(
    persisted.at(-1)?.wedged,
    false,
    'and the clear is persisted, or a relaunch would resurrect the card',
  );
});

test('repeated successes do not churn the snapshot identity', () => {
  // It is called on EVERY transport open, which is frequent. useSyncExternalStore
  // re-renders on identity change, so an unchanged verdict must return the same
  // object or Home would re-render on every BLE open.
  bondWedgeStore.configure({});
  bondWedgeStore.noteConnectSuccess();
  const a = bondWedgeStore.getSnapshot();
  bondWedgeStore.noteConnectSuccess();
  assert.equal(bondWedgeStore.getSnapshot(), a, 'same reference while nothing changed');
});
