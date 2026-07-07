import { test } from 'node:test';
import assert from 'node:assert/strict';

import { matchAvailability, type AvailabilityStation } from './chargeprice';
import type { Charger } from './tomtom';

function charger(id: string, latitude: number, longitude: number): Charger {
  return {
    id, name: id, place: '', region: '', latitude, longitude,
    currentType: 'DC', maxPowerKW: 150, totalConnectors: 2, availableConnectors: 2,
    connectors: [], distanceM: 0,
  };
}
function station(latitude: number, longitude: number, available: number, total: number): AvailabilityStation {
  return { latitude, longitude, available, total };
}

test('matchAvailability assigns a station to the nearest charger within radius', () => {
  const chargers = [charger('a', 42.6800, 23.3200), charger('b', 42.7000, 23.3600)];
  // ~10 m from a
  const rec = matchAvailability(chargers, [station(42.68009, 23.32000, 1, 2)]);
  assert.deepEqual(rec, { a: { available: 1, total: 2 } });
});

test('matchAvailability ignores a station beyond the match radius', () => {
  const chargers = [charger('a', 42.6800, 23.3200)];
  // ~500 m away → beyond 120 m radius
  const rec = matchAvailability(chargers, [station(42.6845, 23.3200, 3, 4)]);
  assert.deepEqual(rec, {});
});

test('matchAvailability keeps the closest station when several match one charger', () => {
  const chargers = [charger('a', 42.6800, 23.3200)];
  const rec = matchAvailability(chargers, [
    station(42.68045, 23.3200, 9, 9), // ~50 m
    station(42.68009, 23.3200, 1, 2), // ~10 m (closer)
  ]);
  assert.deepEqual(rec, { a: { available: 1, total: 2 } });
});
