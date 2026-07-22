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
// DirectBleTransport imports react-native-ble-plx (RN-only) — imported
// directly here, NOT via the src/ble façade, same isolation rule as the
// secure-store adapter above (see directBleTransport.ts's header comment).
import { DirectBleTransport } from '@/ble/directBleTransport';
import { runDuplicateRejectProbe } from '@/ble/hedgeProbe';
import { startPassiveEntry, onPassiveEntryLog } from '../../modules/expo-passive-entry';
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
  const [enrolLink, setEnrolLink] = useState('');
  const [log, setLog] = useState<string[]>([]);
  // transport: which CarTransport lock/unlock/read/wake route through.
  // 'ble' needs no baseUrl/token — DirectBleTransport scans by VIN alone.
  // 'auto' (default) tries direct BLE first and falls back to the Pi via
  // createSelectingTransport — matching the official Tesla app's
  // BLE-primary behavior.
  const [transport, setTransport] = useState<'auto' | 'pi' | 'ble'>('auto');
  // ONE DirectBleTransport instance reused across button presses so the BLE
  // connection stays warm (reconnecting per command is slow) — see
  // directBleTransport.ts's header comment on why only one connection is
  // ever live at a time. Reset to null when the toggle flips back to Pi.
  const bleTransportRef = useRef<DirectBleTransport | null>(null);
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
  const getBleTransport = (): DirectBleTransport => {
    if (!bleTransportRef.current) {
      bleTransportRef.current = new DirectBleTransport();
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
    const probe = new DirectBleTransport();
    append(`BLE scan test: scanning for VIN …${vin.slice(-6)}`);
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

  // handleHedgeProbe runs the RE #10 duplicate-counter-reject probe over a
  // dedicated BLE VCSEC session: seals two GET_STATUS frames at the same counter
  // (distinct uuids), delivers leg-1 (accept) then leg-2 (duplicate → reject),
  // and logs both raw+decoded replies so we can see whether the reject attaches
  // a SignedSessionInfo (the hedge landed-guard's foundation) and the exact fault
  // code/namespace. Idempotent (GET_STATUS = a read); safe.
  const handleHedgeProbe = async () => {
    if (!isValidVin(vin)) {
      append(`ERROR hedge probe: "${vin}" is not a valid 17-char VIN`);
      return;
    }
    append('hedge probe: opening dedicated VCSEC session over BLE…');
    try {
      const keys = await loadOrCreateDeviceKeys(store);
      const transport = new DirectBleTransport();
      const lines = await runDuplicateRejectProbe({ transport, vin, deviceKeys: keys });
      for (const l of lines) append(l);
      await appendDiagnostic('hedge probe', lines);
      append('hedge probe: written to diagnostics (pull the log).');
    } catch (err) {
      append(`ERROR hedge probe: ${errMsg(err)}`);
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
            make: () => new DirectBleTransport({ scanTimeoutMs: AUTO_BLE_SCAN_TIMEOUT_MS }),
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
              <ActionButton label="Hedge probe (dup reject)" onPress={handleHedgeProbe} theme={theme} />
              <ActionButton label="Native passive: start" onPress={handleNativePassiveStart} theme={theme} />
              <ActionButton label="Enrol over BLE" onPress={handleEnrolOverBle} theme={theme} />
              <ActionButton label="Lock" onPress={() => runCarCommand('lock', { type: 'lock' })} theme={theme} />
              <ActionButton label="Unlock" onPress={() => runCarCommand('unlock', { type: 'unlock' })} theme={theme} />
              <ActionButton label="Read VCSEC status" onPress={handleReadStatus} theme={theme} />
              <ActionButton label="Probe key permissions" onPress={handleProbeWhitelist} theme={theme} />
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
