import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { frunkLabelDark, isLightExteriorColor, isLightHSB } from './markerPaint.ts';
import { initialVehicleState, type VehicleViewState } from '../types/vehicleTypes.ts';

describe('isLightHSB (findings §2c, fn #30231 verbatim)', () => {
  it('calls anything brighter than 0.55 light, regardless of hue/sat', () => {
    assert.equal(isLightHSB(0, 1, 0.56), true);
    assert.equal(isLightHSB(200, 1, 0.9), true);
  });

  it('calls anything darker than 0.38 dark', () => {
    assert.equal(isLightHSB(0, 0, 0.37), false);
  });

  it('in the mid band, low saturation reads light', () => {
    assert.equal(isLightHSB(200, 0.29, 0.5), true);
  });

  it('in the mid band with saturation, warm hues are light and cool hues dark', () => {
    assert.equal(isLightHSB(179, 0.5, 0.5), true);
    assert.equal(isLightHSB(180, 0.5, 0.5), false);
  });
});

describe('isLightExteriorColor (findings §2c paint table)', () => {
  it('the user’s case: a WHITE car gets the dark label', () => {
    assert.equal(isLightExteriorColor('White'), true);
    assert.equal(isLightExteriorColor('PearlWhite'), true);
  });

  it('our red Model Y stays on the white label', () => {
    assert.equal(isLightExteriorColor('UltraRed'), false);
    assert.equal(isLightExteriorColor('RedMulticoat'), false);
  });

  it('treats the other light paints as light', () => {
    for (const p of ['Pearl', 'SilkRoadSilver', 'Unknown']) {
      assert.equal(isLightExteriorColor(p), true, p);
    }
  });

  it('treats every listed dark paint as dark', () => {
    for (const p of ['SolidBlack', 'MidnightSilver', 'DeepBlue', 'StealthGrey', 'QuickSilver', 'GarnetRed']) {
      assert.equal(isLightExteriorColor(p), false, p);
    }
  });

  it('defaults null/undefined/empty to LIGHT — their TYPE_NOT_SET/UNKNOWN branch', () => {
    assert.equal(isLightExteriorColor(null), true);
    assert.equal(isLightExteriorColor(undefined), true);
    assert.equal(isLightExteriorColor(''), true);
  });

  it('treats an unlisted paint as dark — their table returns undefined (falsy)', () => {
    assert.equal(isLightExteriorColor('SomeFuturePaint'), false);
  });

  it('is tolerant of separator/case variants of the enum name', () => {
    assert.equal(isLightExteriorColor('PEARL_WHITE'), true);
    assert.equal(isLightExteriorColor('pearl white'), true);
  });
});

describe('frunkLabelDark — tracks the SELECTED colour, not the model default', () => {
  const withCar = (carModel: VehicleViewState['carModel'], exteriorColor: string | null): VehicleViewState => ({
    ...initialVehicleState,
    carModel,
    exteriorColor,
  });

  it('no override → follows the model base paint (Model X base is PearlWhite → dark)', () => {
    assert.equal(frunkLabelDark(withCar('modelX', null)), true);
  });

  it('no override → dark-based models get the white label (Model 3 base GlacierBlue → not dark)', () => {
    assert.equal(frunkLabelDark(withCar('model3', null)), false);
  });

  // THE BUG: selecting white on a dark-default model must flip the label to dark.
  // The old code read vehicleConfigs[carModel] (the base) and ignored the pick, so
  // this returned false (white-on-white) — the reported "other white models".
  it('selecting a white paint on a dark-default model → dark label (was white before the fix)', () => {
    assert.equal(frunkLabelDark(withCar('model3', 'PearlWhite')), true);
    assert.equal(frunkLabelDark(withCar('modelY', 'White')), true);
  });

  // The mirror: selecting a dark paint on Model X (PearlWhite base) must flip to
  // the white label. The old code returned true (dark) regardless — "stuck on that model".
  it('selecting a dark paint on Model X → white label (was dark before the fix)', () => {
    assert.equal(frunkLabelDark(withCar('modelX', 'DeepBlue')), false);
    assert.equal(frunkLabelDark(withCar('modelX', 'SolidBlack')), false);
  });
});
