import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SymbolView } from 'expo-symbols';

import { VehicleCanvas } from '@/godot/VehicleCanvas';
import { ClimateScreen } from '@/screens/ClimateScreen';
import { ControlsScreen } from '@/screens/ControlsScreen';
import { HomeScreen } from '@/screens/HomeScreen';
import { useVehicleState } from '@/state/useVehicleState';

// Tesla home + sub-screens (climate / controls) over the embedded Godot car. Each view swaps the
// bottom panel and camera; the back chevron returns to Home (parked).
export default function Index() {
  const [state, actions] = useVehicleState();
  const mode =
    state.cameraMode === 'CLIMATE' ? 'climate' : state.cameraMode === 'TOP_DOWN' ? 'controls' : 'home';

  let panel;
  if (mode === 'climate') {
    panel = <ClimateScreen state={state} actions={actions} />;
  } else if (mode === 'controls') {
    panel = <ControlsScreen state={state} actions={actions} />;
  } else {
    panel = (
      <SafeAreaView edges={['bottom']} style={styles.homePanel}>
        <HomeScreen state={state} actions={actions} />
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.root}>
      <VehicleCanvas state={state} actions={actions}>
        {panel}
      </VehicleCanvas>

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
