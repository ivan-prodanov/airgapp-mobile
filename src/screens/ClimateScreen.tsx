import { useRef, type ReactNode } from 'react';
import {
  Alert,
  Animated,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import * as Haptics from 'expo-haptics';

import { ClimateMarkerOverlay } from '../godot/ClimateMarkerOverlay';
import { showNum } from '../state/readProbe';
import { showsOverheatActivationTemp } from '../ble/climateDisplay';
import { TeslaFonts } from '../constants/fonts';
import { useCarLinkStatus } from '../state/VehicleProvider';
import { vehicleStatusText } from '../ble/vehicleStatusText';
import { StatusBarFade } from '../components/StatusBarFade';
import { SHEET_SPRING } from '../godot/cardTransition';
import { HI_TEMP, LO_TEMP } from '../state/fleet';
import type { VehicleActions } from '../state/useVehicleState';
import type { CabinOverheatMode, CabinOverheatTemp, VehicleViewState } from '../types/vehicleTypes';

interface Props {
  state: VehicleViewState;
  actions: VehicleActions;
}

// The dial domain (LO, 15.5, 16.0 … 27.5, HI in 0.5° steps) now lives with the setpoint state in
// fleet.ts, which clamps to it; the bounds double as the LO/HI sentinels this formatter renders.
// The degree sign is NOT part of the number. Tesla renders two sibling Texts
// inside `temperatureTextContainer` (@5223200): the value in `temperatureText`
// (Light 40/40) and '\u00b0' on its own in `temperatureDegreeText` — a DIFFERENT
// face and size, Medium 30 on the same 40 line box. Baking the degree into the
// number string rendered it Light 40 like the digits, which is what made it look
// wrong. LO and HI carry no degree sign.
const formatTemp = (v: number) => (v <= LO_TEMP ? 'LO' : v >= HI_TEMP ? 'HI' : v.toFixed(1));
const hasDegree = (v: number) => v > LO_TEMP && v < HI_TEMP;
// Rubber-band overscroll past the snap bounds — copied from the Tesla app, which uses
// @gorhom/bottom-sheet's overDrag: you can pull slightly past expanded/collapsed against a
// √-diminishing resistance, then it springs back on release. `expanded` = top (smaller Y),
// `collapsed` = bottom (larger Y). This is Gorhom's exact formula (sqrt(1 + overshoot) * factor).
const OVERDRAG_RESIST = 2.5; // @gorhom/bottom-sheet's overDragResistanceFactor default, as Tesla ships it
const overDrag = (y: number, expanded: number, collapsed: number) => {
  if (y < expanded) {
    return expanded - Math.sqrt(1 + (expanded - y)) * OVERDRAG_RESIST;
  }
  if (y > collapsed) {
    return collapsed + Math.sqrt(1 + (y - collapsed)) * OVERDRAG_RESIST;
  }
  return y;
};

const tap = () => Haptics.selectionAsync().catch(() => {});
const bump = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});

// Climate controls — RN build of the Tesla climate sheet. The bar is a bottom-anchored panel that you
// drag up/down BY THE PANEL ITSELF (like the real app — swiping above it, on the car, does nothing).
// Collapsed it shows the temp row; dragging up reveals Defrost / Bioweapon / Camp / Pet / Cabin Overheat.
export function ClimateScreen({ state, actions }: Props) {
  // Dim the read-only cabin temps when the data is stale (cached, not fresh) —
  // the same §C3 fade the Home battery row uses.
  const carLink = useCarLinkStatus();
  const tempsStale = vehicleStatusText({
    linked: carLink.linked,
    lastVehicleDataAt: carLink.lastVehicleDataAt,
    awake: state.awake,
    wakeInFlight: carLink.wakeInFlight,
    now: Date.now(),
  }).stale;
  const { height } = useWindowDimensions();

  // Collapsed peek = how much of the panel shows at rest.
  //
  // 270 is THEIR literal — the Climate sheet is a @gorhom/bottom-sheet with
  // `snapPoints: [270]`, the only snapPoint in the module, identical on iOS 4.56
  // and Android 4.58 (tesla-climate-sheet-FINDINGS §1a). It mounts collapsed at
  // detent 0 and can never be dismissed (`enablePanDownToClose: false`).
  //
  // This was `height * 0.25` = 213 — 57pt too short. That is the whole of the
  // user's "ours shows more hood": the car band is FIXED at 59..612 on both
  // apps, so their 270 sheet (top 582) covers the bottom 30pt of the car while
  // our 213 sheet (top 639) covered nothing and left a 27pt gap. Same car
  // pixels, different occlusion — the RE proved nothing scales the car per-view.
  const PEEK = 270;

  // Bottom-anchored panel translated down by `translateY`; snaps between collapsed and expanded.
  const translateY = useRef(new Animated.Value(height)).current;
  const snap = useRef({ collapsed: height, expanded: 0 });
  const restingY = useRef(height);
  const measured = useRef(false);

  const onSheetLayout = (e: { nativeEvent: { layout: { height: number } } }) => {
    const h = e.nativeEvent.layout.height;
    const collapsed = Math.max(0, h - PEEK);
    snap.current = { collapsed, expanded: 0 };
    if (!measured.current) {
      measured.current = true;
      restingY.current = collapsed;
      // SLIDE UP from off-screen on first layout — this used to be a
      // `setValue(collapsed)`, i.e. instant, which is why our sheet just
      // appeared while theirs travels.
      //
      // Mechanism, from tesla-climate-sheet-slide-FINDINGS §1: their sheet's
      // container carries `transform: [{translateY: animatedPosition}]`
      // (gorhom's BottomSheetBody), `animatedPosition` starts at SCREEN_HEIGHT
      // (fully off-screen) and springs to SCREEN_HEIGHT - 270 on first
      // layout-complete. Ours already starts at `height` and lands at the same
      // place, so only the instant write had to become a spring.
      //
      // The config is theirs verbatim (§1c): Climate passes no animationConfigs,
      // so gorhom's ANIMATION_CONFIGS default applies — and on iOS that's a
      // SPRING (Android takes a 250ms timing instead). Note these constants are
      // identical to react-navigation's TransitionIOSSpec: the sheet slide and
      // the card fade ride the same curve. ~467ms to settle, critically damped
      // (zeta 4.56 is over-damped, but Reanimated has no over-damped branch).
      Animated.spring(translateY, { toValue: collapsed, ...SHEET_SPRING }).start();
    }
  };

  const pan = useRef(
    PanResponder.create({
      // Only claim clear vertical drags (taps fall through to the buttons; the car above is untouched).
      onMoveShouldSetPanResponderCapture: (_e, g) => Math.abs(g.dy) > 8 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_e, g) => {
        const { expanded, collapsed } = snap.current;
        translateY.setValue(overDrag(restingY.current + g.dy, expanded, collapsed));
      },
      onPanResponderRelease: (_e, g) => {
        const { expanded, collapsed } = snap.current;
        // Pick the target by projecting the release velocity ~0.2 s ahead (reanimated's snapPoint:
        // value + 0.2 * velocity; g.vy is px/ms so * 200 = 0.2 s), then settle with @gorhom/bottom-sheet's
        // exact spring — and CONTINUE from the finger's velocity. Starting the spring from rest (our old
        // bounciness/speed) is what made ours feel like it stopped-then-animated; this is why Tesla glides.
        const projected = restingY.current + g.dy + g.vy * 200;
        const target = projected < (expanded + collapsed) / 2 ? expanded : collapsed;
        restingY.current = target;
        Animated.spring(translateY, {
          toValue: target,
          velocity: g.vy * 500, // px/ms → px/s, halved (Tesla feeds velocityY / 2 into animateToPosition)
          stiffness: 1000,
          damping: 500,
          mass: 3,
          overshootClamping: true,
          restDisplacementThreshold: 0.5,
          restSpeedThreshold: 0.5,
          useNativeDriver: true,
        }).start();
      },
    }),
  ).current;

  const vented =
    state.leftFrontWindowOpen ||
    state.rightFrontWindowOpen ||
    state.leftRearWindowOpen ||
    state.rightRearWindowOpen;

  // setTargetTemp clamps + snaps to the 0.5° grid, so the raw sum is safe to pass.
  const adjustTemp = (delta: number) => {
    tap();
    actions.setTargetTemp(state.targetTempC + delta);
  };

  // "Vent" lowers all windows a little; "Close" raises them. Drives the four window flags the Godot
  // car already animates (window_animation_state in the state adapter).
  const toggleVent = () => {
    bump();
    const open = !vented;
    actions.patch({
      leftFrontWindowOpen: open,
      rightFrontWindowOpen: open,
      leftRearWindowOpen: open,
      rightRearWindowOpen: open,
    });
  };

  // Camp / Pet. Recovered from their onPress handlers (@5224040 camp, @5224322
  // pet) rather than treated as two toggles, because the car has ONE keeper mode
  // and the two rows are two faces of it.
  //
  //   tap Camp:  camp -> off
  //              pet  -> confirm "Enabling Camp Mode will disable Pet Mode."
  //              else -> camp
  //
  //   tap Pet:   pet  -> confirm "Please confirm to disable Pet Mode."  -> off
  //              else -> pet          (NO prompt: replacing Camp is silent)
  //
  // The asymmetry is theirs and it is not arbitrary — every prompt guards Pet
  // Mode specifically, the one whose whole job is keeping an animal alive in a
  // closed car. Camp needs no confirmation to start or stop; Pet needs one to
  // stop, and one to be displaced.
  //
  // Strings are the app's own (`alert_confirmation_title`,
  // `alert_vehicle_control_camp_pet_mode_override_message`,
  // `alert_vehicle_control_pet_mode_override_message`, `alert_cancel`,
  // `button_yes`) from the English table @926615, and their Alert is
  // `cancelable: false` — on iOS an Alert is modal anyway.
  //
  // NOT copied: their third branch calls actuateCPDAlert() when
  // `requiresClimateKeeperCPDPrompt` (Child Presence Detection). That flag comes
  // from the cloud vehicle config, which BLE does not carry — the same gap as
  // supportsCabinOverheatProtection.
  const confirm = (message: string, onYes: () => void) =>
    Alert.alert('Are you sure?', message, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Yes', onPress: onYes },
    ]);

  // The Child-Left-Alone override prompt — their `actuateCPDAlert` (@5222456).
  // Enabling any keeper mode suppresses Child Presence Detection, and the car
  // will not ENGAGE the mode unless the command carries the override, so the
  // confirmation and the override travel together. Message and submessage are
  // their strings, joined with a blank line exactly as they join them.
  //
  // Tesla shows this only when the car's vehicle config sets
  // `cpd_disable_notification_required`. That flag lives in the cloud config and
  // is on no BLE proto, so we cannot read it — and this car demonstrably needs
  // the override, since the plain command is accepted and then ignored. So we
  // always ask, which is what its own Tesla app does.
  const confirmCpd = (onYes: () => void) =>
    confirm(
      'Child Left Alone Detection and its related safety features are unavailable while Climate Keeper, Pet Mode, or Camp Mode are enabled\n\n' +
        'Child Left Alone Detection will automatically re-enable when Climate Keeper, Pet Mode, and Camp Mode are turned off.',
      onYes,
    );

  const onCampPress = () => {
    tap();
    if (state.climateKeeper === 'camp') return actions.setClimateKeeper('off');
    if (state.climateKeeper === 'pet') {
      // Displacing Pet Mode asks TWICE, in this order, exactly as they chain it:
      // the override warning, then the CPD warning (@5224040 -> actuateCPDAlert).
      return confirm('Enabling Camp Mode will disable Pet Mode.', () =>
        confirmCpd(() => actions.setClimateKeeper('camp')),
      );
    }
    confirmCpd(() => actions.setClimateKeeper('camp'));
  };

  // Bioweapon displaces a running keeper mode, and Tesla confirms before it does
  // — the third member of the same guard-Pet-Mode family (@5223810). Only when
  // ENABLING, and only when a keeper mode is actually running.
  const onBioweaponPress = () => {
    tap();
    const on = !state.bioweaponOn;
    if (on && state.climateKeeper !== 'off') {
      return confirm('Enabling Bioweapon Defense Mode will disable Pet Mode.', () =>
        actions.setBioweapon(true),
      );
    }
    actions.setBioweapon(on);
  };

  const onPetPress = () => {
    tap();
    if (state.climateKeeper === 'pet') {
      return confirm('Please confirm to disable Pet Mode.', () => actions.setClimateKeeper('off'));
    }
    confirmCpd(() => actions.setClimateKeeper('pet'));
  };

  const tempParts = [
    state.interiorTempC !== null ? `Interior ${Math.round(state.interiorTempC)}°C` : null,
    state.exteriorTempC !== null ? `Exterior ${Math.round(state.exteriorTempC)}°C` : null,
  ].filter((p): p is string => p !== null);

  // Defrost Car: (1) turn climate ON, (2) set temp to HI, (3) run front + rear defrost (harness G + H).
  const toggleDefrost = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    const on = !state.frontDefrostOn;
    if (on) {
      actions.patch({ climateOn: true, frontDefrostOn: true, rearDefrostOn: true });
      actions.setTargetTemp(HI_TEMP);
    } else {
      actions.patch({ frontDefrostOn: false, rearDefrostOn: false });
    }
  };

  return (
    // box-none: touches above the panel fall through to the orbit guard (VehicleCanvas) — nothing
    // happens on the car. The panel below captures its own drags/taps.
    <View style={styles.root} pointerEvents="box-none">
      {/* findings §2: Climate renders <StatusBarFade/> with no props as the first
          child of its transparent container — a statusBarHeight-tall scrim over
          the car. Fixed chrome, car-independent. */}
      <StatusBarFade />

      {/* Seat + steering-wheel heater controls pinned to the Godot markers over the top-down car. */}
      <ClimateMarkerOverlay state={state} actions={actions} />


      <Animated.View
        onLayout={onSheetLayout}
        style={[styles.sheet, { paddingBottom: SHEET_PADDING_BOTTOM, transform: [{ translateY }] }]}
        {...pan.panHandlers}
      >
        <View style={styles.handle} />

        {/* Interior + ambient temps (mock now; BLE ClimateState.inside_temp / outside_temp later) — like
            the official app, sits centred above the setpoint. */}
        {/* Shown only when we actually have a temperature. Their gate, at
            @5221853, is exactly:

              tempInteriorText != null || tempExteriorText != null

            and each text is null iff the value is absent from ClimateState —
            no awake check and no staleness rule, even though
            `isVehicleDataUnreliable` sits right beside it in the same
            view-model. Purely "do we have the number".

            We rendered the line unconditionally through showNum, which prints
            an em-dash for an unknown value, so a car we had never read showed
            "Interior — · Exterior —" where theirs shows nothing. Each half is
            independent: one known temperature renders on its own rather than
            dragging a dash along beside it. */}
        {tempParts.length > 0 ? (
          <Text style={[styles.climateTemps, tempsStale && styles.climateTempsStale]}>
            {tempParts.join(' · ')}
          </Text>
        ) : null}

        <View style={styles.tempRow}>
          <Quick
            symbol="power"
            label={state.climateOn ? 'On' : 'Off'}
            active={state.climateOn}
            onPress={() => {
              tap();
              actions.toggle('climateOn');
            }}
          />

          <View style={styles.tempControl}>
            <Pressable
              style={[styles.arrow, styles.arrowDecrease]}
              hitSlop={16}
              onPress={() => adjustTemp(-0.5)}
            >
              <SymbolView name="chevron.left" tintColor={TEXT_DIM} size={CHEVRON_SIZE} weight="medium" />
            </Pressable>
            {/* BRIGHT when climate is on, DIM when off — visible across Ivan's
                first two screenshots, which differ only by the AC state: the
                whole setpoint block (power glyph, its label, the number) tracks
                climateOn. The chevrons stay dim in both. */}
            <View style={styles.tempTextContainer}>
              {/* An INVISIBLE degree, always rendered. It is not decoration: it
                  occupies exactly the width of the real one on the right, so the
                  number sits optically centred in the container instead of being
                  shoved left by its own suffix. Tesla renders three children
                  here (@5223196) and this is the first of them. Ivan saw both
                  halves of its absence at once — "our < and > are much closer to
                  the temp text" and "our temp is more to the left". One missing
                  element, two symptoms.

                  It is rendered unconditionally, exactly as theirs is, so LO and
                  HI occupy the same width as a numeric setpoint and the block
                  does not jump when you drive the dial to either end. */}
              <Text style={[styles.tempDegree, styles.tempDegreeGhost]}>°</Text>
              <Text style={[styles.temp, state.climateOn ? styles.tempOn : styles.tempOff]}>
                {formatTemp(state.targetTempC)}
              </Text>
              <Text
                style={[
                  styles.tempDegree,
                  hasDegree(state.targetTempC)
                    ? state.climateOn
                      ? styles.tempOn
                      : styles.tempOff
                    : styles.tempDegreeGhost,
                ]}
              >
                °
              </Text>
            </View>
            <Pressable
              style={[styles.arrow, styles.arrowIncrease]}
              hitSlop={16}
              onPress={() => adjustTemp(0.5)}
            >
              <SymbolView name="chevron.right" tintColor={TEXT_DIM} size={CHEVRON_SIZE} weight="medium" />
            </Pressable>
          </View>

          <Quick
            symbol="car.window.left"
            label={vented ? 'Close' : 'Vent'}
            active={vented}
            onPress={toggleVent}
          />
        </View>

        <Row
          symbol="windshield.front.and.heat.waves"
          label="Defrost Car"
          active={state.frontDefrostOn}
          onPress={toggleDefrost}
        />
        <View style={styles.spacer} />
        <Row
          symbol="microbe"
          label="Bioweapon Defense Mode"
          active={state.bioweaponOn}
          onPress={onBioweaponPress}
        />

        <View style={styles.spacer} />
        <View style={styles.group}>
          <GroupRow
            symbol="tent"
            label="Camp Mode"
            active={state.climateKeeper === 'camp'}
            first
            onPress={onCampPress}
          />
          <GroupRow
            symbol="pawprint.fill"
            label="Pet Mode"
            active={state.climateKeeper === 'pet'}
            onPress={onPetPress}
          />
        </View>

        <View style={styles.spacer} />
        <View style={styles.separator} />
        <View style={styles.spacer} />

        <Section label="Cabin Overheat Protection">
          <Segmented
            options={[
              { key: 'off', label: 'Off' },
              { key: 'noac', label: 'No A/C' },
              { key: 'on', label: 'On' },
            ]}
            value={state.cabinOverheatMode}
            onChange={(k) => {
              tap();
              actions.setCabinOverheatMode(k as CabinOverheatMode);
            }}
          />
        </Section>

        {/* ONLY while COP is On — see showsOverheatActivationTemp for their
            condition. An activation temperature is meaningless when nothing
            activates, and Fan Only ("No A/C") has no setpoint to reach. */}
        {showsOverheatActivationTemp(state.cabinOverheatMode) ? (
          <Section label="Approximate activation temperature" muted>
            <Segmented
              options={[
                { key: '30', label: '30°C' },
                { key: '35', label: '35°C' },
                { key: '40', label: '40°C' },
              ]}
              value={state.cabinOverheatTemp}
              onChange={(k) => {
                tap();
                actions.setCabinOverheatTemp(k as CabinOverheatTemp);
              }}
            />
          </Section>
        ) : null}
      </Animated.View>
    </View>
  );
}

function Quick({
  symbol,
  label,
  active,
  onPress,
}: {
  symbol: SFSymbol;
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable style={styles.quick} onPress={onPress}>
      {/* INVERTED from what we had. Ours went BLUE when active and near-white
          when idle; across Ivan's off/on pair the glyph and its label are DIM
          when the state is off and WHITE when on. No blue anywhere in this row —
          blue is reserved for an engaged card (Defrost), which is the one place
          it appears in all four screenshots. */}
      <SymbolView name={symbol} tintColor={active ? TEXT_BRIGHT : TEXT_DIM} size={QUICK_ICON_SIZE} />
      <Text style={[styles.quickLabel, active && styles.quickLabelActive]}>{label}</Text>
    </Pressable>
  );
}

function Row({
  symbol,
  label,
  active,
  onPress,
}: {
  symbol: SFSymbol;
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.row,
        active && styles.rowActive,
        pressed && { opacity: PRESS_OPACITY },
      ]}
      onPress={onPress}
    >
      <SymbolView name={symbol} tintColor={active ? TEXT_ON_ACTIVE : TEXT_DIM} size={ICON_SIZE} />
      <Text style={[styles.rowText, active && styles.rowTextActive]}>{label}</Text>
    </Pressable>
  );
}

function GroupRow({
  symbol,
  label,
  active,
  first,
  onPress,
}: {
  symbol: SFSymbol;
  label: string;
  active: boolean;
  first?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.row,
        first ? styles.groupRowFirst : styles.groupRowSecond,
        active && styles.rowActive,
        pressed && { opacity: PRESS_OPACITY },
      ]}
      onPress={onPress}
    >
      <SymbolView name={symbol} tintColor={active ? TEXT_ON_ACTIVE : TEXT_DIM} size={ICON_SIZE} />
      <Text style={[styles.rowText, active && styles.rowTextActive]}>{label}</Text>
    </Pressable>
  );
}

function Section({ label, muted, children }: { label: string; muted?: boolean; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionLabel, muted && styles.sectionLabelMuted]}>{label}</Text>
      {children}
    </View>
  );
}

function Segmented({
  options,
  value,
  onChange,
}: {
  options: { key: string; label: string }[];
  value: string;
  onChange: (key: string) => void;
}) {
  return (
    <View style={styles.segmented}>
      {options.map((opt) => {
        const selected = opt.key === value;
        return (
          <Pressable
            key={opt.key}
            style={[styles.segment, selected && styles.segmentSelected]}
            onPress={() => onChange(opt.key)}
          >
            <Text style={[styles.segmentText, selected && styles.segmentTextSelected]}>{opt.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// Recovered from the dark theme block (main.decompiled.js ~1337960-1338060) and
// the Colors table (~1338467), not sampled from a screenshot:
//   Themes[DARK].borderColorWithOpacity = 'rgba(255, 255, 255, 0.1)'
//   Themes[DARK].buttonActivePrimary    = Colors.buttonBlue = '#3368FF'
//   Themes[DARK].textColorLight         = '#8A8B8B'
//   Themes[DARK].textColor              = '#F3F3F3'
// TYPE. Recovered ladder (main.decompiled.js ~1339774-1339860) — the
// non-Cybertruck Typography block, each entry carrying its own `type` (face):
//
//   Medium 64/77/0   Medium 40/46/0   Medium 32/36/0.5  Medium 24/28/0.5
//   Medium 20/24/0.5 Medium 18/24/0.5 Medium 16/24/0
//   Body        Regular 14/20/-0.1     BodyLabel    Medium 14/20/0.1
//   Caption     Regular 12/16/-0.1     CaptionLabel Medium 12/16/0.1
//   AxisLabel   Medium 10/16/0         Overline     Medium 12/20/0.25 upper
//
// THE SCREEN HAD NO fontFamily AT ALL — every label was rendering in San
// Francisco. That is most of what Ivan meant by "nothing like it": the colours
// were half-right while the typeface was simply wrong everywhere.
//
// Sizes are ladder entries, not free numbers. What LOOKS bolder in their
// screenshots (the COP heading) is the COLOUR, not the weight — the whole ladder
// is one face, and only Body/Caption use Regular, which we do not ship.
const FONT = TeslaFonts.medium;
// The ladder is NOT one face. The 40/46 display tier carries fontWeight '400'
// (the 64/77 one carries '500'), and Body/Caption carry type 'Regular'. Ivan:
// "the temp text is certainly not as bold on the tesla app" — right, and the
// cause was that we only ever bundled Medium.
const FONT_REGULAR = TeslaFonts.regular;
// The climate setpoint, and only it: `temperatureText` sets this family
// directly rather than going through a TextCategory. See the note on `temp`.
const FONT_LIGHT = TeslaFonts.light;
// THE TOGGLE TOKENS, finally sourced (@1338100-1338110). The idle row is their
// *Disabled* toggle set and the engaged row is the *Enabled* one — which is why
// hunting "the inactive border" kept coming back transparent:
//
//   buttonEnabledToggleBackground  = Colors.buttonBlue = #3368FF   (ENGAGED)
//   buttonEnabledToggleBorder      = Colors.buttonBlue = #3368FF
//   buttonEnabledToggleText        = #F1F1F1
//   buttonDisabledToggleBackground = Colors.transparent            (IDLE)
//   buttonDisabledToggleBorder     = #2C2C2C
//   buttonDisabledToggleText       = #969696
//
// The border is a SOLID DARK GREY, not translucent white. Mine happened to
// compute to roughly the same shade over this backdrop, which is worse than
// being obviously wrong: it would have drifted the moment the surface behind it
// changed. #2C2C2C is also buttonActiveSecondary — the selected segment pill —
// so one value covers both.
const BORDER = '#2C2C2C';
const ACTIVE_BLUE = '#3368FF';
const TEXT_DIM = '#969696';
const TEXT_BRIGHT = '#F3F3F3';
// buttonEnabledToggleText — not pure white.
const TEXT_ON_ACTIVE = '#F1F1F1';
// Measured off the awake screenshots at 2.29 px/pt (921px / 402pt). Stated as
// MEASURED, not recovered — the row component's own StyleSheet is behind
// useThemedStyle and I could not pin it without another long dig.
// RECOVERED, not measured. Their button size tiers (@1341521/1341555/1341589)
// all carry borderWidth 2 — six times our hairline (0.33pt), which is the
// "border much wider" Ivan saw. Radii on the ladder are 16 (minHeight 48) and
// 10 (minHeight 40); 10 is the one that reads as "more rectangular" against the
// 12 we had, and it is a real tier rather than a number I picked.
// THE ROWS ARE <Button appearance={TOGGLE} size={LARGE}> (@5223636), so the
// spec is not a measurement — it is three recovered objects composed:
//
//   climate screen's own `largeButton` (@5221317)
//     { height: 6*Gutter = 60, justifyContent: 'flex-start',
//       alignItems: 'center', width: '100%' }
//
//   getButtonSizeStyle(LARGE) (@1340527 — the REAL one, see the radius note)
//     { minWidth: 5*Gutter = 50, minHeight: 5*Gutter = 50,
//       paddingHorizontal: 10, paddingVertical: 13,
//       iconWidth: 24, iconHeight: 24, iconMarginHorizontal: 10,
//       textMarginHorizontal: 10 }
//
//   getButtonFontStyle(LARGE) (@1340624)  ->  TextCategory.BodyLabel = 14/20/0.1
//
// Which corrects three things I had guessed: the label is 14/20, not 16/24; the
// icon is 24, not 20; and the row is a fixed 60 tall with 10pt side padding,
// not 16 with padding-derived height. That is the "internal layout of the button
// is much different".
const ROW_HEIGHT = 60;
const ROW_PADDING_H = 10;
const ROW_ICON = 24;
const ROW_ICON_MARGIN = 10;
// RADIUS. Ivan: "the one on iOS looks rectanglish and all your doings is very
// round buttons". He was right, and the cause was that I had been reading the
// wrong component's table: the tiers I sourced 16 from live in
// `getInputSizeStyleMap` (@1341498) — the sizing map for TEXT INPUTS. Inputs are
// round; these buttons are not.
//
// The real `getButtonSizeStyle` (@1340676) takes (theme, appearance, size) and
// returns ONLY { borderRadius, borderWidth }. Radius does not vary by size at
// all — there is no "LARGE radius" to look up, which is why open question §8.2
// could never have been answered as posed:
//
//   Cybertruck theme -> 0
//   appearance GHOST -> 0
//   everything else  -> Specifications.borderRadius
//
// and `Specifications.borderRadius` (@1338718) is **5**. On a 60pt-tall row that
// is very nearly a rectangle, which is exactly what he was looking at.
const RADIUS = 5;
// Confirmed from the same function: `borderWidth` is seeded 2 and only zeroed
// for GHOST. This one I had right, for the wrong reason — both tables happened
// to say 2.
const BORDER_WIDTH = 2;
const ICON_SIZE = ROW_ICON;
// Content inset. MEASURED off Ivan's side-by-side at 2.29 px/pt (921px / 402pt):
// their cards span x 66..855, ours spanned 37..884 — 29pt of margin against our
// 16. That single number is most of "entire structure of the panel, margins":
// our cards ran nearly edge to edge while theirs sit in a much narrower column.
// bottomSection.paddingHorizontal (@5221154). Was 28, measured off a screenshot.
const CONTENT_INSET = 30;
// getSpacer(20) — the ONE gap value between every card block. Four calls in the
// screen (@5223627, @5223880, @5224576, @5224588), which is exactly the four
// gaps: Defrost|Bioweapon, Bioweapon|group, group|Divider, Divider|heading.
const SPACER = 20;
// bottomSection.paddingBottom = Specifications.bottomMapOffset = 40 (@1338652).
// A flat 40 — NOT the safe-area inset plus a margin, which is what we had
// (34 + 20 = 54, the largest single component of the sheet's 20pt overshoot).
// 40 still clears the 34pt home indicator, so nothing is lost by matching them.
const SHEET_PADDING_BOTTOM = 40;
// Chevrons and the power/vent glyphs, measured the same way: theirs are ~17pt
// and ~23pt against our 24 and 29. Both were noticeably oversized.
const CHEVRON_SIZE = 18;
const QUICK_ICON_SIZE = 24;
// Their most common activeOpacity (two call sites). The pressed card in Ivan's
// 4th screenshot dims noticeably but stays readable, which fits; I could not tie
// it to THIS component, so it is the best-supported value rather than a proven one.
const PRESS_OPACITY = 0.7;

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: CONTENT_INSET,
    // No paddingTop and no `gap`. Tesla spaces this stack element by element —
    // bottomSection.paddingTop folded into climateTemps.marginTop, then
    // climateControls.marginBottom 30, then getSpacer(20) between card blocks.
    // A uniform gap cannot express that and was quietly overriding all of it.
    paddingTop: 0,
    // findings §1e, verbatim. The sheet is FULLY OPAQUE `theme.backgroundColor`
    // (#161718) — no blur, no translucency — which is what hides the bottom of
    // the car. Corners are SQUARE (`bottomSheetBackgroundStyle: {borderRadius:0}`
    // overriding gorhom's default 15) and there is no top hairline. Shadow is
    // theirs: offset (0,10), opacity 1, radius 20, black — the radius exceeds the
    // downward offset, so it still reads as a soft edge above the sheet.
    backgroundColor: '#161718',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 1,
    shadowRadius: 20,
  },
  // The Climate grabber, traced exactly (the earlier "SheetHandle 50x5" note was the WRONG component).
  // The real one is VehicleClimateScreen → FlippableSheetHandle → `styles.indicator` (@1882826):
  //   indicator: { alignSelf:'center', width:100, height:4, borderRadius:4, backgroundColor: colors.backgroundTertiary }
  //   container: { padding:10 }   ← the 10pt above/below the bar
  // `backgroundTertiary` in this module's DARK theme (@1882428) = #2D2D2D — darker than the #454546 I'd
  // guessed, and MUCH wider (100, not 66). The `container` padding 10 becomes our marginTop/marginBottom 10;
  // the 10 below then stacks with climateTemps.marginTop 25 for Tesla's 35pt bar→temps gap.
  handle: {
    alignSelf: 'center',
    width: 100,
    height: 4,
    borderRadius: 4,
    marginTop: 10,
    marginBottom: 10,
    backgroundColor: '#2D2D2D',
  },
  climateTemps: {
    // CaptionLabel 12/16/0.1, NOT BodyLabel. The category is branched on the
    // Cybertruck theme (@5223035): CYBERTRUCK gets BodyLabel, everything else —
    // including this car — gets CaptionLabel. I had read the BodyLabel arm.
    // Worth 4pt of sheet height, which is the whole of the "tiny bit" left over
    // after the 20pt fix: their sheet is 606, ours was 610.
    textAlign: 'center',
    fontFamily: FONT,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.1,
    color: TEXT_DIM,
    // `bottomSection.paddingTop` = Gutter = 10 (@5221163) plus
    // `bottomTextSection.marginTop` = 1.5*Gutter = 15 (@5221199) → 25. The temps
    // are the first child, so folding the container's paddingTop into this margin
    // is equivalent.
    // −16 (25→9): the correct 100x4 grabber made the handle strip 24pt (10+4+10)
    // vs the old 17pt, and the extended sheet still measured tall. This is the
    // first content below the handle, so trimming here shrinks the *extended*
    // sheet while the pinned bottom keeps everything from the temps down at the
    // same absolute Y (the handle + top edge drop to match Tesla's shorter sheet).
    marginTop: 9,
  },
  // Cached-but-stale cabin temps fade, mirroring the Home battery row (§C3).
  climateTempsStale: {
    opacity: 0.5,
  },
  // `climateControls` (@5221211). Height 80 is what produces the air above and
  // below the number — the 40pt text is centred in an 80pt row — and the 30pt
  // marginBottom is the gap down to the Defrost card. Both were guessed before
  // as paddingTop 8 / paddingBottom 24 / marginBottom 4.
  tempRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    height: 80,
    marginBottom: 30,
  },
  // `controlsButton` (@5221244): { flexShrink: 1, marginHorizontal: -20,
  // width: 80 }. The -20 is stored as 4294967276 — an unsigned wrap of a
  // NEGATIVE margin, which is what pulls power and vent OUTSIDE the 30pt
  // content inset. Glyph centre lands at 30 - 20 + 40 = 50pt from the screen
  // edge; I had measured "~48pt" off Ivan's screenshot and hacked it with a
  // -12 breakout on the row. Same intent, wrong mechanism and wrong number.
  quick: {
    flexShrink: 1,
    marginHorizontal: -20,
    width: 80,
    alignItems: 'center',
    gap: 6,
  },
  quickLabel: {
    // CaptionLabel 12/16/0.1.
    fontFamily: FONT,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.1,
    color: TEXT_DIM,
  },
  quickLabelActive: {
    color: TEXT_BRIGHT,
  },
  // `temperatureControlsContainer` (@5221337). The gap between the number and
  // each chevron is NOT a `gap` — it is built from four overlapping boxes, and
  // that is why every symmetric `gap: N` guess looked wrong:
  //
  //   climateAdjustmentArrowDecrease  { paddingLeft: 10 }      (@5221202)
  //   temperatureTextContainer        { marginLeft: -10,
  //                                     paddingHorizontal: 10, zIndex: 1 }
  //   climateAdjustmentArrowIncrease  { paddingRight: 10 }     (@5221205)
  //
  // The padding sits on the OUTER side of each chevron, so it widens the touch
  // target away from the number rather than spacing it. On the left the text
  // container's -10 margin cancels its own 10pt padding, so the '<' sits flush
  // against the number's box; on the right the 10pt padding stands, so '>' is
  // pushed out by 10. The asymmetry is real and deliberate — the arrows are
  // zIndex 2 over a zIndex 1 text container, i.e. they are meant to overlap.
  tempControl: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: 10,
    paddingHorizontal: 10,
  },
  tempTextContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginLeft: -10,
    paddingHorizontal: 10,
    zIndex: 1,
  },
  arrow: {
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
    // Their chevron is <Icon name={IconName.back} size={IconSize.LARGE} /> and
    // largeIconSize = 36 (@1338690). THIRTY-SIX, against our 18 — and since the
    // icon carries no margin of its own, that box IS the gap Ivan is asking
    // about. The visible chevron is small inside a large square; the air around
    // it is what separates it from the number. Doubling our glyph would not
    // reproduce that (SF Symbols draw to the edge of their box, their icon font
    // does not), so the box is 36 and the SF chevron stays its own size,
    // centred. Layout matches; the glyph itself is the deferred job.
    width: 36,
    height: 36,
  },
  arrowDecrease: { paddingLeft: 10 },
  arrowIncrease: { paddingRight: 10 },
  temp: {
    // THE ANSWER TO "temp text is bolder in our app", asked three times.
    //
    // It was never the Typography ladder. I kept re-reading the 40/46 display
    // tier, re-deriving "Medium", and re-shipping it — because I assumed the
    // setpoint went through `getFontStyle` like everything else. It does not.
    // The climate screen declares its own `temperatureText` (@5221355) and sets
    // fontFamily directly:
    //
    //   { fontFamily: getUniversalSansFontFamily('Light'),  // = UniversalSansText-Light
    //     fontSize: 40, fontWeight: '300',
    //     lineHeight: 4*Gutter = 40, paddingTop: Gutter = 10 }
    //
    // Light — two cuts below the Medium we were rendering. `getFontStyle` is
    // never called for it. The lesson for the next one of these: when the same
    // delta is reported three times, stop re-reading the value and question
    // WHICH style object applies.
    //
    // No minWidth: theirs is content-sized. It stays centred anyway because the
    // power and vent buttons that flank it are both a fixed 80 wide, so
    // space-between resolves symmetrically whatever the number's width.
    fontFamily: FONT_LIGHT,
    fontSize: 40,
    fontWeight: '300',
    lineHeight: 40,
    paddingTop: 10,
    letterSpacing: 0,
  },
  tempDegree: {
    // `temperatureDegreeText` (@5221345): getFontStyle({ type: 'Medium',
    // fontSize: 30, lineHeight: 4*Gutter = 40 }). Medium, and ten points
    // smaller than the digits it sits beside.
    // NO paddingTop. `temperatureText` carries paddingTop: Gutter = 10 and the
    // degree carries none, and that 10pt difference is the whole superscript
    // effect: the container stretches both Texts to the same height, so the
    // degree's line box sits 10pt higher than the number's. I had copied the
    // padding onto both, which levelled them and killed the raise.
    fontFamily: FONT,
    fontSize: 30,
    lineHeight: 40,
  },
  // The left-hand spacer copy, and the right-hand one at LO/HI.
  tempDegreeGhost: {
    color: 'transparent',
  },
  tempOn: {
    color: TEXT_BRIGHT,
  },
  tempOff: {
    color: TEXT_DIM,
  },
  // OUTLINED, not filled. Recovered colours, not eyedropped:
  //   Themes[DARK].borderColorWithOpacity = 'rgba(255, 255, 255, 0.1)'
  //   Themes[DARK].buttonActivePrimary    = Colors.buttonBlue = '#3368FF'
  //   Themes[DARK].textColorLight         = '#8A8B8B'
  //
  // Ours was a filled rgba(255,255,255,0.06) card with WHITE labels and a WHITE
  // active fill with BLACK text. Theirs is a transparent card with a 1px hairline
  // border and DIM labels, going solid blue with white content when active.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    width: '100%',
    height: ROW_HEIGHT,
    gap: ROW_ICON_MARGIN + 10,
    paddingHorizontal: ROW_PADDING_H,
    borderRadius: RADIUS,
    borderWidth: BORDER_WIDTH,
    borderColor: BORDER,
  },
  rowActive: {
    backgroundColor: ACTIVE_BLUE,
    borderColor: ACTIVE_BLUE,
  },
  rowText: {
    // getButtonFontStyle(LARGE) -> BodyLabel 14/20/0.1. Was 16/24, guessed.
    fontFamily: FONT,
    fontSize: 14,
    lineHeight: 20,
    letterSpacing: 0.1,
    // Dim by default — the whole list reads as "available", not "on".
    color: TEXT_DIM,
  },
  rowTextActive: {
    color: TEXT_ON_ACTIVE,
  },
  // No border and no fixed height: the group is just the two rows stacked, each
  // a full 60pt bordered Button exactly as Tesla builds them. Wrapping them in a
  // bordered container instead added the container's own 2+2 on top of the rows'
  // 60+60 — 124 where theirs is 120, and 4 of the 20pt the sheet was too tall.
  group: {
    width: '100%',
  },
  // The Camp|Pet line is not a divider at all — it is Camp's OWN bottom border,
  // which is why Ivan read it as "exactly the same as the border of the button".
  // Their two rows are stacked Buttons (@5223897, @5224169):
  //
  //   Camp { borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }
  //   Pet  { borderTopLeftRadius: 0, borderTopRightRadius: 0, borderTopWidth: 0 }
  //
  // Pet zeroes its top border precisely so the two do not stack to 4. So the
  // line is BORDER_WIDTH, in the border colour. Ours was hairlineWidth — 0.33pt
  // on a 3x screen, six times thinner.
  // Camp (@5223897) and Pet (@5224169), verbatim. Pet zeroing its top border is
  // what stops the two 2pt borders stacking to 4 at the seam.
  groupRowFirst: {
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
  groupRowSecond: {
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
    borderTopWidth: 0,
  },
  // `<Divider />` (@5224584) — DividerComponent's base style is { height: 1,
  // width: '100%' } (@1431090), themed `dividerColor` = #2D2E2F. A real 1pt
  // line, not a hairline. Spacing above and below is getSpacer(20) on each
  // side, so the rule carries no margin of its own.
  separator: {
    height: 1,
    backgroundColor: '#2D2E2F',
    width: '100%',
  },
  spacer: {
    height: SPACER,
  },
  section: {
    gap: 10,
  },
  sectionLabel: {
    // `titleText` { marginTop: 2, width: '100%' } (@5221434) with
    // category=BodyLabel (@5224617) — the SAME 14/20 as every row label. It
    // reads larger only because it is bright against their dim. We had 16/24
    // with a 4pt left margin, both invented; the extra 4pt of line height was
    // 2 of the 20pt the sheet was overshooting.
    fontFamily: FONT,
    fontSize: 14,
    lineHeight: 20,
    letterSpacing: 0.1,
    color: TEXT_BRIGHT,
    marginTop: 2,
    width: '100%',
  },
  sectionLabelMuted: {
    // CaptionLabel 12/16/0.1.
    fontFamily: FONT,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.1,
    color: TEXT_DIM,
  },
  // The COP selector is `ToggleSelector` (@1870333) — the component that takes
  // the { options, busy } pair the call site passes. Its stylesheet (@1870274):
  //
  //   wrapper     { borderRadius: Specifications.borderRadius, borderWidth: 1,
  //                 height: 50, width: '100%' }
  //   innerHandle { borderRadius: Specifications.borderRadius, height: '100%' }
  //   option      { flex: 1, alignItems: 'center', justifyContent: 'center' }
  //   options     { flexDirection: 'row', height: '100%',
  //                 justifyContent: 'space-around', zIndex: 2 }
  //
  // So the same radius 5 as the rows, and — the part I had wrong — the track has
  // NO padding and NO gap. The selected pill is FULL height, inset only by the
  // 1px border. I had it inset 4pt on every side with a 9pt radius, which is why
  // it read as a soft floating capsule instead of a filled cell.
  //
  // Dark theme (@1870650/@1870673): borderColor = Gray.mildDarker #212121 for
  // both track and pill; pill fill = Gray.dark #353535. The track's own fill is
  // that same #212121 — it is only transparent when `hideBackground` is passed,
  // and the climate call site does not pass it.
  //
  // Theirs animates an absolutely-positioned handle across the track; ours sets
  // the background on the selected cell. Same pixels at rest, no animation.
  segmented: {
    flexDirection: 'row',
    height: 50,
    width: '100%',
    backgroundColor: '#212121',
    borderWidth: 1,
    borderColor: '#212121',
    borderRadius: RADIUS,
  },
  segment: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: RADIUS,
  },
  segmentSelected: {
    backgroundColor: '#353535',
  },
  segmentText: {
    // BodyLabel 14/20/0.1. Selection is expressed by COLOUR and the pill, not by
    // a weight change — the ladder has one face per size.
    fontFamily: FONT,
    fontSize: 14,
    lineHeight: 20,
    letterSpacing: 0.1,
    color: TEXT_DIM,
  },
  segmentTextSelected: {
    color: TEXT_BRIGHT,
  },
});
