// piSessionOrphan.ts — the Pi single-BLE-session orphan-recovery helpers,
// shared by the bring-up harness (src/app/carlink.tsx) and the productized
// useCarLink hook so the two never keep divergent copies of this logic.
//
// The Pi allows exactly ONE BLE session at a time (bleMu, ~5-min idle reaper).
// A force-kill can't run cleanup, so the last-opened session is orphaned and
// blocks the next cold-start openSession until the reaper fires. We persist
// the open session id (LAST_SESSION_KEY, in the injected SecretStore — verified
// to survive kills) and best-effort DELETE it on the next launch so a
// force-kill recovers instantly instead of waiting ~5 minutes.
//
// Node-safe: imports only ./transport (itself node-tested) + the shared types.
// No expo-secure-store / ble-plx here — the concrete store is injected.

import { PiClient } from './transport';
import type { CarTransport, SecretStore } from './types';

export const LAST_SESSION_KEY = 'ble.lastSessionId';

// wrapPiClient wraps a PiClient in the CarTransport shape that ALSO persists
// every opened session id (LAST_SESSION_KEY) and clears it on close, so
// recoverOrphanedSession can free a force-killed session on the next launch.
export function wrapPiClient(
  cfg: { baseUrl: string; token: string },
  store: SecretStore,
): CarTransport {
  const pi = new PiClient(cfg);
  return {
    openSession: async (vin: string) => {
      const id = await pi.openSession(vin);
      await store.setItem(LAST_SESSION_KEY, id).catch(() => {});
      return id;
    },
    exchange: (id: string, payloadB64: string, timeoutMs: number) =>
      pi.exchange(id, payloadB64, timeoutMs),
    closeSession: async (id: string) => {
      await pi.closeSession(id);
      await store.removeItem(LAST_SESSION_KEY).catch(() => {});
    },
  };
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// recoverOrphanedSession best-effort DELETEs the persisted last-session id so a
// prior force-kill's orphaned Pi BLE session is freed before the first command
// (rather than waiting out the ~5-min reaper). Always clears the persisted id
// afterward (single-use either way); never throws. `log` is an optional sink
// for the harness's on-screen diagnostics.
export async function recoverOrphanedSession(
  cfg: { baseUrl: string; token: string },
  store: SecretStore,
  log?: (line: string) => void,
): Promise<void> {
  try {
    const stale = await store.getItem(LAST_SESSION_KEY);
    if (stale) {
      await new PiClient(cfg).closeSession(stale);
      log?.(`recovered orphaned Pi session ${stale.slice(0, 8)}… (freed before first command)`);
    }
  } catch (err) {
    // 404 (already reaped) / transient — the id is single-use either way.
    log?.(`orphan cleanup (best-effort): ${errMsg(err)}`);
  } finally {
    await store.removeItem(LAST_SESSION_KEY).catch(() => {});
  }
}
