import type { TeslaIconName } from '@/icons/TeslaIcon';

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
  /** Glyph for the favorites bar / grid; a function so lock can swap open↔closed. */
  symbol: (state: VehicleViewState) => TeslaIconName;
  /** When true, the glyph spins continuously (the climate fan while A/C is on). */
  spinning?: (state: VehicleViewState) => boolean;
  /** Whether the favorites-bar icon renders "active" (white) vs dimmed. */
  isActive: (state: VehicleViewState) => boolean;
  /** What happens when the favorites-bar icon is tapped. */
  run: (state: VehicleViewState, actions: VehicleActions) => void;
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
    isActive: (s) => s.climateOn,
    run: (_s, a) => a.setCameraMode('CLIMATE'),
  },
  charging: {
    id: 'charging',
    label: 'Charging',
    // Controls the charge port directly. Closed → "Open"; open & idle → "Close"; open & charging →
    // "Unlock" (releases the latch, stopping the session so the cable can be removed).
    gridLabel: (s) => (s.chargePortOpen ? (s.charging ? 'Unlock' : 'Close') : 'Open'),
    symbol: () => 'bolt-filled',
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
    run: (_s, a) => {
      a.patch({ headlightsOn: true });
      setTimeout(() => a.patch({ headlightsOn: false }), 1200);
    },
  },
  honk: {
    id: 'honk',
    label: 'Honk',
    symbol: () => 'horn-filled',
    isActive: () => false,
    run: noop,
  },
  lightShow: {
    id: 'lightShow',
    label: 'Light Show',
    symbol: () => 'sparkles-filled',
    isActive: () => false,
    run: noop,
  },
  lowPower: {
    id: 'lowPower',
    label: 'Low Power',
    symbol: () => 'battery-empty-filled',
    isActive: () => false,
    run: noop,
  },
  start: {
    id: 'start',
    label: 'Start',
    symbol: () => 'remote-filled',
    isActive: () => false,
    run: noop,
  },
  sentry: {
    id: 'sentry',
    label: 'Sentry',
    symbol: () => 'target-filled',
    isActive: (s) => s.sentryEnabled,
    run: (_s, a) => a.toggle('sentryEnabled'),
  },
  summon: {
    id: 'summon',
    label: 'Summon',
    symbol: () => 'steering-wheel',
    isActive: () => false,
    run: noop,
  },
  unlatchDoor: {
    id: 'unlatchDoor',
    label: 'Unlatch Door',
    symbol: () => 'doors-open-filled',
    isActive: (s) => s.driverFrontDoorOpen,
    run: (_s, a) => a.toggle('driverFrontDoorOpen'),
  },
  bioweapon: {
    id: 'bioweapon',
    label: 'Bioweapon Defense',
    symbol: () => 'biohazard-filled',
    isActive: () => false,
    run: noop,
  },
  homelink: {
    id: 'homelink',
    label: 'HomeLink',
    symbol: () => 'homelink-filled',
    isActive: () => false,
    run: noop,
  },
  fart: {
    id: 'fart',
    label: 'Fart',
    symbol: () => 'speaker-filled',
    isActive: () => false,
    run: noop,
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

// The VehicleStateKeys a control's real command puts in flight — used to render
// a pending affordance on the favorites bar (a key is "pending" while its
// command is dispatched but unconfirmed; see useCarLink.dispatch). Anything
// still [] is not a live BLE command yet; add its key(s) here when it becomes
// one. Empty arrays keep demo/unlinked cars unaffected regardless.
//
// `frunk` was left [] by that rule and then missed when openFrunk went live, so
// the frunk never showed a busy affordance anywhere — which is part of why the
// double-tap was so easy to trigger: nothing on screen said the first command
// was still running.
export const CONTROL_AFFECTED_KEYS: Record<ControlActionId, VehicleStateKey[]> = {
  lock: ['locked'],
  climate: [],
  charging: [],
  frunk: ['frunkOpen'],
  trunk: [],
  vent: [],
  flash: [],
  honk: [],
  lightShow: [],
  lowPower: [],
  start: [],
  sentry: [],
  summon: [],
  unlatchDoor: [],
  bioweapon: [],
  homelink: [],
  fart: [],
};
