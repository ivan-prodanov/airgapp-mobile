// onboarding.tsx — the first-run screen, shown as the root while the fleet is
// empty (Task 11 gates to it). It assembles the whole car-onboarding feature:
//
//   welcome ──► "Add a demo car" ──► CarConfigurator (no lock) ──► Home
//           └─► "Pair your Tesla" ──► pair wizard ──► appearance ──► Home
//
// The pair wizard is driven by the pure `pairReducer` (src/state/pairingReducer):
// vin → connecting → presentKey → verifying → paired (+ error). The reducer owns
// WITHIN-attempt ordering (a stale event outside its step is a no-op) and VIN
// normalisation; this screen owns the async side effects and, crucially, the
// CROSS-attempt staleness guard — every async callback is dropped if its effect
// has been cleaned up (Cancel, unmount, or a re-submit), so a late resolve from a
// superseded BLE attempt can never dispatch into a fresh attempt.
//
// Pi forwarder / remote access is out of scope here — this only pairs the phone's
// device key over DIRECT BLE and persists the car locally.

import { useEffect, useReducer, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';

import { CarConfigurator, type CarConfiguratorOptions } from '@/components/CarConfigurator';
import { initialPairState, pairReducer } from '@/state/pairingReducer';
import { enrollDeviceKeyOverBle, verifyPaired } from '@/ble/pairing';
import { vinToModelLine } from '@/ble/vinDecode';
import { addCar, selectCar } from '@/ble/config';
import { secureStoreSecretStore as store } from '@/ble/secureStoreSecretStore';
import { useCarLinkStatus, useFleet } from '@/state/VehicleProvider';
import { TeslaFonts } from '@/constants/fonts';
import type { CarModel } from '@/types/vehicleTypes';
import { AppIcon } from '../icons/AppIcon';

// The verify poll keeps asking the car whether our key is whitelisted until it
// says yes or this deadline passes. verifyPaired can itself take ~16–36s on a
// not-yet-paired car, so this allows at least a couple of sequential attempts.
const VERIFY_DEADLINE_MS = 60_000;
// A small gap between sequential verify attempts so a fast `false` doesn't hammer
// the BLE stack. Attempts NEVER overlap (see the await-loop below).
const VERIFY_GAP_MS = 1_500;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type Screen = 'welcome' | 'demo' | 'pair';

export default function Onboarding() {
  const router = useRouter();
  const fleet = useFleet();
  const carLink = useCarLinkStatus();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();

  const [view, setView] = useState<Screen>('welcome');
  const [pair, dispatch] = useReducer(pairReducer, initialPairState);
  const [vinInput, setVinInput] = useState('');

  // CarConfigurator's ScrollView is capped so its pinned Finish/Add button stays
  // on screen whatever the device height. Leaves room for the safe-area inset,
  // the header and the button.
  const contentMaxHeight = height - insets.top - insets.bottom - 200;

  // ── connecting: enrol this phone's device key over direct BLE ───────────────
  // enroll performs connect + send-add-key; the car does NOT confirm in-band (the
  // user taps an NFC card next), so a resolve here only means "the add-key frame
  // was written" → advance to presentKey. `cancelled` drops a resolve/reject from
  // a superseded attempt (Cancel / unmount / retry).
  useEffect(() => {
    if (pair.step !== 'connecting') return;
    let cancelled = false;
    void (async () => {
      try {
        await enrollDeviceKeyOverBle({ vin: pair.vin, store });
        if (cancelled) return;
        dispatch({ t: 'connected' });
      } catch (err) {
        if (cancelled) return;
        dispatch({ t: 'connectFailed', error: err instanceof Error ? err.message : String(err) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pair.step, pair.vin]);

  // ── presentKey → verifying ──────────────────────────────────────────────────
  // presentKey and verifying render the SAME "tap your card" guidance; this just
  // starts the verify poll as soon as we show the prompt. Synchronous, and the
  // reducer no-ops keySent outside presentKey, so no staleness guard is needed.
  useEffect(() => {
    if (pair.step === 'presentKey') dispatch({ t: 'keySent' });
  }, [pair.step]);

  // ── verifying: sequential verify poll ───────────────────────────────────────
  // An await-LOOP, never setInterval: verifyPaired can take tens of seconds, and a
  // fixed-interval timer would fire overlapping BLE handshakes. Each attempt is
  // awaited to completion before the next; `cancelled` drops the verdict (and the
  // timeout) of a superseded attempt so it can't dispatch into a fresh one.
  useEffect(() => {
    if (pair.step !== 'verifying') return;
    let cancelled = false;
    const deadline = Date.now() + VERIFY_DEADLINE_MS;
    void (async () => {
      while (!cancelled) {
        const ok = await verifyPaired({ vin: pair.vin, store }); // never throws
        if (cancelled) return;
        if (ok) {
          dispatch({ t: 'verified' });
          return;
        }
        if (Date.now() >= deadline) {
          dispatch({ t: 'verifyTimeout' });
          return;
        }
        await sleep(VERIFY_GAP_MS);
        if (cancelled) return;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pair.step, pair.vin]);

  // Cancel/back out of the pair wizard: reset the reducer AND return to welcome.
  const backToWelcome = () => {
    dispatch({ t: 'cancel' });
    setView('welcome');
  };

  // Demo car: no VIN, nothing locked, straight to Home.
  const addDemoCar = (model: CarModel, opts: CarConfiguratorOptions) => {
    Haptics.selectionAsync();
    fleet.addVehicle(model, toFleetOpts(opts));
    router.replace('/');
  };

  // Finish a real pairing. ORDER IS LOad-BEARING (controller ruling):
  //   addCar  → writes the VIN into EnrolledCars/Keychain
  //   selectCar → makes it the Keychain-selected (live) car
  //   addRealCar → binds the VIN in the in-memory fleet (its internal selectCar is
  //                a no-op unless the VIN is already enrolled — hence addCar first)
  //   reload  → carLink re-reads config so the car goes live without a restart
  //   replace → leave onboarding
  //
  // Re-entry guard: this is async and the Finish button isn't disabled, so a
  // fast double-tap would otherwise run it twice (a stray extra fleet vehicle —
  // the 2nd addRealCar moves the VIN off the 1st). On SUCCESS router.replace
  // unmounts the screen so the guard is never reset; on FAILURE it is reset so
  // the user can retry (addCar/selectCar are idempotent for the same VIN).
  // The failure is surfaced with an Alert: the reducer's connectFailed is a
  // no-op outside the `connecting` step, so it can't route a `paired`-step
  // failure to the error screen — and staying on the appearance screen keeps the
  // user's configurator choices for the retry.
  const submittingRef = useRef(false);
  const finishPairing = async (model: CarModel, opts: CarConfiguratorOptions) => {
    if (submittingRef.current) return; // ignore a double-tap within the async window
    submittingRef.current = true;
    const vin = pair.vin;
    Haptics.selectionAsync();
    try {
      await addCar(store, { vin });
      await selectCar(store, vin);
      fleet.addRealCar(vin, model, toFleetOpts(opts));
      carLink.reload();
      router.replace('/');
    } catch {
      submittingRef.current = false; // allow retry
      Alert.alert('Could not save the car', 'Please try again.');
    }
  };

  // ── Welcome ───────────────────────────────────────────────────────────────
  if (view === 'welcome') {
    return (
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <View style={styles.welcome}>
          <View style={styles.welcomeHero}>
            <Text style={styles.brand}>airgapp</Text>
            <Text style={styles.welcomeTitle}>Set up your car</Text>
            <Text style={styles.welcomeSubtitle}>
              Pair your Tesla over Bluetooth for direct control, or add a demo car to explore the app.
            </Text>
          </View>
          <View style={styles.welcomeButtons}>
            <Pressable
              style={styles.primaryButton}
              onPress={() => {
                Haptics.selectionAsync();
                setView('pair');
              }}>
              <Text style={styles.primaryButtonText}>Pair your Tesla</Text>
            </Pressable>
            <Pressable
              style={styles.secondaryButton}
              onPress={() => {
                Haptics.selectionAsync();
                setView('demo');
              }}>
              <Text style={styles.secondaryButtonText}>Add a demo car</Text>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // ── Demo car (CarConfigurator, nothing locked) ──────────────────────────────
  if (view === 'demo') {
    return (
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <View style={styles.configWrap}>
          <CarConfigurator
            contentMaxHeight={contentMaxHeight}
            submitLabel="Add car"
            onBack={() => setView('welcome')}
            onSubmit={addDemoCar}
          />
        </View>
      </SafeAreaView>
    );
  }

  // ── Pair wizard ─────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      {pair.step === 'vin' ? (
        <View style={styles.stepWrap}>
          <View style={styles.headerRow}>
            <Pressable onPress={backToWelcome} hitSlop={10} style={styles.backBtn}>
              <AppIcon icon="chevron-270" color="rgba(255,255,255,0.7)" size={20} />
            </Pressable>
            <Text style={styles.stepTitle}>Pair your Tesla</Text>
          </View>
          <Text style={styles.fieldLabel}>Vehicle Identification Number (VIN)</Text>
          <TextInput
            style={styles.vinInput}
            value={vinInput}
            onChangeText={(t) => setVinInput(t.toUpperCase())}
            placeholder="5YJ3E1EA7KF000000"
            placeholderTextColor="rgba(255,255,255,0.3)"
            autoCapitalize="characters"
            autoCorrect={false}
            autoComplete="off"
            maxLength={17}
            returnKeyType="done"
            onSubmitEditing={() => dispatch({ t: 'submitVin', vin: vinInput })}
          />
          <Text style={styles.hint}>
            Find your VIN in the Tesla app under your car's details, on the driver-side door jamb, or
            at the base of the windshield.
          </Text>
          {pair.error ? <Text style={styles.errorInline}>{pair.error}</Text> : null}
          <Pressable
            style={styles.primaryButton}
            onPress={() => {
              Haptics.selectionAsync();
              dispatch({ t: 'submitVin', vin: vinInput });
            }}>
            <Text style={styles.primaryButtonText}>Continue</Text>
          </Pressable>
        </View>
      ) : pair.step === 'connecting' ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#FFFFFF" />
          <Text style={styles.centeredTitle}>Connecting to your Tesla…</Text>
          <Text style={styles.centeredBody}>
            Stay near the car with Bluetooth on. This can take a moment.
          </Text>
          <Pressable onPress={backToWelcome} hitSlop={10} style={styles.textButton}>
            <Text style={styles.textButtonLabel}>Cancel</Text>
          </Pressable>
        </View>
      ) : pair.step === 'presentKey' || pair.step === 'verifying' ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#FFFFFF" />
          <Text style={styles.centeredTitle}>Tap your key card on the center console now</Text>
          <Text style={styles.centeredBody}>
            Hold your Tesla key card on the card reader between the front seats to approve this phone.
            Keep this screen open — we'll continue automatically.
          </Text>
          <Pressable onPress={backToWelcome} hitSlop={10} style={styles.textButton}>
            <Text style={styles.textButtonLabel}>Cancel</Text>
          </Pressable>
        </View>
      ) : pair.step === 'paired' ? (
        <View style={styles.configWrap}>
          {/* Keyed by VIN so the locked-base-derived field defaults are read for
              THIS car and can't go stale if the VIN ever changed while mounted. */}
          <CarConfigurator
            key={pair.vin}
            contentMaxHeight={contentMaxHeight}
            lockedBase={vinToModelLine(pair.vin) ?? undefined}
            submitLabel="Finish"
            title="Set up your car"
            onBack={backToWelcome}
            onSubmit={finishPairing}
          />
        </View>
      ) : (
        // error
        <View style={styles.centered}>
          <AppIcon icon="warning" color="#E5484D" size={40} />
          <Text style={styles.centeredTitle}>Pairing didn't finish</Text>
          <Text style={styles.centeredBody}>{pair.error}</Text>
          <Pressable
            style={styles.primaryButton}
            onPress={() => {
              Haptics.selectionAsync();
              dispatch({ t: 'retry' });
            }}>
            <Text style={styles.primaryButtonText}>Try again</Text>
          </Pressable>
          <Pressable onPress={backToWelcome} hitSlop={10} style={styles.textButton}>
            <Text style={styles.textButtonLabel}>Cancel</Text>
          </Pressable>
        </View>
      )}
    </SafeAreaView>
  );
}

// CarConfiguratorOptions carries a required `name` (possibly empty); the fleet
// opts want it omitted when blank so the model's default name wins.
function toFleetOpts(opts: CarConfiguratorOptions) {
  return {
    name: opts.name || undefined,
    exteriorColor: opts.exteriorColor,
    wheelType: opts.wheelType,
    interiorTrim: opts.interiorTrim,
    performance: opts.performance,
  };
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#161618',
  },
  // ── Welcome ──
  welcome: {
    flex: 1,
    paddingHorizontal: 24,
    justifyContent: 'space-between',
  },
  welcomeHero: {
    flex: 1,
    justifyContent: 'center',
  },
  brand: {
    fontFamily: TeslaFonts.medium,
    fontSize: 15,
    letterSpacing: 2,
    color: 'rgba(255,255,255,0.5)',
    textTransform: 'uppercase',
    marginBottom: 16,
  },
  welcomeTitle: {
    fontFamily: TeslaFonts.bold,
    fontSize: 34,
    color: 'white',
    marginBottom: 12,
  },
  welcomeSubtitle: {
    fontFamily: TeslaFonts.regular,
    fontSize: 16,
    lineHeight: 23,
    color: 'rgba(255,255,255,0.6)',
  },
  welcomeButtons: {
    gap: 12,
    paddingBottom: 12,
  },
  // ── Shared buttons ──
  primaryButton: {
    backgroundColor: '#3A6FE0',
    borderRadius: 10,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 20,
  },
  primaryButtonText: {
    fontFamily: TeslaFonts.bold,
    fontSize: 16,
    color: 'white',
  },
  secondaryButton: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 10,
    paddingVertical: 15,
    alignItems: 'center',
  },
  secondaryButtonText: {
    fontFamily: TeslaFonts.medium,
    fontSize: 16,
    color: 'white',
  },
  textButton: {
    marginTop: 18,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  textButtonLabel: {
    fontFamily: TeslaFonts.medium,
    fontSize: 15,
    color: 'rgba(255,255,255,0.6)',
  },
  // ── Configurator host ──
  configWrap: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 8,
  },
  // ── VIN step ──
  stepWrap: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 8,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 20,
  },
  backBtn: {
    marginLeft: -4,
  },
  stepTitle: {
    fontFamily: TeslaFonts.bold,
    fontSize: 28,
    color: 'white',
  },
  fieldLabel: {
    fontFamily: TeslaFonts.medium,
    fontSize: 13,
    color: 'rgba(255,255,255,0.5)',
    marginBottom: 8,
  },
  vinInput: {
    fontFamily: TeslaFonts.medium,
    fontSize: 17,
    letterSpacing: 1,
    color: 'white',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  hint: {
    fontFamily: TeslaFonts.regular,
    fontSize: 13,
    lineHeight: 19,
    color: 'rgba(255,255,255,0.45)',
    marginTop: 10,
  },
  errorInline: {
    fontFamily: TeslaFonts.medium,
    fontSize: 14,
    color: '#E5484D',
    marginTop: 12,
  },
  // ── Centered status steps (connecting / tap-card / error) ──
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  centeredTitle: {
    fontFamily: TeslaFonts.bold,
    fontSize: 22,
    color: 'white',
    textAlign: 'center',
    marginTop: 24,
  },
  centeredBody: {
    fontFamily: TeslaFonts.regular,
    fontSize: 15,
    lineHeight: 22,
    color: 'rgba(255,255,255,0.6)',
    textAlign: 'center',
    marginTop: 12,
  },
});
