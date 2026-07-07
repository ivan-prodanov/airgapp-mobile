import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  foldAccents, normalizeQuery, dedupePlaces, rankPlaces, mergeResults,
  type Place, type SearchRegion,
} from './place';

const REGION: SearchRegion = { latitude: 42.7, longitude: 23.3, latitudeDelta: 0.5, longitudeDelta: 0.5 };
const p = (over: Partial<Place>): Place => ({
  id: 'x', title: 'X', coordinate: { latitude: 42.7, longitude: 23.3 }, kind: 'city', source: 'gazetteer', ...over,
});

test('foldAccents strips diacritics and lowercases', () => {
  assert.equal(foldAccents('Kranevó'), 'kranevo');
  assert.equal(foldAccents('SOFIA'), 'sofia');
});

test('normalizeQuery trims + folds', () => {
  assert.equal(normalizeQuery('  Sófia '), 'sofia');
});

test('dedupePlaces collapses same title, prefers the one with a coordinate', () => {
  const withCoord = p({ id: 'g', title: 'Sofia', source: 'gazetteer' });
  const noCoord = p({ id: 'a', title: 'Sofia', source: 'apple', coordinate: null });
  const out = dedupePlaces([noCoord, withCoord]);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 'g'); // coordinate-bearing kept
});

test('rankPlaces orders recent < gazetteer/charger < apple, then in-region, then population', () => {
  const apple = p({ id: 'a', source: 'apple', coordinate: null });
  const recent = p({ id: 'r', source: 'recent', kind: 'recent' });
  const farCity = p({ id: 'far', source: 'gazetteer', coordinate: { latitude: 10, longitude: 10 }, population: 9_000_000 });
  const nearCity = p({ id: 'near', source: 'gazetteer', population: 1000 });
  const ranked = rankPlaces([apple, farCity, recent, nearCity], REGION).map((x) => x.id);
  assert.deepEqual(ranked, ['r', 'near', 'far', 'a']);
});

test('mergeResults dedupes, ranks, and caps', () => {
  const local = [p({ id: 'l1', title: 'Aa' }), p({ id: 'l2', title: 'Bb' })];
  const apple = [p({ id: 'a1', title: 'Aa', source: 'apple', coordinate: null })]; // dup of l1 by title
  const out = mergeResults(local, apple, { region: REGION, cap: 12 });
  assert.equal(out.length, 2); // dup collapsed
  assert.ok(!out.some((x) => x.id === 'a1'));
});
