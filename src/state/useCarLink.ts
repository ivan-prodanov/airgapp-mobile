// useCarLink.ts — the productized gateway the fleet layer dispatches through.
//
// Owns ONE stable selector-backed CarGateway for the linked car (the enrolled
// VIN in PiConfig, when EXPO_PUBLIC_CAR_LINK=1 and device keys exist). The
// hook is the USER-ACTION → real-command path only: useFleetState calls
// dispatch(cmd, rollback) when the active car is linked and a lock/unlock diff
// is produced; on a car-side failure the rollback reverts the optimistic UI.
// Telemetry (M3b-2) will NOT come through here — it mutates state with no
// dispatch, so it never loops back into a command.
//
// RN-only (imports DirectBleTransport → ble-plx, and the secure-store adapter),
// so this file is deliberately NOT node-tested and never added to the `test`
// script — same isolation rule as carlink.tsx.
//
// Invariants (proven on hardware, see plan P3.T5 + carlink.tsx's selectorRef
// comment):
//   • ONE stable selector + gateway instance, cached in refs. A per-call
//     selector loses its chosen-transport state on a session-cache hit
//     (exchange without a fresh openSession) and throws "no active transport".
//   • The Pi holds its single BLE session for ~5 min after a force-kill; free
//     it on unmount AND on AppState → background so it isn't orphaned and the
//     BLE link drops.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import * as Haptics from 'expo-haptics';

import {
  createCarGateway,
  createSelectingTransport,
  closeAllCachedSessions,
  loadPiConfig,
  loadOrCreateDeviceKeys,
  isCarLinkEnabled,
  type CarCommand,
  type CarGateway,
  type CarTransport,
  type PiConfig,
  type DeviceKeys,
  type TransportCandidate,
} from '@/ble';
import { secureStoreSecretStore as store } from '@/ble/secureStoreSecretStore';
import { DirectBleTransport } from '@/ble/directBleTransport';
import { wrapPiClient, recoverOrphanedSession } from '@/ble/piSessionOrphan';

// Short scan budget for the 'auto' selector's BLE candidate so that when the
// car isn't in range we fall back to the Pi in ~6s instead of waiting out
// DirectBleTransport's full default scan. Matches carlink.tsx.
const AUTO_BLE_SCAN_TIMEOUT_MS = 6000;

export interface CarLink {
  // enabled + config + device keys + a VIN to bind to.
  linked: boolean;
  // Fire-and-reconcile: dispatch the command; on car-side failure call
  // rollback (revert the optimistic UI). Never throws into the caller.
  dispatch: (cmd: CarCommand, rollback: () => void) => void;
}

export function useCarLink(): CarLink {
  const enabled = isCarLinkEnabled();

  const cfgRef = useRef<PiConfig | null>(null);
  const keysRef = useRef<DeviceKeys | null>(null);
  // The single stable selector + gateway (see the header invariant). Built
  // lazily on first dispatch and torn down on background/unmount.
  const selectorRef = useRef<CarTransport | null>(null);
  const gatewayRef = useRef<CarGateway | null>(null);

  const [linked, setLinked] = useState(false);

  // Load config + device keys once on mount (only when the feature is on).
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      try {
        const cfg = await loadPiConfig(store);
        const keys = await loadOrCreateDeviceKeys(store);
        if (cancelled) return;
        cfgRef.current = cfg;
        keysRef.current = keys;
        setLinked(!!cfg?.vin);
        // Free any session a prior force-kill orphaned before the first command.
        if (cfg?.baseUrl && cfg?.token) {
          await recoverOrphanedSession({ baseUrl: cfg.baseUrl, token: cfg.token }, store);
        }
      } catch (err) {
        // Leave unlinked — a missing/unreadable config just means no live car.
        console.warn('[useCarLink] load failed', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  // getGateway builds (once) and returns the single cached gateway, or null if
  // not linked / not yet loaded. The selector is a stable instance so a
  // session-cache hit that skips openSession still has an active transport.
  const getGateway = useCallback((): CarGateway | null => {
    const cfg = cfgRef.current;
    const keys = keysRef.current;
    if (!cfg?.vin || !keys) return null;
    if (!gatewayRef.current) {
      if (!selectorRef.current) {
        const candidates: TransportCandidate[] = [];
        // BLE first (matches the official app's BLE-primary behavior), Pi
        // fallback when a base URL + token are configured.
        candidates.push({
          name: 'ble',
          make: () => new DirectBleTransport({ scanTimeoutMs: AUTO_BLE_SCAN_TIMEOUT_MS }),
        });
        if (cfg.baseUrl && cfg.token) {
          candidates.push({
            name: 'pi',
            make: () => wrapPiClient({ baseUrl: cfg.baseUrl, token: cfg.token }, store),
          });
        }
        selectorRef.current = createSelectingTransport(candidates);
      }
      gatewayRef.current = createCarGateway({
        transport: selectorRef.current,
        vin: cfg.vin,
        deviceKeys: keys,
      });
    }
    return gatewayRef.current;
  }, []);

  const dispatch = useCallback(
    (cmd: CarCommand, rollback: () => void) => {
      const gw = getGateway();
      if (!gw) return; // not linked / not ready → no-op (demo cars stay pure-optimistic)
      // Fire-and-forget: the gateway's per-VIN queue serializes commands. We
      // never surface the promise to the caller — a failure rolls the UI back.
      void (async () => {
        try {
          const outcome = await gw.runCommand(cmd);
          if (!outcome.ok) {
            rollback();
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
            console.warn('[useCarLink] command failed', cmd.type, outcome);
          }
        } catch (err) {
          rollback();
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
          console.warn('[useCarLink] command threw', cmd.type, err);
        }
      })();
    },
    [getGateway],
  );

  // teardown frees the Pi's single session + drops the BLE link and resets the
  // gateway/selector refs so the next dispatch rebuilds a fresh gateway.
  const teardown = useCallback(() => {
    closeAllCachedSessions();
    const sel = selectorRef.current;
    selectorRef.current = null;
    gatewayRef.current = null;
    if (sel) sel.closeSession('').catch(() => {});
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'background') teardown();
    });
    return () => {
      sub.remove();
      teardown();
    };
  }, [teardown]);

  return useMemo<CarLink>(() => ({ linked, dispatch }), [linked, dispatch]);
}
