// climateDisplay.ts — pure display rules for the Climate screen.
//
// Recovered from VehicleClimateScreen @5221432.

import type { CabinOverheatMode, ClimateKeeperMode } from '../types/vehicleTypes';

/**
 * Whether to show the "Approximate activation temperature" row.
 *
 * Their condition, read at @5221950:
 *
 *     supportsCabinOverheatProtection
 *       && supportsSetCabinOverheatProtectionTemp
 *       && cabinOverheatProtection === CABINOVERHEATPROTECTIONON
 *
 * So the row appears ONLY while COP is On. Not on Fan Only (our "No A/C" — their
 * own label for CABINOVERHEATPROTECTIONFANONLY is
 * `vehicle_climate_screen_cabin_overheat_protection_no_ac` = "No A/C"), and not
 * when Off. Which makes sense: an activation temperature is meaningless when
 * nothing activates, and Fan Only has no setpoint to reach.
 *
 * The two `supports*` flags are NOT on the BLE protos — they come from their
 * cloud vehicle config — so we cannot evaluate them and assume support. The
 * proto does carry `supportsFanOnlyCabinOverheatProtection`, which is a
 * different capability (whether the No A/C OPTION exists) and is not read yet.
 *
 * In the same branch, when COP is On but the temp is NOT settable, they show
 * getCabinOverheatProtectionText() instead — a description rather than a
 * control. We have no way to reach that state, so it is not modelled.
 */
export function showsOverheatActivationTemp(mode: CabinOverheatMode): boolean {
  return mode === 'on';
}

/**
 * The Home row's climate line — `getClimateDescriptionText` @3887821.
 *
 * I read this as a priority CASCADE the first time and it is not one: it is a
 * bright STATUS plus a dim DETAIL LIST, rendered as two sibling Texts (@3888124,
 * @3888130). Ivan's screenshot shows both at once — "Active · Interior 25°C" —
 * which a cascade cannot produce, and which is why our row showed a status with
 * no temperature.
 *
 *   status (bright, BodyLabel), only while climate is ON:
 *     bioweapon              -> "Bioweapon Defense Mode"
 *     keeper === ON          -> "Keep On"     <- ONLY the plain Keep Climate On
 *     otherwise              -> "Active"      <- Camp and Pet land HERE
 *
 *   detail (dim), always evaluated:
 *     [ "Interior {temp}", "Window(s) open" ].filter(present).join(" · ")
 *     prefixed with " · " when a status precedes it
 *
 *   plus, as its own element, "Cabin Overheat Protection" when actively cooling.
 *
 * The second mistake was mapping any keeper mode to "Keep On". Their check is
 * `climateKeeperMode === ClimateKeeperMode.ON` specifically (@3887847), so Camp
 * and Pet report "Active" — exactly what Ivan's Tesla screenshot shows next to a
 * tent glyph.
 */
export interface ClimateDescriptionInput {
  climateOn: boolean;
  bioweaponOn: boolean;
  climateKeeper: ClimateKeeperMode;
  interiorTempC: number | null;
  openWindowCount: number;
  copActivelyCooling: boolean;
}

export function climateStatusText(s: ClimateDescriptionInput): string | null {
  if (!s.climateOn) return null;
  if (s.bioweaponOn) return 'Bioweapon Defense Mode';
  if (s.climateKeeper === 'on') return 'Keep On';
  return 'Active';
}

export function climateDetailText(s: ClimateDescriptionInput): string | null {
  const parts: string[] = [];
  // `vehicle_climate_screen_interior_temp` = "Interior {{interior_temp}}".
  if (s.interiorTempC !== null) parts.push(`Interior ${Math.round(s.interiorTempC)}°C`);
  // Singular and plural are two separate keys of theirs, not a formatter.
  if (s.openWindowCount === 1) parts.push('Window open');
  else if (s.openWindowCount > 1) parts.push('Windows open');
  if (!parts.length) return null;
  return parts.join(' · ');
}

// Rendered as its own element, not folded into the detail list (@3888142).
export function climateOverheatText(s: ClimateDescriptionInput): string | null {
  return s.copActivelyCooling ? 'Cabin Overheat Protection' : null;
}

/**
 * `getActiveClimateIcon` @3888184 — the glyph beside the status. Bioweapon is
 * checked FIRST, before any keeper mode.
 */
export type ClimateStatusIcon = 'biohazard' | 'camp' | 'dog' | 'climate';

export function climateStatusIcon(s: ClimateDescriptionInput): ClimateStatusIcon | null {
  if (s.bioweaponOn) return 'biohazard';
  if (s.climateKeeper === 'camp') return 'camp';
  if (s.climateKeeper === 'pet') return 'dog';
  if (s.climateKeeper === 'on') return 'climate';
  return null;
}
