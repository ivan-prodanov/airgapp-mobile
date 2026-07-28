import { useRef, type ReactNode } from 'react';
import {
  Animated,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import * as Haptics from 'expo-haptics';

import { ClimateMarkerOverlay } from '../godot/ClimateMarkerOverlay';
import { showNum } from '../state/readProbe';
import { showsOverheatActivationTemp } from '../ble/climateDisplay';
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
const formatTemp = (v: number) => (v <= LO_TEMP ? 'LO' : v >= HI_TEMP ? 'HI' : `${v.toFixed(1)}°`);
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
  const insets = useSafeAreaInsets();

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
        style={[styles.sheet, { paddingBottom: insets.bottom + 20, transform: [{ translateY }] }]}
        {...pan.panHandlers}
      >
        <View style={styles.handle} />

        {/* Interior + ambient temps (mock now; BLE ClimateState.inside_temp / outside_temp later) — like
            the official app, sits centred above the setpoint. */}
        <Text style={[styles.climateTemps, tempsStale && styles.climateTempsStale]}>
          {showNum(state.interiorTempC, (v) => `Interior ${Math.round(v)}°C`)} · {showNum(state.exteriorTempC, (v) => `Exterior ${Math.round(v)}°C`)}
        </Text>

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
            <Pressable hitSlop={16} onPress={() => adjustTemp(-0.5)}>
              <SymbolView name="chevron.left" tintColor="rgba(255,255,255,0.5)" size={24} weight="medium" />
            </Pressable>
            {/* BRIGHT when climate is on, DIM when off — visible across Ivan's
                first two screenshots, which differ only by the AC state: the
                whole setpoint block (power glyph, its label, the number) tracks
                climateOn. The chevrons stay dim in both. */}
            <Text style={[styles.temp, state.climateOn ? styles.tempOn : styles.tempOff]}>
              {formatTemp(state.targetTempC)}
            </Text>
            <Pressable hitSlop={16} onPress={() => adjustTemp(0.5)}>
              <SymbolView name="chevron.right" tintColor="rgba(255,255,255,0.5)" size={24} weight="medium" />
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
        <Row
          symbol="microbe"
          label="Bioweapon Defense Mode"
          active={state.bioweaponOn}
          onPress={() => {
            tap();
            actions.toggle('bioweaponOn');
          }}
        />

        <View style={styles.group}>
          <GroupRow
            symbol="tent"
            label="Camp Mode"
            active={state.campModeOn}
            divider
            onPress={() => {
              tap();
              actions.toggle('campModeOn');
            }}
          />
          <GroupRow
            symbol="pawprint.fill"
            label="Pet Mode"
            active={state.petModeOn}
            onPress={() => {
              tap();
              actions.toggle('petModeOn');
            }}
          />
        </View>

        <View style={styles.separator} />

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
      <SymbolView name={symbol} tintColor={active ? TEXT_BRIGHT : TEXT_DIM} size={29} />
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
      <SymbolView name={symbol} tintColor={active ? '#FFFFFF' : TEXT_DIM} size={24} />
      <Text style={[styles.rowText, active && styles.rowTextActive]}>{label}</Text>
    </Pressable>
  );
}

function GroupRow({
  symbol,
  label,
  active,
  divider,
  onPress,
}: {
  symbol: SFSymbol;
  label: string;
  active: boolean;
  divider?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.groupRow,
        divider && styles.groupRowDivider,
        active && styles.rowActive,
        pressed && { opacity: PRESS_OPACITY },
      ]}
      onPress={onPress}
    >
      <SymbolView name={symbol} tintColor={active ? '#FFFFFF' : TEXT_DIM} size={24} />
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
const BORDER = 'rgba(255,255,255,0.1)';
const ACTIVE_BLUE = '#3368FF';
const TEXT_DIM = '#8A8B8B';
const TEXT_BRIGHT = '#F3F3F3';
const RADIUS = 14;
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
    paddingHorizontal: 16,
    paddingTop: 10,
    gap: 12,
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
  // findings §1e: the real grabber is SheetHandle's own style — 50x5, radius 5,
  // marginTop 10 (our paddingTop above supplies that), opacity 0.2, centred. The
  // handleStyle/handleIndicatorStyle Climate passes are DEAD CODE: it also
  // passes handleComponent=SheetHandle, which consumes no props.
  // NOTE: the colour token (`colors.highlight`) was NOT resolved to a hex
  // (findings §4) — white at their 0.2 opacity is the closest faithful stand-in.
  handle: {
    alignSelf: 'center',
    width: 50,
    height: 5,
    borderRadius: 5,
    backgroundColor: '#FFFFFF',
    opacity: 0.2,
  },
  climateTemps: {
    textAlign: 'center',
    fontSize: 15,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.5)',
    marginTop: 6,
  },
  // Cached-but-stale cabin temps fade, mirroring the Home battery row (§C3).
  climateTempsStale: {
    opacity: 0.5,
  },
  tempRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingTop: 8,
    paddingBottom: 24,
    marginBottom: 4,
  },
  quick: {
    alignItems: 'center',
    width: 64,
    gap: 6,
  },
  quickLabel: {
    fontSize: 13,
    color: TEXT_DIM,
  },
  quickLabelActive: {
    color: TEXT_BRIGHT,
  },
  tempControl: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 24,
  },
  temp: {
    fontSize: 47,
    fontWeight: '300',
    minWidth: 128,
    textAlign: 'center',
    letterSpacing: 0.5,
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
    gap: 14,
    paddingVertical: 15,
    paddingHorizontal: 16,
    borderRadius: RADIUS,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: BORDER,
  },
  rowActive: {
    backgroundColor: ACTIVE_BLUE,
    borderColor: ACTIVE_BLUE,
  },
  rowText: {
    fontSize: 16,
    // Dim by default — the whole list reads as "available", not "on".
    color: TEXT_DIM,
  },
  rowTextActive: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  group: {
    borderRadius: RADIUS,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: BORDER,
    overflow: 'hidden',
  },
  groupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 15,
    paddingHorizontal: 16,
  },
  groupRowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: BORDER,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.12)',
    marginVertical: 4,
    marginHorizontal: 4,
  },
  section: {
    gap: 10,
  },
  sectionLabel: {
    fontSize: 17,
    fontWeight: '600',
    color: 'white',
    marginLeft: 4,
  },
  sectionLabelMuted: {
    fontSize: 13,
    fontWeight: '400',
    color: TEXT_DIM,
  },
  segmented: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 12,
    padding: 4,
    gap: 4,
  },
  segment: {
    flex: 1,
    paddingVertical: 11,
    alignItems: 'center',
    borderRadius: 9,
  },
  segmentSelected: {
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  segmentText: {
    fontSize: 15,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.55)',
  },
  segmentTextSelected: {
    color: 'white',
    fontWeight: '600',
  },
});
