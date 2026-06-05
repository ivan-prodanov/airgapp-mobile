import type { ReactNode } from 'react';
import { useEffect, useMemo, useRef } from 'react';
import { type LayoutChangeEvent, StyleSheet, View } from 'react-native';

import { ExpoGodotView } from '../../modules/expo-godot-view';
import { BridgeContext } from './bridgeContext';
import { GodotRendererBridge } from './GodotRendererBridge';
import type { VehicleActions } from '../state/useVehicleState';
import type { FrameData } from '../types/rendererMessages';
import type { VehicleViewState } from '../types/vehicleTypes';

// Per-view framing of the car within the main view (layout points; Godot scales by pixel_ratio).
//  - heightFrac < 1 shrinks the car (Godot scales the 3D root by frame_height / screen_height).
//  - topMarginPt < 0 raises the car (hero angled views sit up off the bottom panel).
// CLIMATE 0.93 = whole top-down car centred high (matched to the reference); it pairs with the short
// climate controls panel so the full car sits above them, like the real app.
const VIEW_FRAME: Record<VehicleViewState['cameraMode'], { heightFrac: number; topMarginPt: number }> = {
  // PARKED = home screen: car sits in the upper band (header above, controls sheet below).
  PARKED: { heightFrac: 0.76, topMarginPt: -66 },
  CHARGING: { heightFrac: 1, topMarginPt: -64 },
  CLOSURE_OPEN: { heightFrac: 1, topMarginPt: -64 },
  CLIMATE: { heightFrac: 1, topMarginPt: 0 },
  TOP_DOWN: { heightFrac: 1, topMarginPt: 0 },
};

function buildFrame(
  width: number,
  height: number,
  mode: VehicleViewState['cameraMode'],
  animated: boolean,
): FrameData {
  const cfg = VIEW_FRAME[mode];
  return {
    top_margin: cfg.topMarginPt,
    left_margin: 0,
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height * cfg.heightFrac)),
    animated,
    scroll_fraction: 1,
  };
}

interface VehicleCanvasProps {
  state: VehicleViewState;
  // `actions` is kept on the contract for parity with web-shell; it feeds the marker overlay,
  // which is deferred until the engine renders markers (the sim stub sends none).
  actions: VehicleActions;
  children: ReactNode;
}

// RN port of web-shell VehicleCanvas. Owns the bridge, renders the Godot surface (iframe →
// <ExpoGodotView/>), and drives boot/updateFrame/updateState. The marker/tire overlays are
// intentionally omitted for the Phase 3 wiring PoC.
export function VehicleCanvas({ state, children }: VehicleCanvasProps) {
  const bridge = useMemo(() => new GodotRendererBridge(), []);
  const booted = useRef(false);
  const layout = useRef<{ width: number; height: number } | null>(null);

  // RN swap: web subscribed to the renderer iframe via attachFrame(); here we subscribe to the
  // native module's onGodotMessage stream.
  useEffect(() => bridge.attach(), [bridge]);

  // RN swap: web measured the host div with a ResizeObserver; onLayout gives us the frame size.
  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    layout.current = { width, height };
    const frame = buildFrame(width, height, state.cameraMode, false);

    if (!booted.current) {
      bridge.boot(state, frame);
      booted.current = true;
    } else {
      bridge.updateFrame(frame);
    }
  };

  // Re-send the frame when the view changes so the per-view framing follows it, animating in step
  // with the camera move.
  useEffect(() => {
    if (booted.current && layout.current) {
      bridge.updateFrame(buildFrame(layout.current.width, layout.current.height, state.cameraMode, true));
    }
  }, [bridge, state.cameraMode]);

  useEffect(() => {
    if (booted.current) {
      bridge.updateState(state);
    }
  }, [bridge, state]);

  return (
    <BridgeContext.Provider value={bridge}>
      <View style={styles.root} onLayout={onLayout}>
        <ExpoGodotView sceneName="mobile" style={StyleSheet.absoluteFill} />
        {/* Asleep: dim the 3D car (applies to every screen). UI panels render on top, undimmed. */}
        {!state.awake ? (
          <View style={styles.asleepDim} pointerEvents="none" />
        ) : null}
        <View style={styles.overlay} pointerEvents="box-none">
          {children}
        </View>
      </View>
    </BridgeContext.Provider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: 'black',
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'flex-end',
  },
  asleepDim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
});
