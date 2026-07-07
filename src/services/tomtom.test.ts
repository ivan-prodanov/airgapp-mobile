import { test } from 'node:test';
import assert from 'node:assert/strict';

import { searchChargersInBounds } from './tomtom';

// With no EXPO_PUBLIC_TOMTOM_API_KEY in the test env, this hits the mock path.
test('searchChargersInBounds returns only stations inside the bounds (mock path)', async () => {
  const car = { latitude: 42.6977, longitude: 23.3219 };
  const { chargers: wide } = await searchChargersInBounds({ north: 42.85, south: 42.55, east: 23.5, west: 23.15 }, car);
  const { chargers: tiny } = await searchChargersInBounds({ north: 42.70, south: 42.695, east: 23.325, west: 23.32 }, car);
  assert.ok(wide.length > tiny.length, 'a wider box contains more stations');
  for (const c of tiny) {
    assert.ok(c.latitude <= 42.70 && c.latitude >= 42.695, 'lat in bounds');
    assert.ok(c.longitude <= 23.325 && c.longitude >= 23.32, 'lon in bounds');
  }
});

test('searchChargersInBounds sorts by distance from the car', async () => {
  const car = { latitude: 42.6977, longitude: 23.3219 };
  const { chargers: list } = await searchChargersInBounds({ north: 42.85, south: 42.55, east: 23.5, west: 23.15 }, car);
  for (let i = 1; i < list.length; i += 1) {
    assert.ok(list[i].distanceM >= list[i - 1].distanceM);
  }
});
