import { useRef } from 'react';
import { Animated, PanResponder, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
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

  // Horizontal pan over the car. activeOffsetX claims only clearly-horizontal drags; failOffsetY
  // lets the Home menu's vertical ScrollView win vertical drags. No-op with a single car.
  // runOnJS(true): this project has reanimated installed, so RNGH would otherwise workletize these
  // callbacks onto the UI thread — but we drive RN's Animated.Value and call plain-JS fleet methods,
  // which must run on the JS thread. Forcing JS-thread callbacks is the correct pairing here.
  const swipe = Gesture.Pan()
    .runOnJS(true)
    .activeOffsetX([-20, 20])
    .failOffsetY([-15, 15])
    .onUpdate((e) => {
      if (animating.current || fleet.vehicles.length < 2) {
        return;
      }
      const atStart = fleet.activeIndex === 0;
      const atEnd = fleet.activeIndex === fleet.vehicles.length - 1;
      // Rubber-band past the ends so a boundary swipe feels bounded, not stuck.
      const damped = (e.translationX > 0 && atStart) || (e.translationX < 0 && atEnd);
      carTranslateX.setValue(damped ? e.translationX * 0.25 : e.translationX);
    })
    .onEnd((e) => {
      if (animating.current || fleet.vehicles.length < 2) {
        springBack();
        return;
      }
      const threshold = width * 0.25;
      const atStart = fleet.activeIndex === 0;
      const atEnd = fleet.activeIndex === fleet.vehicles.length - 1;
      if (e.translationX <= -threshold && !atEnd) {
        commitSwitch(-1);
      } else if (e.translationX >= threshold && !atStart) {
        commitSwitch(1);
      } else {
        springBack();
      }
    });

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
      <VehicleCanvas state={state} actions={actions} vehicleId={vehicleId} carTranslateX={carTranslateX}>
        {mode === 'home' ? <GestureDetector gesture={swipe}>{panel}</GestureDetector> : panel}
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
