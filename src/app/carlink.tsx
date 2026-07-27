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
  evictSession,
  openDirectSession,
  buildStandingDriveAssertion,
  buildRoutableCommandFrame,
  DOMAIN_VEHICLE_SECURITY,
  DOMAIN_INFOTAINMENT,
  type ActionPayload,
} from '@/ble/session';
import {
  navigateWaypointsAction,
  navigateGpsAction,
  navigateGpsWithLabelAction,
  navigateSearchAction,
  NAV_ORDER,
} from '@/ble/builders';
import { parseCarServerResponse } from '@/ble/telemetry';
// Aliased: the global DOM `Response` shadows the proto one in this file.
import { Response as CarServerResponse } from '@/ble/proto';
import {
  fmtCoord,
  formatRouteDelta,
  formatRouteRead,
  parseCoord,
  type ProbeCoord,
  type RouteRead,
} from '@/ble/navBench';
import { latencyStats, formatLatencyStats, resetLatencyStats } from '@/ble/passiveEntryLatency';
import { withBackgroundReadsSuspended } from '@/ble/backgroundReads';
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
  // D and E re-run the same discriminator after C came back "no results found" —
  // a phrase that belongs to a SEARCH, not to a numeric parse.
  const [navPointD, setNavPointD] = useState('39.936959,25.305732');
  const [navPointE, setNavPointE] = useState('39.926736,25.332941');
  const [benchMsg, setBenchMsg] = useState<'f53' | 'f106' | 'f21'>('f53');
  const [benchOrder, setBenchOrder] = useState<'REPLACE' | 'PREPEND' | 'APPEND'>('REPLACE');
  const [benchTarget, setBenchTarget] = useState<'A' | 'B' | 'C' | 'D' | 'E'>('A');
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

  const benchPoints = (): Record<'A' | 'B' | 'C' | 'D' | 'E', string> => ({
    A: navPointA,
    B: navPointB,
    C: navPointC,
    D: navPointD,
    E: navPointE,
  });
  const benchCoord = () => parseCoord(benchPoints()[benchTarget]);

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
      //
      // That drop also makes every bench SEND a COLD one — handshake included —
      // which is exactly the thing being timed here. The number decides whether a
      // Share Extension can do this send inside its own lifetime: an appex has no
      // background modes and no state restoration, so it pays this cost on every
      // single share, against a hard kill deadline. The Pi client budgets
      // OPEN_SESSION_TIMEOUT_MS = 45_000 because a cold Pi-side BLE scan "can
      // legitimately take 8-15s" — if that is what we measure, an in-sheet send is
      // a spinner nobody will wait for, and the answer is a warm link on the Pi
      // rather than a rescan per share.
      await closeAllCachedSessions();
      const t0 = Date.now();
      const gw = await makeGateway();
      const res = await gw.runRawAction(benchMessage(c, order), `bench-${benchMsg}-${benchOrder}`);
      const elapsed = Date.now() - t0;
      const timing = `  → COLD total ${(elapsed / 1000).toFixed(1)}s (handshake + command, from zero cached sessions)`;
      out.push(timing);
      append(timing);
      // Loud on failure: the previous probes' worst results all came from reading
      // state after a send that had not landed.
      const verdict = res.outcome.ok
        ? '  → transport ACK ok (says the car received it, NOT that it navigated)'
        : `  → SEND FAILED: ${res.outcome.kind}: ${res.outcome.message}`;
      out.push(verdict);
      append(verdict);

      // The car's OWN verdict, which nothing in this codebase has ever read.
      // Response.actionStatus carries {result: OK|ERROR, result_reason.plain_text}
      // — and a rejection like "no results found" would arrive here, in the reply
      // we have been discarding. This is what makes point D (failed) and point E
      // (worked) distinguishable in the log instead of both reading "ACK ok".
      const payload = res.result?.decryptedPayload;
      if (!payload) {
        const none = '  → car sent no payload to inspect';
        out.push(none);
        append(none);
      } else {
        try {
          const resp = CarServerResponse.decode(payload) as {
            actionStatus?: { result?: number; resultReason?: { plainText?: string } };
          };
          const st = resp.actionStatus;
          const result = st?.result === 1 ? 'ERROR' : st?.result === 0 ? 'OK' : `(absent:${st?.result})`;
          const reason = st?.resultReason?.plainText;
          const carLine = `  → CAR SAYS: ${result}${reason ? ` — "${reason}"` : ' (no reason text)'}`;
          out.push(carLine);
          append(carLine);
        } catch (e) {
          // Never let a decode problem hide the bytes — print them raw instead.
          const hexLine = `  → reply undecodable (${errMsg(e)}); raw: ${Array.from(payload).map((b) => b.toString(16).padStart(2, '0')).join(' ')}`;
          out.push(hexLine);
          append(hexLine);
        }
      }
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
      const readT0 = Date.now();
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
      out.push(
        formatRouteRead(next),
        formatRouteDelta(lastBenchReadRef.current, next),
        `COLD total ${((Date.now() - readT0) / 1000).toFixed(1)}s (VCSEC + DriveState, from zero cached sessions)`,
      );
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

  // PE-5 — does a domain-3 failure still destroy the domain-2 session?
  //
  // PE-4 can only catch this by LUCK: it passes if no background read happened
  // to time out, which looks identical to "fixed". So this probe forces the
  // condition instead of waiting for it.
  //
  //   1. warm BOTH sessions (a VCSEC read and a drive read)
  //   2. time a VCSEC read           → the warm baseline, ~90ms
  //   3. evict domain 3, scoped      → exactly what a timed-out read now does
  //   4. time a VCSEC read again     → the whole question
  //
  // Still ~90ms means the VCSEC session survived and the lock path is untouched.
  // Seconds means it was torn down with the read and the next tap pays a cold
  // handshake — the 4171ms PE-4 caught.
  const handleEvictionScopeProbe = async () => {
    const out: string[] = [];
    const say = (line: string) => {
      out.push(line);
      append(line);
    };
    try {
      const cfg = await loadPiConfig(store);
      if (!cfg?.vin) throw new Error('no VIN saved');
      const gw = await makeGateway();
      say('waking car…');
      await gw.wake();

      const timeVcsec = async (): Promise<number> => {
        const t0 = Date.now();
        await gw.readVcsecStatus();
        return Date.now() - t0;
      };

      say('warming both domains…');
      await timeVcsec();
      await gw.awakeSync({ states: ['drive'] });

      const warm = await timeVcsec();
      say(`  VCSEC warm baseline: ${warm}ms`);

      say('evicting DOMAIN 3 with scope=domain (what a timed-out read now does)…');
      await evictSession(cfg.vin, DOMAIN_INFOTAINMENT, { scope: 'domain' });

      const after = await timeVcsec();
      say(`  VCSEC after the domain-3 eviction: ${after}ms`);

      say('');
      // Threshold on the ABSOLUTE number, not a ratio: a cold handshake is a
      // second or more and a warm read is ~100ms, so there is no ambiguous middle
      // — and a ratio would let a slow baseline hide a cold re-open.
      if (after <= 500) {
        say(`PASS: the VCSEC session SURVIVED a domain-3 eviction (${warm}ms → ${after}ms).`);
        say('  A background read can no longer make the next unlock pay a handshake.');
      } else {
        say(`FAIL: VCSEC went cold (${warm}ms → ${after}ms) — the eviction is still unscoped.`);
      }
    } catch (err) {
      say(`ERROR eviction-scope probe: ${errMsg(err)}`);
    } finally {
      const path = await appendDiagnostic('PE-5 eviction scope', out);
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
      say("  (load runs at priority 'background', exactly as the focused read does)");
      // WARM DOMAIN 3 FIRST — this is the difference between measuring the
      // steady state and measuring a one-off.
      //
      // Phase A only touches VCSEC, so domain 3 starts phase B COLD. The load
      // loop's first read therefore pays a full handshake, and a user command
      // that queues behind it waits for the handshake too, not just for a read.
      // That is the ~240ms on top of the 270ms floor, and it showed up as the
      // first-command outlier in all three runs (4171 / 597 / 510).
      //
      // It is NOT what the focused read does in service: at 1.65s intervals
      // domain 3 is permanently warm, and the cost is paid once at startup. So
      // warm it here, and the number below answers the question actually being
      // asked — what a tap costs while the focused read is RUNNING.
      const warmT0 = Date.now();
      try {
        await gw.awakeSync({ states: ['drive'], priority: 'background' });
        say(`  warmed domain 3 in ${Date.now() - warmT0}ms (cold-open cost, paid once at startup)`);
      } catch (e) {
        say(`  WARN could not warm domain 3: ${errMsg(e)}`);
      }
      let loadReads = 0;
      let loadStop = false;
      const loadLoop = (async () => {
        const deadline = Date.now() + LOAD_MS;
        while (!loadStop && Date.now() < deadline) {
          try {
            // ⚠ priority MUST match what the real focused read passes.
            //
            // Run 2 omitted it, so the load queued as 'user' — both lanes were
            // user, the priority never engaged, and the run measured the OLD
            // behaviour while appearing to test the new one (513ms -> 597ms, no
            // change, because nothing had changed for it). A probe that models
            // the load but not its priority is not modelling the feature.
            await gw!.awakeSync({ states: ['drive'], priority: 'background' });
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
      const worstA = Math.max(...a);
      say('');
      say(`quiet: median ${ma}ms worst ${worstA}ms`);
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
      // BASELINE GATE, before any judgement about the load.
      //
      // Measured 2026-07-26 19:09: both MARGINAL runs had a QUIET phase twice as
      // slow as the passing ones (median 237/209ms vs 91-120ms, worst ~390ms vs
      // ~120ms). The load ratio was actually BETTER in those runs — 1.6-2.0x
      // against 2.5x — so the load was handled fine and the LINK was slow. The
      // verdict blamed the load anyway, because it judges an absolute number.
      //
      // A probe that cannot measure its variable must say so rather than
      // produce a verdict about it. Same rule as PE-1's INCONCLUSIVE and M4's
      // VOID. 250ms separates cleanly: healthy quiet worst is 120-151ms,
      // degraded was 392-394ms.
      if (worstA > 250) {
        say(`VERDICT: BASELINE DEGRADED — the QUIET phase alone hit ${worstA}ms.`);
        say('  This run says NOTHING about the focused read: the link was already slow with');
        say('  nothing running. Re-run when the quiet phase is back under ~150ms.');
        say(`  (for the record: loaded worst ${worstB}ms, ratio ${(worstB / worstA).toFixed(1)}x)`);
      } else if (worstB <= 500) {
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
              <ActionButton label="PE-1 deaf-window repro" onPress={() => withBackgroundReadsSuspended(handlePassiveEntryRepro)} theme={theme} />
              <ActionButton label="PE-4 command latency" onPress={() => withBackgroundReadsSuspended(handleCommandLatencyProbe)} theme={theme} />
              <ActionButton label="PE-5 eviction scope" onPress={() => withBackgroundReadsSuspended(handleEvictionScopeProbe)} theme={theme} />
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
                label="1 · Point C — featureless (came back “no results found”)"
                value={navPointC}
                onChangeText={setNavPointC}
                placeholder="39.936693,25.306087"
                autoCapitalize="none"
                theme={theme}
              />
              <Field
                label="1 · Point D — retry of the same discriminator"
                value={navPointD}
                onChangeText={setNavPointD}
                placeholder="39.936959,25.305732"
                autoCapitalize="none"
                theme={theme}
              />
              <Field
                label="1 · Point E — retry, ~2.5 km from C/D"
                value={navPointE}
                onChangeText={setNavPointE}
                placeholder="39.926736,25.332941"
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
                  {(['A', 'B', 'C', 'D', 'E'] as const).map((p) => (
                    <TransportPill
                      key={p}
                      label={p}
                      active={benchTarget === p}
                      onPress={() => setBenchTarget(p)}
                      theme={theme}
                    />
                  ))}
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
