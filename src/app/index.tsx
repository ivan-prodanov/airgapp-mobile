import { useRef } from 'react';
import { Animated, PanResponder, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SymbolView } from 'expo-symbols';

import { VehicleCanvas } from '@/godot/VehicleCanvas';
import { ClimateScreen } from '@/screens/ClimateScreen';
import { ControlsScreen } from '@/screens/ControlsScreen';
import { HomeScreen } from '@/screens/HomeScreen';
import { useActiveVehicleId, useFleet, useVehicle } from '@/state/VehicleProvider';

// Tesla home + sub-screens (climate / controls) over the embedded Godot car. Each view swaps the
// bottom panel and camera; the back chevron returns to Home (parked).
export default function Index() {
  const [state, actions] = useVehicle();
  const vehicleId = useActiveVehicleId();
  const fleet = useFleet();
  const { width } = useWindowDimensions();
  const carTranslateX = useRef(new Animated.Value(0)).current;
  const animating = useRef(false);

  // Commit a switch: slide the live car fully off-screen in `direction` (-1 left / +1 right), swap
  // the active vehicle WHILE off-screen (the engine re-renders the incoming car in its real state),
  // jump the surface to the opposite edge, then slide it back to centre.
  const commitSwitch = (direction: -1 | 1) => {
    animating.current = true;
    Animated.timing(carTranslateX, {
      toValue: direction * width,
      duration: 180,
      useNativeDriver: true,
    }).start(() => {
      if (direction < 0) {
        fleet.nextVehicle();
      } else {
        fleet.prevVehicle();
      }
      carTranslateX.setValue(-direction * width);
      Animated.timing(carTranslateX, {
        toValue: 0,
        duration: 220,
        useNativeDriver: true,
      }).start(() => {
        animating.current = false;
      });
    });
  };

  const springBack = () => {
    Animated.spring(carTranslateX, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start();
  };

  // Horizontal car-switch swipe via PanResponder (RN's core responder system). RNGH's GestureDetector
  // never received touches inside the native-tab Home screen; PanResponder (same system as the proven
  // edge-back swipe) does. The handlers are spread onto the car-band view in HomeScreen. A horizontal
  // drag switches cars; a vertical drag returns false from onMoveShouldSet so the menu ScrollView
  // scrolls. The long-lived responder reads fleet/width from a ref refreshed every render (no stale
  // closures).
  const swipeLogic = useRef({ fleet, width });
  swipeLogic.current = { fleet, width };
  const swipe = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_e, g) => {
        const { fleet: f } = swipeLogic.current;
        return (
          !animating.current &&
          f.vehicles.length >= 2 &&
          Math.abs(g.dx) > 12 &&
          Math.abs(g.dx) > Math.abs(g.dy) * 1.4
        );
      },
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (_e, g) => {
        if (animating.current) {
          return;
        }
        const { fleet: f } = swipeLogic.current;
        const atStart = f.activeIndex === 0;
        const atEnd = f.activeIndex === f.vehicles.length - 1;
        const damped = (g.dx > 0 && atStart) || (g.dx < 0 && atEnd);
        carTranslateX.setValue(damped ? g.dx * 0.25 : g.dx);
      },
      onPanResponderRelease: (_e, g) => {
        const { fleet: f, width: w } = swipeLogic.current;
        if (animating.current) {
          return;
        }
        // Commit on EITHER a moderate drag distance OR a flick — so a quick swipe switches even when
        // it doesn't physically travel far (matches the edge-back gesture's dx-or-vx feel). Without
        // the velocity term a fast flick under `distThreshold` used to snap back, which felt sticky.
        const distThreshold = w * 0.18;
        const flickVelocity = 0.3;
        const atStart = f.activeIndex === 0;
        const atEnd = f.activeIndex === f.vehicles.length - 1;
        const goLeft = g.dx <= -distThreshold || (g.vx <= -flickVelocity && g.dx < 0);
        const goRight = g.dx >= distThreshold || (g.vx >= flickVelocity && g.dx > 0);
        if (goLeft && !atEnd) {
          commitSwitch(-1);
        } else if (goRight && !atStart) {
          commitSwitch(1);
        } else {
          springBack();
        }
      },
      onPanResponderTerminate: () => springBack(),
    }),
  ).current;

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
    panel = <HomeScreen state={state} actions={actions} swipeHandlers={swipe.panHandlers} />;
  }

  return (
    <View style={styles.root}>
      <VehicleCanvas state={state} actions={actions} vehicleId={vehicleId} carTranslateX={carTranslateX}>
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
