// climateDisplay.ts — pure display rules for the Climate screen.
//
// Recovered from VehicleClimateScreen @5221432.

import type { CabinOverheatMode } from '../types/vehicleTypes';

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
