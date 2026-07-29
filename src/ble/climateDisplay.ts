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
 * The Home row's climate line — `getClimateDescriptionText` @3887821, verbatim.
 *
 * Ivan asked why the interior temperature is sometimes hidden. On the CLIMATE
 * screen the answer is simple presence (see below). On HOME it is not a
 * temperature field at all: it is one line produced by a priority cascade, and
 * the temperature is only its first fallback.
 *
 *     if (climateOn)
 *       bioweapon        -> "Bioweapon Defense Mode"
 *       keeper !== off   -> "Keep On"
 *       otherwise        -> "Active"
 *     else
 *       interior temp    -> "Interior {temp}"
 *       any window open  -> "Window open" / "Windows open"
 *       COP cooling      -> "Cabin Overheat Protection"
 *       otherwise        -> nothing
 *
 * So the temperature disappears whenever ANYTHING more specific is true — most
 * often simply because the climate is running, in which case the row says what
 * it is doing instead of how warm the cabin is. That is the "sometimes hidden"
 * he was seeing, and it is a deliberate hierarchy rather than a data gap.
 *
 * Ours showed `showNum(interiorTempC)`, which renders an em-dash for an unknown
 * value — so with no data we printed "Interior —" where they print nothing, and
 * we never showed the other four states at all.
 *
 * Returns null for "render no line", which is a real outcome here, not an error.
 */
export interface ClimateDescriptionInput {
  climateOn: boolean;
  bioweaponOn: boolean;
  climateKeeper: ClimateKeeperMode;
  interiorTempC: number | null;
  openWindowCount: number;
  copActivelyCooling: boolean;
}

export function climateDescriptionText(s: ClimateDescriptionInput): string | null {
  if (s.climateOn) {
    if (s.bioweaponOn) return 'Bioweapon Defense Mode';
    if (s.climateKeeper !== 'off') return 'Keep On';
    return 'Active';
  }
  // `vehicle_climate_screen_interior_temp` is "Interior {{interior_temp}}" — the
  // unit travels with the value, as it does everywhere else in their UI.
  if (s.interiorTempC !== null) return `Interior ${Math.round(s.interiorTempC)}°C`;
  // Singular and plural are two separate keys of theirs, not a formatter.
  if (s.openWindowCount > 1) return 'Windows open';
  if (s.openWindowCount === 1) return 'Window open';
  if (s.copActivelyCooling) return 'Cabin Overheat Protection';
  return null;
}
