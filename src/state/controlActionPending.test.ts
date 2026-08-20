import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CONTROL_ACTIONS,
  CONTROL_AFFECTED_CMDS,
  CONTROL_AFFECTED_KEYS,
  isControlActionPending,
  type ControlActionId,
} from './controlActions';
import { initialVehicleState, type VehicleStateKey, type VehicleViewState } from '../types/vehicleTypes';
import type { CarCommand } from '../ble/commands';
import type { VehicleActions } from './useVehicleState';

const ALL = Object.keys(CONTROL_ACTIONS) as ControlActionId[];

// THE spec: "everything must have a loading spinner first." A control can only
// show a spinner if it declares a pending source — a state key (reconciled
// commands) OR a command type (keyless one-shots). So every AVAILABLE action must
// have at least one; anything left with neither is a control that will silently
// jump straight to bright with no in-flight feedback, which is the bug this fixes.
test('every available control has a pending source, so it can show a spinner', () => {
  for (const id of ALL) {
    const hasSource = CONTROL_AFFECTED_KEYS[id].length > 0 || CONTROL_AFFECTED_CMDS[id].length > 0;
    if (CONTROL_ACTIONS[id].available === false) {
      assert.equal(hasSource, false, `${id} has no live command → must have no pending source`);
    } else {
      assert.equal(hasSource, true, `${id} must declare a key or command type so it spins while in flight`);
    }
  }
});

// Momentary actions are never "supposed to be bright" (isActive false), so their
// feedback is purely spinner → back to dim. Pin that they stay non-bright.
test('momentary one-shots are never bright — they only ever show the spinner', () => {
  for (const id of ['flash', 'honk', 'start', 'homelink', 'fart'] as ControlActionId[]) {
    assert.equal(CONTROL_ACTIONS[id].isActive(initialVehicleState), false, id);
    assert.deepEqual(CONTROL_AFFECTED_KEYS[id], [], `${id} carries no state key`);
    assert.equal(CONTROL_AFFECTED_CMDS[id].length, 1, `${id} rides the command channel`);
  }
});

test('isControlActionPending reads BOTH channels', () => {
  const noKeys: ReadonlySet<VehicleStateKey> = new Set();
  const noCmds: ReadonlySet<CarCommand['type']> = new Set();

  // Stateful: via its state key.
  assert.equal(isControlActionPending('lock', new Set<VehicleStateKey>(['locked']), noCmds), true);
  assert.equal(isControlActionPending('climate', new Set<VehicleStateKey>(['climateOn']), noCmds), true);
  // Momentary: via its command type.
  assert.equal(isControlActionPending('honk', noKeys, new Set<CarCommand['type']>(['honk'])), true);
  assert.equal(isControlActionPending('unlatchDoor', noKeys, new Set<CarCommand['type']>(['unlatchDriverDoor'])), true);
  // frunk on BOTH: first tap (key) and re-actuate (command).
  assert.equal(isControlActionPending('frunk', new Set<VehicleStateKey>(['frunkOpen']), noCmds), true);
  assert.equal(isControlActionPending('frunk', noKeys, new Set<CarCommand['type']>(['openFrunk'])), true);
  // Nothing in flight → not pending; an UNRELATED key/command doesn't trip it.
  assert.equal(isControlActionPending('lock', noKeys, noCmds), false);
  assert.equal(isControlActionPending('honk', new Set<VehicleStateKey>(['locked']), new Set<CarCommand['type']>(['flashLights'])), false);
});

// Unlatch is the one-shot with an optimistic side effect: the door pops open,
// but that MUST ride fireCommand's `optimistic` (not a bare patch) so the fleet's
// reachability gate can suppress it on an offline car — and a FAILED command must
// revert it (spinner covers the icon until then, so the user sees spinner → dim,
// never a false "open").
test('unlatchDoor fires with a gated optimistic OPEN + a rollback that reverts', () => {
  const patches: Partial<VehicleViewState>[] = [];
  let cmd: CarCommand | undefined;
  let opts: { optimistic?: (s: VehicleViewState) => VehicleViewState; rollback?: () => void } | undefined;
  const actions = {
    patch: (p: Partial<VehicleViewState>) => patches.push(p),
    fireCommand: (c: CarCommand, o?: typeof opts) => {
      cmd = c;
      opts = o;
    },
  } as unknown as VehicleActions;

  CONTROL_ACTIONS.unlatchDoor.run(initialVehicleState, actions);
  assert.equal(cmd?.type, 'unlatchDriverDoor');
  // The optimistic OPEN is a state updater the fleet applies ONLY when reachable —
  // NOT a bare patch (which would open the door even offline).
  assert.ok(opts?.optimistic, 'passes an optimistic updater');
  assert.equal(opts!.optimistic!(initialVehicleState).driverFrontDoorOpen, true);
  assert.deepEqual(patches, [], 'does NOT open the door via a bare patch');
  // The rollback reverts the door on failure.
  assert.ok(opts?.rollback, 'passes a rollback');
  opts!.rollback!();
  assert.deepEqual(patches.at(-1), { driverFrontDoorOpen: false }, 'failure reverts the door → dim');
});
