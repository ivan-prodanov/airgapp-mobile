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

  it('maps to a rounded pixel width across the 33px inner box', () => {
    assert.equal(batteryFillWidth(100), 33);
    assert.equal(batteryFillWidth(50), 17); // round(33 * 0.5) = 17
    assert.equal(batteryFillWidth(0), 3); // the 10% floor: round(33 * 0.1)
  });
});

describe('batteryLabel (findings §C4)', () => {
  it('renders percent as an integer with NO space', () => {
    assert.equal(batteryLabel('percent', 75, 312, 'km'), '75%');
    assert.equal(batteryLabel('percent', 74.6, 312, 'km'), '75%');
  });

  it('renders distance as range + unit', () => {
    assert.equal(batteryLabel('distance', 75, 312, 'km'), '312 km');
  });

  it('converts to miles when that is the vehicle preference', () => {
    assert.equal(batteryLabel('distance', 75, 161, 'mi'), '100 mi');
  });

  it('falls back to percent when no range is known (never renders "null km")', () => {
    assert.equal(batteryLabel('distance', 75, null, 'km'), '75%');
  });
});
