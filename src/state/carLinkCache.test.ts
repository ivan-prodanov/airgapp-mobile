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

test('tirePressures survive a restart — the overlay showed "—" until the car woke', () => {
  // Ivan caught this immediately: the tyre numbers were the ONLY thing on screen
  // that came back empty after a relaunch. Same gap as carLocation the day
  // before, repeated on the very next field added. Anything rendered from
  // telemetry belongs in this cache.
  const storage = memoryStorage();
  const save = makeCarLinkCacheSaver(storage, 'VIN1');
  save({
    lastVehicleDataAt: 1_700_000_000_000,
    batteryLevel: 71, rangeMiles: 210, charging: false, awake: true,
    interiorTempC: 21, exteriorTempC: 14, targetTempC: 21,
    chargeLimitPercent: 80, chargingAmps: 16, carLocation: null,
    tirePressures: {
      fl: 2.8, fr: 2.9, rl: 2.9, rr: 2.9,
      rcpFront: 2.9, rcpRear: 2.9,
      hardWarning: { fl: false, fr: false, rl: false, rr: false },
      softWarning: { fl: true, fr: false, rl: false, rr: false },
    },
  });
  return new Promise((r) => setTimeout(r, 600)).then(async () => {
    const back = await loadCarLinkCache(storage, 'VIN1');
    assert.equal(back?.tirePressures?.fl, 2.8);
    assert.equal(back?.tirePressures?.rcpFront, 2.9);
    assert.equal(back?.tirePressures?.softWarning.fl, true, 'a warning must survive too — it is the reason to look');
  });
});

test('a cache from before TPMS loads cleanly, with null tirePressures', async () => {
  const storage = memoryStorage();
  await storage.setItem(
    carLinkCacheKey('VIN1'),
    JSON.stringify({ lastVehicleDataAt: 1_700_000_000_000, batteryLevel: 50 }),
  );
  const back = await loadCarLinkCache(storage, 'VIN1');
  assert.equal(back?.tirePressures, null, 'absent, not a fabricated set of zeros');
});
