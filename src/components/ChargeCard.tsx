import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { TeslaFonts } from '@/constants/fonts';
import { controlHaptic } from '@/state/controlHaptic';
import { chargingStateText, chargingTextStrings, STATE_SEPARATOR } from './chargeText';
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
// Every number below is READ OUT OF ChargeRow's own StyleSheet, not measured off
// a screenshot. Ivan: "you didnt copy it, you invented it on your own" — he was
// right, the previous pass was pixel-estimates wearing a recovery's clothes.
//
//   container              marginBottom Gutter, paddingTop 1.5*Gutter, minHeight 8*Gutter
//   containerNonCT         bg Themes[DARK].secondaryBackgroundColor, radius Gutter*0.5, opacity .95
//   chargeTextContainer    marginHorizontal 0.5*Gutter        <- WRAPS the texts AND the slider
//   statusText             marginHorizontal 1.5*Gutter, UniversalSans Medium
//   chargeRateText(x)      row, marginTop 0.5*Gutter, marginBottom x ? Gutter : 0
//   sliderContainer        alignSelf flex-start, height 3*Gutter, marginHorizontal 1.5*Gutter
//   targetSlider           overflow visible, width 100%
//   ampsContainer          marginHorizontal 1.5*Gutter + 0.5*Gutter, marginTop 1.5*Gutter
//   bottomCardMargin       marginBottom 2.5*Gutter          <- wraps the amps
//   controlsDivider        height 1, bg Themes[DARK].backgroundColor
//   controlButtonContainer row, space-evenly, alignItems center, width 100%
//   button                 flex 1, opacity 0.9
//   chargeButton           minHeight 46, paddingVertical 13
//   chargeButtonText       textAlign center   (font = Button SMALL -> BodyLabel 14/20/.1)
//   buttonDivider          width 1, height 100%, bg Themes[DARK].backgroundColor
//
// THE INSETS COMPOSE — this is what I got wrong twice. sliderContainer and the
// texts are CHILDREN of chargeTextContainer, not siblings of it, so their 15
// stacks on its 5:
//
//     text    chargeTextContainer 5 + statusText      15 = 20
//     slider  chargeTextContainer 5 + sliderContainer 15 = 20
//     amps                            ampsContainer   20 = 20
//
// All three share one left edge at 20 from the card, which is exactly what
// Ivan's screenshot shows. My first pass used one paddingHorizontal 18 for
// everything; my second read 5/15/20 off the StyleSheet and applied them as
// siblings, which rendered 5/5/15 — three different edges, none of them right.
// Reading the values was not enough; the tree had to be read too.
//
// The card itself sits at homeScreenGutter - homeScreenBoxGutter = 20 - 10 = 10
// from the screen edge, not the 16 the surrounding menu uses.
const GUTTER = 10;
const PANEL_RADIUS = 0.5 * GUTTER;
/**
 * Where the card sits from the SCREEN edge:
 * Specifications.homeScreenGutter(20) - homeScreenBoxGutter(10).
 *
 * The card applies no horizontal margin of its own. It used to undo a
 * hardcoded `MENU_PADDING = 16`, which worked only because HomeScreen's menu
 * happened to pad 16 — and the charging screen happens to pad 16 too, so the
 * bug would have hidden itself. A component silently cancelling one specific
 * parent's padding is a trap; each screen now offsets it explicitly against its
 * own padding, and a screen that changes its padding gets a visible mismatch
 * rather than a silent one.
 */
export const CHARGE_CARD_SCREEN_INSET = 10;
const PANEL_BG = '#222324';
const TEXT = '#F3F3F3';
const TEXT_LIGHT = '#8A8B8B';
// The page behind the card. The divider is drawn in it so the row reads as
// separated rather than ruled — the same trick as MediaCard's 1pt gaps.
const PAGE_BG = '#000000';

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
  // These feed `chargingTextStrings` — see chargeText.ts. The note that used to
  // sit here said the charging-state line "is not verified"; it is now, from
  // chargeRowStateSelector, so they are rendered rather than merely plumbed.
  minutesToChargeLimit: number | null;
  chargerPowerKw: number | null;
  chargeRateMph: number | null;
  energyAddedKwh: number | null;
  /**
   * DC / Supercharger. HIDES the amp stepper — recovered gate (@4157698):
   *   apiVersion >= MIN_SET_CHARGE_AMPS_CAR_API_VERSION && !vehicleIsSemi
   *     && fastcharging !== true && !showPowershareDischargingContent
   * The other three terms do not vary for us (no Semi, no powershare, and the
   * car is well past the API floor), so `fastCharging` is the whole gate here.
   */
  fastCharging: boolean;
  chargerActualCurrentA: number | null;
  chargerVoltageV: number | null;
  chargerPilotCurrentA: number | null;
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
  /** Unlatch a seated cable — fires openChargePort explicitly (see the button below). */
  onUnlockChargePort: () => void;
}

export function ChargeCard({
  batteryLevel,
  chargeLimitPercent,
  chargingState,
  charging,
  chargePortOpen,
  cableAttached,
  chargerPowerKw,
  energyAddedKwh,
  fastCharging,
  chargerActualCurrentA,
  chargerVoltageV,
  chargerPilotCurrentA,
  chargingAmps,
  ampMin,
  ampMax,
  onSetChargeLimit,
  onSetAmps,
  pending,
  onSlidingChange,
  onStartStopCharging,
  onToggleChargePort,
  onUnlockChargePort,
}: ChargeCardProps) {
  // The label tracks the finger; the CAR is only told on release. Without this
  // the label could not move during a drag, since the committed value does not
  // change until the end.
  const [liveLimit, setLiveLimit] = useState<number | null>(null);
  const stateText = chargingStateText(chargingState);
  // A NoPower car cannot be charging, so a definitive NoPower read overrides the
  // optimistic `charging` — otherwise pressing Start on a dead 3rd-party charger
  // (no session paid) leaves the button stuck on "Stop". Tesla's
  // getDisplayStartButtonSelector derives from the live charge state + ongoing
  // command; this is the narrow, no-refactor version of that (the layered-optimism
  // rework is the P0 item). Only NoPower overrides — Stopped/Starting are normal
  // transitions on the way to Charging and must not flicker the button.
  const noPower = (chargingState ?? '').toLowerCase() === 'nopower';
  const showStop = charging && !noPower;

  return (
    <View style={styles.card}>
      {/* Their panel has NO status/battery header row — Ivan's side-by-side is
          unambiguous: the FIRST line is "Charge limit: N%". The percentage and
          range live in the app header above, so repeating them here was mine,
          not theirs, and it pushed everything else down.

          Type comes from app/charging.tsx's own limitLabel (19/700), so the two
          screens read the same. */}
      {/* chargeStateHeader @4157228. My first pass put the state text on the far
          right as a second flex child, reasoning from the space-between. Wrong
          on both counts:

            1. The state is a NESTED <Text> INSIDE the limit <Text>, so it runs
               INLINE — "Charge limit: 80%  ·  Charging" — not right-aligned.
            2. The space-between exists for chargeStateHeader's OTHER child: a
               charge-limit-reason tooltip icon (`showChargeLimitingIcon` +
               chargeControllerTipIconContainer). That is what gets pushed right,
               not the state.

          So the space-between was real and my reading of WHY was invented. We do
          not surface the tooltip (it needs getChargeLimitReason, cloud-side), so
          the row has one child — kept as a row anyway, since that is the shape
          the icon would slot into. */}
      <View style={styles.textBlock}>
        <View style={styles.headerRow}>
          <Text style={styles.limitLabel}>
            Charge limit: {Math.round(liveLimit ?? chargeLimitPercent)}%
            {stateText ? (
              <Text style={styles.headerState}>
                {STATE_SEPARATOR}
                {stateText}
              </Text>
            ) : null}
          </Text>
        </View>

        {/* chargeRateText — a ROW of `chargingTextStrings`, not one fixed line.
            idle     -> ["N kWh added during last charging session"]
            charging -> ["7.4 kW", "+12 kWh", "16A \u00b7 230V"]
          See chargeText.ts for the recovered branch table. Ours only ever had
          the idle line, so a charging car showed a sentence about the last
          session instead of what the car is doing right now. */}
        {charging ? (
          <View style={styles.statusRow}>
            {chargingTextStrings({
              fastCharging,
              chargerPowerKw,
              energyAddedKwh,
              chargerActualCurrentA,
              chargerVoltageV,
              chargerPilotCurrentA,
            }).map((line, i) => (
              <Text key={line} style={[styles.statusItem, i > 0 && styles.statusGap]}>
                {line}
              </Text>
            ))}
          </View>
        ) : energyAddedKwh != null ? (
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
            boxHeight={3 * GUTTER}
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
      {/* bottomCardMargin (25) wraps ampsContainer (marginTop 15, inset 20).
          The WRAPPER stays even when the stepper is hidden — theirs builds it
          unconditionally and only its child is conditional, so the 25pt gap
          above the divider survives a DC session. */}
      <View style={styles.ampWrap}>
        {fastCharging ? null : (
          <View style={styles.ampsContainer}>
            <AmpStepper
              amps={chargingAmps}
              min={ampMin}
              max={ampMax}
              onChange={() => {}}
              onCommit={onSetAmps}
            />
          </View>
        )}
      </View>

      {/* controlsDivider is a real sibling View in theirs. It was safe to fold
          into a border only while the card had a uniform `gap`; the card now
          uses per-child margins, so the sibling form is both faithful and free. */}
      <View style={styles.controlsDivider} />
      <View style={styles.controls}>
        {/* HIDDEN, not disabled, when there is no cable — start/stop is not a
            thing you can do to an unplugged car, and their ControlButtons omits
            the button in that case rather than dimming it. Disabled ONLY while
            its own command is in flight, which is their actual use of disabled. */}
        {cableAttached ? (
          <ChargeButton
            label={showStop ? 'Stop Charging' : 'Start Charging'}
            disabled={!!pending?.has('charging')}
            onPress={() => onStartStopCharging(!showStop)}
          />
        ) : null}
        {/* buttonDivider — only between two buttons, never dangling beside one. */}
        {cableAttached ? <View style={styles.buttonDivider} /> : null}
        {/* THE RIGHT-HAND BUTTON IS ALWAYS PRESENT — it just changes identity.
            Recovered from ControlButtons: the plugged-in branch renders
            _closure1_slot21 = UnlockChargePortButton, and only the UNPLUGGED
            branch renders slot25 = OpenCloseChargePortButton.

            We had no Unlock button at all, and instead HID the port control
            whenever the cable was in — so a plugged-in car showed Start/Stop
            alone, where theirs shows two.

            Its command is the same one: RKE_ACTION_OPEN_CHARGE_PORT. With a
            cable seated that releases the latch rather than opening a door,
            which is why the label differs and the action does not. Exactly the
            frunk lesson again — one command, two meanings by context. */}
        {cableAttached ? (
          <ChargeButton
            label="Unlock Charge Port"
            // Explicit openChargePort (unlatch) — the port is already open, so
            // `onToggleChargePort(true)` diffed to nothing and never fired. No
            // pending affordance because we claim no keys (frunk re-actuate).
            disabled={false}
            onPress={onUnlockChargePort}
          />
        ) : (
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
  // container + containerNonCT.
  card: {
    backgroundColor: PANEL_BG,
    borderRadius: PANEL_RADIUS,
    marginBottom: GUTTER,
    minHeight: 8 * GUTTER,
    paddingTop: 1.5 * GUTTER,
    paddingBottom: 0,
    opacity: 0.95,
  },
  // sliderContainer. The height is FIXED at 3*Gutter and targetSlider is
  // overflow:'visible' inside it — which is how their thumb can grow past the
  // track without the row reflowing. This is the piece I had been guessing at.
  sliderContainer: {
    height: 3 * GUTTER,
    marginHorizontal: 1.5 * GUTTER,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  // The nested state Text. Same statusText face and size as the limit it runs
  // on from — only the colour differs (textColorLight vs textColor). No margins:
  // it is inline inside the parent Text, where they would not apply anyway.
  headerState: {
    fontFamily: TeslaFonts.medium,
    fontSize: 14,
    lineHeight: 20,
    letterSpacing: 0.1,
    color: TEXT_LIGHT,
  },
  // chargeRateText — the row the charging strings sit in. It carries the 15pt
  // inset itself; the items inside must NOT also carry statusText's
  // marginHorizontal or every one of them would be pushed a further 15.
  statusRow: {
    flexDirection: 'row',
    marginHorizontal: 1.5 * GUTTER,
    marginTop: 0.5 * GUTTER,
    marginBottom: GUTTER,
  },
  // chargingText(i) — marginLeft 1.5*Gutter on every item but the first, so the
  // row reads as separated values rather than a run-on string.
  statusGap: {
    marginLeft: 1.5 * GUTTER,
  },
  statusItem: {
    fontFamily: TeslaFonts.medium,
    fontSize: 14,
    lineHeight: 20,
    letterSpacing: 0.1,
    color: TEXT_LIGHT,
  },
  // chargeTextContainer.
  textBlock: {
    marginHorizontal: 0.5 * GUTTER,
  },
  // chargeRateText(hasValue) — marginTop 0.5*Gutter, marginBottom Gutter.
  // statusText — marginHorizontal 1.5*Gutter, INSIDE chargeTextContainer's 0.5.
  // The marginTop/Bottom are chargeRateText's, folded in: that wrapper is a row
  // only so an icon can sit beside the text, and we render text alone.
  statusText: {
    marginHorizontal: 1.5 * GUTTER,
    marginTop: 0.5 * GUTTER,
    marginBottom: GUTTER,
    fontFamily: TeslaFonts.medium,
    // BodyLabel, not CaptionLabel. The `statusText` style itself carries no
    // fontSize — it comes from the Text's category, and all four of their
    // statusText call sites (@4157150, @4157222, @4158084, @4158122) pass
    // category={TextCategory.BodyLabel}. We had CaptionLabel 12/16, which is
    // why ours read smaller. Same trap as the tyre labels: the size was in the
    // call site, not the style.
    fontSize: 14,
    lineHeight: 20,
    letterSpacing: 0.1,
    color: TEXT_LIGHT,
  },
  // controlsDivider — a real 1pt View painted in Themes[DARK].backgroundColor,
  // i.e. the PAGE colour, which is why Ivan read it as transparent. Ours was
  // rgba(255,255,255,0.12): LIGHTER than the card it sat on, the exact opposite.
  controlsDivider: {
    height: 1,
    backgroundColor: PAGE_BG,
  },
  // buttonDivider — the same page colour, but VERTICAL, separating the two
  // buttons. I had no such thing.
  buttonDivider: {
    width: 1,
    alignSelf: 'stretch',
    backgroundColor: PAGE_BG,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-evenly',
    width: '100%',
  },
  // bottomCardMargin wraps the amps; ampsContainer is the amps' own inset.
  ampWrap: {
    marginBottom: 2.5 * GUTTER,
  },
  ampsContainer: {
    marginTop: 1.5 * GUTTER,
    marginHorizontal: 1.5 * GUTTER + 0.5 * GUTTER,
  },
  limitLabel: {
    marginHorizontal: 1.5 * GUTTER,
    fontFamily: TeslaFonts.medium,
    fontSize: 14,
    lineHeight: 20,
    letterSpacing: 0.1,
    color: TEXT,
  },
  // button {flex:1, opacity:0.9} + chargeButton {minHeight:46, paddingVertical:13}.
  controlButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 46,
    paddingVertical: 13,
    opacity: 0.9,
  },
  // ButtonSize.SMALL resolves to TextCategory.BodyLabel via getButtonFontStyle —
  // 14/20/0.1, NOT the 16 (and before that 17) I had. That is Ivan's "the text
  // size differs". Colour is textColorLight, from the GHOST appearance.
  controlLabel: {
    fontFamily: TeslaFonts.medium,
    fontSize: 14,
    lineHeight: 20,
    letterSpacing: 0.1,
    textAlign: 'center',
    color: TEXT_LIGHT,
  },
});
