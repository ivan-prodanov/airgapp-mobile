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
// below favourites:
//
//     ChargingAlerts   30 * Gutter = 300
//     Charging         30 * Gutter = 300      <- this
//     MediaControl     14 * Gutter = 140      <- the media card, two 70pt panels
//
// The 140 is a useful cross-check: it independently confirms the media card's
// two-panel structure from a second place in their code.
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
const PANEL_H = 30 * GUTTER; // 300 — their `Charging` row height
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

      {/* Their second line is the LAST SESSION's energy, not a live rate:
          "58 kWh added during last charging session" — charge_energy_added.
          I had put time-remaining and kW here, which is a different fact about a
          different session. Omitted entirely when the car reports nothing. */}
      {energyAddedKwh != null && energyAddedKwh > 0 ? (
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
      <AmpStepper amps={chargingAmps} min={ampMin} max={ampMax} onChange={() => {}} onCommit={onSetAmps} />

      {/* controlsDivider { height: 1, width: '100%' } then
          controlButtonContainer { flexDirection:'row', justifyContent:'space-evenly' }.
          My first cut had a short vertical rule BETWEEN the buttons; theirs is a
          full-width horizontal rule ABOVE them. */}
      <View style={styles.controlsDivider} />
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
    height: PANEL_H,
    backgroundColor: PANEL_BG,
    borderRadius: PANEL_RADIUS,
    marginBottom: 8,
    paddingHorizontal: 18,
    paddingVertical: 18,
    justifyContent: 'space-between',
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
  // controlsDivider { backgroundColor, height: 1, width: '100%' }
  controlsDivider: {
    height: 1,
    width: '100%',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  // controlButtonContainer — space-evenly, not a divider between two halves.
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-evenly',
    width: '100%',
  },
  limitRow: {
    flexDirection: 'row',
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
