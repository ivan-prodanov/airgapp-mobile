import type { IconRef } from '@/icons/AppIcon';
import { DISCO_LIGHT, FART_PNG, LOW_POWER, SENTRY, unlatchPng } from '@/icons/nativePng';

import type { CarCommand } from '../ble/commands';
import type { VehicleStateKey, VehicleViewState } from '../types/vehicleTypes';
import type { VehicleActions } from './useVehicleState';

export type ControlActionId =
  | 'lock'
  | 'climate'
  | 'charging'
  | 'frunk'
  | 'trunk'
  | 'vent'
  | 'flash'
  | 'honk'
  | 'lightShow'
  | 'lowPower'
  | 'start'
  | 'sentry'
  | 'summon'
  | 'unlatchDoor'
  | 'bioweapon'
  | 'homelink'
  | 'fart';

export interface ControlActionDef {
  id: ControlActionId;
  label: string;
  /**
   * Optional state-dependent label shown ONLY in the customize grid (and the drag caption). The
   * favorites bar itself is icon-only. Falls back to `label` when absent. Used by actions whose
   * grid caption reflects live state (e.g. charging → Open/Close/Unlock, climate → On/Off).
   */
  gridLabel?: (state: VehicleViewState) => string;
  /** Glyph for the favorites bar / grid; a function so it can swap by state (lock open↔closed, sentry
   *  on↔off) or by car model (unlatch door). Returns an IconRef so PNG-only glyphs work too. */
  symbol: (state: VehicleViewState) => IconRef;
  /** When true, the glyph spins continuously (the climate fan while A/C is on). */
  spinning?: (state: VehicleViewState) => boolean;
  /** When true, the favorites-bar icon gets Tesla's soft glow — shown while a control is actively
   *  "working" (climate running). Tesla's `iconGlow`: a white shadow, radius 10, opacity 0.5. */
  glow?: (state: VehicleViewState) => boolean;
  /** Whether the favorites-bar icon renders "active" (white) vs dimmed. */
  isActive: (state: VehicleViewState) => boolean;
  /** What happens when the favorites-bar icon is tapped. */
  run: (state: VehicleViewState, actions: VehicleActions) => void;
  /**
   * False for actions with no BLE command in our protocol yet (Light Show, Summon). The customize grid
   * greys these out and refuses to add them as a favorite, showing a "not available" toast instead.
   * Absent → available.
   */
  available?: boolean;
}

const noop = () => {};

const anyWindowOpen = (s: VehicleViewState) =>
  s.leftFrontWindowOpen || s.rightFrontWindowOpen || s.leftRearWindowOpen || s.rightRearWindowOpen;

export const CONTROL_ACTIONS: Record<ControlActionId, ControlActionDef> = {
  lock: {
    id: 'lock',
    label: 'Lock',
    gridLabel: (s) => (s.locked ? 'Locked' : 'Unlocked'),
    symbol: (s) => (s.locked ? 'lock-filled' : 'unlock-filled'),
    isActive: (s) => !s.locked,
    run: (_s, a) => a.toggle('locked'),
  },
  climate: {
    id: 'climate',
    label: 'Climate',
    gridLabel: (s) => (s.climateOn ? 'On' : 'Off'),
    symbol: () => 'fan-filled',
    spinning: (s) => s.climateOn,
    glow: (s) => s.climateOn,
    isActive: (s) => s.climateOn,
    // Tesla's favourite TOGGLES climate on/off; opening the Climate screen is the menu row's job.
    run: (s, a) => a.setClimateOn(!s.climateOn),
  },
  charging: {
    id: 'charging',
    label: 'Charging',
    // Controls the charge port directly. Closed → "Open"; open & idle → "Close"; open & charging →
    // "Unlock" (releases the latch, stopping the session so the cable can be removed).
    gridLabel: (s) => (s.chargePortOpen ? (s.charging ? 'Unlock' : 'Close') : 'Open'),
    symbol: () => 'charging-bolt',
    isActive: (s) => s.chargePortOpen,
    run: (s, a) =>
      a.patch(
        s.chargePortOpen ? { chargePortOpen: false, charging: false } : { chargePortOpen: true },
      ),
  },
  frunk: {
    id: 'frunk',
    label: 'Frunk',
    symbol: () => 'frunk-filled',
    isActive: (s) => s.frunkOpen,
    // Toggle: the frunk actuate is a toggle on the car, so BOTH taps send the
    // same openFrunk command (see reconcile.ts). The state flip drives the
    // reconciler AND the optimistic open/closed label.
    // NOT toggle('frunkOpen'). See actuateFrunkState: the command fires on every
    // tap, but the optimistic value only ever moves to OPEN.
    run: (_s, a) => a.actuateFrunk(),
  },
  trunk: {
    id: 'trunk',
    label: 'Trunk',
    symbol: () => 'trunk-filled',
    isActive: (s) => s.trunkOpen,
    run: (_s, a) => a.toggle('trunkOpen'),
  },
  vent: {
    id: 'vent',
    label: 'Vent',
    symbol: () => 'vent-windows-filled',
    isActive: anyWindowOpen,
    run: (s, a) => {
      const open = !anyWindowOpen(s);
      a.patch({
        leftFrontWindowOpen: open,
        rightFrontWindowOpen: open,
        leftRearWindowOpen: open,
        rightRearWindowOpen: open,
      });
    },
  },
  flash: {
    id: 'flash',
    label: 'Flash',
    symbol: () => 'brights-filled',
    isActive: () => false,
    run: (_s, a) => a.fireCommand({ type: 'flashLights' }),
  },
  honk: {
    id: 'honk',
    label: 'Honk',
    symbol: () => 'horn-filled',
    isActive: () => false,
    run: (_s, a) => a.fireCommand({ type: 'honk' }),
  },
  lightShow: {
    id: 'lightShow',
    label: 'Light Show',
    symbol: () => ({ png: DISCO_LIGHT }),
    isActive: () => false,
    // No BLE command in our protocol yet — greyed in the grid, refuses to be favourited.
    run: noop,
    available: false,
  },
  lowPower: {
    id: 'lowPower',
    label: 'Low Power',
    // 3-state raster (on/off/on_disabled). We can drive on/off from our optimistic
    // `lowPowerMode`; the on_disabled ("forced on") state needs a car readback we
    // don't get, so it isn't reachable yet — see setLowPowerModeAction / bug 4.
    symbol: (s) => ({ png: s.lowPowerMode ? LOW_POWER.on : LOW_POWER.off }),
    isActive: (s) => s.lowPowerMode,
    run: (_s, a) => a.toggle('lowPowerMode'),
  },
  start: {
    id: 'start',
    label: 'Start',
    symbol: () => 'remote-filled',
    isActive: () => false,
    run: (_s, a) => a.fireCommand({ type: 'remoteStart' }),
  },
  sentry: {
    id: 'sentry',
    label: 'Sentry',
    // sentry_on is baked RED (tint:false keeps it); sentry_off is a gray template that tints.
    symbol: (s) => (s.sentryEnabled ? { png: SENTRY.on, tint: false } : { png: SENTRY.off }),
    isActive: (s) => s.sentryEnabled,
    run: (_s, a) => a.toggle('sentryEnabled'),
  },
  summon: {
    id: 'summon',
    label: 'Summon',
    symbol: () => 'steering-wheel',
    isActive: () => false,
    // No BLE command in our protocol yet — greyed in the grid, refuses to be favourited.
    run: noop,
    available: false,
  },
  unlatchDoor: {
    id: 'unlatchDoor',
    label: 'Unlatch Door',
    symbol: (s) => ({ png: unlatchPng(s.carModel) }),
    isActive: (s) => s.driverFrontDoorOpen,
    // Unlatch = closureMoveRequest opening frontDriverDoor (same VCSEC mechanism as the frunk/trunk — see
    // unlatchDriverDoorAction). The optimistic door-pop rides fireCommand's `optimistic` (NOT a bare patch):
    // driverFrontDoorOpen has no reconciler diff rule, so applyActiveUser's reachability gate can't see it —
    // routing it through fireCommand gets the SAME gate, so an OFFLINE tap doesn't falsely open the door.
    // `rollback` reverts on failure. Spinner covers the icon until the car answers → spinner → dim on
    // failure, spinner → open on success. Never a false success.
    run: (_s, a) => {
      a.fireCommand(
        { type: 'unlatchDriverDoor' },
        {
          optimistic: (s) => ({ ...s, driverFrontDoorOpen: true }),
          rollback: () => a.patch({ driverFrontDoorOpen: false }),
        },
      );
    },
  },
  bioweapon: {
    id: 'bioweapon',
    label: 'Bioweapon Defense',
    symbol: () => 'biohazard-filled',
    // Stateful, like Sentry: toggling `bioweaponOn` drives the reconciler, which sends the bioweaponMode
    // command (reconcile.ts).
    isActive: (s) => s.bioweaponOn,
    run: (_s, a) => a.toggle('bioweaponOn'),
  },
  homelink: {
    id: 'homelink',
    label: 'HomeLink',
    symbol: () => 'homelink-filled',
    isActive: () => false,
    // Triggers the nearest HomeLink device at the car's GPS. No fix → nothing to trigger.
    run: (s, a) => {
      if (s.carLocation) a.fireCommand({ type: 'homelink', lat: s.carLocation.lat, lon: s.carLocation.lon });
    },
  },
  fart: {
    id: 'fart',
    label: 'Fart',
    symbol: () => ({ png: FART_PNG }),
    isActive: () => false,
    // Boombox sound 0 = the selected/default fart (Emissions Testing).
    run: (_s, a) => a.fireCommand({ type: 'boombox', sound: 0 }),
  },
};

// Stable grid ordering (the official app's rough grouping). The grid renders this list filtered to
// the actions NOT currently in the favorites bar, so it is always exactly (catalog − 5) items.
export const CONTROL_ACTION_ORDER: ControlActionId[] = [
  'bioweapon',
  'flash',
  'honk',
  'lightShow',
  'lowPower',
  'start',
  'sentry',
  'summon',
  'trunk',
  'unlatchDoor',
  'vent',
  'homelink',
  'fart',
  'lock',
  'climate',
  'charging',
  'frunk',
];

export const DEFAULT_FAVORITES: ControlActionId[] = ['lock', 'climate', 'charging', 'frunk', 'vent'];

// A control shows a loading spinner while ITS command is in flight, then reveals
// the icon (bright iff isActive) once the car answers — on failure the optimistic
// value has already rolled back, so the revealed icon is honest. That needs a
// pending signal for EVERY action, and there are two kinds of command:
//
//   • STATEFUL actions dispatch through the reconciler, which claims the state
//     key it changed (reconcile.ts). Those keys land in `carLink.pending`, so
//     CONTROL_AFFECTED_KEYS lists exactly the key(s) each action's reconciled
//     command claims (verified against reconcile.ts emit() calls).
//   • MOMENTARY actions (honk/flash/start/homelink/fart) and unlatch dispatch a
//     one-shot with NO state key, so they can't use the key channel. They ride
//     `carLink.pendingCommands` (keyed by CarCommand type) instead — see
//     CONTROL_AFFECTED_CMDS. frunk is in BOTH: its first tap claims `frunkOpen`,
//     but a re-actuate deliberately claims no key (frunkActuateClaimedKeys), so
//     the command channel is what keeps the spinner showing on the second tap.
//
// Empty arrays keep demo/unlinked cars unaffected (neither set ever populates).
export const CONTROL_AFFECTED_KEYS: Record<ControlActionId, VehicleStateKey[]> = {
  lock: ['locked'],
  climate: ['climateOn'],
  charging: ['chargePortOpen', 'charging'],
  frunk: ['frunkOpen'],
  trunk: ['trunkOpen'],
  vent: ['leftFrontWindowOpen', 'rightFrontWindowOpen', 'leftRearWindowOpen', 'rightRearWindowOpen'],
  flash: [],
  honk: [],
  lightShow: [],
  lowPower: ['lowPowerMode'],
  start: [],
  sentry: ['sentryEnabled'],
  summon: [],
  unlatchDoor: [],
  bioweapon: ['bioweaponOn'],
  homelink: [],
  fart: [],
};

// The CarCommand type(s) each action puts in flight that carry NO state key — the
// momentary one-shots + frunk's re-actuate. Watched via carLink.pendingCommands
// so these still show a spinner. Stateful actions leave this [] (they use the key
// channel above). lightShow/summon have no live command, so both channels stay [].
export const CONTROL_AFFECTED_CMDS: Record<ControlActionId, CarCommand['type'][]> = {
  lock: [],
  climate: [],
  charging: [],
  frunk: ['openFrunk'],
  trunk: [],
  vent: [],
  flash: ['flashLights'],
  honk: ['honk'],
  lightShow: [],
  lowPower: [],
  start: ['remoteStart'],
  sentry: [],
  summon: [],
  unlatchDoor: ['unlatchDriverDoor'],
  bioweapon: [],
  homelink: ['homelink'],
  fart: ['boombox'],
};

// isControlActionPending — the ONE place the favorites bar / controls bar asks
// "is this action's command in flight?", across both channels. Used by HomeScreen
// and ControlsScreen so the spinner rule can't drift between them.
export function isControlActionPending(
  id: ControlActionId,
  pendingKeys: ReadonlySet<VehicleStateKey>,
  pendingCommands: ReadonlySet<CarCommand['type']>,
): boolean {
  return (
    CONTROL_AFFECTED_KEYS[id].some((key) => pendingKeys.has(key)) ||
    CONTROL_AFFECTED_CMDS[id].some((type) => pendingCommands.has(type))
  );
}
