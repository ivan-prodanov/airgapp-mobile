import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SymbolView } from 'expo-symbols';
import { useRouter } from 'expo-router';

import { AppIcon, type IconRef } from '@/icons/AppIcon';
import { BusyIcon } from '@/components/BusyIcon';
import { SENTRY } from '@/icons/nativePng';
import { TeslaFonts } from '@/constants/fonts';
import { EdgeSwipeBack } from '@/components/EdgeSwipeBack';
import { ParentalControlsSheet } from '@/components/ParentalControlsSheet';
import { PinSheet } from '@/components/PinSheet';
import { SpeedLimitSheet } from '@/components/SpeedLimitSheet';
import { Toggle } from '@/components/Toggle';
import { controlHaptic } from '@/state/controlHaptic';
import { useCarLinkStatus, useFleet, useVehicle } from '@/state/VehicleProvider';
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
  const carLink = useCarLinkStatus();
  const phoneKeyMissing = carLink.recoveryRemedy === 're-enroll-with-card';
  // A row's toggle is REPLACED by a spinner while its command is in flight, exactly
  // like the official app's Security screen (Speed Limit Mode mid-write shows the
  // spinner where the switch was). Each row's command claims its state key (see
  // reconcile.ts), so pending membership is the in-flight signal.
  const pendingFor = (key: VehicleStateKey) => carLink.pending.has(key);

  // THE CAR IS THE SOURCE OF TRUTH — same principle as Set Schedules. Until now
  // this page read nothing: sentry/valet/speed-limit/parental only ever showed
  // local optimistic state. Poll the car while the screen is open, exactly as the
  // official app does: its Security screen runs a ~1250ms BLE poll fetching
  // closures + parental controls ("on security screen, fetching closures &
  // parental controls state..."). readSecurity is a stable callback that reads at
  // 'background' priority (yields to any command) and applies through the read
  // pipeline's intent grace, so a value the user just toggled is not flipped back
  // mid-flight. On a demo/unlinked/sleeping car it resolves false and leaves what
  // we have. The in-flight guard drops a tick rather than piling reads onto the
  // per-VIN queue when a round trip runs long; the interval stops on unmount.
  const readSecurity = useFleet().readSecurity;
  useEffect(() => {
    let alive = true;
    let inFlight = false;
    const tick = async () => {
      if (!alive || inFlight) return;
      inFlight = true;
      try {
        await readSecurity();
      } finally {
        inFlight = false;
      }
    };
    void tick(); // immediate on open, then match Tesla's cadence
    const id = setInterval(() => void tick(), 1250);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [readSecurity]);

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
          <NavRow symbol="dashcam-filled" title="Dashcam Viewer" subtitle="View saved clips" />
          <ToggleRow
            symbol={state.sentryEnabled ? { png: SENTRY.on, tint: false } : { png: SENTRY.off }}
            title="Sentry Mode"
            subtitle="Enable to view live camera"
            value={state.sentryEnabled}
            onToggle={() => toggle('sentryEnabled')}
            pending={pendingFor('sentryEnabled')}
          />
          <ToggleRow
            symbol="valet"
            title="Valet Mode"
            subtitle="Limit vehicle access"
            value={state.valetMode}
            onToggle={() => requestToggle('valetMode')}
            pinSet={pinSetFor('valetMode')}
            onClearPin={() => requestClearPin('valetMode')}
            pending={pendingFor('valetMode')}
          />
          <ToggleRow
            symbol="parental-control-profile"
            title="Parental Controls"
            subtitle="Turn on a full suite of safety features including speed limit mode, chill acceleration, and more..."
            value={state.parentalControls}
            onToggle={() => requestToggle('parentalControls')}
            onMore={() => openMore(() => setParentalOpen(true))}
            pinSet={pinSetFor('parentalControls')}
            onClearPin={() => requestClearPin('parentalControls')}
            disabled={gatedParental}
            gateSubtitle={phoneKeyMissing ? 'Please set up Phone Key' : undefined}
            pending={pendingFor('parentalControls')}
          />
          <ToggleRow
            symbol="speed-limit-gauge"
            title="Speed Limit Mode"
            subtitle="Limit top speed"
            value={state.speedLimitMode}
            onToggle={() => requestToggle('speedLimitMode')}
            onMore={() => openMore(() => setSpeedOpen(true))}
            pinSet={pinSetFor('speedLimitMode')}
            onClearPin={() => requestClearPin('speedLimitMode')}
            disabled={gatedSpeedLimit}
            pending={pendingFor('speedLimitMode')}
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
            pending={pendingFor('pinToDrive')}
          />

          <Divider />
          <NavRow symbol="account" title="Add Driver" />

          <Divider />
          <ToggleRow
            symbol="phone-key-2"
            title="Phone Key"
            subtitle="Automatically unlock and start when mobile device is near"
            value={!phoneKeyMissing}
            onToggle={() => {}}
          />
          <NavRow symbol="light-bulb" title="Phone Key Best Practices" />
          <NavRow symbol="key-card" title="Add Key Card" />
          <NavRow symbol="bluetooth" title="Set Up Bluetooth Audio" />
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
  symbol: IconRef;
  title: string;
  subtitle?: string;
  onPress?: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable style={[styles.row, disabled && styles.rowDisabled]} onPress={onPress} disabled={disabled}>
      <View style={styles.iconCol}>
        {/* Tesla draws dashcam-filled compact (its artwork fills ~half the glyph box), so at the shared
            size it reads much smaller than the other rows. Render it bigger so its ~half-height artwork
            lands at the same optical size as the other icons. Row height is text-driven, so this doesn't
            shift the row. */}
        {/* Tesla's Row icon = IconSize.MEDIUM = mediumIconSize = 30 (normal dark
            theme; CYBERTRUCK uses MEDIUMSMALL=25). Dashcam's glyph reads small at
            its natural box, so it keeps its own bump. */}
        <AppIcon icon={symbol} color="#8A8B8B" size={symbol === 'dashcam-filled' ? 32 : 28} />
      </View>
      <View style={styles.textCol}>
        <Text style={styles.rowTitle}>{title}</Text>
        {subtitle ? <Text style={styles.rowSub}>{subtitle}</Text> : null}
      </View>
      <SymbolView name="chevron.right" tintColor="rgba(255,255,255,0.35)" size={16} weight="semibold" />
    </Pressable>
  );
}

// A full-width group separator, matching the Tesla page's sectioning.
function Divider() {
  return <View style={styles.divider} />;
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
  pending,
}: {
  symbol: IconRef;
  title: string;
  subtitle: string;
  value: boolean;
  onToggle: () => void;
  // While this row's command is in flight, the switch is replaced by a spinner
  // in place (Tesla's Security screen behaviour).
  pending?: boolean;
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
        {/* IconSize.MEDIUM nominal 30; trimmed to 28 to match on-device. */}
        <AppIcon icon={symbol} color="#8A8B8B" size={28} />
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
      <View style={styles.toggleSlot} pointerEvents={disabled || pending ? 'none' : 'auto'}>
        {pending ? <BusyIcon size={28} /> : <Toggle value={value} onToggle={onToggle} />}
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
    // icon → text gap = Gutter (10): Tesla's textContainerWithIcon.marginLeft.
    gap: 10,
    // Tesla's rowContainer (getStyles @3927579) has NO paddingVertical — every row
    // instead holds minHeight = 7 * Gutter = 70 (Gutter = 10, @1338450) with its
    // content vertically centred. That is why their single-line rows (Add Driver,
    // Add Key Card, Set Up Bluetooth Audio…) stay tall while ours were collapsing
    // to title + padding. Multi-line rows (Parental) grow past 70 with the content
    // flush, exactly as the real app does.
    minHeight: 70,
  },
  rowDisabled: {
    opacity: 0.35,
  },
  iconCol: {
    width: 32,
    alignItems: 'center',
  },
  textCol: {
    flex: 1,
    gap: 2,
  },
  // EXACT from the decompiled design system (not screenshot-calibrated): the
  // RowWithSwitch/Row title defaults to TextCategory.BodyLabel, the subtitle to
  // CaptionLabel. Their Text component resolves those from the Typography ladder
  // (@1643336) as UniversalSansText-Medium — the weight (500) is baked into the
  // cut, so we set the family and pass NO fontWeight (per constants/fonts.ts).
  //   bodyLabel    -> 14 / lh20 / ls0.1
  //   captionLabel -> 12 / lh16 / ls0.1
  // The old 17/600 (title) & 14 (subtitle) in the SYSTEM font were my calibrated
  // guesses — bigger, heavier, and the wrong typeface. That was the whole delta.
  rowTitle: {
    fontFamily: TeslaFonts.medium,
    fontSize: 14,
    lineHeight: 20,
    letterSpacing: 0.1,
    color: 'white',
  },
  rowSub: {
    fontFamily: TeslaFonts.medium,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.1,
    color: 'rgba(255,255,255,0.5)',
  },
  // "Clear PIN" occupies the subtitle slot (CaptionLabel) tinted blue.
  clearPin: {
    fontFamily: TeslaFonts.medium,
    fontSize: 12,
    letterSpacing: 0.1,
    color: '#3E6AE1',
  },
  more: {
    paddingHorizontal: 6,
  },
  // Footprint of the Toggle (51×31) so swapping it for the in-flight spinner
  // doesn't shift the row; the spinner sits centered where the switch was.
  toggleSlot: {
    width: 51,
    height: 31,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The real Tesla `<Divider>` (component @1431035) is height:1 / width:100% in
  // the dark-theme `dividerColor` #2D2E2F, at opacity 0.5, with marginVertical =
  // Gutter (10) (screen style @3926224). Their `width:100%` lives in a list
  // container with NO horizontal padding, so it spans edge to edge — our scroll
  // pads 20, so marginHorizontal:-20 cancels it to reach full width. (Do NOT
  // inset it — that was the "not wide enough" regression.)
  divider: {
    height: 1,
    backgroundColor: '#2D2E2F',
    opacity: 0.5,
    marginHorizontal: -20,
    marginVertical: 10,
  },
});
