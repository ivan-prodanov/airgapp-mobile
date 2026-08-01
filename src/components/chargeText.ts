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

/**
 * The same string joins the current and voltage inside
 * getVehicleChargingCurrentAndVoltageText (@1232034) — `''.concat(dotSeparator,
 * '  ')` with `this` = '  '. I had used single spaces there on the assumption
 * that a value-join would be tighter than a sentence-join. It is not; it is the
 * identical separator.
 */
export const VALUE_SEPARATOR = STATE_SEPARATOR;

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
      // VERIFIED 2026-08-01 from the translation table (main.decompiled.js:926615):
      // `vehicle_status_screen_charging_no_power` = 'Charging Error - No Power'.
      // This was originally GUESSED from the key name and happens to be exactly
      // right. Ivan asked whether this state is expected — it is: the car reports
      // chargingState=NoPower when a cable is seated but no current flows (e.g. an
      // unpaid 3rd-party charger), and this is Tesla's literal string for it.
      return 'Charging Error - No Power';
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
  /** charger_pilot_current — the "/32" half of "16/32A". */
  chargerPilotCurrentA: number | null;
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

  // getVehicleChargingkWText @1231816 is exactly
  //     Math.round(Math.max(0, chargerPower)) + ' ' + ChargeUnit.KILOWATTS
  // — an INTEGER, always. My "keep a decimal below 10 where it carries
  // information" was a reasonable-sounding rule I made up; theirs shows "7 kW"
  // for a 7.4 kW supply.
  if (v.chargerPowerKw != null) out.push(`${Math.round(Math.max(0, v.chargerPowerKw))} kW`);

  // The SAME number the idle line spells out, here as a bare delta.
  if (v.energyAddedKwh != null) out.push(`+${Math.round(v.energyAddedKwh)} kWh`);

  // getVehicleChargingCurrentAndVoltageText @1231969, skipped entirely on DC:
  //
  //   actual  = Math.round(Math.max(0, charger_actual_current))
  //   nominal = charger_pilot_current
  //   current = (actual != null && nominal != null) ? `${actual}/${nominal}A`
  //                                                 : `${actual ?? 0}A`
  //   voltage = charger_voltage != null ? `${voltage}V` : null
  //   -> [current, voltage].join(VALUE_SEPARATOR)   (voltage dropped if null)
  //
  // ONE deviation, deliberate: theirs always emits a current part, falling back
  // to "0A". For them a null means the car reported nothing; for us it can also
  // mean we have not read it yet, and printing "0A" for "unknown" is a
  // fabricated reading. So when we have neither current nor voltage we omit the
  // item entirely — but the moment we have either, we mirror them exactly,
  // including the 0 fallback.
  if (!v.fastCharging && (v.chargerActualCurrentA != null || v.chargerVoltageV != null)) {
    const actual = v.chargerActualCurrentA != null ? Math.round(Math.max(0, v.chargerActualCurrentA)) : null;
    const nominal = v.chargerPilotCurrentA;
    const current =
      actual != null && nominal != null ? `${actual}/${Math.round(nominal)}A` : `${actual ?? 0}A`;
    const parts = [current];
    if (v.chargerVoltageV != null) parts.push(`${Math.round(v.chargerVoltageV)}V`);
    out.push(parts.join(VALUE_SEPARATOR));
  }

  return out;
}
