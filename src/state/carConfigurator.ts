import type { CarModel } from '../types/vehicleTypes';

// The "Add Car" configurator's pure selection logic: the option catalogs the UI
// renders, and the mapping from a (model, body, seats) choice to the single
// CarModel the fleet + Godot renderer key off. Kept UI-free so it stays testable.

// The four mainline models the flow offers. The Godot project also defines
// Cybertruck / Semi vehicle types, but our CarModel union doesn't include them,
// so they're out of scope here.
export type BaseModel = 'modelS' | 'model3' | 'modelX' | 'modelY';

export interface BaseModelOption {
  value: BaseModel;
  // Segmented-control label (matches the Tesla wordmark suffix): "S" | "3" | "X" | "Y".
  label: string;
  // Full marketing name, used as the default vehicle name.
  name: string;
}

export const BASE_MODELS: BaseModelOption[] = [
  { value: 'modelS', label: 'S', name: 'Model S' },
  { value: 'model3', label: '3', name: 'Model 3' },
  { value: 'modelX', label: 'X', name: 'Model X' },
  { value: 'modelY', label: 'Y', name: 'Model Y' },
];

// Facelift generation. 'new' = current body, 'older' = the pre-facelift body
// (our `…Legacy` CarModel variants render a genuinely different 3D scene). Colors
// AND wheels are keyed on this — the older bodies carry their era-correct line-up.
export type BodyGen = 'new' | 'older';

export type SeatCount = 5 | 6 | 7;

const OLDER_MODEL: Record<BaseModel, CarModel> = {
  modelS: 'modelSLegacy',
  model3: 'model3Legacy',
  modelX: 'modelXLegacy',
  modelY: 'modelYLegacy',
};

// Model X is the only model with seat-count variants, and only on the new body
// (the older-X CarModel has no seat variants). Every other model returns [] so
// the UI hides the seat control.
export function seatOptionsFor(base: BaseModel, body: BodyGen): SeatCount[] {
  return base === 'modelX' && body === 'new' ? [5, 6, 7] : [];
}

// Collapse the configurator selection into the single CarModel that both the
// fleet store and `createShowProductMessage` use. Seats only matter for the
// new-body Model X; they're ignored otherwise.
export function resolveCarModel(base: BaseModel, body: BodyGen, seats: SeatCount = 5): CarModel {
  if (body === 'older') return OLDER_MODEL[base];
  if (base === 'modelX') return seats === 6 ? 'modelX6Seat' : seats === 7 ? 'modelX7Seat' : 'modelX';
  return base;
}

// ── Trim ─────────────────────────────────────────────────────────────────
// Per-model trim variants. A trim carries `performance` — the one safe, per-car
// render delta it implies (red brake calipers + the body's rear spoiler, both
// applied by Vehicle.update without a body/fascia swap). Trim is DECOUPLED from
// wheels: the wheel list is per (model × generation), so a trim can't pin a wheel
// that doesn't exist for the selected generation. The FIRST entry is the default,
// and its `performance` matches the model's base config (a test enforces this).
export interface TrimOption {
  value: string;
  label: string;
  performance: boolean;
}

export const TRIMS_BY_MODEL: Record<BaseModel, TrimOption[]> = {
  modelS: [
    { value: 'plaid', label: 'Plaid', performance: true },
    { value: 'dual', label: 'Dual Motor', performance: false },
  ],
  model3: [
    { value: 'perf', label: 'Performance', performance: true },
    { value: 'lr', label: 'Long Range', performance: false },
    { value: 'rwd', label: 'RWD', performance: false },
  ],
  modelX: [
    { value: 'dual', label: 'Dual Motor', performance: false },
    { value: 'plaid', label: 'Plaid', performance: true },
  ],
  modelY: [
    { value: 'perf', label: 'Performance', performance: true },
    { value: 'lr', label: 'Long Range', performance: false },
    { value: 'rwd', label: 'RWD', performance: false },
  ],
};

// ── Paint ────────────────────────────────────────────────────────────────
// `value` is the exact key the Godot side looks up in VehicleOptions.ExteriorColorValue
// (every key below verified present there); an unknown key would render the fallback
// grey. `swatch` is a curated DISPLAY hex for the picker chip — the engine's own
// base-tint values are near-black (modulated by the scene), so they can't drive the UI.
//
// The engine renders ANY color on ANY body, but Tesla's OFFER differs per model AND
// per generation, so each (model, body) shows its own era-correct line-up. The FIRST
// entry is the default. Lists researched against Tesla's actual history 2016-2026.
export interface ColorOption {
  value: string;
  label: string;
  swatch: string;
}

const C = {
  PearlWhite: { value: 'PearlWhite', label: 'Pearl White', swatch: '#EDEEEF' },
  SolidBlack: { value: 'SolidBlack', label: 'Solid Black', swatch: '#0C0D0E' },
  DiamondBlack: { value: 'DiamondBlack', label: 'Diamond Black', swatch: '#16161A' },
  MidnightSilver: { value: 'MidnightSilver', label: 'Midnight Silver', swatch: '#34373C' },
  StealthGrey: { value: 'StealthGrey', label: 'Stealth Grey', swatch: '#4A4E52' },
  LunarSilver: { value: 'LunarSilver', label: 'Lunar Silver', swatch: '#8E9195' },
  SilverMetallic: { value: 'SilverMetallic', label: 'Silver Metallic', swatch: '#A9ADB1' },
  Quicksilver: { value: 'Quicksilver', label: 'Quicksilver', swatch: '#B7B9BB' },
  DeepBlue: { value: 'DeepBlue', label: 'Deep Blue', swatch: '#1B2B4D' },
  MarineBlue: { value: 'MarineBlue', label: 'Marine Blue', swatch: '#16243F' },
  GlacierBlue: { value: 'GlacierBlue', label: 'Glacier Blue', swatch: '#5578A0' },
  FrostBlue: { value: 'FrostBlue', label: 'Frost Blue', swatch: '#9FB2C6' },
  RedMulticoat: { value: 'RedMulticoat', label: 'Red Multi-Coat', swatch: '#8C0F19' },
  UltraRed: { value: 'UltraRed', label: 'Ultra Red', swatch: '#A80D1C' },
} as const satisfies Record<string, ColorOption>;

export const EXTERIOR_COLORS_BY_MODEL_GEN: Record<BaseModel, Record<BodyGen, ColorOption[]>> = {
  // S/X refresh (2021+, current 2025 config): Pearl White, Diamond Black, Stealth
  // Grey, Lunar Silver, Ultra Red, Frost Blue. Classic S/X: the older palette.
  modelS: {
    new: [C.PearlWhite, C.DiamondBlack, C.StealthGrey, C.LunarSilver, C.UltraRed, C.FrostBlue],
    older: [C.PearlWhite, C.SolidBlack, C.MidnightSilver, C.DeepBlue, C.RedMulticoat, C.SilverMetallic],
  },
  // Highland (2024+): Stealth Grey, Pearl White, <blue>, Diamond Black, Ultra Red,
  // Quicksilver. The blue is TRIM-dependent (Marine on non-perf, Frost on Perf —
  // see colorsFor); MarineBlue is the stored default. Pre-Highland: the older palette.
  model3: {
    new: [C.StealthGrey, C.PearlWhite, C.MarineBlue, C.DiamondBlack, C.UltraRed, C.Quicksilver],
    older: [C.PearlWhite, C.SolidBlack, C.MidnightSilver, C.DeepBlue, C.RedMulticoat],
  },
  modelX: {
    new: [C.PearlWhite, C.DiamondBlack, C.StealthGrey, C.LunarSilver, C.UltraRed, C.FrostBlue],
    older: [C.PearlWhite, C.SolidBlack, C.MidnightSilver, C.DeepBlue, C.RedMulticoat, C.SilverMetallic],
  },
  // Juniper (2025+): Stealth Grey, Pearl White, <blue>, Diamond Black, Glacier Blue,
  // Ultra Red, Quicksilver. Blue is TRIM-dependent like Highland (see colorsFor).
  modelY: {
    new: [C.StealthGrey, C.PearlWhite, C.MarineBlue, C.DiamondBlack, C.GlacierBlue, C.UltraRed, C.Quicksilver],
    older: [C.PearlWhite, C.MidnightSilver, C.DeepBlue, C.SolidBlack, C.RedMulticoat, C.Quicksilver],
  },
};

// New Model 3 / Model Y swap their metallic blue by trim: Frost Blue on the
// Performance trim, Marine Blue otherwise (the stored default is Marine). No other
// (model × gen) varies by trim, so `performance` only affects those two.
export function colorsFor(base: BaseModel, body: BodyGen, performance = false): ColorOption[] {
  const list = EXTERIOR_COLORS_BY_MODEL_GEN[base][body];
  if (performance && body === 'new' && (base === 'model3' || base === 'modelY')) {
    return list.map((c) => (c.value === C.MarineBlue.value ? C.FrostBlue : c));
  }
  return list;
}

// ── Wheels ───────────────────────────────────────────────────────────────
// `value` is a key in VehicleOptions.MobileWheelTypeEnumMap (all verified present;
// an unknown key would fall back to the car_type default, so it can't crash).
// Per (model × generation) — the older bodies wore genuinely different wheels.
export interface WheelOption {
  value: string;
  label: string;
}

export const WHEELS_BY_MODEL_GEN: Record<BaseModel, Record<BodyGen, WheelOption[]>> = {
  modelS: {
    // Refresh S: 19" Tempest (standard) + 21" Arachnid, which ships DARK on the
    // Plaid → the Armor-Black scene (Arachnid21 rendered too close to Tempest).
    new: [
      { value: 'Tempest19SonicSilver', label: 'Tempest 19"' },
      { value: 'Arachnid21Black', label: 'Arachnid 21"' },
    ],
    // Classic S never offered Arachnid — its 21" was the Twin Turbine (silver /
    // sonic carbon). Dropped Arachnid here (it duplicated the Sonic Carbon render).
    older: [
      { value: 'AeroTurbine19', label: 'Slipstream 19"' },
      { value: 'TwinTurbine21Silver', label: 'Twin Turbine 21"' },
      { value: 'TwinTurbine21Carbon', label: 'Sonic Carbon 21"' },
    ],
  },
  model3: {
    new: [
      { value: 'PinwheelRefresh18', label: 'Photon 18"' },
      { value: 'Helix19', label: 'Nova 19"' },
      { value: 'Riptide20', label: 'Warp 20"' },
    ],
    older: [
      { value: 'Pinwheel18', label: 'Aero 18"' },
      { value: 'Stiletto19', label: 'Sport 19"' },
      { value: 'UberTurbine20Gunpowder', label: 'Überturbine 20"' },
    ],
  },
  modelX: {
    // Cyberstream 20" (the real refresh-X standard) is UNRENDERABLE in this build —
    // Wheels_Palladium/Cyberstream.fbx is missing, so it fails to load and keeps the
    // previous wheel. Same for the other Palladium (.fbx) wheels. Until that mesh is
    // added + the .pck re-exported, offer the two Turbine finishes (Wheels_X_S .obj,
    // both present + distinct).
    new: [
      { value: 'Turbine22', label: 'Turbine 22"' },
      { value: 'Turbine22Dark', label: 'Onyx Turbine 22"' },
    ],
    older: [
      { value: 'Slipstream20Carbon', label: 'Slipstream 20"' },
      { value: 'Turbine22Dark', label: 'Onyx Turbine 22"' },
    ],
  },
  modelY: {
    new: [
      { value: 'Crossflow19', label: 'Crossflow 19"' },
      { value: 'HelixV220', label: 'Helix 20"' },
      { value: 'ArachnidV221', label: 'Arachnid 21"' },
    ],
    older: [
      { value: 'Gemini19Square', label: 'Gemini 19"' },
      { value: 'Induction20Black', label: 'Induction 20"' },
      { value: 'UberTurbine21Black', label: 'Überturbine 21"' },
    ],
  },
};

export function wheelsFor(base: BaseModel, body: BodyGen): WheelOption[] {
  return WHEELS_BY_MODEL_GEN[base][body];
}

// ── Interior ─────────────────────────────────────────────────────────────
// `value` is a key in VehicleOptions.InteriorMap (via Vehicle.set_interior_type →
// InteriorMap.get(key, Black)); unknown → black. Interior shows in the interior /
// climate camera, not the exterior hero. `swatch` is a curated display hex.
//
// Per-model (interiors barely changed across facelifts): 3 / Y offer Black + White;
// S / X add Cream. FIRST = default.
export interface InteriorOption {
  value: string;
  label: string;
  swatch: string;
}

const I = {
  // A visibly-dark grey, not pure black, so the swatch reads as a real chip.
  Black: { value: 'Black', label: 'Black', swatch: '#232326' },
  White: { value: 'White', label: 'White', swatch: '#DDDDDE' },
  Cream: { value: 'Cream', label: 'Cream', swatch: '#CDBBA0' },
} as const satisfies Record<string, InteriorOption>;

export const INTERIORS_BY_MODEL: Record<BaseModel, InteriorOption[]> = {
  modelS: [I.Black, I.Cream, I.White],
  model3: [I.Black, I.White],
  modelX: [I.Black, I.Cream, I.White],
  modelY: [I.Black, I.White],
};

// The configurator's pre-selected defaults: the first entry of each (model × gen)
// list, so opening the flow (and switching model/body) reflects a sensible stock look.
export function defaultColorFor(base: BaseModel, body: BodyGen): string {
  return colorsFor(base, body)[0].value;
}

export function defaultWheelFor(base: BaseModel, body: BodyGen): string {
  return wheelsFor(base, body)[0].value;
}

export function defaultInteriorFor(base: BaseModel): string {
  return INTERIORS_BY_MODEL[base][0].value;
}

export function defaultTrimFor(base: BaseModel): TrimOption {
  return TRIMS_BY_MODEL[base][0];
}
