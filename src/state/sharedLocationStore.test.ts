import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sharedLocationStore } from './sharedLocationStore';

const sample = {
  location: { coordinate: { latitude: 1, longitude: 2 }, name: 'X', source: 'apple' as const },
};

test('set → consume returns the intent once, then null', () => {
  sharedLocationStore.set(sample);
  assert.deepEqual(sharedLocationStore.consume(), sample);
  assert.equal(sharedLocationStore.consume(), null);
});

test('subscribe fires on set', () => {
  let fired = 0;
  const unsub = sharedLocationStore.subscribe(() => { fired++; });
  sharedLocationStore.set(sample);
  assert.equal(fired, 1);
  sharedLocationStore.consume();
  unsub();
});
