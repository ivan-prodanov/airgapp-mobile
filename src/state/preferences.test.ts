import test from 'node:test';
import assert from 'node:assert/strict';

import { defaultPreferences, preferencesReducer, setFavoriteSlot } from './preferences';

test('replaces the slot when the dropped id is not already a favorite', () => {
  const next = setFavoriteSlot(defaultPreferences, 0, 'honk');
  assert.equal(next.favorites[0], 'honk');
  assert.deepEqual(next.favorites.slice(1), defaultPreferences.favorites.slice(1));
});

test('swaps positions when the dropped id is already a favorite elsewhere', () => {
  // default: ['lock','climate','charging','frunk','vent']; drop 'vent' (idx 4) into slot 0
  const next = setFavoriteSlot(defaultPreferences, 0, 'vent');
  assert.equal(next.favorites[0], 'vent');
  assert.equal(next.favorites[4], 'lock'); // displaced 'lock' lands in vent's old slot
});

test('no-op (same reference) when dropping an id onto the slot it already occupies', () => {
  assert.equal(setFavoriteSlot(defaultPreferences, 0, 'lock'), defaultPreferences);
});

test('ignores an out-of-range slot index', () => {
  assert.equal(setFavoriteSlot(defaultPreferences, 9, 'honk'), defaultPreferences);
  assert.equal(setFavoriteSlot(defaultPreferences, -1, 'honk'), defaultPreferences);
});

test('does not mutate the input', () => {
  const input = { favorites: [...defaultPreferences.favorites] };
  const snapshot = [...input.favorites];
  setFavoriteSlot(input, 1, 'sentry');
  assert.deepEqual(input.favorites, snapshot);
});

test('preferencesReducer dispatches setFavorite', () => {
  const next = preferencesReducer(defaultPreferences, { type: 'setFavorite', slotIndex: 2, id: 'summon' });
  assert.equal(next.favorites[2], 'summon');
});
