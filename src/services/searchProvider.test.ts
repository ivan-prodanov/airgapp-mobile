import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runSearch, type SearchDeps } from './searchProvider';
import type { Place, SearchRegion } from './place';

const REGION: SearchRegion = { latitude: 42.7, longitude: 23.3, latitudeDelta: 0.5, longitudeDelta: 0.5 };
const place = (over: Partial<Place>): Place => ({
  id: 'x', title: 'X', coordinate: { latitude: 42.7, longitude: 23.3 }, kind: 'city', source: 'gazetteer', ...over,
});

const baseDeps = (over: Partial<SearchDeps> = {}): SearchDeps => ({
  localSearch: () => [],
  appleComplete: async () => [],
  recents: () => [place({ id: 'recent', source: 'recent', kind: 'recent' })],
  ...over,
});

test('empty query returns recents', async () => {
  const out = await runSearch('   ', REGION, baseDeps());
  assert.deepEqual(out.map((p) => p.id), ['recent']);
});

test('merges local + apple results', async () => {
  const deps = baseDeps({
    localSearch: () => [place({ id: 'l', title: 'Sofia' })],
    appleComplete: async () => [place({ id: 'a', title: 'Kaufland', source: 'apple', coordinate: null, kind: 'poi' })],
  });
  const out = await runSearch('so', REGION, deps);
  assert.deepEqual(out.map((p) => p.id).sort(), ['a', 'l']);
});

test('offline: appleComplete rejection degrades to local-only', async () => {
  const deps = baseDeps({
    localSearch: () => [place({ id: 'l', title: 'Sofia' })],
    appleComplete: async () => { throw new Error('offline'); },
  });
  const out = await runSearch('so', REGION, deps);
  assert.deepEqual(out.map((p) => p.id), ['l']);
});

test('localSearch receives the NORMALIZED query', async () => {
  let seen = '';
  const deps = baseDeps({ localSearch: (q) => { seen = q; return []; } });
  await runSearch('  Sófia ', REGION, deps);
  assert.equal(seen, 'sofia');
});
