import test from 'node:test';
import assert from 'node:assert/strict';

import { createMemoryBackend } from './persistence';
import { loadCarLinkCache, makeCarLinkCacheSaver, carLinkCacheKey } from './carLinkCache';

const memoryStorage = createMemoryBackend;

test('carLocation survives a restart — the map should not fall back to the user', async () => {
  // Ivan: "when I restart the app the Location is MY location until I swipe down
  // to refresh". Correct, and it made no sense: the native side already persists
  // the car's position (CarRegionMonitor keeps it in UserDefaults for the
  // reboot-survival geofence), so the phone knew where the car was — JS just
  // never wrote it to its own cache.
  const storage = memoryStorage();
  const save = makeCarLinkCacheSaver(storage, 'VIN1');
  save({
    lastVehicleDataAt: 1_700_000_000_000,
    batteryLevel: 71,
    rangeMiles: 210,
    charging: false,
    awake: true,
    interiorTempC: 21,
    exteriorTempC: 14,
    targetTempC: 21,
    chargeLimitPercent: 80,
    chargingAmps: 16,
    carLocation: { lat: 39.9247818, lon: 25.3326435, heading: 269 },
  });
  await new Promise((r) => setTimeout(r, 600)); // the saver is debounced
  const back = await loadCarLinkCache(storage, 'VIN1');
  assert.equal(back?.carLocation?.lat, 39.9247818);
  assert.equal(back?.carLocation?.lon, 25.3326435);
  assert.equal(back?.carLocation?.heading, 269);
});

test('a cache from BEFORE this field loads cleanly, with no location', async () => {
  // Every shipped install has one of these. It must not throw and must not
  // invent a position.
  const storage = memoryStorage();
  await storage.setItem(
    carLinkCacheKey('VIN1'),
    JSON.stringify({ lastVehicleDataAt: 1_700_000_000_000, batteryLevel: 50 }),
  );
  const back = await loadCarLinkCache(storage, 'VIN1');
  assert.equal(back?.batteryLevel, 50);
  assert.equal(back?.carLocation, null, 'absent, not undefined and not 0,0');
});

test('a CORRUPT cached location is dropped, not rendered at 0,0', async () => {
  // The failure this guards against is a map pin in the Gulf of Guinea, which is
  // worse than no pin because it looks like real data.
  const storage = memoryStorage();
  await storage.setItem(
    carLinkCacheKey('VIN1'),
    JSON.stringify({
      lastVehicleDataAt: 1_700_000_000_000,
      carLocation: { lat: null, lon: 'nonsense', heading: 1 },
    }),
  );
  const back = await loadCarLinkCache(storage, 'VIN1');
  assert.equal(back?.carLocation, null);
});
