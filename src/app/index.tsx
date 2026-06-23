import { useRef } from 'react';
import { PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SymbolView } from 'expo-symbols';

import { VehicleCanvas } from '@/godot/VehicleCanvas';
import { ClimateScreen } from '@/screens/ClimateScreen';
import { ControlsScreen } from '@/screens/ControlsScreen';
import { HomeScreen } from '@/screens/HomeScreen';
import { useActiveVehicleId, useVehicle } from '@/state/VehicleProvider';

// Tesla home + sub-screens (climate / controls) over the embedded Godot car. Each view swaps the
// bottom panel and camera; the back chevron returns to Home (parked).
export default function Index() {
  const [state, actions] = useVehicle();
  const vehicleId = useActiveVehicleId();
  const mode =
    state.cameraMode === 'CLIMATE' ? 'climate' : state.cameraMode === 'TOP_DOWN' ? 'controls' : 'home';

  // iOS-style left-edge swipe-back: a rightward swipe from the left edge returns to Home (parked),
  // available on climate & controls (like the system back gesture). A narrow strip catches the start.
  const goBack = useRef(() => actions.setCameraMode('PARKED'));
  goBack.current = () => actions.setCameraMode('PARKED');
  const edgeBack = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => g.dx > 12 && g.dx > Math.abs(g.dy) * 1.6,
      onPanResponderRelease: (_e, g) => {
        if (g.dx > 70 || g.vx > 0.4) {
          // Defer one frame: navigating flips `mode` to 'home', which unmounts THIS strip — doing it
          // synchronously during its own release crashes RN's touch handler (active responder freed).
          requestAnimationFrame(() => goBack.current());
        }
      },
    }),
  ).current;

  let panel;
  if (mode === 'climate') {
    panel = <ClimateScreen state={state} actions={actions} />;
  } else if (mode === 'controls') {
    panel = <ControlsScreen state={state} actions={actions} />;
  } else {
    panel = <HomeScreen state={state} actions={actions} />;
  }

  return (
    <View style={styles.root}>
      <VehicleCanvas state={state} actions={actions} vehicleId={vehicleId}>
        {panel}
      </VehicleCanvas>

      {mode !== 'home' ? (
        <View style={styles.edgeBack} {...edgeBack.panHandlers} />
      ) : null}

      {mode !== 'home' ? (
        <SafeAreaView edges={['top']} style={styles.topBar} pointerEvents="box-none">
          <View style={styles.topBarRow}>
            <Pressable style={styles.backButton} onPress={() => actions.setCameraMode('PARKED')}>
              <SymbolView name="chevron.left" tintColor="white" size={22} weight="medium" />
            </Pressable>
            {mode === 'controls' ? <Text style={styles.title}>Controls</Text> : null}
          </View>
        </SafeAreaView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: 'black',
  },
  homePanel: {
    padding: 16,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  edgeBack: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    width: 26,
  },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 12,
    paddingTop: 4,
  },
  topBarRow: {
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backButton: {
    position: 'absolute',
    left: 0,
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(50,50,50,0.6)',
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: 'white',
  },
});
