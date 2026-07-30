import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SymbolView } from 'expo-symbols';
import { useRouter } from 'expo-router';

import { TeslaIcon, type TeslaIconName } from '@/icons/TeslaIcon';
import { EdgeSwipeBack } from '@/components/EdgeSwipeBack';
import { ParentalControlsSheet } from '@/components/ParentalControlsSheet';
import { PinSheet } from '@/components/PinSheet';
import { SpeedLimitSheet } from '@/components/SpeedLimitSheet';
import { Toggle } from '@/components/Toggle';
import { controlHaptic } from '@/state/controlHaptic';
import { useCarLinkStatus, useVehicle } from '@/state/VehicleProvider';
import type { VehicleStateKey, VehicleViewState } from '@/types/vehicleTypes';

// The four "Customize Parental Controls" sub-settings we model (the app has 7, incl. Restricted-Apps
// browser/theater/arcade — we don't surface those). Enabling Parental Controls needs at least one on.
const PARENTAL_SETTING_KEYS: VehicleStateKey[] = [
  'parentalLimitSpeed',
  'parentalReduceAccel',
  'parentalRequireSafety',
  'parentalCurfewNotify',
];

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
  // The car's whitelist has no key for us (a genuine wipe, remedy 're-enroll-with-card') — the faithful
  // analog of the app's `phone_key_required`. A mere BT bond wedge ('forget-bluetooth-device') leaves the
  // key intact, so it does NOT count as "no phone key". Reads the shared status context (no 2nd BLE link).
  const phoneKeyMissing = useCarLinkStatus().recoveryRemedy === 're-enroll-with-card';

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
    // Enabling Parental Controls with every customizable setting off is refused BEFORE the PIN prompt —
    // exactly as the app does (setErrorData, no modal, no activation). Copy verified in v4.58.0.
    if (key === 'parentalControls' && !on && !PARENTAL_SETTING_KEYS.some((k) => state[k])) {
      Alert.alert(
        'Failed to Activate Parental Controls',
        'Enable at least one customizable setting to activate Parental Controls',
        [{ text: 'OK' }],
      );
      return;
    }
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
  // rows set one at all — Valet and Sentry are never gated). Each is `noPhoneKey ? true : <feature term>`:
  //   • PIN to Drive  disabled = valetModeOn        — its subtitle is replaced by the reason.
  //   • Speed Limit   disabled = parentalOn         — Parental Controls owns speed limiting while it's on.
  //     (Speed Limit is NOT phone-key gated in the app — only Parental & PIN to Drive are.)
  //   • Parental      disabled = speedLimitOn && !parentalOn — mutually exclusive with Speed Limit, but the
  //     `&& !parentalOn` term means whichever is already ON stays switchable, so neither can trap the other.
  // Parental + PIN to Drive additionally gate on a phone key being set up (verified: only those two rows
  // carry the `phone_key_required` branch). The phone-key reason wins the subtitle over the feature reason.
  const gatedParental = phoneKeyMissing || (state.speedLimitMode && !state.parentalControls);
  const gatedSpeedLimit = state.parentalControls;
  const gatedPinToDrive = phoneKeyMissing || state.valetMode;

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
          <NavRow symbol="dashcam-filled" title="Dashcam Viewer" subtitle="View saved clips" disabled />
          <ToggleRow
            symbol="target-filled"
            title="Sentry Mode"
            subtitle="Enable to view live camera"
            value={state.sentryEnabled}
            onToggle={() => toggle('sentryEnabled')}
          />
          <ToggleRow
            symbol="valet"
            title="Valet Mode"
            subtitle="Limit vehicle access"
            value={state.valetMode}
            onToggle={() => requestToggle('valetMode')}
            pinSet={pinSetFor('valetMode')}
            onClearPin={() => requestClearPin('valetMode')}
          />
          <ToggleRow
            symbol="child-lock-filled"
            title="Parental Controls"
            subtitle="Turn on a full suite of safety features including speed limit mode, chill acceleration, and more..."
            value={state.parentalControls}
            onToggle={() => requestToggle('parentalControls')}
            onMore={() => openMore(() => setParentalOpen(true))}
            pinSet={pinSetFor('parentalControls')}
            onClearPin={() => requestClearPin('parentalControls')}
            disabled={gatedParental}
            gateSubtitle={phoneKeyMissing ? 'Please set up Phone Key' : undefined}
          />
          <ToggleRow
            symbol="speedometer-filled"
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
            symbol="security-filled"
            title="PIN to Drive"
            subtitle="Require PIN entry to drive vehicle"
            value={state.pinToDrive}
            onToggle={() => requestToggle('pinToDrive')}
            pinSet={pinSetFor('pinToDrive')}
            onClearPin={() => requestClearPin('pinToDrive')}
            disabled={gatedPinToDrive}
            gateSubtitle={
              phoneKeyMissing ? 'Please set up Phone Key' : state.valetMode ? 'Disable Valet Mode to enable' : undefined
            }
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
        mph={state.speedLimitMph}
        onChange={(mph) => actions.patch({ speedLimitMph: mph })}
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
  symbol: TeslaIconName;
  title: string;
  subtitle: string;
  onPress?: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable style={[styles.row, disabled && styles.rowDisabled]} onPress={onPress} disabled={disabled}>
      <View style={styles.iconCol}>
        <TeslaIcon name={symbol} color="rgba(255,255,255,0.9)" size={26} />
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
  symbol: TeslaIconName;
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
        <TeslaIcon name={symbol} color="rgba(255,255,255,0.9)" size={26} />
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
