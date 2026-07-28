// The charge panel's TEXT model, recovered from `chargeRowStateSelector`
// (@3884280-3884400) and its helpers. Ivan: "right of Charge limit should be the
// current state no? while charging the text ... seems off it should be different".
// Both correct, and both were missing.
//
// Their selector returns `chargingStateText` (one string, right of the limit) and
// `chargingTextStrings` (an ARRAY rendered as a row under it). The array's
// contents depend on whether the car is charging:
//
//   NOT charging (@868):
//     [ tr('vehicle_charge_screen_range_added', {range: getChargeAddedText()}) ]
//
//   CHARGING (@971):
//     getVehicleChargingkWText()                  if isFastCharging || units===KW
//     getChargeRateDistanceDisplayValue()         if units !== KW
//     '+' + getChargeAddedText()                  if non-nil
//     getVehicleChargeSessionCostText()           if supercharger || roaming
//     getVehicleChargingCurrentAndVoltageText()   if !isFastCharging
//
// So while charging it is NOT "N kWh added during last charging session" — that
// line belongs to the idle state. Charging shows live values, and the added
// energy appears as a bare "+N kWh".

/**
 * What sits BETWEEN the charge limit and the state, @4157408.
 *
 * Not a layout gap — a literal string. They build
 *   ''.concat(SpecialCharacters.dotSeparator, '  ')  with `this` = '  '
 * i.e. two spaces, U+00B7 MIDDLE DOT, two spaces, and prepend it to the state
 * text. The result is ONE line: "Charge limit: 80%  ·  Charging".
 *
 * It is only prepended when the limit string is non-null — the separator never
 * leads.
 */
export const STATE_SEPARATOR = '  \u00b7  ';

/** getVehicleChargingStateText @1225331 — four branches on ChargingState. */
export function chargingStateText(chargingState: string | null): string | null {
  switch ((chargingState ?? '').toLowerCase()) {
    case 'charging':
      return 'Charging';
    case 'complete':
      return 'Charging Complete';
    case 'stopped':
      return 'Charging Stopped';
    case 'nopower':
      return 'No Power';
    // Disconnected / Starting / Unknown fall through: their switch has no arm for
    // them, so the header's right side is empty rather than guessing a label.
    default:
      return null;
  }
}

export interface ChargingTextInput {
  fastCharging: boolean;
  chargerPowerKw: number | null;
  energyAddedKwh: number | null;
  chargerActualCurrentA: number | null;
  chargerVoltageV: number | null;
}

/**
 * `chargingTextStrings` for a CHARGING car.
 *
 * Omitted deliberately, not stubbed: getChargeRateDistanceDisplayValue (needs
 * GuiSettings' units, which we do not read — we take the kW branch throughout,
 * the same assumption as the kWh line) and getVehicleChargeSessionCostText
 * (Supercharger billing, cloud-only).
 */
export function chargingTextStrings(v: ChargingTextInput): string[] {
  const out: string[] = [];

  if (v.chargerPowerKw != null) {
    // Sub-10 kW rates read as "7.4 kW"; above that the decimal is noise.
    const kw = v.chargerPowerKw < 10 ? Math.round(v.chargerPowerKw * 10) / 10 : Math.round(v.chargerPowerKw);
    out.push(`${kw} kW`);
  }

  // The SAME number the idle line spells out, here as a bare delta.
  if (v.energyAddedKwh != null) out.push(`+${Math.round(v.energyAddedKwh)} kWh`);

  // getVehicleChargingCurrentAndVoltageText: `<n>A` and `<n>V` joined by
  // SpecialCharacters.dotSeparator, and skipped entirely on DC.
  if (!v.fastCharging) {
    const parts: string[] = [];
    if (v.chargerActualCurrentA != null) parts.push(`${Math.round(v.chargerActualCurrentA)}A`);
    if (v.chargerVoltageV != null) parts.push(`${Math.round(v.chargerVoltageV)}V`);
    if (parts.length) out.push(parts.join(' \u00b7 '));
  }

  return out;
}
