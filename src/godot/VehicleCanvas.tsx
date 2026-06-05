import type { ReactNode } from 'react';
import { useEffect, useMemo, useRef } from 'react';
import { type LayoutChangeEvent, StyleSheet, View } from 'react-native';

import { ExpoGodotView } from '../../modules/expo-godot-view';
import { BridgeContext } from './bridgeContext';
import { GodotRendererBridge } from './GodotRendererBridge';
import type { VehicleActions } from '../state/useVehicleState';
import type { FrameData } from '../types/rendererMessages';
import type { VehicleViewState } from '../types/vehicleTypes';

// Lifts the car up off the bottom controls panel (frame top_margin, in layout points).
const CAR_TOP_LIFT_PT = -64;

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

  // RN swap: web subscribed to the renderer iframe via attachFrame(); here we subscribe to the
  // native module's onGodotMessage stream.
  useEffect(() => bridge.attach(), [bridge]);

  // RN swap: web measured the host div with a ResizeObserver; onLayout gives us the frame size.
  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    const frame: FrameData = {
      // Small upward lift (points; Godot scales by pixel_ratio) so the hero car clears the bottom
      // controls panel. Negative = up. Tune CAR_TOP_LIFT_PT to taste.
      top_margin: CAR_TOP_LIFT_PT,
      left_margin: 0,
      width: Math.max(1, Math.round(width)),
      height: Math.max(1, Math.round(height)),
      animated: false,
      scroll_fraction: 1,
    };

    if (!booted.current) {
      bridge.boot(state, frame);
      booted.current = true;
    } else {
      bridge.updateFrame(frame);
    }
  };

  useEffect(() => {
    if (booted.current) {
      bridge.updateState(state);
    }
  }, [bridge, state]);

  return (
    <BridgeContext.Provider value={bridge}>
      <View style={styles.root} onLayout={onLayout}>
        <ExpoGodotView sceneName="mobile" style={StyleSheet.absoluteFill} />
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
});
