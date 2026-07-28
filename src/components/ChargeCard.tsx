import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { TeslaFonts } from '@/constants/fonts';
import { controlHaptic } from '@/state/controlHaptic';
import { ChargeLimitSlider } from './ChargeLimitSlider';
import { AmpStepper } from './AmpStepper';

// ChargeCard — the home-screen charging panel.
//
// Recovered, see docs/superpowers/research/tesla-charge-row-FINDINGS.md. It is
// `DynamicRowTypes.Charging`, a SIBLING of `MediaControl` in the same row list
// below favourites.
//
// ⚠️ IT IS NOT FIXED-HEIGHT. I previously read these out of the home screen —
//
//     ChargingAlerts   30 * Gutter    Charging  30 * Gutter    MediaControl  14 * Gutter
//
// — and hardcoded 300. Those numbers are real but they are ACCUMULATED SCROLL
// OFFSETS: they feed `interpolate({inputRange: [...]})` a few lines later, not
// any view's height. The MediaControl 14*Gutter = 140 happening to equal the
// media card's two 70pt panels made the misreading look corroborated.
//
// Measured off Ivan's side-by-side (both ~3 px/pt): THEIRS IS ~226pt, ours was
// 305. Their panel sizes to its CONTENT — which it must, since a state with no
// Start button is shorter than one with it. Hence no fixed height here, and no
// space-between: the empty gaps in ours were a fixed box distributing slack.
//
// Chain: dynamic-row switch -> VehicleChargeRow (container) -> ChargeRow
// (presentational). The conditional logic is `chargeRowStateSelector`, which
// returns {chargeLimit, defaultChargeToMax, range, scheduledChargingText,
// dischargeLimit, dischargeLimitSocRange} off getSelectedVehicleIsPluggedIn /
// ChargePortOpen / isChargingSelector / getIsChargeStopped /
// getDisplayStartButtonSelector / sliderMax / sliderSnapPoints.
//
// DELIBERATELY OMITTED, not stubbed (Ivan's call): powershare / V2H
// (dischargeLimit, StopRestartPowershareButton), Semi, supercharger session and
// billing, ReportIssueButton. None of it applies to this car and none of it is
// reachable over BLE, so a placeholder would be a lie about a capability.
const GUTTER = 10;
const PANEL_RADIUS = 0.5 * GUTTER;
const PANEL_BG = '#222324';
const TEXT = '#F3F3F3';
const TEXT_LIGHT = '#8A8B8B';

// Their slider is `sliderMax` + `sliderSnapPoints`. The car supplies the real
// bounds (charge_limit_soc_min/max/std); these are the fallbacks for a car that
// has not reported them yet, NOT hardcoded truth.
const LIMIT_MIN = 50;
const LIMIT_MAX = 100;

export interface ChargeCardProps {
  batteryLevel: number | null;
  rangeMiles: number | null;
  chargeLimitPercent: number;
  chargingState: string | null;
  charging: boolean;
  chargePortOpen: boolean;
  cableAttached: boolean;
  // Still plumbed, deliberately unrendered. Their idle panel's second line is
  // the LAST session's energy (verified from Ivan's side-by-side); what it shows
  // WHILE charging is not verified, and the fake presets cannot settle it since
  // they are my own invention. These are the fields that line would need.
  minutesToChargeLimit: number | null;
  chargerPowerKw: number | null;
  chargeRateMph: number | null;
  energyAddedKwh: number | null;
  chargingAmps: number;
  ampMin: number;
  ampMax: number;
  useMiles: boolean;
  onSetChargeLimit: (percent: number) => void;
  onSetAmps: (amps: number) => void;
  /**
   * Keys with a command in flight. Their pattern, recovered:
   *   disabled = useCommandTypeBusyStatus(CHARGINGSTARTSTOPACTION).busy
   * i.e. a control is DISABLED only while ITS OWN command is running — never to
   * express "this does not apply here". That case is a HIDE.
   */
  pending?: ReadonlySet<string>;
  /** Lets Home freeze its ScrollView while the slider drag owns the touch. */
  onSlidingChange?: (sliding: boolean) => void;
  onStartStopCharging: (start: boolean) => void;
  onToggleChargePort: (open: boolean) => void;
}

export function ChargeCard({
  batteryLevel,
  chargeLimitPercent,
  charging,
  chargePortOpen,
  cableAttached,
  energyAddedKwh,
  chargingAmps,
  ampMin,
  ampMax,
  onSetChargeLimit,
  onSetAmps,
  pending,
  onSlidingChange,
  onStartStopCharging,
  onToggleChargePort,
}: ChargeCardProps) {
  // The label tracks the finger; the CAR is only told on release. Without this
  // the label could not move during a drag, since the committed value does not
  // change until the end.
  const [liveLimit, setLiveLimit] = useState<number | null>(null);

  return (
    <View style={styles.card}>
      {/* Their panel has NO status/battery header row — Ivan's side-by-side is
          unambiguous: the FIRST line is "Charge limit: N%". The percentage and
          range live in the app header above, so repeating them here was mine,
          not theirs, and it pushed everything else down.

          Type comes from app/charging.tsx's own limitLabel (19/700), so the two
          screens read the same. */}
      <Text style={styles.limitLabel}>Charge limit: {Math.round(liveLimit ?? chargeLimitPercent)}%</Text>

      {/* Recovered: `vehicle_charge_screen_range_added` =
          "{{range}} added during last charging session", filled by
          getChargeAddedText(chargeState, guiSettings) and gated by
          isChargeAddedNotNil(...). The placeholder is {{range}} because the same
          slot carries EITHER energy or distance:

              guiChargeRateUnits === ChargeRateUnit.KW ? charge_energy_added
                                                       : charge_miles_added_rated

          We do not read GuiSettings yet, so we always take the kWh branch — which
          is what Ivan's car shows. Unit-switching is blocked on getGuiSettings.

          Gate is non-nil, matching their isSomething. My earlier `> 0` would have
          hidden a legitimately-reported zero. */}
      {energyAddedKwh != null ? (
        <Text style={styles.statusText} numberOfLines={1}>
          {Math.round(energyAddedKwh)} kWh added during last charging session
        </Text>
      ) : null}

      {/* sliderContainer + targetSlider { overflow:'visible', width:'100%' }.
          Their slider takes usablePercentageCharged AND nominalPercentageCharged
          as SEPARATE fills, `target` as the thumb, plus snapPercentageLocations
          and a defaultChargeToMaxMarker. We have one SoC, so one fill — the
          nominal/usable split needs fields we do not read yet. */}
      <View style={styles.sliderContainer}>
        {/* The SAME control as app/charging.tsx — normal/changing states, the
            detent breaks that appear only while changing, and the growing thumb.
            Ivan: use ours and polish it, not a second one. */}
        <ChargeLimitSlider
          batteryPercent={batteryLevel}
          limitPercent={chargeLimitPercent}
          min={LIMIT_MIN}
          max={LIMIT_MAX}
          onChange={setLiveLimit}
          onCommit={(v) => {
            setLiveLimit(null);
            onSetChargeLimit(v);
          }}
          onSlidingChange={onSlidingChange}
        />
      </View>

      {/* Amperage. Ivan: "some of the states should have a way to change the
          amperage." Shown only with a cable in — the car rejects it otherwise,
          and a stepper that cannot work is worse than no stepper. */}
      {/* Amperage. Same wide bar as app/charging.tsx, via the SAME component —
          hold-to-repeat, and the chevron disappears at the bound rather than
          dimming.
          
          NOT gated on a cable. Ivan: on a parked, unplugged car Tesla still
          shows it, and that is right — the charge current is a SETTING for the
          next session, not an action on the current one. My "the car rejects it
          otherwise" was reasoning about a command, not about the control. */}
      {/* Extra air beneath it: measured ~23pt from the bar's bottom edge to the
          rule on the reference, against the card's 14pt rhythm. */}
      <View style={styles.ampWrap}>
        <AmpStepper amps={chargingAmps} min={ampMin} max={ampMax} onChange={() => {}} onCommit={onSetAmps} />
      </View>

      {/* The divider is the button row's TOP BORDER, not a sibling. As a
          sibling the card's `gap` put 10pt above AND below a 1pt line, which is
          20pt of air theirs does not have — most of "Open Charge Port takes more
          space". Their controlsDivider is still {height:1, width:'100%'};
          expressing it as a border just stops the flex gap from padding it. */}
      <View style={styles.controls}>
        {/* HIDDEN, not disabled, when there is no cable — start/stop is not a
            thing you can do to an unplugged car, and their ControlButtons omits
            the button in that case rather than dimming it. Disabled ONLY while
            its own command is in flight, which is their actual use of disabled. */}
        {cableAttached ? (
          <ChargeButton
            label={charging ? 'Stop Charging' : 'Start Charging'}
            disabled={!!pending?.has('charging')}
            onPress={() => onStartStopCharging(!charging)}
          />
        ) : null}
        {/* Same rule: with the cable latched the port cannot close, so the
            control goes rather than sitting there greyed. */}
        {chargePortOpen && cableAttached ? null : (
          <ChargeButton
            label={chargePortOpen ? 'Close Charge Port' : 'Open Charge Port'}
            disabled={!!pending?.has('chargePortOpen')}
            onPress={() => onToggleChargePort(!chargePortOpen)}
          />
        )}
      </View>
    </View>
  );
}

function ChargeButton({
  label,
  disabled,
  onPress,
}: {
  label: string;
  disabled: boolean;
  onPress: () => void;
}) {
  // Text only — theirs carries no icon, and it renders DIM rather than white.
  return (
    <Pressable
      style={({ pressed }) => [styles.controlButton, { opacity: disabled ? 0.35 : pressed ? 0.5 : 1 }]}
      disabled={disabled}
      onPress={() => {
        controlHaptic();
        onPress();
      }}
    >
      <Text style={styles.controlLabel} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: PANEL_BG,
    borderRadius: PANEL_RADIUS,
    marginBottom: 8,
    paddingHorizontal: 18,
    paddingTop: 18,
    // Zero: the button row's own 44pt height is the bottom space, exactly as in
    // theirs where the rule sits 44pt above the card's bottom edge.
    paddingBottom: 0,
    // Explicit rhythm instead of space-between. space-between on a fixed box is
    // what produced the dead air between the limit label and the slider.
    gap: 14,
  },
  // TextCategory.BodyLabel, the same 14/20/0.1 the rest of the recovered UI uses.
  sliderContainer: {
    alignSelf: 'stretch',
    marginVertical: 2,
  },




  statusText: {
    fontFamily: TeslaFonts.medium,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.1,
    color: TEXT_LIGHT,
  },
  // controlButtonContainer — space-evenly, with controlsDivider as its top
  // border. Negative horizontal margin so the rule spans the card edge to edge
  // like theirs, rather than stopping at the card's 18pt text padding.
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-evenly',
    marginHorizontal: -18,
    paddingHorizontal: 18,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.12)',
  },
  limitRow: {
    flexDirection: 'row',
  },
  ampWrap: {
    marginBottom: 9,
  },
  limitLabel: {
    fontFamily: TeslaFonts.medium,
    fontSize: 14,
    lineHeight: 20,
    letterSpacing: 0.1,
    color: TEXT,
  },
  ampLabel: {
    fontFamily: TeslaFonts.medium,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.1,
    color: TEXT_LIGHT,
  },
  controlButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 44,
  },
  controlLabel: {
    fontSize: 17,
    fontWeight: '600',
    // Dim, not white — theirs reads as a secondary action.
    color: TEXT_LIGHT,
  },
});
