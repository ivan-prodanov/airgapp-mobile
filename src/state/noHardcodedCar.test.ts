import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createInitialFleet } from './fleet';

test('no hardcoded seed car remains', () => {
  assert.deepEqual(createInitialFleet().vehicles, []);
  const fleetSrc = readFileSync(new URL('./fleet.ts', import.meta.url), 'utf8');
  assert.ok(!/Red Velvet/.test(fleetSrc), 'fleet.ts must not hardcode a seed vehicle');
});
