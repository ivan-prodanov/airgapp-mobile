import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runSearch, RESULT_CAP, type SearchDeps } from './searchProvider';
import type { Place, SearchRegion } from './place';

const REGION: SearchRegion = { latitude: 42.7, longitude: 23.3, latitudeDelta: 0.5, longitudeDelta: 0.5 };
const place = (over: Partial<Place>): Place => ({
  id: 'x', title: 'X', coordinate: { latitude: 42.7, longitude: 23.3 }, kind: 'poi', source: 'apple', ...over,
});
const deps = (over: Partial<SearchDeps> = {}): SearchDeps => ({
  localSearch: () => [],
  appleSearch: async () => [],
  ...over,
});

test('empty query returns no results', async () => {
  assert.deepEqual(await runSearch('   ', REGION, deps()), []);
});

test('online: returns Apple results in Apple order (not re-ranked)', async () => {
  const apple = [place({ id: 'a1', title: 'Vidin' }), place({ id: 'a2', title: 'Vidimeks' })];
  const out = await runSearch('vidi', REGION, deps({ appleSearch: async () => apple }));
  assert.deepEqual(out.map((p) => p.id), ['a1', 'a2']);
});

test('online results are capped at RESULT_CAP', async () => {
  const many = Array.from({ length: RESULT_CAP + 8 }, (_, i) => place({ id: `a${i}` }));
  const out = await runSearch('x', REGION, deps({ appleSearch: async () => many }));
  assert.equal(out.length, RESULT_CAP);
});

test('offline: Apple rejects → ranked local results', async () => {
  const local = [place({ id: 'l', title: 'Sofia', source: 'gazetteer', kind: 'city' })];
  const out = await runSearch('so', REGION, deps({
    appleSearch: async () => { throw new Error('offline'); },
    localSearch: () => local,
  }));
  assert.deepEqual(out.map((p) => p.id), ['l']);
});
