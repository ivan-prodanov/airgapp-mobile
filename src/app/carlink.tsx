import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SymbolView } from 'expo-symbols';
import { useRouter } from 'expo-router';

import { EdgeSwipeBack } from '@/components/EdgeSwipeBack';
import { appendDiagnostic } from '@/services/diagnosticFile';
import { useTheme } from '@/hooks/use-theme';
import {
  createCarGateway,
  createSelectingTransport,
  PiClient,
  closeAllCachedSessions,
  loadOrCreateDeviceKeys,
  deleteDeviceKeys,
  publicKeyBase64,
  deviceKeyFingerprint,
  loadPiConfig,
  savePiConfig,
  parseEnrolUrl,
  isValidVin,
  isCarLinkEnabled,
  type CarCommand,
  type PiConfig,
  type CarTransport,
  type TransportCandidate,
} from '@/ble';
import { secureStoreSecretStore as store } from '@/ble/secureStoreSecretStore';
// RESPONSE-11 drive: openDirectSession handshakes on a transport; the standing
// DRIVE assertion is the unlock passive response with level = DRIVE(2).
import {
  openDirectSession,
  buildStandingDriveAssertion,
  buildRoutableCommandFrame,
  DOMAIN_VEHICLE_SECURITY,
  DOMAIN_INFOTAINMENT,
  type ActionPayload,
} from '@/ble/session';
import { navigateWaypointsAction, navigateGpsAction, navigateGpsWithLabelAction, navigateSearchAction, NAV_ORDER, vehicleDataSubscriptionAction, cancelVehicleDataSubscriptionAction, pingAction, piiKeyRequestFor, VDS_DEFAULTS } from '@/ble/builders';
import {
  fmtCoord,
  formatRouteDelta,
  formatRouteRead,
  parseCoord,
  type ProbeCoord,
  type RouteRead,
} from '@/ble/navBench';
import { parseCarServerResponse } from '@/ble/telemetry';
import { latencyStats, formatLatencyStats, resetLatencyStats } from '@/ble/passiveEntryLatency';
import {
  loadOrCreatePiiKeypair,
  unwrapPiiKey,
  decryptEncryptedState,
  extractWrappedPiiKey,
  parsePiiEnvelopes,
} from '@/ble/piiKey';
import { DriveState as DriveStateMsg } from '@/ble/proto';
// Aliased: the global DOM `Response` shadows the proto one in this file.
import { Response as CarServerResponse } from '@/ble/proto';
import { armVdsCapture, disarmVdsCapture, buildVdsReport, type VdsWindow } from '@/ble/vdsProbe';
// Model (b): the real BLE path is the native central (BridgedBleTransport) — the
// ONLY phone-central path. react-native-ble-plx (DirectBleTransport) was removed
// 2026-07-23, so a second phone central is impossible to construct.
import { BridgedBleTransport } from '@/ble/bridgedBleTransport';
import { startPassiveEntry, onPassiveEntryLog, passiveEntrySealGolden, passiveEntryEcdhGolden, passiveEntryHandshakeGolden, setPassiveEntryDeviceKey, passiveEntryDeviceFingerprint } from '../../modules/expo-passive-entry';
// The Pi single-session orphan-recovery helpers are shared with useCarLink so
// the 'auto'/'pi' modes here and the productized hook stay in lockstep.
import { LAST_SESSION_KEY, wrapPiClient, recoverOrphanedSession } from '@/ble/piSessionOrphan';

// carlink.tsx — HARDWARE BRING-UP HARNESS, not polished UX.
//
// Drives the already-built headless BLE stack (src/ble/) directly from a
// debug screen so we can prove config → enrol → lock/unlock → read against a
// REAL Tesla over the RPi forwarder. Every raw outcome and error is printed
// on screen VERBATIM (JSON.stringify'd CommandOutcome/VcsecStatus, err.message
// + err.kind where present) — nothing is swallowed or summarized, because
// we need to see exactly what comes back off real hardware. The polished
// production UX (secure-store-backed keys, nicer chrome) is a later phase —
// see docs/superpowers/plans/2026-07-12-ble-backend-integration.md.
//
// Gated end-to-end on EXPO_PUBLIC_CAR_LINK=1 (isCarLinkEnabled()) — the shell
// still renders so the route exists, but the controls are hidden when the
// flag is off.

type Theme = ReturnType<typeof useTheme>;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// Local hex helper (avoid importing crypto internals into the harness).
const bytesToHexLocal = (b: Uint8Array): string =>
  Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

// AUTO_BLE_SCAN_TIMEOUT_MS is the short scan budget the 'auto' transport
// mode gives DirectBleTransport (vs. the module's own 20s default) so that
// when the car isn't in BLE range, createSelectingTransport falls back to
// the Pi in ~6s instead of making every command wait out a full scan first.
const AUTO_BLE_SCAN_TIMEOUT_MS = 6000;

// errMsg formats an unknown thrown value verbatim for the log: the message,
// plus the TransportError `kind` tag when present (session-gone/timeout/
// ble/auth/http/network) — that tag is exactly what we need to diagnose a
// real-hardware failure at a glance.
function errMsg(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const kind = (err as { kind?: unknown } | null)?.kind;
  return kind !== undefined ? `${message} (kind=${String(kind)})` : message;
}

export default function CarLinkScreen() {
  const router = useRouter();
  const theme = useTheme();
  const enabled = isCarLinkEnabled();

  const [baseUrl, setBaseUrl] = useState('');
  const [token, setToken] = useState('');
  const [vin, setVin] = useState('');
  // Raw waypoints string, so format variants can be tried on-car without a rebuild.
  const [waypointsRaw, setWaypointsRaw] = useState('42.697700,23.321900;42.700000,23.330000');
  // NAV BENCH — two destinations, far enough apart that the car's snap-to-road can
  // never make them look like the same stop, plus the message/order/target the next
  // SEND will use. See the handlers further down for why this is a manual bench.
  const [navPointA, setNavPointA] = useState('42.6977,23.3219');
  const [navPointB, setNavPointB] = useState('42.7105,23.3219');
  // Point C is the GEOCODING DISCRIMINATOR: open water in the north Aegean, with no
  // road, address or POI anywhere near it. If the car pins this exact spot, it
  // parsed our string as two numbers. If it lands on a named place (an island, a
  // port) or refuses, it ran the string through its own search instead — which
  // would mean arbitrary dropped pins are not safe to send as "lat,lon".
  const [navPointC, setNavPointC] = useState('39.936693,25.306087');
  const [benchMsg, setBenchMsg] = useState<'f53' | 'f106' | 'f21'>('f53');
  const [benchOrder, setBenchOrder] = useState<'REPLACE' | 'PREPEND' | 'APPEND'>('REPLACE');
  const [benchTarget, setBenchTarget] = useState<'A' | 'B' | 'C'>('A');
  // The previous read, so each read can state how far the destination moved. A ref,
  // not state: it must survive re-renders without causing them, and it is only ever
  // read inside the handler.
  const lastBenchReadRef = useRef<RouteRead | null>(null);
  // Back-to-back commands desynchronised the Pi's BLE channel in the earlier runs
  // (a send read the previous send's reply). Track the spacing so the log can say so.
  const lastBenchActionRef = useRef(0);
  const [enrolLink, setEnrolLink] = useState('');
  const [log, setLog] = useState<string[]>([]);
  // transport: which CarTransport lock/unlock/read/wake route through.
  // 'ble' needs no baseUrl/token — DirectBleTransport scans by VIN alone.
  // 'auto' (default) tries direct BLE first and falls back to the Pi via
  // createSelectingTransport — matching the official Tesla app's
  // BLE-primary behavior.
  const [transport, setTransport] = useState<'auto' | 'pi' | 'ble'>('auto');
  // ONE BridgedBleTransport instance reused across button presses. The native
  // central keeps the connection warm across sessions; this ref just holds the
  // command-session view. Reset to null when the toggle flips back to Pi.
  const bleTransportRef = useRef<BridgedBleTransport | null>(null);
  // The 'auto' selector is STATEFUL (createSelectingTransport remembers which
  // candidate it chose in openSession and routes exchange/closeSession there).
  // It MUST be a stable instance across button presses: the module-global
  // session cache reuses a session across gateway instances and calls
  // exchange WITHOUT re-calling openSession on a cache hit, so a freshly-minted
  // selector would have no `active` transport and throw "no active transport".
  // Reset (like bleTransportRef) whenever the mode or config changes.
  const selectorRef = useRef<CarTransport | null>(null);

  const append = (line: string) => {
    const ts = new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
    setLog((prev) => [`[${ts}] ${line}`, ...prev]);
  };

  // Prefill from whatever is already persisted (Keychain-backed store — see
  // secureStoreSecretStore.ts's header comment). ALSO probe the raw storage
  // boundary on mount so a force-kill+relaunch tells us definitively whether
  // expo-secure-store persists anything across launches (diagnosing the
  // device-key-not-saved bug): reads the exact keys keystore.ts/config.ts use
  // plus a dedicated self-test marker written by the "Storage self-test" button.
  useEffect(() => {
    (async () => {
      try {
        const dk = await store.getItem('ble.deviceKey.v1');
        const pc = await store.getItem('ble.piConfig.v1');
        const st = await store.getItem('ble.selftest.v1');
        append(
          `STORAGE PROBE on mount: deviceKey=${dk ? `PRESENT(${dk.length})` : 'null'} ` +
            `piConfig=${pc ? 'PRESENT' : 'null'} selftest=${st ?? 'null'}`,
        );
      } catch (err) {
        append(`STORAGE PROBE error: ${errMsg(err)}`);
      }
      let cfg: PiConfig | null = null;
      try {
        cfg = await loadPiConfig(store);
        if (cfg) {
          setBaseUrl(cfg.baseUrl);
          setToken(cfg.token);
          setVin(cfg.vin ?? '');
          append(`loaded saved config: ${JSON.stringify(cfg)}`);
        }
      } catch (err) {
        append(`ERROR load config: ${errMsg(err)}`);
      }
      // Orphaned-session recovery: a prior force-kill can leave the Pi holding
      // its single BLE session (bleMu) for ~5 min, blocking our first command.
      // Best-effort DELETE the persisted last session id to free it now.
      if (cfg) {
        await recoverOrphanedSession({ baseUrl: cfg.baseUrl, token: cfg.token }, store, append);
      }
    })();
    // On unmount (navigate away), free the Pi session so it isn't orphaned.
    return () => {
      closeAllCachedSessions();
    };
    // Mount-only: intentionally not re-running when append's closure changes.
  }, []);

  // handleSelfTest writes a timestamp to a dedicated key through the SAME store
  // keystore.ts uses and reads it straight back (proves in-session round-trip).
  // Persistence across a force-kill is confirmed by the STORAGE PROBE line on
  // the next mount showing this timestamp (or 'null' if it didn't survive).
  // handleCloseSession frees the Pi's BLE session now (in-memory cached
  // session → DELETE via the wrapped transport, which also clears the
  // persisted last-session id). Use before a deliberate kill during testing.
  const handleCloseSession = async () => {
    closeAllCachedSessions();
    await store.removeItem(LAST_SESSION_KEY).catch(() => {});
    append('closed cached Pi session(s) + cleared last-session id');
  };

  const handleSelfTest = async () => {
    const marker = new Date().toISOString();
    try {
      await store.setItem('ble.selftest.v1', marker);
      const back = await store.getItem('ble.selftest.v1');
      append(`SELF-TEST wrote "${marker}" read back "${back ?? 'null'}" — now force-kill + relaunch and read the STORAGE PROBE line`);
    } catch (err) {
      append(`SELF-TEST error: ${errMsg(err)}`);
    }
  };

  // handleTransportChange flips the selected CarTransport. Switching away
  // from manual 'ble' drops the cached DirectBleTransport (best-effort
  // disconnect) so a later switch back to BLE starts a clean scan+connect
  // rather than reusing a possibly-stale link. 'auto' never uses
  // bleTransportRef (createSelectingTransport mints its own fresh
  // DirectBleTransport per session — see makeGateway), so it's dropped the
  // same as switching to 'pi'.
  const handleTransportChange = (next: 'auto' | 'pi' | 'ble') => {
    if (next === transport) return;
    setTransport(next);
    const label = next === 'ble' ? 'Direct BLE' : next === 'pi' ? 'Pi (Funnel)' : 'Auto (BLE→Pi)';
    append(`transport -> ${label}`);
    if (next !== 'ble' && bleTransportRef.current) {
      bleTransportRef.current.closeSession('').catch(() => {});
      bleTransportRef.current = null;
    }
    // Leaving 'auto' drops the cached selector (it holds a live BLE/Pi session);
    // it's rebuilt fresh on the next switch back to 'auto'.
    if (next !== 'auto' && selectorRef.current) {
      selectorRef.current.closeSession('').catch(() => {});
      selectorRef.current = null;
    }
  };

  // getBleTransport returns the cached instance, creating it on first use.
  const getBleTransport = (): BridgedBleTransport => {
    if (!bleTransportRef.current) {
      bleTransportRef.current = new BridgedBleTransport();
    }
    return bleTransportRef.current;
  };

  // handleBleScanTest exercises scan+connect (and the MTU negotiation) in
  // isolation from a full command, so a hardware failure narrows to "can't
  // even find/connect to the car" vs. "connected fine, protocol issue."
  // Uses its OWN throwaway transport (not the cached one) so it never
  // disturbs a connection the toggle is relying on.
  const handleBleScanTest = async () => {
    if (!isValidVin(vin)) {
      append(`ERROR BLE scan test: "${vin}" is not a valid 17-char VIN`);
      return;
    }
    const probe = new BridgedBleTransport();
    append(`BLE scan test: scanning for VIN …${vin.slice(-6)} (via native central)`);
    try {
      const sessionId = await probe.openSession(vin);
      const info = probe.getDebugInfo();
      append(
        `BLE scan test: connected ✓ device=${info.deviceName ?? '(no local name)'} blockLength=${info.blockLength} sessionId=${sessionId}`,
      );
      await probe.closeSession(sessionId);
      append('BLE scan test: disconnected');
    } catch (err) {
      append(`ERROR BLE scan test: ${errMsg(err)}`);
    }
  };

  // handleSendWaypointsRaw sends the waypoints STRING EXACTLY as typed — no
  // formatting, no validation. The car ACCEPTS our generated coordinate string
  // ("lat,lon;lat,lon") and then ignores it, so the format (or a capability gate)
  // is wrong and we cannot tell which from our side. This lets a variant be tried
  // per tap instead of per rebuild: fewer decimals, a trailing ';', the origin
  // included, "refId:" Place IDs, etc. Watch the car screen; the log records the
  // exact bytes and the car's reply.
  const handleSendWaypointsRaw = async () => {
    const raw = waypointsRaw.trim();
    if (!raw) {
      append('ERROR waypoints: string is empty');
      return;
    }
    append(`waypoints RAW → "${raw}"`);
    try {
      const keys = await loadOrCreateDeviceKeys(store);
      const t = getBleTransport();
      const session = await openDirectSession({
        transport: t,
        vin,
        deviceKeys: keys,
        domain: DOMAIN_INFOTAINMENT,
        dedicated: true,
      });
      const { bytes } = buildRoutableCommandFrame(session, navigateWaypointsAction(raw).bytes);
      await t.sendRaw(bytes);
      append('waypoints RAW: sent — watch the car screen');
    } catch (err) {
      append(`ERROR waypoints RAW: ${errMsg(err)}`);
    }
  };

  // ── NAV BENCH — one action per press ────────────────────────────────────────
  //
  // This replaced three automated probes that produced two CONTRADICTORY verdicts
  // on the same message in consecutive runs — see src/ble/navBench.ts's header for
  // the post mortem. The short version: the classifiers reported confident results
  // from sends that had already failed, and firing six commands in ninety seconds
  // desynchronised the Pi's BLE channel so later sends read earlier replies.
  //
  // So the bench does no sequencing and draws no conclusions. SEND fires exactly
  // one command and prints its raw outcome; READ ROUTE performs exactly one read
  // and prints the raw fields plus how far the destination moved since last time.
  // The operator drives the sequence, because the operator can see the centre
  // screen — which is the only instrument that can answer the question the reads
  // provably cannot (PREPEND and REPLACE produce identical readings).

  // Below this spacing the Pi's BLE channel has been observed serving the previous
  // command's reply to the next request. Not enforced — just flagged in the log.
  const BENCH_MIN_GAP_MS = 3_000;

  const benchCoord = () =>
    parseCoord(benchTarget === 'A' ? navPointA : benchTarget === 'B' ? navPointB : navPointC);

  const benchMessage = (c: ProbeCoord, order: number): ActionPayload => {
    if (benchMsg === 'f53') return navigateGpsAction({ lat: c.lat, lon: c.lon, order });
    if (benchMsg === 'f106') return navigateGpsWithLabelAction({ lat: c.lat, lon: c.lon, label: 'bench', order });
    // f21 takes a STRING. RESPONSE-19: the car splits "lat,lon" locally
    // (split(',') + toDouble) with no geocoding — which is what makes it usable
    // air-gapped at all.
    return navigateSearchAction({ query: `${c.lat.toFixed(6)},${c.lon.toFixed(6)}`, order });
  };

  // Firing two commands back-to-back is what corrupted the previous runs. This
  // does not block — the operator may have a reason — it just says so in the log
  // so a desynchronised reply is recognisable afterwards rather than mysterious.
  const benchPaceWarning = () => {
    const since = Date.now() - lastBenchActionRef.current;
    lastBenchActionRef.current = Date.now();
    if (since < BENCH_MIN_GAP_MS) {
      append(`⚠ only ${(since / 1000).toFixed(1)}s since the last bench action — the Pi channel can serve a STALE reply`);
    }
  };

  const handleBenchSend = async () => {
    const c = benchCoord();
    if (!c) {
      append(`ERROR bench: point ${benchTarget} is not "lat,lon"`);
      return;
    }
    const order = NAV_ORDER[benchOrder];
    const line = `SEND ${benchMsg} order=${benchOrder}(${order}) → ${benchTarget} ${fmtCoord(c)}`;
    benchPaceWarning();
    append(line);
    const out: string[] = [line];
    try {
      // Same reason as READ ROUTE: a cached session skips openSession, leaving the
      // 'auto' selector with no active transport after a relaunch.
      await closeAllCachedSessions();
      const gw = await makeGateway();
      const res = await gw.runRawAction(benchMessage(c, order), `bench-${benchMsg}-${benchOrder}`);
      // Loud on failure: the previous probes' worst results all came from reading
      // state after a send that had not landed.
      const verdict = res.outcome.ok
        ? '  → ACK ok (an ACK is not a route — look at the centre screen)'
        : `  → SEND FAILED: ${res.outcome.kind}: ${res.outcome.message}`;
      out.push(verdict);
      append(verdict);
    } catch (err) {
      const e = `  → SEND FAILED: ${errMsg(err)}`;
      out.push(e);
      append(e);
    } finally {
      await appendDiagnostic('nav bench send', out);
    }
  };

  // WAKE as its own press. SEND uses runRawAction, which deliberately does NOT
  // wake — so "can nav be set on a sleeping car?" is answerable by sending cold,
  // and "does it need the MCU up first?" by waking, waiting, then sending. Keeping
  // them separate is the difference between measuring the car and measuring us.
  //
  // RESPONSE-19 Q3.7 is the reason this matters: the car's requestNavigation
  // returns early — no queue, no retry, silently dropped — when the centre display
  // or nav window isn't initialised. If that holds here, a cold send ACKs and
  // vanishes, which looks identical to success from our side.
  const handleBenchWake = async () => {
    benchPaceWarning();
    try {
      await closeAllCachedSessions();
      const gw = await makeGateway();
      const t0 = Date.now();
      const out = await gw.wake();
      const line = `WAKE: ${out.ok ? 'ok' : `${out.kind}: ${out.message}`} (${Date.now() - t0}ms) — give the MCU a few seconds before sending`;
      append(line);
      await appendDiagnostic('nav bench wake', [line]);
    } catch (err) {
      append(`WAKE FAILED: ${errMsg(err)}`);
    }
  };

  // READ ROUTE deliberately never wakes the car. Two of the questions on the bench
  // — is the route readable with nobody aboard, and does it survive sleep — are
  // destroyed by a wake, so this reads whatever the car will answer as it is.
  //
  // Order matters. VCSEC answers while the car SLEEPS; DriveState is
  // DOMAIN_INFOTAINMENT and faults on a sleeping car. Reading VCSEC first means a
  // sleeping car still yields presence + sleep state, and the DriveState failure
  // is recorded as a RESULT rather than aborting the whole read. The earlier
  // version read DriveState first and threw away everything on a fault — which is
  // precisely the case the sleep test is about.
  const handleBenchRead = async () => {
    benchPaceWarning();
    const out: string[] = [];
    try {
      // In 'auto' mode the selector only acquires an active transport inside
      // openSession, but the module-global session cache serves a cached session
      // and calls exchange directly — so a selector minted after a relaunch throws
      // "no active transport (openSession first)". Dropping the cached sessions
      // forces a fresh handshake through the selector. Costs one handshake per
      // read; on a hand-driven bench that is free, and it also removes the stale
      // -session class of fault that corrupted the automated runs.
      await closeAllCachedSessions();
      const gw = await makeGateway();

      let userPresent: boolean | null = null;
      let sleepStatus = 'unknown';
      try {
        const vcsec = await gw.readVcsecStatus();
        if (vcsec.userPresence !== 'unknown') userPresent = vcsec.userPresence === 'present';
        sleepStatus = vcsec.sleepStatus;
      } catch (err) {
        append(`  (VCSEC read failed: ${errMsg(err)} — presence/sleep unknown)`);
      }

      let snap: Awaited<ReturnType<typeof gw.awakeSync>> | null = null;
      let readError: string | null = null;
      try {
        snap = await gw.awakeSync({ states: ['drive'] });
      } catch (err) {
        readError = errMsg(err);
      }

      const next: RouteRead = {
        present: !!snap?.route,
        destination: snap?.route?.destination ?? null,
        coordinates: snap?.route?.coordinates ?? null,
        minutesToArrival: snap?.route?.minutesToArrival ?? null,
        milesToArrival: snap?.route?.milesToArrival ?? null,
        shiftState: snap?.drive?.gear ?? 'unknown',
        userPresent,
        sleepStatus,
        readError,
      };
      out.push(formatRouteRead(next), formatRouteDelta(lastBenchReadRef.current, next));
      lastBenchReadRef.current = next;
      out.forEach(append);
    } catch (err) {
      const e = `READ FAILED (before any car contact): ${errMsg(err)}`;
      out.push(e);
      append(e);
    } finally {
      await appendDiagnostic('nav bench read', out);
    }
  };

  // handleAssertDrive (RESPONSE-11) fires the proactive standing-DRIVE the
  // official app sends on connect — the unlock passive response with level
  // DRIVE(2). Opens a dedicated BLE session (via the native central) so it can
  // sign with a live session, then writes the assertion. To actually drive:
  // sit INSIDE with the app foreground so the car localizes you in-cabin, tap
  // this, then press the brake. (Exterior → the car ignores it, harmless.)
  const handleAssertDrive = async () => {
    if (!isValidVin(vin)) {
      append(`ERROR assert DRIVE: "${vin}" is not a valid 17-char VIN`);
      return;
    }
    append('assert DRIVE: opening BLE session (standing DRIVE)…');
    try {
      const keys = await loadOrCreateDeviceKeys(store);
      const t = getBleTransport();
      const session = await openDirectSession({
        transport: t,
        vin,
        deviceKeys: keys,
        domain: DOMAIN_VEHICLE_SECURITY,
        dedicated: true,
      });
      const { bytes, counter } = buildStandingDriveAssertion(session);
      await t.sendRaw(bytes);
      append(`assert DRIVE ✓ standing DRIVE sent counter=${counter} (${bytes.length}B). Sit inside + press brake.`);
    } catch (err) {
      append(`ERROR assert DRIVE: ${errMsg(err)}`);
    }
  };

  // handleNativePassiveStart verifies the JS↔native round-trip of the new
  // expo-passive-entry module (Task 1 scaffold): subscribe to its native `log`
  // stream, then call start(vin). Success = the echoed scaffold line appears in
  // the harness log, proving the native module is present and callable.
  const handleNativePassiveStart = () => {
    append('native passive-entry: subscribing + start(vin)…');
    const unsub = onPassiveEntryLog((line) => append(`[native] ${line}`));
    // Keep the subscription briefly so the echo lands, then drop it.
    setTimeout(unsub, 4000);
    startPassiveEntry(vin || 'NO-VIN');
  };

  const handleNativeSealGolden = () => {
    append(`native seal golden: ${passiveEntrySealGolden()}`);
    append(`native ecdh golden: ${passiveEntryEcdhGolden()}`);
    append(`native handshake golden: ${passiveEntryHandshakeGolden()}`);
  };

  // Pass the real device key to native, then compare native's fingerprint to JS's.
  const handleNativeKeyCheck = async () => {
    try {
      const keys = await loadOrCreateDeviceKeys(store);
      const jsFp = deviceKeyFingerprint(keys);
      const stored = setPassiveEntryDeviceKey(bytesToHexLocal(keys.privateScalar));
      const nativeFp = passiveEntryDeviceFingerprint();
      append(`key check: stored=${stored} jsFp=${jsFp} nativeFp=${nativeFp} → ${jsFp === nativeFp ? 'MATCH ✅' : 'MISMATCH ❌'}`);
    } catch (err) {
      append(`ERROR key check: ${errMsg(err)}`);
    }
  };

  // handleEnrolOverBle enrolls the phone's device key directly over BLE —
  // no Pi involved. Opens (or reuses) the cached DirectBleTransport
  // connection and writes the add-key message (spec §7); the operator must
  // still tap an existing NFC key card on the console to approve, since the
  // car doesn't confirm this over BLE. Verify success afterward with
  // Lock/Read.
  const handleEnrolOverBle = async () => {
    try {
      const keys = await loadOrCreateDeviceKeys(store);
      append(`device key fingerprint: ${deviceKeyFingerprint(keys)}`);
      const cfg = await loadPiConfig(store);
      if (!cfg?.vin) throw new Error('no VIN saved — set VIN and tap "Save config" first');
      const t = getBleTransport();
      await t.openSession(cfg.vin);
      await t.sendAddKey(publicKeyBase64(keys));
      append('add-key sent over BLE — TAP YOUR NFC KEY CARD on the console now, then tap Lock/Read to verify');
    } catch (err) {
      append(`ERROR enrol over BLE: ${errMsg(err)}`);
    }
  };

  const handleEnrolLinkChange = (text: string) => {
    setEnrolLink(text);
    const parsed = parseEnrolUrl(text);
    if (parsed) {
      setBaseUrl(parsed.baseUrl);
      setToken(parsed.token);
      append(`parsed enrol link: baseUrl=${parsed.baseUrl}${parsed.nickname ? ` nickname=${parsed.nickname}` : ''}`);
    }
  };

  const handleSaveConfig = async () => {
    if (!isValidVin(vin)) {
      append(`ERROR save config: "${vin}" is not a valid 17-char VIN`);
      return;
    }
    try {
      await savePiConfig(store, { baseUrl, token, vin });
      // Config changed — the cached selector captured the old baseUrl/token/vin
      // in its candidate factories; drop it so the next command rebuilds it.
      if (selectorRef.current) {
        selectorRef.current.closeSession('').catch(() => {});
        selectorRef.current = null;
      }
      append('saved');
    } catch (err) {
      append(`ERROR save config: ${errMsg(err)}`);
    }
  };

  const handleCheckPi = async () => {
    try {
      const t = new PiClient({ baseUrl, token });
      const info = await t.pairInfo();
      append(`pairInfo: ${JSON.stringify(info)}`);
    } catch (err) {
      append(`ERROR check Pi: ${errMsg(err)}`);
    }
  };

  const handleGenerateAndEnrol = async () => {
    try {
      const keys = await loadOrCreateDeviceKeys(store);
      append(`device key fingerprint: ${deviceKeyFingerprint(keys)}`);
      const t = new PiClient({ baseUrl, token });
      await t.enrollPublicKey(publicKeyBase64(keys));
      append('enrolment requested — TAP YOUR NFC KEY CARD on the center console now');

      const deadline = Date.now() + 60_000;
      let paired = false;
      while (Date.now() < deadline && !paired) {
        await sleep(3000);
        try {
          const info = await t.pairInfo();
          paired = info.paired;
          append(`paired=${info.paired}`);
        } catch (err) {
          append(`ERROR pairInfo poll: ${errMsg(err)}`);
        }
      }
      append(paired ? 'PAIRED ✓' : 'enrolment poll timed out after 60s without paired=true');
    } catch (err) {
      append(`ERROR generate+enrol key: ${errMsg(err)}`);
    }
  };

  // makeGateway reads the persisted keys + config fresh on every call — this
  // is a bring-up harness, not a long-lived screen, so no gateway/queue is
  // cached across button presses. Which CarTransport backs the gateway
  // depends on the toggle:
  //   'ble'  — the cached DirectBleTransport (no baseUrl/token needed; BLE
  //     scans by VIN). Reused across calls so the connection stays warm.
  //   'pi'   — the wrapped PiClient (wrapPiClient), which persists every
  //     opened session id so the mount-time orphan recovery can DELETE it
  //     after a force-kill.
  //   'auto' — createSelectingTransport tries a fresh DirectBleTransport
  //     (short scan timeout — see AUTO_BLE_SCAN_TIMEOUT_MS) first, falling
  //     back to a fresh wrapped PiClient if BLE isn't configured/available.
  //     The selector mints a NEW transport per openSession, but the gateway
  //     opens one session and reuses it for the lifetime of this call's
  //     session cache, so the BLE connection still stays warm across the
  //     runCommand calls within one makeGateway()'s session.
  const makeGateway = async () => {
    const keys = await loadOrCreateDeviceKeys(store);
    const cfg = await loadPiConfig(store);
    if (!cfg) throw new Error('no config saved — tap "Save config" first');
    if (!cfg.vin) throw new Error('no VIN saved — set VIN and tap "Save config" first');

    if (transport === 'ble') {
      return createCarGateway({ transport: getBleTransport(), vin: cfg.vin, deviceKeys: keys });
    }

    if (transport === 'auto') {
      // Reuse the cached selector so its chosen-transport state survives across
      // commands that hit the session cache (see selectorRef's comment).
      if (!selectorRef.current) {
        const candidates: TransportCandidate[] = [];
        if (cfg.vin) {
          candidates.push({
            name: 'ble',
            make: () => new BridgedBleTransport({ scanTimeoutMs: AUTO_BLE_SCAN_TIMEOUT_MS }),
          });
        }
        if (cfg.baseUrl && cfg.token) {
          candidates.push({ name: 'pi', make: () => wrapPiClient({ baseUrl: cfg.baseUrl, token: cfg.token }, store) });
        }
        selectorRef.current = createSelectingTransport(candidates, (name) => append(`transport selected: ${name}`));
      }
      return createCarGateway({ transport: selectorRef.current, vin: cfg.vin, deviceKeys: keys });
    }

    return createCarGateway({
      transport: wrapPiClient({ baseUrl: cfg.baseUrl, token: cfg.token }, store),
      vin: cfg.vin,
      deviceKeys: keys,
    });
  };

  const runCarCommand = async (label: string, cmd: CarCommand) => {
    try {
      const gw = await makeGateway();
      const out = await gw.runCommand(cmd);
      append(`${label}: ${JSON.stringify(out)}`);
    } catch (err) {
      append(`ERROR ${label}: ${errMsg(err)}`);
    }
  };

  const handleReadStatus = async () => {
    try {
      const gw = await makeGateway();
      const status = await gw.readVcsecStatus();
      append(`vcsecStatus: ${JSON.stringify(status)}`);
    } catch (err) {
      append(`ERROR read VCSEC status: ${errMsg(err)}`);
    }
  };

  // PASSIVE-ENTRY PRECONDITION PROBE. Asks the car which permissions it granted
  // OUR key. Settles the one firmware-side unknown from the phone-key research
  // (§1.4): does ROLE_DRIVER expand to include LOCAL_UNLOCK(1)? If yes, our
  // existing card-enrolled key is passive-entry eligible as-is and the work is
  // purely a background-BLE-presence runtime feature. If no, walk-up unlock is
  // firmware-blocked for a driver key and the whole project needs rethinking —
  // which is exactly why this runs BEFORE any of it gets built.
  const handleProbeWhitelist = async () => {
    // Collect into a buffer so the SAME text goes to the on-screen log and to
    // the pullable diagnostics file — no risk of the two disagreeing.
    const out: string[] = [];
    const say = (line: string) => {
      out.push(line);
      append(line);
    };
    try {
      const gw = await makeGateway();
      const probe = await gw.readWhitelistEntry();

      // Print EVERY attempt. The first on-car run was inconclusive and the log
      // could not say why — whether the car refused, replied with something
      // else, or we named the key wrongly. The per-arm subMessage + raw hex is
      // what turns a second inconclusive run into a diagnosable one.
      for (const a of probe.attempts) {
        say(`probe[${a.mode}]: ${a.error ? `ERROR ${a.error}` : `reply=${a.subMessage ?? 'none'}`}`);
        if (a.rawHex) say(`  raw: ${a.rawHex}`);
      }

      if (probe.matchedMode) {
        say(`entry via ${probe.matchedMode}: keyRole=${probe.keyRole} slot=${probe.slot}`);
      }

      // CONTROL GROUP. The decisive comparison: do the car's OTHER keys (the
      // official Tesla phone key, the NFC card — which definitely have unlock
      // authority) report a permissions field where ours does not?
      say(`slotMask=${probe.slotMask ?? 'n/a'} entries=${probe.numberOfEntries ?? 'n/a'}`);
      for (const r of probe.survey) {
        if (r.error) {
          say(`slot ${r.slot}: ERROR ${r.error}`);
          continue;
        }
        const perms = r.permissions === null ? 'none' : `[${r.permissions.join(',')}]`;
        say(
          `slot ${r.slot}${r.isOurs ? ' (OURS)' : ''}: role=${r.keyRole} ` +
            `fields=[${(r.fields ?? []).join(',')}] perms=${perms}`,
        );
      }
      const anyPerms = probe.survey.some((r) => r.permissions !== null && r.permissions.length > 0);
      say(
        anyPerms
          ? 'CONTROL: at least one key DOES report permissions → absence on ours is meaningful'
          : 'CONTROL: NO key on this car reports permissions over BLE → the reply never carries them',
      );
      say(probe.summary);
      say(
        probe.localUnlock === null
          ? 'VERDICT: inconclusive — see per-arm replies above (request-side, NOT a firmware verdict)'
          : probe.localUnlock
            ? 'VERDICT: PASSIVE ENTRY ELIGIBLE — key needs no change, only a background BLE presence'
            : 'VERDICT: NOT eligible — LOCAL_UNLOCK missing; walk-up unlock would be refused',
      );
    } catch (err) {
      say(`ERROR whitelist probe: ${errMsg(err)}`);
    } finally {
      const path = await appendDiagnostic('whitelist permission probe', out);
      append(path ? 'written to diagnostics file (pull with devicectl)' : 'WARN: diagnostics file write failed');
    }
  };

  // VDS-M1 — the vehicle-data subscription experiment. See src/ble/vdsProbe.ts
  // for what it measures and why a negative result is the expected one.
  //
  // Structure of the run, and why each part is there:
  //   1. BASELINE window with nothing subscribed. The car already pushes VCSEC
  //      status unprompted, so without this a run cannot tell "the subscription
  //      worked" from "the car was chatty anyway".
  //   2. Send the 12-byte subscribe and record the car's answer verbatim. Even a
  //      rejection is informative: it tells us the field number reached a parser.
  //   3. WATCH window ~= the TTL, looking for domain-3 frames with no request_uuid.
  //   4. Cancel, always — including on the error path, so a probe that throws
  //      halfway cannot leave the car pushing at us for the rest of the TTL.
  // describePlaintext — turn a decrypted push into one readable line.
  //
  // Decodes as a CarServer.Response, which is what a subscription push should be
  // if it is the same shape as a state read. If it is NOT that shape the decode
  // yields nothing recognisable, and saying so plainly is the useful outcome —
  // the report prints the plaintext hex alongside either way, so a surprise is
  // diagnosable rather than silently rendered as "empty".
  const describePlaintext = (plain: Uint8Array): string => {
    try {
      const resp = CarServerResponse.decode(plain);
      // PING first — VDS-M3 measured that a subscription with no per-state rate
      // pushes nothing BUT pings, and the old wording called those "no
      // recognised state slices", which reads like a decode failure when it is
      // actually a fully understood frame.
      if (resp.ping) {
        const ts = resp.ping.localTimestamp;
        const secs = Number(ts?.seconds ?? 0);
        const when = secs ? new Date(secs * 1000 + Math.round(Number(ts?.nanos ?? 0) / 1e6)).toISOString() : 'none';
        const lastRemote = resp.ping.lastRemoteTimestamp
          ? new Date(Number(resp.ping.lastRemoteTimestamp.seconds ?? 0) * 1000).toISOString()
          : 'ABSENT';
        // last_remote_timestamp is the interesting half: it is the car echoing
        // the most recent timestamp IT received from US, so its presence is
        // direct evidence of whether our acks are landing.
        return `PING id=${resp.ping.pingId ?? 0} carClock=${when} lastRemote=${lastRemote}`;
      }
      const snap = parseCarServerResponse(resp);
      const slices = Object.keys(snap);
      const status = resp.actionStatus?.result;
      const parts: string[] = [];
      if (status !== undefined && status !== null) parts.push(`actionStatus=${status}`);
      parts.push(slices.length ? `slices=[${slices.join(',')}]` : 'no recognised state slices');
      if (snap.location) {
        parts.push(`location=${JSON.stringify(snap.location)}`);
      }
      if (snap.drive) parts.push(`drive=${JSON.stringify(snap.drive)}`);
      return parts.join(' ');
    } catch (err) {
      return `does NOT decode as CarServer.Response (${errMsg(err)})`;
    }
  };

  // extractPiiEnvelope — pull VehicleData field 11 out of a decrypted push.
  // Uses the generated decoder's unknown-field retention where available and
  // falls back to a direct scan, because field 11 is deliberately NOT declared
  // in our proto (we have measured its shape, not its semantics).
  const extractPiiEnvelope = (plain: Uint8Array): Uint8Array | null => {
    const readVarint = (b: Uint8Array, p: number): [number, number] => {
      let v = 0;
      let shift = 0;
      let i = p;
      while (i < b.length) {
        const byte = b[i++];
        v += (byte & 0x7f) * Math.pow(2, shift);
        if ((byte & 0x80) === 0) break;
        shift += 7;
      }
      return [v, i];
    };
    const findField = (buf: Uint8Array, want: number): Uint8Array | null => {
      let p = 0;
      while (p < buf.length) {
        const [tag, afterTag] = readVarint(buf, p);
        p = afterTag;
        const field = tag >>> 3;
        const wire = tag & 0x07;
        if (wire === 2) {
          const [len, afterLen] = readVarint(buf, p);
          p = afterLen;
          if (p + len > buf.length) return null;
          if (field === want) return buf.subarray(p, p + len);
          p += len;
        } else if (wire === 0) {
          const [, next] = readVarint(buf, p);
          p = next;
        } else if (wire === 5) p += 4;
        else if (wire === 1) p += 8;
        else return null;
      }
      return null;
    };
    // Response field 2 = vehicleData; VehicleData field 11 = the envelope.
    const vehicleData = findField(plain, 2);
    return vehicleData ? findField(vehicleData, 11) : null;
  };

  // VDS-M3 — what does the car push when we name NO state?
  //
  // Why this and not more M2 sweeping: M2's oracle turned out to be invalid. It
  // rested on "No PII request" being the car announcing the no-PII branch, so a
  // candidate that parsed would have to change it. The logs killed that: FOUR
  // subscribe requests that carried no pii_key_request at all produced TWO
  // different replies (`0a 00` once, `32 10 1a 0e "No PII request"` three
  // times). The string is not a function of our input, so it cannot adjudicate
  // our input. Everything M2 inferred FROM the reply text is withdrawn.
  //
  // What survived M2 is behavioural and reproducible across both runs: the key
  // at tag 2 kills the subscription (0 pushes, twice), the key at tag 1 with an
  // expiry at tag 2 does not (5 pushes, twice). That is consistent with
  // {1: bytes key, 2: varint expiry} — a wire-type mismatch at tag 2 would abort
  // the parse — but it is one bit of evidence, not a confirmed schema, and
  // REQUEST-19 Q1a asks for the real tags.
  //
  // So this probe deliberately guesses NOTHING. It sends only fields whose
  // numbers we have confirmed on the wire — duration (3) and ping (12) — and
  // omits the per-state rate entirely. Whatever the car chooses to push then
  // tells us its DEFAULT state set. If that includes DriveState in the clear,
  // it answers REQUEST-19 Q1d directly and hands us live speed, which is the
  // whole reason this thread started.
  const handleVdsDefaultProbe = async () => {
    const WATCH_MS = 30_000;
    const out: string[] = [];
    const say = (line: string) => {
      out.push(line);
      append(line);
    };
    const hex = (b: Uint8Array | null | undefined) =>
      b ? Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join(' ') : null;
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    let gw: Awaited<ReturnType<typeof makeGateway>> | null = null;
    try {
      gw = await makeGateway();
      say('waking car…');
      await gw.wake();
      say('subscribing with duration + ping ONLY — no per-state rate, no PII field.');
      say('  (every field number here is one we have confirmed on the wire)');
      const sub = await gw.runRawAction(
        vehicleDataSubscriptionAction({ durationS: 40, pingS: 5, locationRateMs: null }),
        'vds-default',
      );
      // Log the outcome too. M2 conflated "no decrypted payload" with "the action
      // failed", and the pushes that arrived anyway proved that wrong.
      say(`  outcome: ${sub.outcome.ok ? 'ok' : `${sub.outcome.kind}: ${sub.outcome.message}`}`);
      say(`  reply hex: ${hex(sub.result?.decryptedPayload) ?? '(none)'}`);

      armVdsCapture(Date.now());
      await wait(WATCH_MS);
      const seen = disarmVdsCapture();
      say(`${seen.length} car-initiated frames in ${WATCH_MS / 1000}s`);
      let opened = 0;
      const shapes = new Map<string, number>();
      for (const o of seen) {
        const dec = sub.result?.decryptPush?.(o.raw);
        if (!dec) continue;
        opened++;
        const desc = describePlaintext(dec.plaintext);
        shapes.set(desc, (shapes.get(desc) ?? 0) + 1);
        if (opened <= 3) say(`  +${(o.atMs / 1000).toFixed(1)}s ${desc}`);
        if (opened === 1) say(`    plain: ${hex(dec.plaintext)}`);
      }
      say(`decrypted ${opened}/${seen.length}`);
      for (const [shape, n] of shapes) say(`  ${n}x  ${shape}`);
      if (opened === 0 && seen.length === 0) {
        say('VERDICT: no pushes at all — the car appears to need an explicit per-state rate.');
        say('  → that is a clean answer: breadth is blocked on REQUEST-19 Q2 (the per-state tags).');
      } else if (opened > 0) {
        say('VERDICT: the car pushes a DEFAULT state set. See the shapes above for what is in it.');
      }
    } catch (err) {
      say(`ERROR default probe: ${errMsg(err)}`);
      disarmVdsCapture();
    } finally {
      try {
        if (gw) await gw.runRawAction(cancelVehicleDataSubscriptionAction(), 'vds-cancel');
      } catch {
        say('WARN: cancel failed (the TTL will expire it)');
      }
      const path = await appendDiagnostic('VDS-M3 default-state probe', out);
      append(path ? 'written to diagnostics file (pull with devicectl)' : 'WARN: diagnostics file write failed');
    }
  };

  // VDS-M4 — is there an ack channel, and does the subscription need it?
  //
  // VDS-M3 found the car's subscription pings: Response.ping, local_timestamp
  // set to the car's own clock, and last_remote_timestamp ABSENT. Ping's three
  // fields are a round-trip clock sync, so that third field is the car reporting
  // the newest timestamp it has had FROM US — which makes it the visible half of
  // the `handleAck:` path RESPONSE-15 found in QtCarServer.
  //
  // This probe subscribes, lets the car ping us for a while UNANSWERED, then
  // starts answering with our own Ping and watches for last_remote_timestamp to
  // appear. The unanswered phase is the control: without it, a populated field
  // could just be how pings always look.
  //
  // Guess-free — Ping (1/2/3) and VehicleAction.ping (46) are public proto.
  const handleVdsAckProbe = async () => {
    const SILENT_MS = 20_000; // control: never answer
    const ACKED_MS = 25_000; // then answer every car ping
    const out: string[] = [];
    const say = (line: string) => {
      out.push(line);
      append(line);
    };
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    let gw: Awaited<ReturnType<typeof makeGateway>> | null = null;
    try {
      gw = await makeGateway();
      say('waking car…');
      await gw.wake();
      const sub = await gw.runRawAction(
        vehicleDataSubscriptionAction({ durationS: 90, pingS: 5, locationRateMs: null }),
        'vds-ack',
      );
      say(`subscribe: ${sub.outcome.ok ? 'ok' : sub.outcome.message}`);

      const summarise = (label: string, frames: ReturnType<typeof disarmVdsCapture>) => {
        let withRemote = 0;
        let total = 0;
        for (const o of frames) {
          const dec = sub.result?.decryptPush?.(o.raw);
          if (!dec) continue;
          total++;
          const desc = describePlaintext(dec.plaintext);
          if (total <= 2) say(`  ${label} +${(o.atMs / 1000).toFixed(1)}s ${desc}`);
          if (desc.includes('PING') && !desc.includes('lastRemote=ABSENT')) withRemote++;
        }
        say(`  ${label}: ${total} decrypted pings, ${withRemote} carrying last_remote_timestamp`);
        return { total, withRemote };
      };

      say(`phase 1 — ${SILENT_MS / 1000}s, NEVER answering (control)`);
      armVdsCapture(Date.now());
      await wait(SILENT_MS);
      const silent = summarise('silent', disarmVdsCapture());

      say(`phase 2 — ${ACKED_MS / 1000}s, answering every ~5s with our own Ping`);
      armVdsCapture(Date.now());
      // Sequential and AWAITED, with every result logged.
      //
      // Run 1 fired these from a setInterval with `.catch(() => undefined)`, and
      // the transport log later showed ZERO exchanges for the whole phase — the
      // acks never reached the car, so phase 2 was just a second copy of the
      // control and the "acks are optional" verdict was worthless. Swallowing
      // the error hid the fact that the experiment had not run.
      let acksSent = 0;
      const ackErrors: string[] = [];
      const ackDeadline = Date.now() + ACKED_MS;
      while (Date.now() < ackDeadline) {
        try {
          const r = await gw.runRawAction(pingAction({ pingId: 1 }), 'vds-ack-ping');
          if (r.outcome.ok) acksSent++;
          else ackErrors.push(`${r.outcome.kind}: ${r.outcome.message}`);
        } catch (e) {
          ackErrors.push(errMsg(e));
        }
        await wait(5000);
      }
      // acksSent is the ONLY trustworthy record that this phase happened.
      //
      // ⚠ Do NOT try to corroborate it from the `txp` log category: that log
      // covers useCarLink's transport, NOT the gateway this screen builds. A
      // probe's own wake/subscribe/ack traffic never appears there. Verified the
      // hard way — an M4 verdict was withdrawn on the reasoning "zero exchanges
      // in the txp log, so the acks never left the phone", and the subscribe
      // that had demonstrably succeeded was missing from that same window. An
      // absence only means something once you have shown the log covers the
      // thing you are looking for.
      say(`  acks: ${acksSent} delivered, ${ackErrors.length} failed`);
      for (const e of [...new Set(ackErrors)].slice(0, 3)) say(`    ack error: ${e}`);
      const acked = summarise('acked', disarmVdsCapture());

      say('');
      // The verdict is now CONDITIONAL ON THE MANIPULATION HAVING HAPPENED. A
      // probe that cannot show it did the thing it was testing must not report a
      // result about it — that is the general form of the mistake that produced
      // run 1's answer.
      if (acksSent === 0) {
        say('VERDICT: VOID — not one ack reached the car, so phase 2 never differed from the control.');
        say('  → this says NOTHING about whether acks matter. See the ack errors above.');
      } else if (acked.withRemote > 0 && silent.withRemote === 0) {
        say('VERDICT: ACK CHANNEL FOUND — last_remote_timestamp appears only once we ping back.');
        say('  → VehicleAction.ping(46) is how a phone acks a BLE subscription.');
      } else if (silent.total > 0 && acked.total > 0 && acked.withRemote === 0) {
        say('VERDICT: the car pings regardless and never echoes us — acks appear OPTIONAL over BLE.');
        say('  → good news for shipping: no keepalive needed within a TTL.');
      } else {
        say('VERDICT: inconclusive — too few decrypted pings to compare the phases.');
      }
    } catch (err) {
      say(`ERROR ack probe: ${errMsg(err)}`);
      disarmVdsCapture();
    } finally {
      try {
        if (gw) await gw.runRawAction(cancelVehicleDataSubscriptionAction(), 'vds-cancel');
      } catch {
        say('WARN: cancel failed (the TTL will expire it)');
      }
      const path = await appendDiagnostic('VDS-M4 ping/ack probe', out);
      append(path ? 'written to diagnostics file (pull with devicectl)' : 'WARN: diagnostics file write failed');
    }
  };

  // VDS-M6 — the full PII recipe, end to end, on the car.
  //
  // M5 settled that DriveState is GATED on this HW4 car: field 5 arrives
  // present-and-empty (`2a 00`) beside `5a 51 08 05 …`, an encrypted_data
  // envelope with field_number = 5. So live speed needs the PII key, not just
  // location — RESPONSE-19 expected cleartext here and flagged the choice as
  // MCU2->HW4 divergent. It diverged.
  //
  // The recipe (RESPONSE-19 Q1c, and unit-tested end to end in piiKey.test.ts
  // against an independently-built envelope, so anything that fails here is the
  // WIRE, not our crypto):
  //   1. our RSA-2048 keypair (generated once, persisted)
  //   2. subscribe with pii_key_request{2: PKCS#1 PEM} + DriveState rate
  //   3. read VehicleData field 900 -> PiiKeyResponse.encrypted_pii_key (256 B)
  //   4. RSA-OAEP(SHA-1) unwrap -> K
  //   5. AES-GCM each field-11 envelope with K, AAD = be32(field_number)
  //   6. decode the plaintext as the state it claims to be
  const handleVdsPiiRun = async () => {
    const WATCH_MS = 25_000;
    const RATE_MS = 2000;
    const out: string[] = [];
    const say = (line: string) => {
      out.push(line);
      append(line);
    };
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const hex = (b: Uint8Array | null | undefined) =>
      b ? Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join(' ') : null;
    let gw: Awaited<ReturnType<typeof makeGateway>> | null = null;
    try {
      say('loading PII keypair (first run generates RSA-2048 — this blocks for seconds)…');
      const t0 = Date.now();
      const kp = await loadOrCreatePiiKeypair(store);
      say(`  keypair ready in ${Date.now() - t0}ms; public key is ${kp.publicPkcs1Pem.length} chars of PKCS#1 PEM`);

      gw = await makeGateway();
      say('waking car…');
      await gw.wake();
      say(`subscribing: DriveState ${RATE_MS}ms + pii_key_request (expiry OMITTED — cold request)`);
      const sub = await gw.runRawAction(
        vehicleDataSubscriptionAction({
          durationS: 60,
          pingS: 10,
          locationRateMs: null,
          driveRateMs: RATE_MS,
          piiKeyRequest: piiKeyRequestFor({ publicKeyPkcs1Pem: kp.publicPkcs1Pem }),
        }),
        'vds-pii-run',
      );
      say(`  outcome: ${sub.outcome.ok ? 'ok' : sub.outcome.message}`);
      say(`  reply hex: ${hex(sub.result?.decryptedPayload) ?? '(none)'}`);

      armVdsCapture(Date.now());
      await wait(WATCH_MS);
      const seen = disarmVdsCapture();

      let k: Uint8Array | null = null;
      let wrappedSeen = 0;
      let envelopes = 0;
      let opened = 0;
      for (const o of seen) {
        const dec = sub.result?.decryptPush?.(o.raw);
        if (!dec) continue;
        // Always show the first few frames whatever happens — this probe must be
        // diagnosable from its own log, not from a re-run.
        if (opened + envelopes < 2) say(`  frame: ${hex(dec.plaintext)}`);
        const wrapped = extractWrappedPiiKey(dec.plaintext);
        if (wrapped) {
          wrappedSeen++;
          if (!k) {
            say(`  encrypted_pii_key present: ${wrapped.length} bytes (expect 256 for RSA-2048)`);
            try {
              k = unwrapPiiKey(kp.privatePem, wrapped);
              say(`  *** UNWRAPPED K: ${k.length} bytes (${k.length * 8}-bit AES) ***`);
            } catch (e) {
              say(`  RSA-OAEP unwrap FAILED: ${errMsg(e)}`);
              say('  → the car wrapped to a DIFFERENT public key than we sent (stale registration?)');
            }
          }
        }
        for (const env of parsePiiEnvelopes(dec.plaintext)) {
          envelopes++;
          if (!k) continue;
          try {
            const plain = decryptEncryptedState(k, env);
            opened++;
            if (opened <= 3) {
              say(`  *** DECRYPTED state ${env.fieldNumber}: ${hex(plain)}`);
              if (env.fieldNumber === 5) {
                const ds = DriveStateMsg.decode(plain);
                const shift = ds.shiftState ? Object.keys(ds.shiftState)[0] : '?';
                say(`      drive: shift=${shift} speed=${ds.speed ?? '?'} odo=${ds.odometerInHundredthsOfAMile ?? '?'}`);
              }
            }
          } catch (e) {
            if (opened === 0) say(`  AES-GCM decrypt failed: ${errMsg(e)}`);
          }
        }
      }
      say(`${seen.length} frames — ${wrappedSeen} carried a wrapped key, ${envelopes} envelopes, ${opened} DECRYPTED`);
      if (opened > 0) {
        say('VERDICT: FULL PII PATH WORKS OVER BLE — live gated state, entirely offline.');
      } else if (k && envelopes > 0) {
        say('VERDICT: K unwrapped but no envelope opened — check nonce order / AAD width.');
      } else if (wrappedSeen > 0) {
        say('VERDICT: the car sent a wrapped key but we could not unwrap it. See above.');
      } else {
        say('VERDICT: no encrypted_pii_key in any push — the car ignored our pii_key_request.');
      }
    } catch (err) {
      say(`ERROR pii run: ${errMsg(err)}`);
      disarmVdsCapture();
    } finally {
      try {
        if (gw) await gw.runRawAction(cancelVehicleDataSubscriptionAction(), 'vds-cancel');
      } catch {
        say('WARN: cancel failed (the TTL will expire it)');
      }
      const path = await appendDiagnostic('VDS-M6 full PII run', out);
      append(path ? 'written to diagnostics file (pull with devicectl)' : 'WARN: diagnostics file write failed');
    }
  };

  // PE-4 — what does a user command COST while the focused read is running?
  //
  // The deaf window is fixed, so passive entry is no longer the question: it
  // writes directly under the write lock and never touches the command FIFO.
  // What is still unmeasured is head-of-line blocking. SessionQueue is an
  // unbounded per-VIN promise chain that never drops or coalesces, so a command
  // you tap lands BEHIND whatever read is already in flight. The focused read
  // does check inFlightRef before starting, but that is one-directional — it
  // stops us piling onto a command, not a command piling onto us.
  //
  // This is the number that decides whether the focused read goes back on, and
  // it is the same shape as PE-1: measure the thing quiet, then measure it under
  // exactly the load in question.
  //
  //   A. QUIET  — 5 commands back to back, nothing else running.
  //   B. LOADED — the same 5, with a continuous drive-state read loop beside
  //               them, i.e. precisely what FOCUSED_READ_ENABLED=true would do.
  //
  // A VCSEC status read stands in for the user command: it goes through the same
  // per-VIN FIFO as a lock, so it measures the same wait, without actuating
  // anything on a car that may be parked somewhere public.
  const handleCommandLatencyProbe = async () => {
    const N = 5;
    const LOAD_MS = 25_000;
    const out: string[] = [];
    const say = (line: string) => {
      out.push(line);
      append(line);
    };
    const median = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : 0);
    let gw: Awaited<ReturnType<typeof makeGateway>> | null = null;
    try {
      gw = await makeGateway();
      say('waking car…');
      await gw.wake();

      const timeCommands = async (label: string): Promise<number[]> => {
        const ms: number[] = [];
        for (let i = 0; i < N; i++) {
          const t0 = Date.now();
          try {
            await gw!.readVcsecStatus();
            ms.push(Date.now() - t0);
          } catch (e) {
            say(`  ${label} command ${i + 1} FAILED: ${errMsg(e)}`);
            ms.push(Date.now() - t0);
          }
        }
        return ms;
      };

      say('');
      say(`PHASE A (quiet): ${N} commands, nothing else running…`);
      const a = await timeCommands('A');
      say(`  latencies: ${a.join(', ')}ms  → median ${median(a)}ms`);

      say('');
      say(`PHASE B (focused-read load): the same ${N}, with continuous drive reads beside them…`);
      let loadReads = 0;
      let loadStop = false;
      const loadLoop = (async () => {
        const deadline = Date.now() + LOAD_MS;
        while (!loadStop && Date.now() < deadline) {
          try {
            await gw!.awakeSync({ states: ['drive'] });
            loadReads++;
          } catch {
            /* a failed read still occupied the link, which is the point */
          }
        }
      })();
      const b = await timeCommands('B');
      loadStop = true;
      await loadLoop;
      say(`  latencies: ${b.join(', ')}ms  → median ${median(b)}ms  (${loadReads} background reads ran)`);

      const ma = median(a);
      const mb = median(b);
      const worstB = Math.max(...b);
      say('');
      say(`quiet: median ${ma}ms worst ${Math.max(...a)}ms`);
      say(`loaded: median ${mb}ms WORST ${worstB}ms`);
      // ⚠ The verdict is on the WORST, not the median.
      //
      // Run 1 verdicted on the median and said SAFE with a 4171ms first command
      // sitting in the sample. That is the whole user experience — you tap, and
      // four seconds later the car responds — and the median buried it under
      // four fast ones that only came after the session was warm again.
      //
      // Latency questions are TAIL questions. A summary that averages away the
      // bad case is measuring the wrong thing, which is the same mistake as
      // gating a hex dump on the classification under test.
      if (worstB <= 500) {
        say('VERDICT: SAFE TO ENABLE — even the worst command stayed responsive.');
      } else if (worstB <= 1500) {
        say(`VERDICT: MARGINAL — worst tap ${worstB}ms. Fix the cause before enabling.`);
      } else {
        say(`VERDICT: DO NOT ENABLE — worst tap ${worstB}ms.`);
        say('  Look for a cold re-open: a failing domain-3 read evicts the VCSEC session too');
        say('  (evictSession drops EVERY domain for the VIN), so the next lock pays a full');
        say('  handshake. That is the 8-10s regression the 60s throttle was hiding.');
      }
    } catch (err) {
      say(`ERROR latency probe: ${errMsg(err)}`);
    } finally {
      const path = await appendDiagnostic('PE-4 command latency under load', out);
      append(path ? 'written to diagnostics file (pull with devicectl)' : 'WARN: diagnostics file write failed');
    }
  };

  // PE-1 — reproduce the deaf window ON DEMAND.
  //
  // "It's hard to reproduce" is true of waiting for it to happen by luck: the
  // window is only open while a command is in flight, which is ~2% of the time
  // in normal use. But we do not have to wait for luck — WE control when a
  // command is in flight. Hold the link busy continuously and the window is open
  // essentially 100% of the time, so every challenge the car sends lands in it.
  //
  // Two phases, and the pull happens in BOTH:
  //   A. QUIET  — nothing in flight. Pull the handle. Expect PASS, 0 lost.
  //   B. LOADED — back-to-back drive-state reads. Pull again. Expect FAIL.
  //
  // The quiet phase is not ceremony. Without it a failure in phase B could be
  // "the car did not challenge at all", and we would be reading a broken link as
  // a reproduced bug. Phase A proves the car challenges and we answer.
  //
  // After the fix, the SAME run must report PASS in both phases. That is the
  // only acceptable result — the pass condition is zero lost, not few.
  const handlePassiveEntryRepro = async () => {
    const QUIET_MS = 20_000;
    const LOAD_MS = 20_000;
    const out: string[] = [];
    const say = (line: string) => {
      out.push(line);
      append(line);
    };
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    let gw: Awaited<ReturnType<typeof makeGateway>> | null = null;
    try {
      gw = await makeGateway();
      say('waking car…');
      await gw.wake();

      // Lock before EACH phase. Ivan caught this: a successful phase A unlocks
      // the car, so a phase-B handle pull on an already-unlocked car produces no
      // challenge at all — the probe would report INCONCLUSIVE and look like the
      // bug had vanished. The lock is done here rather than asked of the user
      // because forgetting it silently invalidates the run.
      const lockCar = async (phase: string) => {
        try {
          const r = await gw!.runCommand({ type: 'lock' });
          say(`  locked before ${phase}: ${r.ok ? 'ok' : r.message}`);
        } catch (e) {
          say(`  WARN could not lock before ${phase}: ${errMsg(e)} — pull may not challenge`);
        }
        await wait(2000); // let VCSEC settle so the pull is seen as a walk-up
      };

      // ---- Phase A: quiet ----
      await lockCar('PHASE A');
      resetLatencyStats();
      const aStart = Date.now();
      say('');
      say('*** PHASE A (quiet) — PULL THE DOOR HANDLE NOW. 20s. ***');
      await wait(QUIET_MS);
      const a = latencyStats(aStart);
      say('PHASE A result:');
      for (const l of formatLatencyStats(a)) say(`  ${l}`);

      // ---- Phase B: link held busy ----
      // Re-lock: phase A very likely opened the car.
      await lockCar('PHASE B');
      resetLatencyStats();
      const bStart = Date.now();
      say('');
      say('*** PHASE B (link held busy) — PULL THE DOOR HANDLE AGAIN. 20s. ***');
      const deadline = Date.now() + LOAD_MS;
      let reads = 0;
      let readFails = 0;
      while (Date.now() < deadline) {
        try {
          // One state, the cheapest read there is. The point is not to be heavy,
          // it is to be CONTINUOUS: each read holds exchangeInFlight for its
          // whole round trip, and the gap between them is sub-millisecond.
          await gw.awakeSync({ states: ['drive'] });
          reads++;
        } catch {
          readFails++;
        }
      }
      const b = latencyStats(bStart);
      say(`PHASE B result (${reads} reads issued, ${readFails} failed — the link was busy throughout):`);
      for (const l of formatLatencyStats(b)) say(`  ${l}`);

      say('');
      if (a.total === 0 && b.total === 0) {
        say('INCONCLUSIVE: the car never challenged in either phase. Did the handle get pulled?');
        say('  → this says nothing about the bug; re-run and pull during the 20s windows.');
      } else if (a.lostToDeafWindow === 0 && b.lostToDeafWindow > 0) {
        say('REPRODUCED: challenges are answered when the link is idle and LOST when it is busy.');
      } else if (b.lostToDeafWindow === 0 && b.total > 0) {
        say('NOT reproduced: nothing was lost even under load. If this is AFTER the fix, that is the pass.');
      } else {
        say('MIXED: read the two phases above — losses in the quiet phase mean something else is wrong.');
      }
    } catch (err) {
      say(`ERROR repro: ${errMsg(err)}`);
    } finally {
      const path = await appendDiagnostic('PE-1 deaf-window reproduction', out);
      append(path ? 'written to diagnostics file (pull with devicectl)' : 'WARN: diagnostics file write failed');
    }
  };

  // VDS-M5 — is DriveState cleartext? (The cheapest possible live speed.)
  //
  // Replaces the M2 PII sweep, obsolete twice over: its oracle was invalid (the
  // "No PII request" string is not a function of our input) and the tags it was
  // guessing are now PROVEN — pii_key_request is subscription field 13 holding
  // {2: PKCS#1 RSA PEM *string*, 4: Timestamp}. Not EC, not raw bytes, not
  // sequential tags. That path needs an RSA-2048 keypair we do not have yet.
  //
  // But RESPONSE-19 Q1d says we may not need it for what we actually want.
  // DriveState (VehicleData field 5) holds shiftState and speedFloat, and its
  // ONLY coordinates are the active-route DESTINATION — no live position. So it
  // is expected CLEARTEXT, hence un-gated. Whether that holds is a
  // per-field_number car-side choice, and the RE flags it as exactly the kind of
  // thing that diverges MCU2 -> HW4. So: measure, do not assume.
  //
  // Subscribe with DriveState_max_update_rate_ms (tag 7) and NO pii_key_request:
  //   - VehicleData field 5 populated -> speed/gear stream for free, no RSA.
  //   - a field-11 envelope with field_number = 5 -> gated, needs the key.
  const handleVdsDriveProbe = async () => {
    const WATCH_MS = 30_000;
    const RATE_MS = 2000;
    const out: string[] = [];
    const say = (line: string) => {
      out.push(line);
      append(line);
    };
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const hex = (b: Uint8Array | null | undefined) =>
      b ? Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join(' ') : null;
    let gw: Awaited<ReturnType<typeof makeGateway>> | null = null;
    try {
      gw = await makeGateway();
      say('waking car...');
      await gw.wake();
      say(`subscribing: DriveState (tag 7) at ${RATE_MS}ms, NO pii_key_request`);
      const sub = await gw.runRawAction(
        vehicleDataSubscriptionAction({ durationS: 60, pingS: 10, locationRateMs: null, driveRateMs: RATE_MS }),
        'vds-drive',
      );
      say(`  outcome: ${sub.outcome.ok ? 'ok' : sub.outcome.message}`);
      say(`  reply hex: ${hex(sub.result?.decryptedPayload) ?? '(none)'}`);

      armVdsCapture(Date.now());
      await wait(WATCH_MS);
      const seen = disarmVdsCapture();
      let clear = 0;
      let gated = 0;
      let opened = 0;
      for (const o of seen) {
        const dec = sub.result?.decryptPush?.(o.raw);
        if (!dec) continue;
        opened++;
        const desc = describePlaintext(dec.plaintext);
        // ALWAYS dump the plaintext for the first few, whatever the verdict.
        // Run 1 printed it only for frames that failed the cleartext test, and
        // since every frame passed, the run produced no bytes at all to check
        // its own conclusion against. Fifth time I have gated the evidence on
        // the classification under test; the rule is simply never do it.
        if (opened <= 3) {
          say(`  +${(o.atMs / 1000).toFixed(1)}s ${desc}`);
          say(`    plain: ${hex(dec.plaintext)}`);
        }
        // GATED: a field-11 envelope whose field_number is 5 (drive_state).
        const env = extractPiiEnvelope(dec.plaintext);
        if (env && env.length > 1 && env[0] === 0x08 && env[1] === 5) gated++;
        // CLEARTEXT means the slice carries actual VALUES. Run 1 tested only
        // that the slice was PRESENT, so a present-and-empty field 5 — the very
        // shape a gated state produces — counted as cleartext, and the probe
        // reported "cleartext" and "gated" on all 15 frames simultaneously.
        if (/"speed":\s*-?[\d.]/.test(desc) || /"gear":\s*"(?!unknown)/.test(desc)) clear++;
      }
      say(`${seen.length} frames, ${opened} decrypted, ${clear} with POPULATED drive, ${gated} gated envelopes`);
      if (clear > 0 && gated === 0) {
        say('VERDICT: DRIVESTATE IS CLEARTEXT - speed and gear stream with NO PII key.');
        say('  -> live speed is reachable today; RSA is only needed for LOCATION.');
      } else if (gated > 0 && clear === 0) {
        say('VERDICT: DriveState is GATED - field 5 arrives EMPTY, content is in a');
        say('  field-11 envelope with field_number=5. Live speed needs the PII key too.');
        say('  (RESPONSE-19 expected cleartext but flagged this as MCU2->HW4 divergent.)');
      } else if (clear > 0 && gated > 0) {
        say('VERDICT: BOTH populated cleartext AND a drive envelope - unexpected; read the hex.');
      } else {
        say('VERDICT: inconclusive - no drive content either way. See the plaintext above.');
      }
    } catch (err) {
      say(`ERROR drive probe: ${errMsg(err)}`);
      disarmVdsCapture();
    } finally {
      try {
        if (gw) await gw.runRawAction(cancelVehicleDataSubscriptionAction(), 'vds-cancel');
      } catch {
        say('WARN: cancel failed (the TTL will expire it)');
      }
      const path = await appendDiagnostic('VDS-M5 DriveState cleartext probe', out);
      append(path ? 'written to diagnostics file (pull with devicectl)' : 'WARN: diagnostics file write failed');
    }
  };

  const handleVdsProbe = async () => {
    // VDS-M1 — the vehicle-data subscription experiment. See src/ble/vdsProbe.ts.
    //
    // RUN 2 is a RATE SWEEP, because run 1 could not interpret itself. It saw
    // nine 243B frames at a clean 5.0s cadence, exactly the 5000ms it had asked
    // for, and reported NO PUSHES — because the push predicate read the wrong
    // oneof arm for `domain` and additionally excluded frames carrying a
    // request_uuid, which RESPONSE-15 says is the subscription's own correlation
    // tag. Both bugs are fixed, but a fixed classifier still only counts frames.
    //
    // Counting cannot distinguish "the car answered us" from "the car was
    // chatty". Varying the parameter can: subscribe at two DIFFERENT rates in one
    // run and see whether the observed cadence follows. Nothing else on this link
    // — not our 20s poll, not VCSEC pushes, not the passive-entry challenge —
    // has any reason to track a number we picked. That is the measurement.
    const BASELINE_MS = 15_000;
    const WINDOW_MS = 30_000;
    const RATES = [5000, 2000];
    const out: string[] = [];
    const say = (line: string) => {
      out.push(line);
      append(line);
    };
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const hex = (b: Uint8Array | null | undefined) =>
      b ? Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join(' ') : null;
    let gw: Awaited<ReturnType<typeof makeGateway>> | null = null;
    const windows: VdsWindow[] = [];
    const armedAt = Date.now();
    try {
      gw = await makeGateway();
      say('waking car (domain 3 needs the MCU up)…');
      await gw.wake();

      say(`baseline: listening ${BASELINE_MS / 1000}s with NOTHING subscribed…`);
      armVdsCapture(Date.now());
      await wait(BASELINE_MS);

      for (const rate of RATES) {
        const startMs = Date.now() - armedAt;
        say(`subscribing: LocationState rate=${rate}ms duration=${VDS_DEFAULTS.durationS}s…`);
        const sub = await gw.runRawAction(
          vehicleDataSubscriptionAction({ locationRateMs: rate }),
          `vds-subscribe-${rate}`,
        );
        const outcome = sub.outcome.ok ? 'ok' : `${sub.outcome.kind}: ${sub.outcome.message}`;
        say(`  outcome: ${outcome} (ACK ≠ understood — the cadence is the evidence)`);
        say(`watching ${WINDOW_MS / 1000}s…`);
        await wait(WINDOW_MS);
        windows.push({
          label: `${rate}ms`,
          startMs,
          endMs: Date.now() - armedAt,
          requestedRateMs: rate,
          subscribeOutcome: outcome,
          subscribeResponseHex: hex(sub.result?.decryptedPayload),
          // Bound to THIS window's subscribe: the AAD candidates include that
          // request's own tag, so window 2's pushes must be opened with
          // window 2's decryptor.
          decryptPush: sub.result?.decryptPush,
          describePlaintext,
        });
        // Cancel BETWEEN windows, so the second window measures the second rate
        // rather than two overlapping subscriptions.
        try {
          await gw.runRawAction(cancelVehicleDataSubscriptionAction(), 'vds-cancel');
        } catch {
          say('  WARN: inter-window cancel failed; next window may overlap the previous subscription');
        }
      }

      const report = buildVdsReport({ observations: disarmVdsCapture(), baselineEndMs: BASELINE_MS, windows });
      for (const line of report.lines) say(line);
    } catch (err) {
      say(`ERROR vds probe: ${errMsg(err)}`);
      disarmVdsCapture();
    } finally {
      try {
        if (gw) {
          const c = await gw.runRawAction(cancelVehicleDataSubscriptionAction(), 'vds-cancel');
          say(`final cancel: ${c.outcome.ok ? 'ok' : c.outcome.message}`);
        }
      } catch (err) {
        say(`WARN cancel failed (TTL will expire it in ≤${VDS_DEFAULTS.durationS}s): ${errMsg(err)}`);
      }
      const path = await appendDiagnostic('VDS-M1 subscription probe', out);
      append(path ? 'written to diagnostics file (pull with devicectl)' : 'WARN: diagnostics file write failed');
    }
  };

  const handleWake = async () => {
    try {
      const gw = await makeGateway();
      const out = await gw.wake();
      append(`wake: ${JSON.stringify(out)}`);
    } catch (err) {
      append(`ERROR wake: ${errMsg(err)}`);
    }
  };

  const handleForgetKey = async () => {
    try {
      await deleteDeviceKeys(store);
      // A key change invalidates EVERY cached session — they carry the OLD
      // key's ECDH-derived session key + counter. Reusing one after the old
      // key is gone from the car throws UNKNOWN_KEY_ID (fault 3). Close all
      // sessions (Pi in-memory + persisted orphan id + the warm BLE link) so
      // the next command does a FRESH handshake with the newly-enrolled key.
      closeAllCachedSessions();
      await store.removeItem(LAST_SESSION_KEY).catch(() => {});
      const ble = bleTransportRef.current;
      bleTransportRef.current = null;
      if (ble) await ble.closeSession('').catch(() => {});
      const sel = selectorRef.current;
      selectorRef.current = null;
      if (sel) await sel.closeSession('').catch(() => {});
      append('device key deleted + all sessions closed (Pi + BLE + auto) — re-enrol, then commands use the new key');
    } catch (err) {
      append(`ERROR forget device key: ${errMsg(err)}`);
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <SafeAreaView edges={['top']} style={styles.safe}>
        <View style={styles.header}>
          <Pressable style={styles.back} hitSlop={10} onPress={() => router.back()}>
            <SymbolView name="chevron.left" tintColor={theme.text} size={22} weight="medium" />
          </Pressable>
          <Text style={[styles.title, { color: theme.text }]}>Car Link (BLE bring-up)</Text>
        </View>

        {!enabled ? (
          <View style={styles.disabledNote}>
            <Text style={[styles.disabledText, { color: theme.textSecondary }]}>
              Set EXPO_PUBLIC_CAR_LINK=1 in .env.local and redeploy.
            </Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
            <Field
              label="Pi base URL"
              value={baseUrl}
              onChangeText={setBaseUrl}
              placeholder="https://<host>.ts.net"
              theme={theme}
            />
            <Field
              label="Bearer token"
              value={token}
              onChangeText={setToken}
              placeholder="token"
              secureTextEntry
              theme={theme}
            />
            <Field
              label="VIN"
              value={vin}
              onChangeText={setVin}
              placeholder="17-char VIN"
              autoCapitalize="characters"
              theme={theme}
            />
            <Field
              label="Paste enrol link (optional)"
              value={enrolLink}
              onChangeText={handleEnrolLinkChange}
              placeholder="airgap://enrol?api=...&token=..."
              theme={theme}
            />

            <View style={styles.field}>
              <Text style={[styles.fieldLabel, { color: theme.textSecondary }]}>Transport</Text>
              <View style={styles.transportRow}>
                <TransportPill
                  label="Auto (BLE→Pi)"
                  active={transport === 'auto'}
                  onPress={() => handleTransportChange('auto')}
                  theme={theme}
                />
                <TransportPill
                  label="Pi (Funnel)"
                  active={transport === 'pi'}
                  onPress={() => handleTransportChange('pi')}
                  theme={theme}
                />
                <TransportPill
                  label="Direct BLE"
                  active={transport === 'ble'}
                  onPress={() => handleTransportChange('ble')}
                  theme={theme}
                />
              </View>
            </View>

            <View style={styles.buttonGrid}>
              <ActionButton label="Save config" onPress={handleSaveConfig} theme={theme} />
              <ActionButton label="Check Pi" onPress={handleCheckPi} theme={theme} />
              <ActionButton label="Generate + enrol key" onPress={handleGenerateAndEnrol} theme={theme} />
              <ActionButton label="BLE scan test" onPress={handleBleScanTest} theme={theme} />
              <ActionButton label="Assert DRIVE (seated)" onPress={handleAssertDrive} theme={theme} />
              <Field
                label="Waypoints string (raw, sent verbatim)"
                value={waypointsRaw}
                onChangeText={setWaypointsRaw}
                placeholder="lat,lon;lat,lon"
                autoCapitalize="none"
                theme={theme}
              />
              <ActionButton label="Send waypoints (raw)" onPress={handleSendWaypointsRaw} theme={theme} />
              <ActionButton label="Native passive: start" onPress={handleNativePassiveStart} theme={theme} />
              <ActionButton label="Native seal golden" onPress={handleNativeSealGolden} theme={theme} />
              <ActionButton label="Native key check" onPress={handleNativeKeyCheck} theme={theme} />
              <ActionButton label="Enrol over BLE" onPress={handleEnrolOverBle} theme={theme} />
              <ActionButton label="Lock" onPress={() => runCarCommand('lock', { type: 'lock' })} theme={theme} />
              <ActionButton label="Unlock" onPress={() => runCarCommand('unlock', { type: 'unlock' })} theme={theme} />
              <ActionButton label="Read VCSEC status" onPress={handleReadStatus} theme={theme} />
              <ActionButton label="Probe key permissions" onPress={handleProbeWhitelist} theme={theme} />
              <ActionButton label="VDS-M1 subscription probe" onPress={handleVdsProbe} theme={theme} />
              <ActionButton label="PE-1 deaf-window repro" onPress={handlePassiveEntryRepro} theme={theme} />
              <ActionButton label="PE-4 command latency" onPress={handleCommandLatencyProbe} theme={theme} />
              <ActionButton label="VDS-M5 DriveState cleartext" onPress={handleVdsDriveProbe} theme={theme} />
              <ActionButton label="VDS-M6 full PII run" onPress={handleVdsPiiRun} theme={theme} />
              <ActionButton label="VDS-M3 default-state probe" onPress={handleVdsDefaultProbe} theme={theme} />
              <ActionButton label="VDS-M4 ping/ack probe" onPress={handleVdsAckProbe} theme={theme} />
              <ActionButton label="Wake" onPress={handleWake} theme={theme} />
              <ActionButton label="Close session" onPress={handleCloseSession} theme={theme} />
              <ActionButton label="Forget device key" onPress={handleForgetKey} theme={theme} />
              <ActionButton label="Storage self-test" onPress={handleSelfTest} theme={theme} />
            </View>

            {/* NAV BENCH — its own section, directly above the log so the controls and
                their output are on screen together. Numbered because the order of
                operations is the experiment: configure, send ONE command, read once. */}
            <View style={[styles.benchSection, { borderColor: theme.backgroundSelected }]}>
              <Text style={[styles.benchTitle, { color: theme.text }]}>NAV BENCH — one action per press</Text>
              <Text style={[styles.benchNote, { color: theme.textSecondary }]}>
                No sequencing, no verdicts. Watch the centre screen — it answers what the reads cannot.
              </Text>

              <Field
                label="1 · Point A (lat,lon)"
                value={navPointA}
                onChangeText={setNavPointA}
                placeholder="42.6977,23.3219"
                autoCapitalize="none"
                theme={theme}
              />
              <Field
                label="1 · Point B (lat,lon)"
                value={navPointB}
                onChangeText={setNavPointB}
                placeholder="42.7105,23.3219"
                autoCapitalize="none"
                theme={theme}
              />
              <Field
                label="1 · Point C — open sea, no road/address/POI (geocoding test)"
                value={navPointC}
                onChangeText={setNavPointC}
                placeholder="39.936693,25.306087"
                autoCapitalize="none"
                theme={theme}
              />

              <View style={styles.field}>
                <Text style={[styles.fieldLabel, { color: theme.textSecondary }]}>2 · Message</Text>
                <View style={styles.transportRow}>
                  <TransportPill label="f53 gps" active={benchMsg === 'f53'} onPress={() => setBenchMsg('f53')} theme={theme} />
                  <TransportPill label="f106 gps+label" active={benchMsg === 'f106'} onPress={() => setBenchMsg('f106')} theme={theme} />
                  <TransportPill label="f21 string" active={benchMsg === 'f21'} onPress={() => setBenchMsg('f21')} theme={theme} />
                </View>
              </View>

              <View style={styles.field}>
                <Text style={[styles.fieldLabel, { color: theme.textSecondary }]}>3 · Order</Text>
                <View style={styles.transportRow}>
                  <TransportPill label="REPLACE 0" active={benchOrder === 'REPLACE'} onPress={() => setBenchOrder('REPLACE')} theme={theme} />
                  <TransportPill label="PREPEND 1" active={benchOrder === 'PREPEND'} onPress={() => setBenchOrder('PREPEND')} theme={theme} />
                  <TransportPill label="APPEND 2" active={benchOrder === 'APPEND'} onPress={() => setBenchOrder('APPEND')} theme={theme} />
                </View>
              </View>

              <View style={styles.field}>
                <Text style={[styles.fieldLabel, { color: theme.textSecondary }]}>4 · Target</Text>
                <View style={styles.transportRow}>
                  <TransportPill label="Point A" active={benchTarget === 'A'} onPress={() => setBenchTarget('A')} theme={theme} />
                  <TransportPill label="Point B" active={benchTarget === 'B'} onPress={() => setBenchTarget('B')} theme={theme} />
                  <TransportPill label="Point C sea" active={benchTarget === 'C'} onPress={() => setBenchTarget('C')} theme={theme} />
                </View>
              </View>

              <View style={styles.buttonGrid}>
                <ActionButton label="5 · SEND ONE COMMAND" onPress={handleBenchSend} theme={theme} />
                <ActionButton label="6 · READ ROUTE" onPress={handleBenchRead} theme={theme} />
                <ActionButton label="7 · WAKE (does not send)" onPress={handleBenchWake} theme={theme} />
              </View>
            </View>

            <View style={styles.logHeader}>
              <Text style={[styles.logTitle, { color: theme.text }]}>Log</Text>
              <Pressable hitSlop={8} onPress={() => setLog([])}>
                <Text style={[styles.clearLabel, { color: theme.textSecondary }]}>Clear</Text>
              </Pressable>
            </View>
            <View style={[styles.logBox, { backgroundColor: theme.backgroundElement }]}>
              {log.length === 0 ? (
                <Text style={[styles.logLine, { color: theme.textSecondary }]}>(no output yet)</Text>
              ) : (
                log.map((line, i) => (
                  <Text key={i} style={[styles.logLine, { color: theme.text }]} selectable>
                    {line}
                  </Text>
                ))
              )}
            </View>
          </ScrollView>
        )}
      </SafeAreaView>
      <EdgeSwipeBack onBack={() => router.back()} />
    </View>
  );
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  secureTextEntry,
  autoCapitalize,
  theme,
}: {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  secureTextEntry?: boolean;
  autoCapitalize?: 'none' | 'characters' | 'words' | 'sentences';
  theme: Theme;
}) {
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: theme.textSecondary }]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.textSecondary}
        secureTextEntry={secureTextEntry}
        autoCapitalize={autoCapitalize ?? 'none'}
        autoCorrect={false}
        style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
      />
    </View>
  );
}

function TransportPill({
  label,
  active,
  onPress,
  theme,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  theme: Theme;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.transportPill,
        { backgroundColor: active ? theme.backgroundSelected : theme.backgroundElement, opacity: pressed ? 0.7 : 1 },
      ]}>
      <Text style={[styles.transportPillLabel, { color: theme.text, fontWeight: active ? '700' : '500' }]}>
        {label}
      </Text>
    </Pressable>
  );
}

function ActionButton({ label, onPress, theme }: { label: string; onPress: () => void; theme: Theme }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionButton,
        { backgroundColor: theme.backgroundElement, opacity: pressed ? 0.7 : 1 },
      ]}>
      <Text style={[styles.actionButtonLabel, { color: theme.text }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
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
    fontSize: 19,
    fontWeight: '700',
  },
  disabledNote: {
    padding: 24,
  },
  disabledText: {
    fontSize: 15,
    lineHeight: 21,
  },
  scroll: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 60,
    gap: 14,
  },
  field: {
    gap: 6,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  input: {
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  transportRow: {
    flexDirection: 'row',
    gap: 10,
  },
  transportPill: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  transportPillLabel: {
    fontSize: 14,
  },
  buttonGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 8,
  },
  benchSection: {
    marginTop: 22,
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    gap: 4,
  },
  benchTitle: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 2,
  },
  benchNote: {
    fontSize: 12,
    lineHeight: 16,
    marginBottom: 10,
  },
  actionButton: {
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  actionButtonLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  logHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 18,
  },
  logTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  clearLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  logBox: {
    borderRadius: 10,
    padding: 12,
    marginTop: 8,
    gap: 6,
  },
  logLine: {
    fontFamily: 'ui-monospace',
    fontSize: 12,
    lineHeight: 16,
  },
});
