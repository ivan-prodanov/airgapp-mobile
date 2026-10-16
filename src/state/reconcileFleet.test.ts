import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcileFleet } from './reconcileFleet';

const cfg = { carModel: 'modelY' as const, exteriorColor: null, wheelType: null, interiorTrim: null, performance: null };
const demo = (id: string, name: string) => ({ id, name, config: cfg });
const real = (id: string, name: string, vin: string) => ({ id, name, vin, config: cfg });

test('empty persisted + no enrolled → empty fleet', () => {
  const f = reconcileFleet(null, { cars: [], selectedVin: null });
  assert.deepEqual(f, { vehicles: [], activeId: '' });
});

test('demo-only persisted survives with order and active', () => {
  const f = reconcileFleet(
    { version: 1, order: [demo('veh_1', 'A'), demo('veh_2', 'B')], activeId: 'veh_2' },
    { cars: [], selectedVin: null });
  assert.deepEqual(f.vehicles.map((v) => v.id), ['veh_1', 'veh_2']);
  assert.equal(f.activeId, 'veh_2');
  assert.equal(f.vehicles[0].vin, undefined);
});

test('listed real car whose VIN is no longer enrolled is dropped', () => {
  const f = reconcileFleet(
    { version: 1, order: [real('veh_1', 'Gone', 'VIN_GONE_00000000'), demo('veh_2', 'Demo')], activeId: 'veh_1' },
    { cars: [], selectedVin: null });
  assert.deepEqual(f.vehicles.map((v) => v.id), ['veh_2']); // real dropped
  assert.equal(f.activeId, 'veh_2');                         // active fell back
});

test('enrolled car not in the list is appended (out-of-band pair / upgrade)', () => {
  const f = reconcileFleet(null, { cars: [{ vin: '5YJ3E1EA7LF000000' }], selectedVin: '5YJ3E1EA7LF000000' });
  assert.equal(f.vehicles.length, 1);
  assert.equal(f.vehicles[0].vin, '5YJ3E1EA7LF000000');
  assert.equal(f.vehicles[0].state.carModel, 'model3');
  assert.equal(f.activeId, f.vehicles[0].id);
});

test('a listed real car is bound by VIN and kept in place', () => {
  const f = reconcileFleet(
    { version: 1, order: [demo('veh_1', 'Demo'), real('veh_2', 'Mine', '5YJYGDEE9PF000000')], activeId: 'veh_2' },
    { cars: [{ vin: '5YJYGDEE9PF000000' }], selectedVin: '5YJYGDEE9PF000000' });
  assert.deepEqual(f.vehicles.map((v) => v.id), ['veh_1', 'veh_2']);
  assert.equal(f.vehicles[1].vin, '5YJYGDEE9PF000000');
});
