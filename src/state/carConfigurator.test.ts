import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveCarModel,
  seatOptionsFor,
  BASE_MODELS,
  INTERIORS_BY_MODEL,
  TRIMS_BY_MODEL,
  colorsFor,
  wheelsFor,
  defaultColorFor,
  defaultWheelFor,
  defaultInteriorFor,
  defaultTrimFor,
  type BodyGen,
} from './carConfigurator';
import { vehicleConfigs } from '../types/vehicleTypes';

const GENS: BodyGen[] = ['new', 'older'];

test('resolveCarModel: new mainline models map to their base CarModel', () => {
  assert.equal(resolveCarModel('modelS', 'new'), 'modelS');
  assert.equal(resolveCarModel('model3', 'new'), 'model3');
  assert.equal(resolveCarModel('modelY', 'new'), 'modelY');
  assert.equal(resolveCarModel('modelX', 'new', 5), 'modelX');
});

test('resolveCarModel: older body maps to the Legacy variant', () => {
  assert.equal(resolveCarModel('modelS', 'older'), 'modelSLegacy');
  assert.equal(resolveCarModel('model3', 'older'), 'model3Legacy');
  assert.equal(resolveCarModel('modelX', 'older'), 'modelXLegacy');
  assert.equal(resolveCarModel('modelY', 'older'), 'modelYLegacy');
});

test('resolveCarModel: Model X seat counts map to the seat variants (new body only)', () => {
  assert.equal(resolveCarModel('modelX', 'new', 6), 'modelX6Seat');
  assert.equal(resolveCarModel('modelX', 'new', 7), 'modelX7Seat');
  assert.equal(resolveCarModel('modelX', 'older', 6), 'modelXLegacy');
});

test('seatOptionsFor: only the new-body Model X exposes 5/6/7', () => {
  assert.deepEqual(seatOptionsFor('modelX', 'new'), [5, 6, 7]);
  assert.deepEqual(seatOptionsFor('modelX', 'older'), []);
  assert.deepEqual(seatOptionsFor('modelY', 'new'), []);
});

test('BASE_MODELS covers exactly the four mainline models with S/3/X/Y labels', () => {
  assert.deepEqual(BASE_MODELS.map((m) => m.label), ['S', '3', 'X', 'Y']);
  assert.deepEqual(BASE_MODELS.map((m) => m.value), ['modelS', 'model3', 'modelX', 'modelY']);
});

test('every (model × generation) has a non-empty exterior palette with hex swatches', () => {
  for (const m of BASE_MODELS) {
    for (const gen of GENS) {
      const colors = colorsFor(m.value, gen);
      assert.ok(colors.length >= 4, `too few colors for ${m.value}/${gen}`);
      for (const c of colors) {
        assert.ok(c.value.length > 0 && c.label.length > 0);
        assert.match(c.swatch, /^#[0-9a-fA-F]{6}$/, `bad swatch: ${c.swatch}`);
      }
    }
  }
});

test('every (model × generation) has a non-empty wheel list', () => {
  for (const m of BASE_MODELS) {
    for (const gen of GENS) {
      const wheels = wheelsFor(m.value, gen);
      assert.ok(wheels.length >= 2, `too few wheels for ${m.value}/${gen}`);
      for (const w of wheels) {
        assert.ok(w.value.length > 0 && w.label.length > 0);
      }
    }
  }
});

// The configurator pre-selects each (model × gen)'s first color/wheel and the
// model's first interior, so those defaults MUST exist in the matching picker —
// else nothing highlights on open, or after a model/body switch.
test('each default color / wheel (per gen) + interior is present in its own list', () => {
  for (const m of BASE_MODELS) {
    const interiorValues = new Set(INTERIORS_BY_MODEL[m.value].map((i) => i.value));
    assert.ok(interiorValues.has(defaultInteriorFor(m.value)), `${m.value} default interior missing`);
    for (const gen of GENS) {
      const colorValues = new Set(colorsFor(m.value, gen).map((c) => c.value));
      assert.ok(colorValues.has(defaultColorFor(m.value, gen)), `${m.value}/${gen} default color missing`);
      const wheelValues = new Set(wheelsFor(m.value, gen).map((w) => w.value));
      assert.ok(wheelValues.has(defaultWheelFor(m.value, gen)), `${m.value}/${gen} default wheel missing`);
    }
  }
});

test('every model has a non-empty interior list with hex swatches', () => {
  for (const m of BASE_MODELS) {
    const interiors = INTERIORS_BY_MODEL[m.value];
    assert.ok(interiors.length >= 2, `too few interiors for ${m.value}`);
    for (const i of interiors) {
      assert.ok(i.value.length > 0 && i.label.length > 0);
      assert.match(i.swatch, /^#[0-9a-fA-F]{6}$/, `bad interior swatch: ${i.swatch}`);
    }
  }
});

// The DEFAULT trim (first entry) is built so its performance flag matches the
// model's own base config (red brake calipers), so the configurator reflects
// whether that model ships as a performance variant.
test('default trim performance matches the model config red_brake_calipers', () => {
  for (const m of BASE_MODELS) {
    assert.equal(
      defaultTrimFor(m.value).performance,
      vehicleConfigs[m.value].vehicle_config.red_brake_calipers,
      `${m.value} default trim perf != config calipers`,
    );
  }
});
