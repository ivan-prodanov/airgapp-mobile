import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { VehicleCanvas } from '@/godot/VehicleCanvas';
import { HomeScreen } from '@/screens/HomeScreen';
import { useVehicleState } from '@/state/useVehicleState';

// Phase 3 proof-of-concept: the Tesla Home vertical wired against the expo-godot-view sim stub.
// The bridge boots on mount (GODOT_READY round-trips through the stub) and control taps drive
// sendMessageToGodot. Real Godot rendering arrives with the device engine embed.
export default function Index() {
  const [state, actions] = useVehicleState();

  return (
    <View style={styles.root}>
      <VehicleCanvas state={state} actions={actions}>
        <SafeAreaView edges={['bottom']} style={styles.controls}>
          <HomeScreen state={state} actions={actions} />
        </SafeAreaView>
      </VehicleCanvas>
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
});
