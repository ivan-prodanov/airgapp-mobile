import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CONTROL_ACTIONS, CONTROL_AFFECTED_KEYS } from './controlActions';
import { initialVehicleState } from '../types/vehicleTypes';
import type { VehicleActions } from './useVehicleState';

// Guards the wiring the frunk regression exposed: the control must reach
// actuateFrunk, because nothing else sends openFrunk any more (reconcile.ts has
// no frunk diff rule by design).
test('the frunk control calls actuateFrunk, not toggle', () => {
  let actuated = 0;
  let toggled = 0;
  const actions = {
    actuateFrunk: () => {
      actuated++;
    },
    toggle: () => {
      toggled++;
    },
  } as unknown as VehicleActions;

  CONTROL_ACTIONS.frunk.run(initialVehicleState, actions);
  assert.equal(actuated, 1, 'must dispatch through actuateFrunk');
  assert.equal(toggled, 0, 'must NOT go through the generic toggle');
});

test('the frunk declares its affected key so the control can show busy', () => {
  assert.deepEqual(CONTROL_AFFECTED_KEYS.frunk, ['frunkOpen']);
});

// The regression this file exists for: removing the reconciler's frunk diff rule
// made EVERY remaining `toggle('frunkOpen')` a silent no-op — the label flipped
// and the car heard nothing. One surface (the 3D car's Open/Close marker) was
// missed, and it is the one Ivan uses.
//
// So the invariant is: nothing may toggle frunkOpen directly. This test cannot
// see JSX, so it guards the rule at the source instead — a grep-style assertion
// over the files that own frunk interaction.
test('no source file toggles frunkOpen directly', async () => {
  const { readFileSync, readdirSync, statSync } = await import('node:fs');
  const { join } = await import('node:path');
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.tsx?$/.test(entry) || /\.test\.tsx?$/.test(entry)) continue;
      // Comments legitimately NAME the forbidden call while explaining it, so
      // strip them first — otherwise the rule's own documentation trips it.
      const src = readFileSync(full, 'utf8')
        .split('\n')
        .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
        .join('\n');
      if (/toggle\(\s*['"]frunkOpen['"]\s*\)/.test(src)) offenders.push(full);
    }
  };
  walk('src');
  assert.deepEqual(offenders, [], 'use actuateFrunk() — a bare toggle sends no command');
});
