// reconcile.ts — the pure user-action → CarCommand reconciler.
//
// diffToCommands maps a USER-INITIATED optimistic state change (prev → next) to
// the car command(s) that realize it, EACH PAIRED WITH THE FIELDS IT OWNS. This
// is the single extensible seam between the app's view-state and the BLE command
// layer: a control lights up by adding one `prev.field !== next.field` case, no
// per-button wiring. Deliberately PURE (imports only the CarCommand union + the
// view-state types) so it runs and is unit-tested under plain node.
//
// CRITICAL: only ever feed this the USER-action apply path (the wrapped apply in
// useFleetState). It must NEVER see telemetry-driven mutations — an incoming
// lock-status patch would otherwise diff into a lock command and loop back to
// the car. The two write paths are kept separate at the apply layer precisely so
// this stays a one-way map.
//
// WHY commands now carry their keys (was lock-only): a failed command must revert
// ONLY the fields IT owns, not everything the user touched since. With one
// command that was cosmetic; across a screen of independent controls it's
// correctness — a failed temp set must not revert a seat toggle flipped in the
// same tick. These `keys` are also what the coalescer lanes on and what the
// intent-grace window covers.

import type { CarCommand } from './commands';
import type { ParentalSetting } from './builders';
import type { SeatPosition, VehicleStateKey, VehicleViewState } from '../types/vehicleTypes';

export interface ReconciledCommand {
  cmd: CarCommand;
  keys: VehicleStateKey[];
}

// Fleet SeatPosition → the command builder's seat id. Cooling only exists front
// (the command builder enforces it); rear/third-row cool is impossible in the UI
// anyway. Third row has no heater command in the protocol, so it's absent here.
const SEAT_CMD_ID: Partial<Record<SeatPosition, 'FL' | 'FR' | 'RL' | 'RC' | 'RR'>> = {
  frontLeft: 'FL',
  frontRight: 'FR',
  rearLeft: 'RL',
  rearMiddle: 'RC',
  rearRight: 'RR',
};

const WINDOW_KEYS: VehicleStateKey[] = [
  'leftFrontWindowOpen',
  'rightFrontWindowOpen',
  'leftRearWindowOpen',
  'rightRearWindowOpen',
];

// Cabin-overheat protection temperature -> the car's three COP levels.
const COP_TEMP_LEVEL: Record<'30' | '35' | '40', 'low' | 'medium' | 'high'> = {
  '30': 'low',
  '35': 'medium',
  '40': 'high',
};

// The four "Customize Parental Controls" checkboxes → the car's ParentalControlsSetting enum name.
const PARENTAL_SETTING_KEYS: ReadonlyArray<readonly [VehicleStateKey, ParentalSetting]> = [
  ['parentalLimitSpeed', 'speedLimit'],
  ['parentalReduceAccel', 'acceleration'],
  ['parentalRequireSafety', 'safetyFeatures'],
  ['parentalCurfewNotify', 'curfew'],
];

export function diffToCommands(prev: VehicleViewState, next: VehicleViewState): ReconciledCommand[] {
  const out: ReconciledCommand[] = [];
  const emit = (cmd: CarCommand, ...keys: VehicleStateKey[]) => out.push({ cmd, keys });

  // ── Controls ───────────────────────────────────────────────────────────────
  if (prev.locked !== next.locked) emit({ type: next.locked ? 'lock' : 'unlock' }, 'locked');
  // Frunk actuate is a TOGGLE on the car: the SAME openFrunk command opens it,
  // and sending it again closes it (Tesla's own app sends OPEN for "Close" too;
  // aftermarket auto-close add-ons ride the same command). So emit openFrunk on
  // BOTH transitions, not just open.
  if (prev.frunkOpen !== next.frunkOpen) emit({ type: 'openFrunk' }, 'frunkOpen');
  if (prev.trunkOpen !== next.trunkOpen) {
    emit({ type: next.trunkOpen ? 'openTrunk' : 'closeTrunk' }, 'trunkOpen');
  }
  if (prev.chargePortOpen !== next.chargePortOpen) {
    emit({ type: next.chargePortOpen ? 'openChargePort' : 'closeChargePort' }, 'chargePortOpen');
  }
  if (prev.sentryEnabled !== next.sentryEnabled) {
    emit({ type: 'sentry', on: next.sentryEnabled }, 'sentryEnabled');
  }

  // ── Security & Drivers: PIN-gated toggles ──────────────────────────────────
  // Each feature emits on TWO independent transitions: the on/off toggle, and a
  // pin cleared (prev pin non-null → next null, the "Clear PIN" row action). They
  // never coincide — enabling sets a pin (null → value, not → null) and clearing
  // leaves the feature off — so the `else if` can't drop a real command. Enabling
  // reads the pin from `next` (it may have been set in the same patch, so the
  // command owns both keys and a failed enable reverts the pin too); clearing
  // reads it from `prev` (the value being removed). Off carries no pin — the car
  // wants an empty password for Valet/PIN-to-Drive off, and the builders/handlers
  // supply it.
  if (prev.valetMode !== next.valetMode) {
    if (next.valetMode) {
      emit(
        { type: 'valet', on: true, pin: next.valetPin ?? undefined },
        ...(next.valetPin !== prev.valetPin ? (['valetMode', 'valetPin'] as const) : (['valetMode'] as const)),
      );
    } else {
      emit({ type: 'valet', on: false }, 'valetMode');
    }
  } else if (prev.valetPin && !next.valetPin) {
    emit({ type: 'valetClearPin' }, 'valetPin');
  }

  if (prev.pinToDrive !== next.pinToDrive) {
    if (next.pinToDrive) {
      emit(
        { type: 'pinToDrive', on: true, pin: next.pinToDrivePin ?? undefined },
        ...(next.pinToDrivePin !== prev.pinToDrivePin
          ? (['pinToDrive', 'pinToDrivePin'] as const)
          : (['pinToDrive'] as const)),
      );
    } else {
      emit({ type: 'pinToDrive', on: false }, 'pinToDrive');
    }
  } else if (prev.pinToDrivePin && !next.pinToDrivePin) {
    emit({ type: 'pinToDriveClearPin' }, 'pinToDrivePin');
  }

  // Speed Limit Mode: activate/deactivate (both verify the PIN) + the mph setpoint
  // (edited live from the "…" panel, coalesced like the charge sliders) + clear-PIN.
  if (prev.speedLimitMode !== next.speedLimitMode) {
    if (next.speedLimitMode) {
      emit(
        { type: 'speedLimit', action: 'activate', pin: next.speedLimitPin ?? undefined },
        ...(next.speedLimitPin !== prev.speedLimitPin
          ? (['speedLimitMode', 'speedLimitPin'] as const)
          : (['speedLimitMode'] as const)),
      );
    } else {
      emit({ type: 'speedLimit', action: 'deactivate', pin: next.speedLimitPin ?? undefined }, 'speedLimitMode');
    }
  } else if (prev.speedLimitPin && !next.speedLimitPin) {
    emit({ type: 'speedLimit', action: 'clearPin', pin: prev.speedLimitPin }, 'speedLimitPin');
  }
  if (prev.speedLimitMph !== next.speedLimitMph) {
    emit({ type: 'speedLimit', action: 'set', mph: next.speedLimitMph }, 'speedLimitMph');
  }

  // Parental Controls: activate/deactivate (verify PIN) + clear-PIN, the "Customize
  // Parental Controls" sub-settings, and that panel's own mph limit.
  if (prev.parentalControls !== next.parentalControls) {
    if (next.parentalControls) {
      emit(
        { type: 'parental', action: 'activate', pin: next.parentalPin ?? undefined },
        ...(next.parentalPin !== prev.parentalPin
          ? (['parentalControls', 'parentalPin'] as const)
          : (['parentalControls'] as const)),
      );
    } else {
      emit({ type: 'parental', action: 'deactivate', pin: next.parentalPin ?? undefined }, 'parentalControls');
    }
  } else if (prev.parentalPin && !next.parentalPin) {
    emit({ type: 'parental', action: 'clearPin', pin: prev.parentalPin }, 'parentalPin');
  }
  if (prev.parentalLimitSpeedMph !== next.parentalLimitSpeedMph) {
    emit({ type: 'parental', action: 'setSpeedLimit', mph: next.parentalLimitSpeedMph }, 'parentalLimitSpeedMph');
  }
  for (const [key, setting] of PARENTAL_SETTING_KEYS) {
    // Every key in PARENTAL_SETTING_KEYS is a boolean field; the cast narrows the state-value union.
    if (prev[key] !== next[key]) {
      emit({ type: 'parental', action: 'setSetting', setting, enable: next[key] as boolean }, key);
    }
  }

  // ── Windows: one UI toggle flips all four, so any-open → vent, none-open →
  // close, and the command owns the whole set. ────────────────────────────────
  const prevVented = WINDOW_KEYS.some((k) => prev[k]);
  const nextVented = WINDOW_KEYS.some((k) => next[k]);
  if (prevVented !== nextVented) {
    emit({ type: nextVented ? 'ventWindows' : 'closeWindows' }, ...WINDOW_KEYS);
  }

  // ── Charging ─────────────────────────────────────────────────────────────────
  if (prev.charging !== next.charging) {
    emit({ type: next.charging ? 'chargeStart' : 'chargeStop' }, 'charging');
  }
  if (prev.chargeLimitPercent !== next.chargeLimitPercent) {
    emit({ type: 'setChargeLimit', percent: next.chargeLimitPercent }, 'chargeLimitPercent');
  }
  if (prev.chargingAmps !== next.chargingAmps) {
    emit({ type: 'setChargingAmps', amps: next.chargingAmps }, 'chargingAmps');
  }

  // ── Climate ───────────────────────────────────────────────────────────────────
  if (prev.climateOn !== next.climateOn) {
    emit({ type: next.climateOn ? 'climateOn' : 'climateOff' }, 'climateOn');
  }
  if (prev.targetTempC !== next.targetTempC) {
    emit({ type: 'setClimateTemp', celsius: next.targetTempC }, 'targetTempC');
  }
  if (prev.bioweaponOn !== next.bioweaponOn) {
    emit({ type: 'bioweaponMode', on: next.bioweaponOn }, 'bioweaponOn');
  }
  if (prev.cabinOverheatMode !== next.cabinOverheatMode) {
    emit({ type: 'cabinOverheat', on: next.cabinOverheatMode !== 'off' }, 'cabinOverheatMode');
  }
  // Cabin-overheat TEMP (30/35/40 -> COP low/med/high). Was UNMAPPED, so changing
  // the segmented temp did nothing. The Defrost button drives front+rear together
  // and both flip as one, so a single defrostOn/Off covers the pair. Both were
  // unmapped — tapping Defrost only ever sent climateOn ("does something else").
  if (prev.cabinOverheatTemp !== next.cabinOverheatTemp) {
    emit({ type: 'setCopTemp', level: COP_TEMP_LEVEL[next.cabinOverheatTemp] }, 'cabinOverheatTemp');
  }
  if (prev.frontDefrostOn !== next.frontDefrostOn || prev.rearDefrostOn !== next.rearDefrostOn) {
    const on = next.frontDefrostOn || next.rearDefrostOn;
    emit({ type: on ? 'defrostOn' : 'defrostOff' }, 'frontDefrostOn', 'rearDefrostOn');
  }
  // Camp and Pet are independent toggles that both map to climateKeeper.
  if (prev.campModeOn !== next.campModeOn) {
    emit({ type: 'climateKeeper', mode: next.campModeOn ? 'camp' : 'off' }, 'campModeOn');
  }
  if (prev.petModeOn !== next.petModeOn) {
    emit({ type: 'climateKeeper', mode: next.petModeOn ? 'dog' : 'off' }, 'petModeOn');
  }

  // ── Seat + steering-wheel heaters ──────────────────────────────────────────────
  // seatClimateModes is a single state key, so every seat change reverts through
  // it. That's correct: the whole map is applied as one optimistic object.
  for (const pos of Object.keys(SEAT_CMD_ID) as SeatPosition[]) {
    const seat = SEAT_CMD_ID[pos]!;
    const p = prev.seatClimateModes[pos];
    const n = next.seatClimateModes[pos];
    if (p.level === n.level && p.mode === n.mode) continue;
    const canCool = seat === 'FL' || seat === 'FR';
    // Going OFF must turn off whichever system was RUNNING. The old code keyed on
    // next.mode only, so cool->off (next.mode 'off') fell to the heater branch and
    // sent seatHeater 0 — leaving the COOLER on. Key on the PREVIOUS mode when the
    // target is off.
    const effective = n.mode === 'off' ? p.mode : n.mode;
    if (effective === 'cool' && canCool) {
      emit({ type: 'seatCooler', seat, level: n.mode === 'off' ? 0 : n.level }, 'seatClimateModes');
    } else if (effective === 'auto') {
      // No seat-auto command exists over BLE (see the test plan). Emit nothing
      // rather than silently sending a heater level the user didn't ask for.
    } else {
      emit({ type: 'seatHeater', seat, level: n.mode === 'off' ? 0 : n.level }, 'seatClimateModes');
    }
  }
  if (prev.steeringWheelClimate.mode !== next.steeringWheelClimate.mode) {
    emit(
      { type: 'steeringWheelHeat', on: next.steeringWheelClimate.mode !== 'off' },
      'steeringWheelClimate',
    );
  }

  return out;
}

// revertFields restores exactly `keys` to their prev values, leaving every other
// (independently-applied) field untouched — the generic rollback for a failed
// command. Returns the same object when nothing changed so React can bail.
export function revertFields(
  state: VehicleViewState,
  prev: VehicleViewState,
  keys: readonly VehicleStateKey[],
): VehicleViewState {
  let changed = false;
  const out: VehicleViewState = { ...state };
  for (const key of keys) {
    if (out[key] !== prev[key]) {
      (out as Record<VehicleStateKey, unknown>)[key] = prev[key];
      changed = true;
    }
  }
  return changed ? out : state;
}
