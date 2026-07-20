import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { useRouter } from 'expo-router';

import { EdgeSwipeBack } from '@/components/EdgeSwipeBack';
import { ParentalControlsSheet } from '@/components/ParentalControlsSheet';
import { PinSheet } from '@/components/PinSheet';
import { SpeedLimitSheet } from '@/components/SpeedLimitSheet';
import { Toggle } from '@/components/Toggle';
import { controlHaptic } from '@/state/controlHaptic';
import { useVehicle } from '@/state/VehicleProvider';
import type { VehicleStateKey, VehicleViewState } from '@/types/vehicleTypes';

// The four PIN-gated toggles and their INDEPENDENT per-feature PINs (the real Tesla app keeps a separate
// PIN per feature, not one shared), copied exactly from the decompiled Tesla bundle:
//   • Valet Mode & PIN to Drive: ENABLE always shows "Set your 4-digit PIN" (re-sets it); DISABLE is FREE
//     (no prompt). Their PIN exists only to drive the "Clear PIN" row action.
//   • Speed Limit Mode & Parental Controls: ENABLE sets the PIN the first time then VERIFIES it; DISABLE
//     always VERIFIES.
// Each feature's row swaps its subtitle for a tappable blue "Clear PIN" once its PIN is set (see below).
type ProtectedKey = 'valetMode' | 'parentalControls' | 'speedLimitMode' | 'pinToDrive';
type PinField = 'valetPin' | 'parentalPin' | 'speedLimitPin' | 'pinToDrivePin';
const PIN_FIELD: Record<ProtectedKey, PinField> = {
  valetMode: 'valetPin',
  parentalControls: 'parentalPin',
  speedLimitMode: 'speedLimitPin',
  pinToDrive: 'pinToDrivePin',
};
const FEATURE_TITLE: Record<ProtectedKey, string> = {
  valetMode: 'Valet Mode',
  parentalControls: 'Parental Controls',
  speedLimitMode: 'Speed Limit Mode',
  pinToDrive: 'PIN to Drive',
};
// Clear PIN splits two ways (verified): Valet & PIN to Drive clear via a simple confirm alert (no entry);
// Speed Limit & Parental require the feature OFF first, then verify the PIN in the pad to clear it.
// Valet & PIN to Drive enable-always-"Set" / disable-free; Speed Limit & Parental verify on every toggle.
const ENABLE_ALWAYS_SET = new Set<ProtectedKey>(['valetMode', 'pinToDrive']);
const CLEAR_VIA_ALERT = new Set<ProtectedKey>(['valetMode', 'pinToDrive']);
const CLEAR_MSG: Record<'valetMode' | 'pinToDrive', string> = {
  valetMode: 'Valet PIN will be removed',
  pinToDrive: 'Drive PIN will be removed',
};
type PinPurpose = 'set' | 'verifyEnable' | 'verifyDisable' | 'clearVerify';

// Security & Drivers screen (route). Everything from Dashcam Viewer down to PIN to Drive; the driver/key rows
// below PIN to Drive in the real app are intentionally dropped.
export default function SecurityScreen() {
  const router = useRouter();
  const [state, actions] = useVehicle();

  // Which protected toggle is awaiting a PIN, and why (set new / verify to enable / verify to disable /
  // verify to clear); null = no prompt.
  const [pinFor, setPinFor] = useState<{ key: ProtectedKey; purpose: PinPurpose } | null>(null);
  const [speedOpen, setSpeedOpen] = useState(false);
  const [parentalOpen, setParentalOpen] = useState(false);

  const toggle = (key: VehicleStateKey) => {
    controlHaptic();
    actions.toggle(key);
  };
  const setFeature = (key: ProtectedKey, on: boolean) =>
    actions.patch({ [key]: on } as Partial<VehicleViewState>);
  const clearPin = (key: ProtectedKey) => actions.patch({ [PIN_FIELD[key]]: null } as Partial<VehicleViewState>);

  const requestToggle = (key: ProtectedKey) => {
    controlHaptic();
    const on = state[key];
    const pinSet = state[PIN_FIELD[key]] != null;
    if (ENABLE_ALWAYS_SET.has(key)) {
      // Valet & PIN to Drive: enabling always (re)sets the PIN; disabling is free (no prompt).
      if (!on) setPinFor({ key, purpose: 'set' });
      else setFeature(key, false);
    } else if (!on) {
      // Speed Limit & Parental: set the PIN the first time, verify it thereafter.
      setPinFor({ key, purpose: pinSet ? 'verifyEnable' : 'set' });
    } else if (pinSet) {
      setPinFor({ key, purpose: 'verifyDisable' });
    } else {
      // No PIN on record (e.g. just cleared while on) — nothing to verify, so turn off directly.
      setFeature(key, false);
    }
  };

  // Called from the PIN pad. Returns whether the entry was accepted (a rejection shakes + clears in place).
  const onPinSubmit = (pin: string): boolean => {
    if (!pinFor) return false;
    const { key, purpose } = pinFor;
    if (purpose === 'set') {
      actions.patch({ [PIN_FIELD[key]]: pin, [key]: true } as Partial<VehicleViewState>);
      setPinFor(null);
      return true;
    }
    if (pin !== state[PIN_FIELD[key]]) return false; // verify against this feature's saved PIN
    if (purpose === 'verifyEnable') setFeature(key, true);
    else if (purpose === 'verifyDisable') setFeature(key, false);
    else clearPin(key); // clearVerify
    setPinFor(null);
    return true;
  };

  // "Clear PIN" subtitle tap.
  const requestClearPin = (key: ProtectedKey) => {
    controlHaptic();
    if (CLEAR_VIA_ALERT.has(key)) {
      Alert.alert(FEATURE_TITLE[key], CLEAR_MSG[key as 'valetMode' | 'pinToDrive'], [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => clearPin(key) },
      ]);
    } else if (state[key]) {
      // Speed Limit / Parental: must turn the feature off before its PIN can be cleared.
      Alert.alert(FEATURE_TITLE[key], `To clear the PIN, you must first turn off ${FEATURE_TITLE[key]}.`, [
        { text: 'OK' },
      ]);
    } else {
      setPinFor({ key, purpose: 'clearVerify' });
    }
  };

  const openMore = (open: () => void) => {
    controlHaptic();
    open();
  };

  // Cross-feature gates, read off the `disabled` flags the decompiled row builder sets (only three of the
  // rows set one at all — Valet and Sentry are never gated):
  //   • PIN to Drive  disabled = valetModeOn        — and its subtitle is replaced by the reason.
  //   • Speed Limit   disabled = parentalOn         — Parental Controls owns speed limiting while it's on.
  //   • Parental      disabled = speedLimitOn && !parentalOn — mutually exclusive with Speed Limit, but the
  //     `&& !parentalOn` term means whichever is already ON stays switchable, so neither can trap the other.
  // (The app also gates Parental + PIN to Drive on having a Phone Key; we have no phone-key state, so that
  // half is not modelled.)
  const gatedParental = state.speedLimitMode && !state.parentalControls;
  const gatedSpeedLimit = state.parentalControls;
  const gatedPinToDrive = state.valetMode;

  const pinMode: 'set' | 'enter' = pinFor?.purpose === 'set' ? 'set' : 'enter';
  const pinSetFor = (key: ProtectedKey) => state[PIN_FIELD[key]] != null;

  return (
    <View style={styles.root}>
      <SafeAreaView edges={['top']} style={styles.safe}>
        <View style={styles.header}>
          <Pressable style={styles.back} hitSlop={10} onPress={() => router.back()}>
            <SymbolView name="chevron.left" tintColor="white" size={22} weight="medium" />
          </Pressable>
          <Text style={styles.title}>Security &amp; Drivers</Text>
        </View>

        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <NavRow symbol="camera.fill" title="Dashcam Viewer" subtitle="View saved clips" disabled />
          <ToggleRow
            symbol="record.circle.fill"
            title="Sentry Mode"
            subtitle="Enable to view live camera"
            value={state.sentryEnabled}
            onToggle={() => toggle('sentryEnabled')}
          />
          <ToggleRow
            symbol="key.fill"
            title="Valet Mode"
            subtitle="Limit vehicle access"
            value={state.valetMode}
            onToggle={() => requestToggle('valetMode')}
            pinSet={pinSetFor('valetMode')}
            onClearPin={() => requestClearPin('valetMode')}
          />
          <ToggleRow
            symbol="figure.and.child.holdinghands"
            title="Parental Controls"
            subtitle="Turn on a full suite of safety features including speed limit mode, chill acceleration, and more..."
            value={state.parentalControls}
            onToggle={() => requestToggle('parentalControls')}
            onMore={() => openMore(() => setParentalOpen(true))}
            pinSet={pinSetFor('parentalControls')}
            onClearPin={() => requestClearPin('parentalControls')}
            disabled={gatedParental}
          />
          <ToggleRow
            symbol="speedometer"
            title="Speed Limit Mode"
            subtitle="Limit top speed"
            value={state.speedLimitMode}
            onToggle={() => requestToggle('speedLimitMode')}
            onMore={() => openMore(() => setSpeedOpen(true))}
            pinSet={pinSetFor('speedLimitMode')}
            onClearPin={() => requestClearPin('speedLimitMode')}
            disabled={gatedSpeedLimit}
          />
          <ToggleRow
            symbol="checkmark.shield.fill"
            title="PIN to Drive"
            subtitle="Require PIN entry to drive vehicle"
            value={state.pinToDrive}
            onToggle={() => requestToggle('pinToDrive')}
            pinSet={pinSetFor('pinToDrive')}
            onClearPin={() => requestClearPin('pinToDrive')}
            disabled={gatedPinToDrive}
            gateSubtitle={gatedPinToDrive ? 'Disable Valet Mode to enable' : undefined}
          />
        </ScrollView>
      </SafeAreaView>

      <PinSheet
        visible={!!pinFor}
        title={pinFor ? FEATURE_TITLE[pinFor.key] : ''}
        mode={pinMode}
        onSubmit={onPinSubmit}
        onCancel={() => setPinFor(null)}
      />
      <SpeedLimitSheet
        visible={speedOpen}
        value={state.speedLimitKph}
        onChange={(kph) => actions.patch({ speedLimitKph: kph })}
        onClose={() => setSpeedOpen(false)}
      />
      <ParentalControlsSheet
        visible={parentalOpen}
        state={state}
        actions={actions}
        onClose={() => setParentalOpen(false)}
      />
      <EdgeSwipeBack onBack={() => router.back()} />
    </View>
  );
}

function NavRow({
  symbol,
  title,
  subtitle,
  onPress,
  disabled,
}: {
  symbol: SFSymbol;
  title: string;
  subtitle: string;
  onPress?: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable style={[styles.row, disabled && styles.rowDisabled]} onPress={onPress} disabled={disabled}>
      <View style={styles.iconCol}>
        <SymbolView name={symbol} tintColor="rgba(255,255,255,0.9)" size={26} />
      </View>
      <View style={styles.textCol}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowSub}>{subtitle}</Text>
      </View>
      <SymbolView name="chevron.right" tintColor="rgba(255,255,255,0.35)" size={16} weight="semibold" />
    </Pressable>
  );
}

function ToggleRow({
  symbol,
  title,
  subtitle,
  value,
  onToggle,
  onMore,
  pinSet,
  onClearPin,
  disabled,
  gateSubtitle,
}: {
  symbol: SFSymbol;
  title: string;
  subtitle: string;
  value: boolean;
  onToggle: () => void;
  // Present → shows the "…" affordance that opens the row's detail panel.
  onMore?: () => void;
  // "Clear PIN" replaces the subtitle only while this feature's PIN is set AND the feature is OFF — the
  // rule is identical for all four rows in the decompiled app (`pinSet === true && on !== true`), and the
  // car backs it up with "To clear the PIN, you must first turn off <feature>".
  pinSet?: boolean;
  onClearPin?: () => void;
  // Gated by another feature: the row dims and stops responding.
  disabled?: boolean;
  // Reason text shown in place of BOTH the description and "Clear PIN" while gated — the builder checks
  // this branch before either of those.
  gateSubtitle?: string;
}) {
  const showClearPin = !gateSubtitle && pinSet && !value && onClearPin;
  return (
    <View style={[styles.row, disabled && styles.rowDisabled]}>
      <View style={styles.iconCol}>
        <SymbolView name={symbol} tintColor="rgba(255,255,255,0.9)" size={26} />
      </View>
      <View style={styles.textCol}>
        <Text style={styles.rowTitle}>{title}</Text>
        {showClearPin ? (
          <Pressable hitSlop={6} onPress={onClearPin}>
            <Text style={styles.clearPin}>Clear PIN</Text>
          </Pressable>
        ) : (
          <Text style={styles.rowSub}>{gateSubtitle ?? subtitle}</Text>
        )}
      </View>
      {onMore ? (
        <Pressable hitSlop={10} style={styles.more} onPress={onMore} disabled={disabled}>
          <SymbolView name="ellipsis" tintColor="rgba(255,255,255,0.5)" size={20} weight="semibold" />
        </Pressable>
      ) : null}
      {/* pointerEvents rather than Toggle's own `disabled`: the row is already at 0.35 opacity and the
          Toggle's disabled style would multiply another 0.4 on top, leaving it nearly invisible. */}
      <View pointerEvents={disabled ? 'none' : 'auto'}>
        <Toggle value={value} onToggle={onToggle} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#161618',
  },
  safe: {
    flex: 1,
  },
  header: {
    height: 52,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  back: {
    position: 'absolute',
    left: 6,
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 21,
    fontWeight: '700',
    color: 'white',
  },
  scroll: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 60,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingVertical: 18,
  },
  rowDisabled: {
    opacity: 0.35,
  },
  iconCol: {
    width: 34,
    alignItems: 'center',
  },
  textCol: {
    flex: 1,
    gap: 3,
  },
  rowTitle: {
    fontSize: 19,
    fontWeight: '600',
    color: 'white',
  },
  rowSub: {
    fontSize: 14,
    lineHeight: 19,
    color: 'rgba(255,255,255,0.5)',
  },
  clearPin: {
    fontSize: 14,
    fontWeight: '600',
    color: '#3E6AE1',
  },
  more: {
    paddingHorizontal: 6,
  },
});
