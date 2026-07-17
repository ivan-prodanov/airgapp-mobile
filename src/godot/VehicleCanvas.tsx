import type { ReactNode } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated as RNAnimated,
  Easing,
  StyleSheet,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
} from 'react-native';

// findings §4: alpha 0.5 (not 0.6), tweened over 0.5s LINEAR (not instant).
const RENDERER_DIM_ALPHA = 0.5;
const RENDERER_DIM_MS = 500;

import { ExpoGodotView } from '../../modules/expo-godot-view';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CAMERA_ANIM } from './cameraPresets';
import * as Device from 'expo-device';

import { isVehicleDataUnreliable } from '@/ble/vehicleStatusText';
import { teslaStatusBarHeight } from './teslaStatusBarHeight';
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
// The main-view frame we send the renderer.
//
// ⚠️ OUR `height` IS A ZOOM FACTOR, NOT TESLA'S COMPOSITING RECT. Read this
// before "correcting" these numbers against the RE (I did, and it shrank the car
// by 45%):
//
//   godot/mobile/scripts/MainViewContainer.gd :: on_update_main_view_frame does
//     scale = height / screen_height ; root_node.scale = scale
//   i.e. it SCALES THE WHOLE 3D SCENE by height/screen_height. (It also does its
//   own points -> pixels conversion via AppConfigManager.pixel_ratio, so their
//   `x getNativeScale()` is already handled for us.)
//
// The official app sends an absolute rect — Home = a 355pt band at
// statusBarHeight+60 (tesla-renderer-and-battery-FINDINGS §3c) — into a scene
// whose frame handler we have NOT recovered (their .gdc is compiled; Round 5
// only recovered the RN side). Their 355 evidently crops rather than zooms,
// because at the identical PARKED pose their car renders far larger than 355/852
// would give here. So their literals are NOT portable to this engine until we
// know their handler's maths.
//
// heightFrac is therefore the zoom knob (1.0 = unscaled), tuned against the real
// app; topMarginPt shifts the band. Our PARKED *pose* already matches theirs
// exactly (cameraPresets.ts), so framing is all that differs.
const VIEW_FRAME: Record<VehicleViewState['cameraMode'], { heightFrac: number; topMarginPt: number }> = {
  // PARKED: superseded by the absolute Tesla rect below — see buildFrame.
  PARKED: { heightFrac: 0.76, topMarginPt: -66 },
  CHARGING: { heightFrac: 1, topMarginPt: -64 },
  CLOSURE_OPEN: { heightFrac: 1, topMarginPt: -64 },
  // Climate uses Tesla's exact camera (offset[0,6,0.6] fov40, WIDTH-fit). At screen-size the whole car
  // renders small; Tesla shows it larger, so we scale the render frame up (>1) and lift it with a
  // negative top margin to re-centre. heightFrac is the climate ZOOM knob; topMargin keeps it framed.
  CLIMATE: { heightFrac: 1.3, topMarginPt: -300 },
  TOP_DOWN: { heightFrac: 1, topMarginPt: 0 },
};

// Their Home rect (tesla-renderer-frame-FINDINGS §2, R5 §3c): an absolute 355pt
// band starting statusBarHeight+60 below the top. Round 6 decompiled their scene
// and their frame handler is byte-for-byte ours — `height/screen_height` scene
// zoom and all — so with keep_aspect finally matching (HEIGHT), their numbers ARE
// portable now. The DPR cancels in the ratio: they send pixels against a pixel
// viewport; we send points and our scene multiplies by pixel_ratio itself.
const GODOT_VIEW_SIZE = 355;
// Their Climate rect: statusBarOffset .. SCREEN_HEIGHT - statusBarOffset - 240.
// Round 7 §2b: the 240 is NOT a sheet height — it's two inline literals
// (-320 +80), a fixed net inset. Copy it as-is.
const CLIMATE_BOTTOM_INSET = 240;
// Their Controls rect: SCREEN_HEIGHT - 20 (Round 7 §1a).
const CONTROLS_BOTTOM_INSET = 20;

function buildFrame(
  width: number,
  height: number,
  mode: VehicleViewState['cameraMode'],
  animated: boolean,
  statusBarHeight: number,
  // The FULL window height. Their frames are measured off SCREEN_HEIGHT, which
  // is not necessarily our canvas's laid-out height.
  screenHeight: number,
): FrameData {
  const cfg = VIEW_FRAME[mode];
  let top: number;
  let h: number;
  switch (mode) {
    case 'PARKED':
      top = statusBarHeight + 60;
      h = GODOT_VIEW_SIZE;
      break;
    case 'CLIMATE':
      // Their Climate rect (R5 §3c): top = statusBarOffset,
      // height = SCREEN_HEIGHT - statusBarOffset - 240.
      //
      // Round 7 §2b resolved all three inputs and they match what we pass:
      //   statusBarOffset = statusBarHeight = 59 on a Dynamic-Island phone
      //                     (== the insets.top we already use)
      //   240             = a fixed literal inset, not a sheet height
      //   SCREEN_HEIGHT   = Dimensions.get('window').height = the FULL window
      //                     (852) — which is what useWindowDimensions gives us.
      // So this should now be exact: height 553, scale 0.6491, center_y 335.5pt
      // (their §4 calibration). If it still mis-frames, the residual is NOT in
      // these numbers — measure before touching them.
      top = statusBarHeight;
      h = screenHeight - statusBarHeight - CLIMATE_BOTTOM_INSET;
      break;
    case 'TOP_DOWN':
      // Their Controls rect, RESOLVED (Round 7 §1a, iOS fn #98623):
      //   top_margin = 0                       (non-Cybertruck iOS)
      //   height     = SCREEN_HEIGHT - 20      (the `sheetHeight` R5 §5 left
      //                                         unresolved is a static literal
      //                                         20 = r4(2) x Gutter(10), NOT a
      //                                         draggable sheet)
      // -> scale 832/852 = 0.9765 on the reference phone. My earlier full-screen
      // guess gave scale 1.0, i.e. +2.4% — the "now actually bigger" the user saw.
      top = 0;
      h = screenHeight - CONTROLS_BOTTOM_INSET;
      break;
    default: {
      // No recovered rect for these (their Controls reuses the PARKED pose
      // rather than our top-down one, and R5 §5 left the Controls sheetHeight
      // UNRESOLVED). But keep_aspect must be uniform across views, or the fov
      // axis flips mid-navigation and the car collapses on the way to the
      // screen. So: reproduce each view's PRE-KEEP_HEIGHT look exactly — both
      // its size AND its position — on the new axis.
      //
      // SIZE: under KEEP_WIDTH the car rendered at `aspect` (= W/H) of its
      // KEEP_HEIGHT size, so an equal-looking zoom is frac x (W/H), which a
      // frame height of `frac x W` yields (H x frac x W/H).
      //
      // POSITION: the scene's centre is `top + H/2 * scale` (MainViewContainer),
      // so changing the zoom MOVES the car unless top moves with it. Solving
      // `top_new + H/2*scale_new == top_old + H/2*scale_old` gives
      //     top_new = top_old + (H/2) * frac * (1 - W/H).
      // Forgetting this is what threw Controls ~230pt up the screen: its
      // topMargin of 0 was tuned for scale 1.0 and means something else at 0.461.
      const aspect = width / height;
      h = cfg.heightFrac * width;
      top = cfg.topMarginPt + (height / 2) * cfg.heightFrac * (1 - aspect);
      break;
    }
  }
  return {
    top_margin: Math.round(top),
    left_margin: 0,
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(h)),
    animated,
    // findings §3a: the frame travels on the same 0.5s QUART/OUT curve as the
    // camera and the lighting. Omitting these left our scene on its own 0.75s
    // EASE_IN_OUT default, so the zoom lagged behind the pose.
    duration: CAMERA_ANIM.duration,
    transition_type: CAMERA_ANIM.transition_type,
    ease_type: CAMERA_ANIM.ease_type,
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
  const { height: screenHeight } = useWindowDimensions();
  // NOT insets.top. Their frames are built from a HARDCODED statusBarHeight
  // table, which on this phone says 59 where the real inset reports 68 — a 9pt
  // gap that made Climate render 1.5% small (measured on device; see
  // teslaStatusBarHeight.ts for the full derivation).
  const statusBarHeight = teslaStatusBarHeight(Device.modelId ?? null, insets.top);
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
    const frame = buildFrame(width, height, state.cameraMode, false, statusBarHeight, screenHeight);

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
        buildFrame(layout.current.width, layout.current.height, state.cameraMode, true, statusBarHeight, screenHeight),
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
