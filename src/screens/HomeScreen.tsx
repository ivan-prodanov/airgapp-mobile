import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ShellButton } from '../components/ShellButton';
import { StatusPill } from '../components/StatusPill';
import type { VehicleActions } from '../state/useVehicleState';
import type { VehicleViewState } from '../types/vehicleTypes';

interface ScreenProps {
  state: VehicleViewState;
  actions: VehicleActions;
}

// RN port of web-shell HomeScreen (divs + Tailwind grid → Views + StyleSheet).
// onClick → onPress; the bridge calls behind `actions` are unchanged.
export function HomeScreen({ state, actions }: ScreenProps) {
  return (
    <View style={styles.root}>
      <View>
        <Text style={styles.title}>Model Y</Text>
        <Text style={styles.subtitle}>Ultra Red · Performance Bayberry</Text>
      </View>

      <View style={styles.grid}>
        <Cell>
          <StatusPill label="Lock" value={state.locked ? 'Locked' : 'Unlocked'} active={state.locked} />
        </Cell>
        <Cell>
          <StatusPill label="Climate" value={state.climateOn ? 'On' : 'Off'} active={state.climateOn} />
        </Cell>
        <Cell>
          <StatusPill label="Charge" value={state.charging ? 'Charging' : state.cableAttached ? 'Plugged' : 'Idle'} active={state.charging} />
        </Cell>
        <Cell>
          <StatusPill label="Sentry" value={state.sentryEnabled ? 'On' : 'Off'} active={state.sentryEnabled} />
        </Cell>
      </View>

      <View style={styles.grid}>
        <Cell>
          <ShellButton active={state.frunkOpen} onPress={() => actions.toggle('frunkOpen')}>
            {state.frunkOpen ? 'Close frunk' : 'Open frunk'}
          </ShellButton>
        </Cell>
        <Cell>
          <ShellButton active={state.trunkOpen} onPress={() => actions.toggle('trunkOpen')}>
            {state.trunkOpen ? 'Close trunk' : 'Open trunk'}
          </ShellButton>
        </Cell>
        <Cell>
          <ShellButton active={state.cameraMode === 'CLIMATE'} onPress={() => actions.setCameraMode('CLIMATE')}>
            Climate view
          </ShellButton>
        </Cell>
        <Cell>
          <ShellButton active={state.cameraMode === 'CHARGING'} onPress={() => actions.setCameraMode('CHARGING')}>
            Charge view
          </ShellButton>
        </Cell>
        <Cell>
          <ShellButton active={state.mediaPlaying} onPress={() => actions.toggle('mediaPlaying')}>
            Media playback
          </ShellButton>
        </Cell>
      </View>
    </View>
  );
}

// 2-column grid cell (web used Tailwind `grid grid-cols-2 gap-2`).
function Cell({ children }: { children: ReactNode }) {
  return <View style={styles.cell}>{children}</View>;
}

const styles = StyleSheet.create({
  root: {
    gap: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
    color: 'white',
  },
  subtitle: {
    marginTop: 2,
    fontSize: 13,
    color: 'rgba(255,255,255,0.5)',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -4,
  },
  cell: {
    width: '50%',
    padding: 4,
  },
});
