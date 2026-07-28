import { Pressable, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SymbolView } from 'expo-symbols';

import { MarkerOverlay } from '../godot/MarkerOverlay';
import { TirePressureOverlay } from '../godot/TirePressureOverlay';
import { CONTROL_ACTIONS, CONTROL_AFFECTED_KEYS, type ControlActionId } from '../state/controlActions';
import { controlHaptic } from '../state/controlHaptic';
import { useCarLinkStatus } from '../state/VehicleProvider';
import { BusyIcon } from '../components/BusyIcon';
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
  // ⚠️ The bottom bar rides the CARD clock (479ms from the push), NOT the
  // markers' content clock — so it lands well before the markers do.
  //
  // findings R10 §1c claims otherwise: "one shared Animated.Value written into
  // opacity at 10 sites: 5 markers + 5 bottom buttons", started in the markers
  // callback. Built that way, and the user's device says it's wrong: on the real
  // app the title and buttons fade in noticeably QUICKER than the markers. That
  // is only possible if they ride the card while the markers wait for the
  // markers response (which lands after the ~500ms camera move). Device beats
  // doc — the same call we've made five times now, and it's been right each time.
  //
  // So: no opacity of our own here. The card's Animated.View (index.tsx) carries
  // this whole screen, and the markers add their own second clock on top.
  return (
    <>
      <MarkerOverlay state={state} actions={actions} />
      <TirePressureOverlay state={state} />
      <SafeAreaView edges={['bottom']} style={styles.bar}>
        {/* Same actions as the Customize Controls grid — they run identically. */}
        <Action id="flash" state={state} actions={actions} />
        <Action id="honk" state={state} actions={actions} />
        <Action id="start" state={state} actions={actions} />
        <Action id="vent" state={state} actions={actions} />
      </SafeAreaView>
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
  // Part of the double-tap fix, not a flourish. buildVehicleActions now DROPS a
  // toggle whose command is still in flight; without a busy affordance that tap
  // is silently ignored, which trades "wrong for 30s" for "button appears dead
  // for 2s". Home already had this (BusyIcon + the recovered
  // iconButtonBusyOpacity fade); this screen — the one the bug was reported on —
  // had neither, and did not consult `pending` at all.
  const carLink = useCarLinkStatus();
  const pending = CONTROL_AFFECTED_KEYS[id].some((key) => carLink.pending.has(key));
  return (
    <Pressable
      style={[styles.action, pending ? styles.actionBusy : null]}
      // Disabled while its own command runs — the official app's rule,
      // `disabled = useCommandTypeBusyStatus(...).busy`.
      disabled={pending}
      onPress={() => {
        controlHaptic();
        action.run(state, actions);
      }}
    >
      {pending ? (
        <BusyIcon size={26} />
      ) : (
        <SymbolView
          name={action.symbol(state)}
          tintColor={action.isActive(state) ? 'white' : 'rgba(255,255,255,0.85)'}
          size={26}
        />
      )}
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
  // findings §5: a busy control button fades to iconButtonBusyOpacity. Same
  // value Home's quickIconBusy uses, so the two screens read identically.
  actionBusy: {
    opacity: 0.5,
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
