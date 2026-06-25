import test from 'node:test';
import assert from 'node:assert/strict';

import { createMemoryBackend, load, makeSaver } from './persistence';

test('load returns the fallback for a missing key', async () => {
  const s = createMemoryBackend();
  assert.deepEqual(await load(s, 'missing', { a: 1 }), { a: 1 });
});

test('load returns the stored value', async () => {
  const s = createMemoryBackend();
  await s.setItem('k', JSON.stringify({ a: 2 }));
  assert.deepEqual(await load(s, 'k', { a: 1 }), { a: 2 });
});

test('load returns the fallback on corrupt JSON', async () => {
  const s = createMemoryBackend();
  await s.setItem('k', 'not json{');
  assert.deepEqual(await load(s, 'k', { a: 1 }), { a: 1 });
});

test('makeSaver persists the latest value once after the debounce window', async () => {
  const s = createMemoryBackend();
  const save = makeSaver<{ n: number }>(s, 'k', 5);
  save({ n: 1 });
  save({ n: 2 });
  save({ n: 3 });
  await new Promise((r) => setTimeout(r, 25));
  assert.deepEqual(await load(s, 'k', { n: 0 }), { n: 3 });
});
