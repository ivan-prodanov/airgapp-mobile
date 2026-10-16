import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryBackend } from './persistence';
import { toPersisted, loadPersistedFleet, savePersistedFleet } from './fleetStore';
import { vehicleFromConfig } from './fleet';

const cfg = { carModel: 'modelY' as const, exteriorColor: 'Pearl', wheelType: 'Gemini', interiorTrim: 'Black', performance: false };

test('toPersisted captures id/name/vin/appearance and active', () => {
  const fleet = { vehicles: [vehicleFromConfig('veh_1', 'Mine', cfg, '5YJYGDEE9PF000000')], activeId: 'veh_1' };
  const p = toPersisted(fleet);
  assert.equal(p.version, 1);
  assert.equal(p.activeId, 'veh_1');
  assert.deepEqual(p.order[0], { id: 'veh_1', name: 'Mine', vin: '5YJYGDEE9PF000000', config: cfg });
});

test('save then load round-trips', async () => {
  const s = createMemoryBackend();
  const fleet = { vehicles: [vehicleFromConfig('veh_1', 'Mine', cfg)], activeId: 'veh_1' };
  await savePersistedFleet(s, toPersisted(fleet));
  assert.deepEqual(await loadPersistedFleet(s), toPersisted(fleet));
});

test('missing or corrupt payload loads as null, never throws', async () => {
  const s = createMemoryBackend();
  assert.equal(await loadPersistedFleet(s), null);           // nothing stored
  await s.setItem('fleet.v1', '{ not json');
  assert.equal(await loadPersistedFleet(s), null);           // corrupt
  await s.setItem('fleet.v1', JSON.stringify({ version: 2 })); // unknown version
  assert.equal(await loadPersistedFleet(s), null);
});
