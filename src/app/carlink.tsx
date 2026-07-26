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
} from '@/ble/session';
import { navigateWaypointsAction, vehicleDataSubscriptionAction, cancelVehicleDataSubscriptionAction, encodePiiKeyRequest, pingAction, VDS_DEFAULTS } from '@/ble/builders';
import { parseCarServerResponse } from '@/ble/telemetry';
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

  // VDS-M2 — find the pii_key_request encoding, using the CAR as the oracle.
  //
  // Established by VDS-M1 (measured, 2026-07-26): the car pushes state over BLE
  // at the rate we ask for, and 23/23 pushes decrypt — but location_state comes
  // back EMPTY, with the real payload in an undeclared VehicleData field 11
  // encrypted to a key we never supplied. The car says why, in as many words:
  // "No PII request".
  //
  // That string is what makes this a measurement rather than a guessing game.
  // We know pii_key_request is subscription field 13, but not the inner tags of
  // its sub-message. So: send each candidate encoding and read the reply. If a
  // candidate PARSES, the car cannot still be taking the no-PII branch, so that
  // string must change — and if location_state comes back populated, we are done.
  // A wrong guess produces an unambiguous negative instead of silence, which is
  // the property the first version of the M1 probe lacked.
  const handleVdsPiiSweep = async () => {
    const WATCH_MS = 8000;
    const RATE_MS = 2000; // fast, so a short watch still yields several pushes
    const out: string[] = [];
    const say = (line: string) => {
      out.push(line);
      append(line);
    };
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const ascii = (b: Uint8Array) =>
      Array.from(b)
        .map((c) => (c >= 0x20 && c < 0x7f ? String.fromCharCode(c) : '.'))
        .join('');
    const hex = (b: Uint8Array | null | undefined) =>
      b ? Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join(' ') : null;
    let gw: Awaited<ReturnType<typeof makeGateway>> | null = null;
    try {
      const keys = await loadOrCreateDeviceKeys(store);
      gw = await makeGateway();
      say('waking car…');
      await gw.wake();
      say(`device public key: ${keys.publicKeyRaw.length}B SEC1 (the one the car already whitelisted)`);

      // Candidates, cheapest-first. Tag 1 is the overwhelmingly likely home for
      // the key; the expiry variants test whether the car REQUIRES it before it
      // will accept the request at all.
      const expiresAt = Math.floor(Date.now() / 1000) + 3600;
      const candidates = [
        { label: 'key@1', opts: { keyTag: 1, publicKeyRaw: keys.publicKeyRaw } },
        { label: 'key@2', opts: { keyTag: 2, publicKeyRaw: keys.publicKeyRaw } },
        { label: 'key@1 + expiry@2', opts: { keyTag: 1, publicKeyRaw: keys.publicKeyRaw, expiryTag: 2, expiresAtUnix: expiresAt } },
        { label: 'key@2 + expiry@1', opts: { keyTag: 2, publicKeyRaw: keys.publicKeyRaw, expiryTag: 1, expiresAtUnix: expiresAt } },
      ];

      for (const c of candidates) {
        const piiKeyRequest = encodePiiKeyRequest(c.opts);
        const sub = await gw.runRawAction(
          vehicleDataSubscriptionAction({ locationRateMs: RATE_MS, piiKeyRequest }),
          `vds-pii-${c.label}`,
        );
        const reply = sub.result?.decryptedPayload ?? null;
        say('');
        say(`candidate "${c.label}" — pii_key_request ${piiKeyRequest.length}B`);
        // ALWAYS the hex. Sweep run 1 logged the reply as ASCII only, so the one
        // byte string that distinguished the candidates had to be reconstructed
        // afterwards from a four-character rendering. Never log evidence through
        // a lossy view.
        say(`  reply hex  : ${hex(reply) ?? '(none)'}`);
        say(`  reply ascii: ${reply ? ascii(reply) : '(no payload)'}`);
        // Three outcomes, not two. Run 1 collapsed "no payload" into PARSED,
        // which is backwards: an empty reply means the car did NOT answer, and
        // the zero pushes that followed confirmed the subscription never armed.
        const outcome = !reply
          ? 'ERROR — no response payload; the action itself failed to parse'
          : ascii(reply).includes('No PII request')
            ? 'REJECTED — car still took the no-PII branch, so our sub-message did not parse'
            : 'PARSED — the car left the no-PII branch';
        say(`  → ${outcome}`);

        // Whether location actually arrives is the outcome that matters; the
        // string only tells us the car got as far as looking.
        armVdsCapture(Date.now());
        await wait(WATCH_MS);
        const seen = disarmVdsCapture();
        let populated = 0;
        let piiOpened = 0;
        for (const o of seen) {
          const opened = sub.result?.decryptPush?.(o.raw);
          if (!opened) continue;
          const desc = describePlaintext(opened.plaintext);
          if (!desc.includes('location={}') && !desc.includes('no recognised')) {
            populated++;
            if (populated === 1) say(`  PUSH DECODED (plaintext location): ${desc}`);
          }
          // Sweep run 1 only asked whether location_state was populated, and
          // that may simply be the wrong question: an EMPTY location_state
          // alongside a filled field 11 looks like the NORMAL way PII is
          // delivered, in which case supplying our key changes who can open the
          // envelope, not whether the plaintext field gets used. So try to open
          // it — that is the outcome that actually decides this.
          const env = extractPiiEnvelope(opened.plaintext);
          if (!env) continue;
          const pii = sub.result?.decryptPiiEnvelope?.(env);
          if (pii) {
            piiOpened++;
            if (piiOpened === 1) {
              say(`  *** PII ENVELOPE OPENED (${pii.variant}) stateId=${pii.stateId} ***`);
              say(`  pii plaintext: ${hex(pii.plaintext)}`);
            }
          }
        }
        say(
          `  ${seen.length} pushes in ${WATCH_MS / 1000}s — ${populated} with plaintext location, ` +
            `${piiOpened} with a DECRYPTABLE pii envelope`,
        );
        if (populated > 0 || piiOpened > 0) {
          say(`  *** WINNER: "${c.label}" yields readable location — stop here ***`);
          break;
        }
        try {
          await gw.runRawAction(cancelVehicleDataSubscriptionAction(), 'vds-cancel');
        } catch {
          say('  WARN: inter-candidate cancel failed');
        }
      }
    } catch (err) {
      say(`ERROR pii sweep: ${errMsg(err)}`);
      disarmVdsCapture();
    } finally {
      try {
        if (gw) await gw.runRawAction(cancelVehicleDataSubscriptionAction(), 'vds-cancel');
      } catch {
        say('WARN: final cancel failed (the TTL will expire it)');
      }
      const path = await appendDiagnostic('VDS-M2 pii_key_request sweep', out);
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
              <ActionButton label="VDS-M2 PII key sweep" onPress={handleVdsPiiSweep} theme={theme} />
              <ActionButton label="VDS-M3 default-state probe" onPress={handleVdsDefaultProbe} theme={theme} />
              <ActionButton label="VDS-M4 ping/ack probe" onPress={handleVdsAckProbe} theme={theme} />
              <ActionButton label="Wake" onPress={handleWake} theme={theme} />
              <ActionButton label="Close session" onPress={handleCloseSession} theme={theme} />
              <ActionButton label="Forget device key" onPress={handleForgetKey} theme={theme} />
              <ActionButton label="Storage self-test" onPress={handleSelfTest} theme={theme} />
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
