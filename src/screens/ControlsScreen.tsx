import { Animated, Pressable, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SymbolView } from 'expo-symbols';

import { MarkerOverlay } from '../godot/MarkerOverlay';
import { useContentFade } from '../godot/useContentFade';
import { CONTROL_ACTIONS, type ControlActionId } from '../state/controlActions';
import { controlHaptic } from '../state/controlHaptic';
import type { VehicleActions } from '../state/useVehicleState';
import type { VehicleViewState } from '../types/vehicleTypes';

interface Props {
  state: VehicleViewState;
  actions: VehicleActions;
}

// Vertical trim for the Flash/Honk/Start/Vent bar on top of its natural safe-area bottom position:
// positive lifts it up, negative drops it down. (It was previously dropped to clear a temporary
// Home/Explore tab bar; that bar is gone, so it's back to the natural position.) Calibrated on device.
const BOTTOM_BAR_LIFT = 10;

// Controls screen: the closure marker overlay (frunk/trunk Open · center lock · charge port) drawn
// over the top-down car, plus the bottom action bar (Flash / Honk / Start / Vent).
export function ControlsScreen({ state, actions }: Props) {
  // findings R10 §1c: their Controls drives TEN opacity sites from ONE clock —
  // the 5 markers AND these 5 bottom buttons — started on the markers response.
  // So the buttons wait for the markers too, and the screen resolves as one
  // object. Same hook as MarkerOverlay, same event, same frame.
  const fade = useContentFade();
  return (
    <>
      <MarkerOverlay state={state} actions={actions} />
      <Animated.View style={{ opacity: fade }} pointerEvents="box-none">
      <SafeAreaView edges={['bottom']} style={styles.bar}>
        {/* Same actions as the Customize Controls grid — they run identically. */}
        <Action id="flash" state={state} actions={actions} />
        <Action id="honk" state={state} actions={actions} />
        <Action id="start" state={state} actions={actions} />
        <Action id="vent" state={state} actions={actions} />
      </SafeAreaView>
      </Animated.View>
    </>
  );
}

function Action({
  id,
  state,
  actions,
}: {
  id: ControlActionId;
  state: VehicleViewState;
  actions: VehicleActions;
}) {
  const action = CONTROL_ACTIONS[id];
  return (
    <Pressable
      style={styles.action}
      onPress={() => {
        controlHaptic();
        action.run(state, actions);
      }}
    >
      <SymbolView
        name={action.symbol(state)}
        tintColor={action.isActive(state) ? 'white' : 'rgba(255,255,255,0.85)'}
        size={26}
      />
      <Text style={styles.label}>{action.label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'flex-start',
    paddingTop: 14,
    paddingHorizontal: 8,
    marginBottom: BOTTOM_BAR_LIFT,
  },
  action: {
    alignItems: 'center',
    gap: 6,
    width: 72,
  },
  label: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.6)',
  },
});
