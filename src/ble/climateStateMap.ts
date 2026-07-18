// Pure mappers from the car's ClimateState (proto/vehicle.proto) enums to our
// VehicleViewState shapes. Split out of telemetry.ts so the intricate,
// trap-laden enum logic is unit-tested in isolation.
//
// Every rule here is derived from proto/vehicle.proto ClimateState — see the
// per-function comments for the exact enum. NO react-native imports (ble/*
// isolation rule).

import type {
  CabinOverheatMode,
  CabinOverheatTemp,
  SeatClimateMode,
  SteeringWheelClimateModeName,
} from '../types/vehicleTypes';

// oneof case name (pbjs decodes `oneof type { Void Dog = 4; }` to {Dog:{}} or a
// bare string). Lower-cased for matching.
export function oneofCase(val: unknown): string | undefined {
  if (val == null) return undefined;
  if (typeof val === 'string') return val.toLowerCase();
  if (typeof val === 'object') {
    const keys = Object.keys(val as Record<string, unknown>);
    return keys.length ? keys[0].toLowerCase() : undefined;
  }
  return undefined;
}

// SeatHeaterLevel_E / SeatCoolingLevel_E {Off=0, Low=1, Med=2, High=3} → 0..3.
// Accepts the numeric enum (normal decode) or the string name (defensive).
export function seatLevel(v: unknown): 0 | 1 | 2 | 3 | undefined {
  if (typeof v === 'number') return v >= 0 && v <= 3 ? (v as 0 | 1 | 2 | 3) : undefined;
  if (typeof v === 'string') {
    const m: Record<string, 0 | 1 | 2 | 3> = {
      seatheaterlevoff: 0, seatheaterlevlow: 1, seatheaterlevmed: 2, seatheaterlevhigh: 3,
      seatcoolinglevoff: 0, seatcoolinglevlow: 1, seatcoolinglevmed: 2, seatcoolinglevhigh: 3,
      off: 0, low: 1, med: 2, high: 3,
    };
    return m[v.toLowerCase()];
  }
  return undefined;
}

// Resolve one seat's {mode, level} from its three separate proto fields.
// ⚠️ PRECEDENCE: auto > cool > heat > off. Cooling & auto are FRONT-ONLY in the
// proto (rear passes undefined for both). Returns undefined if the car reported
// NONE of the three for this seat (so the caller leaves the default untouched
// rather than forcing it off).
export function resolveSeat(
  heat: unknown,
  cool: unknown,
  auto: unknown,
): SeatClimateMode | undefined {
  const h = seatLevel(heat);
  const c = seatLevel(cool);
  const a = typeof auto === 'boolean' ? auto : undefined;
  if (h === undefined && c === undefined && a === undefined) return undefined;
  if (a === true) return { mode: 'auto', level: 0 };
  if (c !== undefined && c > 0) return { mode: 'cool', level: c };
  if (h !== undefined && h > 0) return { mode: 'heat', level: h };
  return { mode: 'off', level: 0 };
}

// StwHeatLevel {Unknown=0, Off=1, Low=2, High=3} — NOTE off is 1, not 0.
// Combined with autoSteeringWheelHeat (bool) + steeringWheelHeater (bool).
export function resolveSteeringWheel(
  auto: unknown,
  level: unknown,
  heater: unknown,
): { mode: SteeringWheelClimateModeName; level: 0 | 1 | 2 } | undefined {
  const a = typeof auto === 'boolean' ? auto : undefined;
  const on = typeof heater === 'boolean' ? heater : undefined;
  const lvl = typeof level === 'number' ? level : stwLevelFromName(level);
  if (a === undefined && on === undefined && lvl === undefined) return undefined;
  if (a === true) return { mode: 'auto', level: 0 };
  // level 2=Low→1, 3=High→2; 1=Off→0. `on` true with no level → heat level 1.
  if (lvl === 2) return { mode: 'heat', level: 1 };
  if (lvl === 3) return { mode: 'heat', level: 2 };
  if (on === true && (lvl === undefined || lvl === 1)) return { mode: 'heat', level: 1 };
  return { mode: 'off', level: 0 };
}

function stwLevelFromName(v: unknown): number | undefined {
  if (typeof v !== 'string') return undefined;
  return { stwheatlevelunknown: 0, stwheatleveloff: 1, stwheatlevellow: 2, stwheatlevelhigh: 3 }[
    v.toLowerCase()
  ];
}

// ClimateKeeperMode oneof {Unknown=1, Off=2, On=3, Dog=4, Party=5}.
// ⚠️ `Party` is CAMP mode (the state proto's name for it); `Dog` is Pet.
export function keeperToToggles(val: unknown): { campModeOn: boolean; petModeOn: boolean } | undefined {
  const c = oneofCase(val);
  if (c === undefined) return undefined;
  return { campModeOn: c === 'party', petModeOn: c === 'dog' };
}

// CabinOverheatProtection_E {Off=0, On=1, FanOnly=2} → our 'off'|'on'|'noac'.
export function copMode(v: unknown): CabinOverheatMode | undefined {
  const n = typeof v === 'number' ? v : copModeFromName(v);
  if (n === undefined) return undefined;
  return n === 1 ? 'on' : n === 2 ? 'noac' : 'off';
}
function copModeFromName(v: unknown): number | undefined {
  if (typeof v !== 'string') return undefined;
  return { cabinoverheatprotectionoff: 0, cabinoverheatprotectionon: 1, cabinoverheatprotectionfanonly: 2 }[
    v.toLowerCase()
  ];
}

// CopActivationTemp {Unspecified=0, Low=1, Medium=2, High=3} → '30'|'35'|'40'.
// Unspecified → undefined (omit).
export function copTemp(v: unknown): CabinOverheatTemp | undefined {
  const n = typeof v === 'number' ? v : copTempFromName(v);
  if (n === 1) return '30';
  if (n === 2) return '35';
  if (n === 3) return '40';
  return undefined;
}
function copTempFromName(v: unknown): number | undefined {
  if (typeof v !== 'string') return undefined;
  return { copactivationtemplow: 1, copactivationtempmedium: 2, copactivationtemphigh: 3 }[v.toLowerCase()];
}
