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

test('a structurally-malformed payload loads as null, never throws', async () => {
  const s = createMemoryBackend();
  await s.setItem('fleet.v1', JSON.stringify({ version: 1, order: [null], activeId: null }));
  assert.equal(await loadPersistedFleet(s), null);                 // null entry
  await s.setItem('fleet.v1', JSON.stringify({ version: 1, order: [{ id: 'veh_1' }], activeId: null })); // missing name/config
  assert.equal(await loadPersistedFleet(s), null);
  await s.setItem('fleet.v1', JSON.stringify({ version: 1, order: [{ id: 'v', name: 'n', config: {} }], activeId: null })); // config missing carModel
  assert.equal(await loadPersistedFleet(s), null);
});

test('an unknown or prototype carModel loads as null', async () => {
  const s = createMemoryBackend();
  await s.setItem('fleet.v1', JSON.stringify({ version: 1, order: [{ id: 'v', name: 'n', config: { carModel: 'bogus' } }], activeId: null }));
  assert.equal(await loadPersistedFleet(s), null);
  await s.setItem('fleet.v1', JSON.stringify({ version: 1, order: [{ id: 'v', name: 'n', config: { carModel: 'constructor' } }], activeId: null }));
  assert.equal(await loadPersistedFleet(s), null);
});

test('a real car with a vin round-trips through load', async () => {
  const s = createMemoryBackend();
  const p = toPersisted({ vehicles: [vehicleFromConfig('veh_1', 'Mine', { carModel: 'modelX', exteriorColor: 'DeepBlue', wheelType: 'Turbine', interiorTrim: 'White', performance: true }, '5YJXCBE22HF000000')], activeId: 'veh_1' });
  await savePersistedFleet(s, p);
  const loaded = await loadPersistedFleet(s);
  assert.equal(loaded?.order[0].vin, '5YJXCBE22HF000000');
  assert.equal(loaded?.order[0].config.carModel, 'modelX');
});

test('a non-string activeId coerces to null (well-formed order preserved)', async () => {
  const s = createMemoryBackend();
  const ok = toPersisted({ vehicles: [vehicleFromConfig('veh_1', 'A', { carModel: 'modelY', exteriorColor: null, wheelType: null, interiorTrim: null, performance: null })], activeId: 'veh_1' });
  await s.setItem('fleet.v1', JSON.stringify({ ...ok, activeId: 42 }));
  const loaded = await loadPersistedFleet(s);
  assert.equal(loaded?.activeId, null);
  assert.equal(loaded?.order.length, 1);
});
