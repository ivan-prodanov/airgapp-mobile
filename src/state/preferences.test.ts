import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_FAVORITES } from './controlActions';
import {
  defaultPreferences,
  favoritesFor,
  preferencesReducer,
  setFavoriteSlot,
} from './preferences';

const V = 'veh-1'; // a vehicle id (activeId)

test('an unseen vehicle falls back to the default favorites', () => {
  assert.deepEqual(favoritesFor(defaultPreferences, V), [...DEFAULT_FAVORITES]);
});

test('replaces the slot when the dropped id is not already a favorite', () => {
  const next = setFavoriteSlot(defaultPreferences, V, 0, 'honk');
  assert.equal(favoritesFor(next, V)[0], 'honk');
  assert.deepEqual(favoritesFor(next, V).slice(1), DEFAULT_FAVORITES.slice(1));
});

test('swaps positions when the dropped id is already a favorite elsewhere', () => {
  // default: ['lock','climate','charging','frunk','vent']; drop 'vent' (idx 4) into slot 0
  const next = setFavoriteSlot(defaultPreferences, V, 0, 'vent');
  assert.equal(favoritesFor(next, V)[0], 'vent');
  assert.equal(favoritesFor(next, V)[4], 'lock'); // displaced 'lock' lands in vent's old slot
});

test('no-op (same reference) when dropping an id onto the slot it already occupies', () => {
  assert.equal(setFavoriteSlot(defaultPreferences, V, 0, 'lock'), defaultPreferences);
});

test('ignores an out-of-range slot index', () => {
  assert.equal(setFavoriteSlot(defaultPreferences, V, 9, 'honk'), defaultPreferences);
  assert.equal(setFavoriteSlot(defaultPreferences, V, -1, 'honk'), defaultPreferences);
});

test('one vehicle’s change does not touch another’s favorites', () => {
  const a = setFavoriteSlot(defaultPreferences, 'veh-A', 0, 'honk');
  const b = setFavoriteSlot(a, 'veh-B', 0, 'vent');
  assert.equal(favoritesFor(b, 'veh-A')[0], 'honk');
  assert.equal(favoritesFor(b, 'veh-B')[0], 'vent');
  // veh-A's other slots stay default, independent of veh-B.
  assert.deepEqual(favoritesFor(b, 'veh-A').slice(1), DEFAULT_FAVORITES.slice(1));
});

test('does not mutate the input', () => {
  const input = { favoritesByVehicle: { [V]: [...DEFAULT_FAVORITES] } };
  const snapshot = [...input.favoritesByVehicle[V]];
  setFavoriteSlot(input, V, 1, 'sentry');
  assert.deepEqual(input.favoritesByVehicle[V], snapshot);
});

test('preferencesReducer dispatches setFavorite for a vehicle', () => {
  const next = preferencesReducer(defaultPreferences, {
    type: 'setFavorite',
    vehicleId: V,
    slotIndex: 2,
    id: 'summon',
  });
  assert.equal(favoritesFor(next, V)[2], 'summon');
});
