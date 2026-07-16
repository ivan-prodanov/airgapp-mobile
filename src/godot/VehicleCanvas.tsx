import type { ReactNode } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated as RNAnimated, Easing, StyleSheet, View, type LayoutChangeEvent } from 'react-native';

// findings §4: alpha 0.5 (not 0.6), tweened over 0.5s LINEAR (not instant).
const RENDERER_DIM_ALPHA = 0.5;
const RENDERER_DIM_MS = 500;

import { ExpoGodotView } from '../../modules/expo-godot-view';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { isVehicleDataUnreliable } from '@/ble/vehicleStatusText';
import { useCarLinkStatus } from '@/state/VehicleProvider';
import type { VehicleActions } from '../state/useVehicleState';
import type { FrameData } from '../types/rendererMessages';
import type { VehicleViewState } from '../types/vehicleTypes';
import { BridgeContext } from './bridgeContext';
import { GodotRendererBridge } from './GodotRendererBridge';

// Per-view framing of the car within the main view (layout points; Godot scales by pixel_ratio).
//  - heightFrac < 1 shrinks the car (Godot scales the 3D root by frame_height / screen_height).
//  - topMarginPt < 0 raises the car (hero angled views sit up off the bottom panel).
// CLIMATE 0.93 = whole top-down car centred high (matched to the reference); it pairs with the short
// climate controls panel so the full car sits above them, like the real app.
// The on-screen rectangle the car composites into (their UPDATE_MAIN_VIEW_FRAME).
//
// Source: docs/superpowers/research/tesla-renderer-and-battery-FINDINGS.md §3c.
// The camera POSE is not viewport-dependent in the official app — every
// cam_fov/offset/rotation is a hard-coded literal (our PARKED already matches
// theirs exactly). The car's apparent size and position therefore come from THIS
// rectangle, which is why the poses looked right but the framing didn't.
//
// Their Home frame is an ABSOLUTE 355pt band starting statusBarHeight+60 below
// the top — not a fraction of the screen. What was here before were hand-tuned
// fudge factors (a 0.76 height fraction, a -66 top margin, and a Climate
// "zoom knob" of 1.3 with a -300 lift) that approximated the look per-device.
// Replaced with their literals.
const GODOT_VIEW_SIZE = 355; // their GODOT_VIEW_SIZE (iOS :4068110)
// Their Climate frame: statusBarOffset .. SCREEN_HEIGHT - statusBarOffset - 240.
const CLIMATE_BOTTOM_INSET = 240;

function buildFrame(
  width: number,
  height: number,
  mode: VehicleViewState['cameraMode'],
  animated: boolean,
  // The status-bar height their frames are measured from (insets.top).
  statusBarHeight: number,
): FrameData {
  const w = Math.max(1, Math.round(width));
  let top: number;
  let h: number;
  switch (mode) {
    case 'PARKED':
      top = statusBarHeight + 60;
      h = GODOT_VIEW_SIZE;
      break;
    case 'CLIMATE':
      top = statusBarHeight;
      h = height - statusBarHeight - CLIMATE_BOTTOM_INSET;
      break;
    default:
      // CHARGING / CLOSURE_OPEN / TOP_DOWN keep our framing: their Controls
      // screen reuses the PARKED pose rather than a top-down one (§3b), so
      // there's no recovered frame to copy for these. See the note in
      // cameraPresets.ts.
      top = 0;
      h = height;
      break;
  }
  return {
    top_margin: Math.round(top),
    left_margin: 0,
    width: w,
    height: Math.max(1, Math.round(h)),
    animated,
    scroll_fraction: 1,
  };
}

interface VehicleCanvasProps {
  state: VehicleViewState;
  // `actions` is kept on the contract for parity with web-shell; it feeds the marker overlay,
  // which is deferred until the engine renders markers (the sim stub sends none).
  actions: VehicleActions;
  /** Active vehicle id. A change means the user switched cars (full re-apply) vs. editing fields. */
  vehicleId: string;
  /** Horizontal translation of the live car surface, driven by the Home swipe. Defaults to static. */
  carTranslateX?: RNAnimated.Value;
  children: ReactNode;
}

// RN port of web-shell VehicleCanvas. Owns the bridge, renders the Godot surface (iframe →
// <ExpoGodotView/>), and drives boot/updateFrame/updateState. The marker/tire overlays are
// intentionally omitted for the Phase 3 wiring PoC.
export function VehicleCanvas({ state, vehicleId, carTranslateX, children }: VehicleCanvasProps) {
  const bridge = useMemo(() => new GodotRendererBridge(), []);
  const carLink = useCarLinkStatus();
  const insets = useSafeAreaInsets();
  const booted = useRef(false);
  const layout = useRef<{ width: number; height: number } | null>(null);
  const lastVehicleId = useRef<string | null>(null);

  // RN swap: web subscribed to the renderer iframe via attachFrame(); here we subscribe to the
  // native module's onGodotMessage stream.
  useEffect(() => bridge.attach(), [bridge]);

  // ── Renderer dim ─────────────────────────────────────────────────────────
  // Findings §4 (docs/superpowers/research/tesla-status-polish-FINDINGS.md):
  // the official app dims the CAR — not the screen — via a Godot overlay quad
  // (`SET_SCREEN_OVERLAY_COLOR`), at the theme background colour, alpha 0.5,
  // tweened over 0.5s LINEAR. We have no such bridge message, but our dim view
  // sits under the UI overlay and over the renderer, so it covers the same
  // pixels; only the colour/alpha/curve had to be corrected (was an instant
  // rgba(0,0,0,0.6) blackout).
  //
  // The TRIGGER is the real correction: theirs is `isVehicleDataUnreliable`,
  // NOT ConnectionState.ASLEEP. A demo car has no telemetry to be unreliable,
  // so its Explore sleep toggle stands in for the same idea.
  const unreliable = carLink.linked
    ? isVehicleDataUnreliable(carLink.lastVehicleDataAt, Date.now())
    : !state.awake;
  const dim = useRef(new RNAnimated.Value(0)).current;
  useEffect(() => {
    RNAnimated.timing(dim, {
      toValue: unreliable ? RENDERER_DIM_ALPHA : 0,
      duration: RENDERER_DIM_MS,
      easing: Easing.linear,
      useNativeDriver: true,
    }).start();
  }, [unreliable, dim]);

  // Re-evaluate `unreliable` as the 2-minute window elapses: nothing else
  // re-renders this component once the link goes quiet.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!carLink.linked) return;
    const id = setInterval(() => setTick((n) => n + 1), 5_000);
    return () => clearInterval(id);
  }, [carLink.linked]);

  // RN swap: web measured the host div with a ResizeObserver; onLayout gives us the frame size.
  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    layout.current = { width, height };
    const frame = buildFrame(width, height, state.cameraMode, false, insets.top);

    if (!booted.current) {
      bridge.boot(state, frame);
      lastVehicleId.current = vehicleId;
      booted.current = true;
    } else {
      bridge.updateFrame(frame);
    }
  };

  // Re-send the frame when the view changes so the per-view framing follows it, animating in step
  // with the camera move.
  useEffect(() => {
    if (booted.current && layout.current) {
      bridge.updateFrame(
        buildFrame(layout.current.width, layout.current.height, state.cameraMode, true, insets.top),
      );
    }
  }, [bridge, state.cameraMode]);

  useEffect(() => {
    if (!booted.current) {
      return;
    }
    if (lastVehicleId.current !== vehicleId) {
      lastVehicleId.current = vehicleId;
      bridge.switchVehicle(state);
    } else {
      bridge.updateState(state);
    }
  }, [bridge, state, vehicleId]);

  return (
    <BridgeContext.Provider value={bridge}>
      <View style={styles.root} onLayout={onLayout}>
        {/* Orbit DISABLED everywhere (2026-06-21). Tested orbit-on-Controls-only; it still crashed
            within seconds of any rotation drag. The rapid camera mutation feeds the same GL
            state corruption that gl_view.mm::touchesBegan triggers — different entry, same bug.
            Whole feature reverts to "no touches reach Godot" until Phase 8 (Godot source rebuild
            with iOS 26 GLES2 fixes). Infrastructure (orbitEnabled prop, setOrbitEnabled, recognizer
            code) stays in place so the feature flips back on with one line change when ready. */}
        <RNAnimated.View
          style={[StyleSheet.absoluteFill, carTranslateX ? { transform: [{ translateX: carTranslateX }] } : null]}
          pointerEvents="none">
          <ExpoGodotView sceneName="mobile" orbitEnabled={false} style={StyleSheet.absoluteFill} />
        </RNAnimated.View>
        {/* Dim the 3D car when the car's data is unreliable (applies to every
            screen). UI panels render on top, undimmed — matching the official
            app, whose dim covers the renderer surface only. */}
        <RNAnimated.View style={[styles.rendererDim, { opacity: dim }]} pointerEvents="none" />
        <View style={styles.overlay} pointerEvents="box-none">
          {children}
        </View>
      </View>
    </BridgeContext.Provider>
  );
}

const styles = StyleSheet.create({
  root: {
    // Match the Godot scene's background grey so that when the car surface slides during a vehicle
    // swipe, the area it vacates blends into the same grey instead of flashing pure black.
    flex: 1,
    backgroundColor: '#161718',
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'flex-end',
  },
  rendererDim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    // findings §4: their overlay's colour is ThemeContext.v5BackgroundColor —
    // the THEME BACKGROUND, not hard black. The RE did not resolve that token to
    // a hex (§8 gap), so we use the renderer's own background grey, which is
    // what the car should fade toward. Alpha lives in the animated `opacity`.
    backgroundColor: '#161718',
  },
});
