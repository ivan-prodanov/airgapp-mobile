import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Image, PixelRatio, Pressable, StyleSheet, Text, useWindowDimensions, View, type ImageStyle, type StyleProp } from 'react-native';
import * as Haptics from 'expo-haptics';

import { useGodotBridge } from './bridgeContext';
import { useContentFade } from './useContentFade';
import { anchorToPoint, CLIMATE_MARKER_CALIBRATION, markerAnchorPx } from './markerLayout';
import { SEAT_WAVE_URI } from './seatWaveIcon';
import { STEERING_WHEEL_URI, STEERING_YOKE_URI } from './steeringWheelIcon';
import type { VehicleActions } from '../state/useVehicleState';
import type { MarkerName, MarkerPoint, VehicleMarkers } from '../types/markerTypes';
import {
  climateCapabilitiesFor,
  type SeatClimateModeName,
  type SeatPosition,
  type SteeringWheelClimateModeName,
  type SteeringWheelType,
  type VehicleViewState,
} from '../types/vehicleTypes';

interface Props {
  state: VehicleViewState;
  actions: VehicleActions;
}

type ClimateKey = SeatPosition | 'steeringWheel';

// Mode colors: heat = orange-red, cool = blue, auto/off = neutral white at different opacities. These
// match the official app's seat-heater glyph (waves fill the mode color from the bottom up by level).
// Round 12 opened the ARTWORK, which is what R10 §3b never did — and it maps
// exactly onto our wave glyph, because `seat_climate_*` turns out to be three
// heat waves and NO seat body: anatomically identical to ours.
//
// Their design is one artwork re-split per level, with two fills:
//   seat_climate_0 : [1454 #999999]                     all 3 waves grey
//   seat_climate_1 : [482 currentColor] + [972 #999999] wave 1 lit
//   seat_climate_2 : [968 currentColor] + [486 #999999] waves 1-2 lit
//   seat_climate_3 : [1454 currentColor]                all 3 lit
// So the LIT waves take the tint and the UNLIT waves are hardcoded #999999 —
// which is why R10 concluded "seats never grey out" (the tint token really IS
// always heaterOn) and was still wrong: at level 0 there is no currentColor path
// for the tint to touch.
//
// ⇒ lit = the tint; unlit = #999999. Heating and cooling share the SAME artwork
// (there are no seat_cool_* assets) and differ ONLY in tint.
const HEAT = '#FF3A3A'; // buttonHeaterOn  — the LIT tint
const COOL = '#3E6BE2'; // buttonCoolerOn  — the LIT tint when cooling
// The UNLIT wave colour — an off seat's whole glyph, and the dark waves of a
// partially-lit one. #999999 is BAKED INTO their artwork (see above), not read
// from the theme, which is exactly why it stayed invisible to three rounds of
// token-hunting and why we ended up hand-tuning a substitute.
//
// ⚠️ The user rejected this exact value once ("Nope, too grey!") back when we
// had no idea it was theirs. It is now confirmed as the real thing, so it goes
// in — but if it still reads too grey on device, that is a genuine divergence
// worth understanding (our wave SHAPE differs from their path), not a licence to
// re-tune it by eye.
const DIM = '#999999';
// `auto` is OURS — their seats have heat/cool levels and no auto tint at all, so
// there is nothing to copy. Kept on the grey per the user's explicit request.
const AUTO_WAVE = DIM;
// Steering wheel body — neutral grey (the heat waves on top carry the state colour).
// The wheel's off/unlit colour. Their `steering_wheel_heater_off` is BOTH paths
// (rim + squiggles) hardcoded #999999; `_low` lights the rim and one squiggle;
// `_high` lights everything. So the wheel body really does turn red when heating
// — which our `wheelColor` already does.
const WHEEL_GREY = '#999999';

// Control box (centered on the marker) and how far below it the Heat/Cool/Auto menu floats.
const BOX = { w: 58, h: 60 } as const;
const MENU_DY = 30;
const MENU_OPT_W = 60;
const MENU_PAD = 16;

const tap = () => Haptics.selectionAsync().catch(() => {});

// Seat/steering-wheel heater controls drawn over the top-down climate car, each pinned to its Godot
// marker. Tapping the glyph ramps the level down (3→2→1→off, from off it jumps to max heat); a popup
// Heat/Cool/Auto menu (only for seats/wheel that support more than heat) switches mode. Capabilities
// come from the active model's config, so heat-only rear seats get no menu and absent markers get no
// control. The menu auto-dismisses 3s after the last control tap, on reaching off, or on switching.
export function ClimateMarkerOverlay({ state, actions }: Props) {
  const bridge = useGodotBridge();
  const { width: screenW } = useWindowDimensions();
  const pixelRatio = PixelRatio.get();
  const [markers, setMarkers] = useState<VehicleMarkers | null>(null);
  // The 300ms Easing.cubic content fade (findings R10 §3d) — see useContentFade.
  const fade = useContentFade();
  const [visible, setVisible] = useState(false);
  const shown = useRef(false);
  const [selected, setSelected] = useState<ClimateKey | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // THE mock→BLE boundary: today a per-model table, tomorrow the vehicle's live BLE config. The whole
  // overlay below is purely capability-driven, so swapping the source needs no changes here.
  const caps = climateCapabilitiesFor(state.carModel);

  const clearTimer = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  // Arm/reset the 3s idle dismissal for the open menu (matches the official app).
  const armTimer = useCallback(
    (key: ClimateKey) => {
      clearTimer();
      timer.current = setTimeout(() => {
        setSelected((current) => (current === key ? null : current));
      }, 3000);
    },
    [clearTimer],
  );

  useEffect(() => {
    const offMarkers = bridge.onMarkers(setMarkers);
    const offVisibility = bridge.onMarkerVisibility(setVisible);
    bridge.requestMarkers();
    return () => {
      offMarkers();
      offVisibility();
      clearTimer();
    };
  }, [bridge, clearTimer]);

  const hasMenu = useCallback(
    (key: ClimateKey) =>
      key === 'steeringWheel'
        ? caps.steeringWheel.auto
        : caps.seats[key].coolLevels > 0 || caps.seats[key].auto,
    [caps],
  );

  const onIcon = useCallback(
    (key: ClimateKey) => {
      tap();
      if (key === 'steeringWheel') {
        actions.stepSteeringWheelClimate();
      } else {
        actions.stepSeatClimate(key);
      }
      if (hasMenu(key)) {
        setSelected(key);
        armTimer(key);
      } else {
        setSelected(null);
        clearTimer();
      }
    },
    [actions, armTimer, clearTimer, hasMenu],
  );

  const onMenu = useCallback(
    (key: ClimateKey, mode: SeatClimateModeName) => {
      tap();
      if (key === 'steeringWheel') {
        actions.setSteeringWheelClimate(mode as SteeringWheelClimateModeName);
      } else {
        actions.setSeatClimate(key, mode);
      }
      setSelected(key);
      armTimer(key);
    },
    [actions, armTimer],
  );

  // ⚠️ Once shown, STAY shown. The renderer flips marker-visibility to false the
  // moment the camera starts moving away, and unmounting on that made the
  // markers VANISH on the way out instead of fading (the user's "the markers
  // don't fade out"). The pushed card owns our lifetime — it fades us over 479ms
  // and unmounts us when that finishes — so `visible` only ever needs to gate
  // the FIRST appearance.
  if (!shown.current && visible && markers) shown.current = true;
  if (!shown.current || !markers) {
    return null;
  }

  const controls: React.ReactNode[] = [];
  for (const seat of Object.keys(caps.seats) as SeatPosition[]) {
    const cap = caps.seats[seat];
    // Only show a control where the seat actually has a climate function (Tesla-style: a seat with no
    // heater/cooler/auto — e.g. the Model Y rear-centre — gets nothing).
    if (cap.heatLevels === 0 && cap.coolLevels === 0 && !cap.auto) {
      continue;
    }
    const anchor = markerAnchorPx(markers, cap.marker);
    if (!anchor) {
      continue;
    }
    const sc = state.seatClimateModes[seat];
    controls.push(
      <Control
        key={seat}
        anchor={anchor}
        marker={cap.marker}
        pixelRatio={pixelRatio}
        waves={Math.max(cap.heatLevels, cap.coolLevels)}
        mode={sc.mode}
        level={sc.level}
        autoActivity={sc.autoActivity}
        onPress={() => onIcon(seat)}
      />,
    );
  }
  if (caps.steeringWheel.heating) {
    const anchor = markerAnchorPx(markers, 'steeringWheel');
    if (anchor) {
      const w = state.steeringWheelClimate;
      controls.push(
        <Control
          key="steeringWheel"
          anchor={anchor}
          marker="steeringWheel"
          pixelRatio={pixelRatio}
          waves={caps.steeringWheel.heatLevels}
          mode={w.mode}
          level={w.level}
          wheelType={caps.steeringWheel.type}
          onPress={() => onIcon('steeringWheel')}
        />,
      );
    }
  }

  const menu = renderMenu();

  return (
    <Animated.View style={[StyleSheet.absoluteFill, { opacity: fade }]} pointerEvents="box-none">
      {controls}
      {menu}
    </Animated.View>
  );

  function renderMenu(): React.ReactNode {
    if (!selected || !markers) {
      return null;
    }
    const isWheel = selected === 'steeringWheel';
    const marker: MarkerName = isWheel ? 'steeringWheel' : caps.seats[selected].marker;
    const anchor = markerAnchorPx(markers, marker);
    if (!anchor) {
      return null;
    }
    const mode = isWheel ? state.steeringWheelClimate.mode : state.seatClimateModes[selected].mode;
    if (mode === 'off' || !hasMenu(selected)) {
      return null;
    }
    const options: SeatClimateModeName[] = isWheel
      ? ['heat', 'auto']
      : (['heat', caps.seats[selected].coolLevels > 0 ? 'cool' : null, caps.seats[selected].auto ? 'auto' : null].filter(
          Boolean,
        ) as SeatClimateModeName[]);

    const point = anchorToPoint(anchor, pixelRatio, CLIMATE_MARKER_CALIBRATION[marker] ?? { dx: 0, dy: 0 });
    const menuW = options.length * MENU_OPT_W + MENU_PAD;
    const left = Math.min(Math.max(point.left - menuW / 2, 8), screenW - menuW - 8);
    const top = point.top + MENU_DY;
    const key = selected;

    return (
      <View style={[styles.menu, { left, top, width: menuW }]}>
        {options.map((opt) => {
          const on = opt === mode;
          return (
            <Pressable key={opt} style={styles.menuOpt} hitSlop={6} onPress={() => onMenu(key, opt)}>
              <Text style={[styles.menuText, on && styles.menuTextOn]}>{MODE_LABEL[opt]}</Text>
            </Pressable>
          );
        })}
      </View>
    );
  }
}

const MODE_LABEL: Record<SeatClimateModeName, string> = {
  off: 'Off',
  heat: 'Heat',
  cool: 'Cool',
  auto: 'Auto',
};

function Control({
  anchor,
  marker,
  pixelRatio,
  waves,
  mode,
  level,
  autoActivity,
  wheelType = 'round',
  onPress,
}: {
  anchor: MarkerPoint;
  marker: MarkerName;
  pixelRatio: number;
  waves: number;
  mode: SeatClimateModeName;
  level: number;
  autoActivity?: 'heat' | 'cool' | null;
  wheelType?: SteeringWheelType;
  onPress: () => void;
}) {
  const point = anchorToPoint(anchor, pixelRatio, CLIMATE_MARKER_CALIBRATION[marker] ?? { dx: 0, dy: 0 });
  // AUTO IS NOT ONE COLOUR. Their `getSeatClimateIcon` (@3987850) picks the
  // cooling icon when the live cooling level is above off while in auto, and the
  // heating icon at the live heater level otherwise — so the glyph says which way
  // auto is currently working. We drew AUTO_WAVE grey for every auto seat, which
  // is why a seat cooling under auto looked identical to one doing nothing.
  //
  // Idle auto keeps the grey: auto is engaged but the car is not driving the seat.
  const effective = mode === 'auto' ? (autoActivity ?? null) : mode;
  const color =
    effective === 'heat' ? HEAT : effective === 'cool' ? COOL : mode === 'auto' ? AUTO_WAVE : DIM;
  // With no activity there is no level ramp to show, so light every wave and let
  // the "Auto" label carry the meaning — that was the old behaviour, now confined
  // to the case it was actually right for.
  const lit = mode === 'auto' && !autoActivity ? waves : level;
  // Steering wheel turns the S-line colour as long as ≥1 wave is actually lit red (heat, level ≥ 1).
  const wheelColor = mode === 'heat' && lit >= 1 ? color : WHEEL_GREY;
  const isWheel = marker === 'steeringWheel';
  // The rim shape follows VehicleConfig.steeringWheelType: round wheel vs the flat-top yoke (S/X Plaid).
  const isYoke = wheelType === 'yoke';
  const wheelUri = isYoke ? STEERING_YOKE_URI : STEERING_WHEEL_URI;
  // Tiny press "pulse": scale in on touch-down, spring back out on release.
  const scale = useRef(new Animated.Value(1)).current;
  const pressIn = () => Animated.spring(scale, { toValue: 0.92, useNativeDriver: true, speed: 50, bounciness: 0 }).start();
  const pressOut = () => Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 18, bounciness: 10 }).start();
  return (
    <Pressable
      style={[styles.control, { left: point.left - BOX.w / 2, top: point.top - BOX.h / 2 }]}
      hitSlop={8}
      onPress={onPress}
      onPressIn={isWheel ? pressIn : undefined}
      onPressOut={isWheel ? pressOut : undefined}>
      <View style={styles.glyphCol}>
        {isWheel ? (
          // Tesla's icon-heat-wheel look: the wheel as a grey icon with the heat waves drawn on top as
          // INDIVIDUAL glyphs (same as the seats) so each lights by level (2→1→off), not all-or-nothing.
          // The unlit waves take the wheel's grey; the whole group pulses on press.
          <Animated.View style={[styles.wheelBox, { transform: [{ scale }] }]}>
            <WaveGlyph waves={waves} lit={lit} color={color} dimColor={WHEEL_GREY} waveStyle={styles.wheelWave} stretch />
            <Image source={{ uri: wheelUri }} style={[isYoke ? styles.yokeIcon : styles.wheelIcon, { tintColor: wheelColor }]} resizeMode="contain" />
          </Animated.View>
        ) : (
          <WaveGlyph waves={waves} lit={lit} color={color} />
        )}
        {/* "Auto" floats BELOW the glyph (absolute, anchored to the glyph's bottom) so switching to Auto
            doesn't shove the icon up — matches the Tesla app, where the glyph stays put. */}
        {mode === 'auto' ? (
          // Follow THIS marker's own colour: the wheel's glyph is `wheelColor`
          // (it greys out when off), the seats' is `color` (the wave tint). They
          // resolve differently, so the label must pick the matching one rather
          // than share a hardcoded white.
          <Text style={[styles.autoLabel, { color: isWheel ? wheelColor : color }]}>Auto</Text>
        ) : null}
      </View>
    </Pressable>
  );
}

// `waves` S-shaped strokes side-by-side (the real seat-heater glyph); the first `lit` take `color`,
// the rest stay dim. Drawn from a rendered "clean S" alpha PNG (seatWaveIcon) tinted per wave — exact
// Tesla shape with no SVG dependency and no bundled asset (data-URI works in the JS-only deploy).
function WaveGlyph({
  waves,
  lit,
  color,
  waveStyle,
  stretch,
  dimColor,
}: {
  waves: number;
  lit: number;
  color: string;
  waveStyle?: StyleProp<ImageStyle>;
  stretch?: boolean;
  dimColor?: string;
}) {
  const items = [];
  for (let i = 0; i < waves; i += 1) {
    const c = i < lit ? color : dimColor ?? DIM;
    items.push(
      <Image
        key={i}
        source={{ uri: SEAT_WAVE_URI }}
        style={[waveStyle ?? styles.wave, { tintColor: c }]}
        // 'stretch' lets the wheel waves be made wider than the glyph's natural aspect; seats use contain.
        resizeMode={stretch ? 'stretch' : 'contain'}
      />,
    );
  }
  return <View style={styles.waveRow}>{items}</View>;
}

const styles = StyleSheet.create({
  control: {
    position: 'absolute',
    width: BOX.w,
    height: BOX.h,
    alignItems: 'center',
    justifyContent: 'center',
  },
  waveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  wave: {
    width: 10,
    height: 19,
    // Pull the three strokes a hair closer (Tesla packs them tightly).
    marginHorizontal: -1.5,
  },
  // Steering wheel control: the heat waves sit ON TOP of the wheel icon (column, centred).
  wheelBox: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  // ── SIZE KNOBS ──────────────────────────────────────────────────────────────────────────────
  // wheelIcon = the wheel size; wheelWave = each S-line size on the wheel (smaller than the seats).
  wheelIcon: {
    width: 19,
    height: 15, // matches the trimmed wheel aspect (172x132) so there's no internal whitespace
    marginTop: -2, // pull the wheel up so the waves sit right on it (no gap)
    tintColor: WHEEL_GREY,
  },
  // The yoke rim is wider + shorter than the round wheel (trimmed 192x107 ≈ 1.79:1); keep a similar
  // visual height so the waves sit on it the same way.
  yokeIcon: {
    width: 26,
    height: 14.5,
    marginTop: -1,
    tintColor: WHEEL_GREY,
  },
  wheelWave: {
    width: 8.5,
    height: 12,
    marginHorizontal: -0.8,
  },
  // Wraps the glyph so "Auto" can anchor to the glyph's bottom edge without affecting its centring.
  glyphCol: {
    width: BOX.w,
    alignItems: 'center',
    justifyContent: 'center',
  },
  autoLabel: {
    position: 'absolute',
    top: '100%', // just under the glyph; out of flow, so the glyph stays centred on the marker
    left: 0,
    right: 0,
    textAlign: 'center',
    paddingTop: 2,
    fontSize: 11,
    fontWeight: '600',
    // Colour is applied inline: "Auto" follows ITS OWN marker's colour, and the
    // seat and the steering wheel resolve to different ones (the wheel greys out
    // when off; the seats take the heat/cool tint). A hardcoded white made every
    // Auto label the same regardless of which marker it sat under.
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  menu: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(28,28,30,0.96)',
    borderRadius: 11,
    paddingVertical: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.5,
    shadowRadius: 8,
  },
  menuOpt: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuText: {
    fontSize: 15,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.55)',
  },
  menuTextOn: {
    color: 'white',
    fontWeight: '700',
  },
});
