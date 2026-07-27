import test from 'node:test';
import assert from 'node:assert/strict';

import { recommendedColdPressure } from './tirePressureText';
import type { TirePressures } from '../types/vehicleTypes';

const base: TirePressures = {
  fl: 2.8, fr: 2.9, rl: 2.9, rr: 2.9,
  rcpFront: null, rcpRear: null,
  hardWarning: { fl: false, fr: false, rl: false, rr: false },
  softWarning: { fl: false, fr: false, rl: false, rr: false },
};

test('equal front/rear reads as ONE number — matching the official app', () => {
  assert.equal(
    recommendedColdPressure({ ...base, rcpFront: 2.9, rcpRear: 2.9 }),
    'Recommended Cold Pressure: 2.9 bar',
  );
});

test('DIFFERENT front/rear says both rather than picking one', () => {
  // Picking one would be wrong for two wheels, on the one screen where a wrong
  // number could send someone to a garage or stop them going.
  assert.equal(
    recommendedColdPressure({ ...base, rcpFront: 2.9, rcpRear: 3.2 }),
    'Recommended Cold Pressure: 2.9 bar front · 3.2 bar rear',
  );
});

test('a single axle is LABELLED, so it is not read as applying to all four', () => {
  assert.equal(
    recommendedColdPressure({ ...base, rcpFront: 2.9 }),
    'Recommended Cold Pressure: 2.9 bar front',
  );
  assert.equal(
    recommendedColdPressure({ ...base, rcpRear: 3.0 }),
    'Recommended Cold Pressure: 3.0 bar rear',
  );
});

test('no recommendation ⇒ null, so the header shows NOTHING', () => {
  // A missing recommendation is not a recommendation of nothing. The caller
  // renders no subtitle rather than a placeholder or a zero.
  assert.equal(recommendedColdPressure(base), null);
});

test('values render to one decimal — 2.9, never 2.9000000000000004', () => {
  // These are proto floats; 32-bit values land on ugly doubles routinely.
  assert.match(recommendedColdPressure({ ...base, rcpFront: 2.9000000000000004, rcpRear: 2.9000000000000004 })!, /2\.9 bar$/);
});
