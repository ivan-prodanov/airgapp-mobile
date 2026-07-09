import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sharedLocationStore } from './sharedLocationStore';

test('set notifies subscribers; consume returns once then null', () => {
  let fired = 0;
  const unsub = sharedLocationStore.subscribe(() => { fired++; });
  sharedLocationStore.set({ coordinate: { latitude: 1, longitude: 2 }, source: 'apple' });
  assert.equal(fired, 1);
  const first = sharedLocationStore.consume();
  assert.equal(first?.coordinate.latitude, 1);
  assert.equal(sharedLocationStore.consume(), null);
  unsub();
});
