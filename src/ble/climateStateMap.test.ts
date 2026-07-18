import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  copMode,
  copTemp,
  keeperToToggles,
  resolveSeat,
  resolveSteeringWheel,
  seatLevel,
} from './climateStateMap.ts';

describe('seatLevel', () => {
  it('maps 0..3 and rejects out-of-range', () => {
    assert.equal(seatLevel(0), 0);
    assert.equal(seatLevel(3), 3);
    assert.equal(seatLevel(4), undefined);
    assert.equal(seatLevel(undefined), undefined);
  });
});

describe('resolveSeat — precedence auto > cool > heat > off', () => {
  it('returns undefined when the car reported nothing (leave the default)', () => {
    assert.equal(resolveSeat(undefined, undefined, undefined), undefined);
  });
  it('auto beats everything', () => {
    assert.deepEqual(resolveSeat(3, 2, true), { mode: 'auto', level: 0 });
  });
  it('cool beats heat', () => {
    assert.deepEqual(resolveSeat(3, 2, false), { mode: 'cool', level: 2 });
  });
  it('heat when no cool/auto', () => {
    assert.deepEqual(resolveSeat(1, 0, undefined), { mode: 'heat', level: 1 });
  });
  it('off when all present but zero', () => {
    assert.deepEqual(resolveSeat(0, 0, false), { mode: 'off', level: 0 });
  });
  it('rear seat (heat only, no cool/auto fields) still resolves', () => {
    assert.deepEqual(resolveSeat(2, undefined, undefined), { mode: 'heat', level: 2 });
  });
});

describe('resolveSteeringWheel — StwHeatLevel off=1 trap', () => {
  it('undefined when nothing reported', () => {
    assert.equal(resolveSteeringWheel(undefined, undefined, undefined), undefined);
  });
  it('auto wins', () => {
    assert.deepEqual(resolveSteeringWheel(true, 3, true), { mode: 'auto', level: 0 });
  });
  it('level Off(=1) is OFF, not level 1', () => {
    assert.deepEqual(resolveSteeringWheel(false, 1, false), { mode: 'off', level: 0 });
  });
  it('level Low(=2)→heat 1, High(=3)→heat 2', () => {
    assert.deepEqual(resolveSteeringWheel(false, 2, false), { mode: 'heat', level: 1 });
    assert.deepEqual(resolveSteeringWheel(false, 3, false), { mode: 'heat', level: 2 });
  });
  it('heater bool true with no level → heat 1', () => {
    assert.deepEqual(resolveSteeringWheel(undefined, undefined, true), { mode: 'heat', level: 1 });
  });
});

describe('keeperToToggles — Party=Camp, Dog=Pet', () => {
  it('Party → camp', () => {
    assert.deepEqual(keeperToToggles({ Party: {} }), { campModeOn: true, petModeOn: false });
  });
  it('Dog → pet', () => {
    assert.deepEqual(keeperToToggles('Dog'), { campModeOn: false, petModeOn: true });
  });
  it('Off/On/Unknown → both false', () => {
    for (const c of [{ Off: {} }, { On: {} }, { Unknown: {} }]) {
      assert.deepEqual(keeperToToggles(c), { campModeOn: false, petModeOn: false });
    }
  });
  it('absent → undefined (leave default)', () => {
    assert.equal(keeperToToggles(undefined), undefined);
  });
});

describe('copMode — FanOnly=noac', () => {
  it('maps the enum', () => {
    assert.equal(copMode(0), 'off');
    assert.equal(copMode(1), 'on');
    assert.equal(copMode(2), 'noac');
    assert.equal(copMode(undefined), undefined);
  });
});

describe('copTemp — Low/Med/High → 30/35/40', () => {
  it('maps and omits Unspecified', () => {
    assert.equal(copTemp(1), '30');
    assert.equal(copTemp(2), '35');
    assert.equal(copTemp(3), '40');
    assert.equal(copTemp(0), undefined);
    assert.equal(copTemp(undefined), undefined);
  });
});
