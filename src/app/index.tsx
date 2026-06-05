import { Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SymbolView } from 'expo-symbols';

import { VehicleCanvas } from '@/godot/VehicleCanvas';
import { ClimateScreen } from '@/screens/ClimateScreen';
import { HomeScreen } from '@/screens/HomeScreen';
import { useVehicleState } from '@/state/useVehicleState';

// Phase 3 proof-of-concept: the Tesla Home vertical wired against the expo-godot-view sim stub.
// The bridge boots on mount (GODOT_READY round-trips through the stub) and control taps drive
// sendMessageToGodot. Real Godot rendering arrives with the device engine embed.
export default function Index() {
  const [state, actions] = useVehicleState();
  const isClimate = state.cameraMode === 'CLIMATE';

  return (
    <View style={styles.root}>
      <VehicleCanvas state={state} actions={actions}>
        {isClimate ? (
          <ClimateScreen state={state} actions={actions} />
        ) : (
          <SafeAreaView edges={['bottom']} style={styles.controls}>
            <HomeScreen state={state} actions={actions} />
          </SafeAreaView>
        )}
      </VehicleCanvas>

      {isClimate ? (
        <SafeAreaView edges={['top']} style={styles.topBar} pointerEvents="box-none">
          <Pressable style={styles.backButton} onPress={() => actions.setCameraMode('PARKED')}>
            <SymbolView name="chevron.left" tintColor="white" size={22} weight="medium" />
          </Pressable>
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
  controls: {
    padding: 16,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    paddingHorizontal: 12,
    paddingTop: 4,
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(50,50,50,0.6)',
  },
});
