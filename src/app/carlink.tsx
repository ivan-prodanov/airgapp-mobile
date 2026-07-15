import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SymbolView } from 'expo-symbols';
import { useRouter } from 'expo-router';

import { EdgeSwipeBack } from '@/components/EdgeSwipeBack';
import { useTheme } from '@/hooks/use-theme';
import {
  createCarGateway,
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
} from '@/ble';
import { secureStoreSecretStore as store } from '@/ble/secureStoreSecretStore';

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

// The Pi allows exactly ONE BLE session at a time (bleMu, ~5-min idle reaper).
// A force-kill can't run cleanup, so the last session is orphaned and blocks
// the next cold-start openSession until the reaper fires. We persist the open
// session id here (secure-store — verified to survive kills) and best-effort
// DELETE it on the next launch so a force-kill recovers instantly instead of
// waiting 5 minutes. (Productization moves this into useCarLink — plan P3.T5.)
const LAST_SESSION_KEY = 'ble.lastSessionId';

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
        try {
          const stale = await store.getItem(LAST_SESSION_KEY);
          if (stale) {
            await new PiClient({ baseUrl: cfg.baseUrl, token: cfg.token }).closeSession(stale);
            append(`recovered orphaned Pi session ${stale.slice(0, 8)}… (freed before first command)`);
          }
        } catch (err) {
          // 404 (already reaped) / transient — the id is single-use either way.
          append(`orphan cleanup (best-effort): ${errMsg(err)}`);
        } finally {
          await store.removeItem(LAST_SESSION_KEY).catch(() => {});
        }
      }
    })();
    // On unmount (navigate away), free the Pi session so it isn't orphaned.
    return () => {
      closeAllCachedSessions();
    };
    // Mount-only: intentionally not re-running when append's closure changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  // cached across button presses. The transport is WRAPPED so every opened Pi
  // session id is persisted (and cleared on close): that persisted id is what
  // the mount-time orphan recovery DELETEs after a force-kill.
  const makeGateway = async () => {
    const keys = await loadOrCreateDeviceKeys(store);
    const cfg = await loadPiConfig(store);
    if (!cfg) throw new Error('no config saved — tap "Save config" first');
    const pi = new PiClient({ baseUrl: cfg.baseUrl, token: cfg.token });
    const transport = {
      openSession: async (vin: string) => {
        const id = await pi.openSession(vin);
        await store.setItem(LAST_SESSION_KEY, id).catch(() => {});
        return id;
      },
      exchange: (id: string, payloadB64: string, timeoutMs: number) => pi.exchange(id, payloadB64, timeoutMs),
      closeSession: async (id: string) => {
        await pi.closeSession(id);
        await store.removeItem(LAST_SESSION_KEY).catch(() => {});
      },
    };
    return createCarGateway({ transport, vin: cfg.vin!, deviceKeys: keys });
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
      append('device key deleted');
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

            <View style={styles.buttonGrid}>
              <ActionButton label="Save config" onPress={handleSaveConfig} theme={theme} />
              <ActionButton label="Check Pi" onPress={handleCheckPi} theme={theme} />
              <ActionButton label="Generate + enrol key" onPress={handleGenerateAndEnrol} theme={theme} />
              <ActionButton label="Lock" onPress={() => runCarCommand('lock', { type: 'lock' })} theme={theme} />
              <ActionButton label="Unlock" onPress={() => runCarCommand('unlock', { type: 'unlock' })} theme={theme} />
              <ActionButton label="Read VCSEC status" onPress={handleReadStatus} theme={theme} />
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
