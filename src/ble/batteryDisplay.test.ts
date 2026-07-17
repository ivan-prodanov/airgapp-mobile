import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  BatteryColors,
  batteryFillColor,
  batteryFillFraction,
  batteryFillWidth,
  batteryLabel,
  batteryTextColor,
} from './batteryDisplay.ts';

describe('batteryFillColor (findings §C5, checked in their priority order)', () => {
  it('is green while charging, whatever the level', () => {
    assert.equal(batteryFillColor(3, true), BatteryColors.charging);
    assert.equal(batteryFillColor(90, true), BatteryColors.charging);
  });

  it('is red at or below 7% (critical)', () => {
    assert.equal(batteryFillColor(7, false), BatteryColors.critical);
    assert.equal(batteryFillColor(0, false), BatteryColors.critical);
  });

  it('is amber from just above critical through 20% (warning)', () => {
    assert.equal(batteryFillColor(8, false), BatteryColors.warning);
    assert.equal(batteryFillColor(20, false), BatteryColors.warning);
  });

  it('is the normal grey above 20%', () => {
    assert.equal(batteryFillColor(21, false), BatteryColors.normalDark);
    assert.equal(batteryFillColor(100, false), BatteryColors.normalDark);
  });

  it('rounds the level before comparing, as they do', () => {
    assert.equal(batteryFillColor(20.4, false), BatteryColors.warning);
    assert.equal(batteryFillColor(20.6, false), BatteryColors.normalDark);
  });
});

describe('batteryTextColor (findings §C5)', () => {
  it('stays grey when low — only the FILL goes amber/red', () => {
    assert.equal(batteryTextColor(false), '#8A8B8B');
  });

  it('turns green only while charging', () => {
    assert.equal(batteryTextColor(true), BatteryColors.charging);
  });
});

describe('battery fill geometry (findings §C3)', () => {
  it('never drops below a 10% floor', () => {
    assert.equal(batteryFillFraction(0), 0.1);
    assert.equal(batteryFillFraction(5), 0.1);
    assert.equal(batteryFillFraction(10), 0.1);
  });

  it('tracks the level above the floor and clamps at full', () => {
    assert.equal(batteryFillFraction(50), 0.5);
    assert.equal(batteryFillFraction(100), 1);
    assert.equal(batteryFillFraction(120), 1);
  });

  it('maps to a rounded pixel width across the 31px inner box (35 - the 4px inset)', () => {
    assert.equal(batteryFillWidth(100), 31);
    assert.equal(batteryFillWidth(50), 16); // round(31 * 0.5) = 16
    assert.equal(batteryFillWidth(0), 3); // the 10% floor: round(31 * 0.1)
  });
});

describe('batteryLabel (findings §C4 / Round 5 §2a — rangeMiles is the RAW field)', () => {
  it('renders percent as an integer with NO space', () => {
    assert.equal(batteryLabel('percent', 75, 200, 'km'), '75%');
    assert.equal(batteryLabel('percent', 74.6, 200, 'km'), '75%');
  });

  it('converts miles -> km with their exact factor and rounds to 0 decimals', () => {
    // 200 mi * 1.609344 = 321.8688 -> "322 km"
    assert.equal(batteryLabel('distance', 75, 200, 'km'), '322 km');
  });

  it('applies NO factor on the miles path — the field is already miles', () => {
    assert.equal(batteryLabel('distance', 75, 200.4, 'mi'), '200 mi');
  });

  it('separates value and unit with a single ASCII space', () => {
    assert.equal(batteryLabel('distance', 75, 200, 'km'), '322 km');
    assert.match(batteryLabel('distance', 75, 200, 'km')!, /^\d+ (km|mi)$/);
  });

  it('renders NOTHING in distance mode with no range — it does NOT fall back to %', () => {
    // Round 5 §2b: their string builder returns undefined and the Text renders
    // nothing. Falling back to % (what we used to do) is visibly non-Tesla.
    assert.equal(batteryLabel('distance', 75, null, 'km'), null);
  });

  it('still renders percent with no range, since % needs no range', () => {
    assert.equal(batteryLabel('percent', 75, null, 'km'), '75%');
  });

  it('renders NOTHING for undefined — never "NaN km"', () => {
    // The shipped bug: a cache written before rangeKm -> rangeMiles rehydrated
    // `undefined` into state; a strict `=== null` let it through and it
    // multiplied to NaN.
    assert.equal(batteryLabel('distance', 75, undefined, 'km'), null);
    assert.equal(batteryLabel('distance', 75, undefined, 'mi'), null);
  });

  it('renders NOTHING for a non-finite range — this text is on screen', () => {
    assert.equal(batteryLabel('distance', 75, NaN, 'km'), null);
    assert.equal(batteryLabel('distance', 75, Infinity, 'km'), null);
  });
});
