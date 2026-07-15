// useCarLink.ts — the productized gateway the fleet layer dispatches through.
//
// Owns ONE stable selector-backed CarGateway for the linked car (the enrolled
// VIN in PiConfig, when EXPO_PUBLIC_CAR_LINK=1 and device keys exist). The
// hook is BOTH the USER-ACTION → real-command path AND the telemetry-in path:
//   • dispatch(cmd, rollback, affectedKeys): useFleetState calls this when the
//     active car is linked and a lock/unlock diff is produced; on a car-side
//     failure the rollback reverts the optimistic UI. affectedKeys stamp a
//     grace window so an in-flight/lagging poll can't revert the change.
//   • a foreground 20s VCSEC poll reads the car's real lock/awake/closures and
//     applies them via opts.applyTelemetry — the PLAIN (non-reconciling) apply,
//     so telemetry NEVER loops back into a command. The optimistic-intent grace
//     (intentGrace.ts) strips any field the user just changed from the patch.
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
  type CommandOutcome,
  type PiConfig,
  type DeviceKeys,
  type TransportCandidate,
} from '@/ble';
import { secureStoreSecretStore as store } from '@/ble/secureStoreSecretStore';
import { DirectBleTransport } from '@/ble/directBleTransport';
import { wrapPiClient, recoverOrphanedSession } from '@/ble/piSessionOrphan';
import { vcsecStatusToPatch } from '@/ble/telemetry';
import { filterPatchUnderIntent, GRACE_MS } from '@/ble/intentGrace';
import { commandActionLabel, commandFailureMessage } from '@/ble/commandMessages';
import { useToast } from '@/components/ToastHost';
import type { VehicleStateKey, VehicleViewState } from '@/types/vehicleTypes';

// Short scan budget for the 'auto' selector's BLE candidate so that when the
// car isn't in range we fall back to the Pi in ~6s instead of waiting out
// DirectBleTransport's full default scan. Matches carlink.tsx.
const AUTO_BLE_SCAN_TIMEOUT_MS = 6000;

// Foreground VCSEC poll cadence. readVcsecStatus works while the car sleeps
// (VCSEC stays awake) so it's cheap and never wakes the car; 20s is frequent
// enough for a live lock/awake/closures indicator without spamming the link.
const POLL_MS = 20_000;

// CarLinkStatus is the read-only connection surface consumers render from.
export interface CarLinkStatus {
  // enabled + config + device keys + a VIN to bind to.
  linked: boolean;
  // 'offline' = no successful contact yet / last poll failed / backgrounded.
  // 'connecting' = first contact in flight. 'online' = last read succeeded.
  connection: 'offline' | 'connecting' | 'online';
  // Which transport the selector used on the last successful read.
  transport: 'ble' | 'pi' | null;
  // Date.now() of the last successful read (null until the first one lands).
  lastUpdatedAt: number | null;
  // VehicleStateKeys with a real command in flight (dispatched, not yet
  // confirmed/failed). Controls read this to show a pending affordance;
  // demo/unlinked cars never populate it (dispatch no-ops before adding).
  pending: ReadonlySet<VehicleStateKey>;
}

export interface CarLink extends CarLinkStatus {
  // Fire-and-reconcile: dispatch the command; on car-side failure call
  // rollback (revert the optimistic UI). Never throws into the caller.
  // affectedKeys are the VehicleStateKeys the user just changed — each is
  // stamped with a GRACE_MS intent window so the poll won't revert them.
  dispatch: (cmd: CarCommand, rollback: () => void, affectedKeys?: VehicleStateKey[]) => void;
}

export interface UseCarLinkOptions {
  // The PLAIN telemetry apply path (NOT the user/reconciler path) — writing a
  // poll-derived patch through here must never loop back into a command.
  applyTelemetry: (patch: Partial<VehicleViewState>) => void;
}

export function useCarLink({ applyTelemetry }: UseCarLinkOptions): CarLink {
  const enabled = isCarLinkEnabled();

  const cfgRef = useRef<PiConfig | null>(null);
  const keysRef = useRef<DeviceKeys | null>(null);
  // The single stable selector + gateway (see the header invariant). Built
  // lazily on first dispatch and torn down on background/unmount.
  const selectorRef = useRef<CarTransport | null>(null);
  const gatewayRef = useRef<CarGateway | null>(null);
  // Which candidate the selector last chose (recorded via its onSelect). Read
  // into `transport` state on a successful poll tick.
  const selectedTransportRef = useRef<'ble' | 'pi' | null>(null);
  // Optimistic-intent map: VehicleStateKey → grace expiry (Date.now()+GRACE_MS).
  // Stamped by dispatch, consumed (and pruned) by the poll's strip filter.
  const intentRef = useRef<Map<VehicleStateKey, number>>(new Map());
  // Keep the latest applyTelemetry without restarting the poll effect: its
  // identity can change per render, but the poll must not tear down/rebuild.
  const applyTelemetryRef = useRef(applyTelemetry);
  applyTelemetryRef.current = applyTelemetry;

  const [linked, setLinked] = useState(false);
  const [connection, setConnection] = useState<CarLinkStatus['connection']>('offline');
  const [transport, setTransport] = useState<CarLinkStatus['transport']>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  // Fields with an in-flight command. Never carries a stale key: every dispatch
  // that adds keys removes exactly those on completion (ok, fail, or throw).
  const [pending, setPending] = useState<ReadonlySet<VehicleStateKey>>(() => new Set());

  // Toast surface for command failures. Held in a ref so dispatch's identity
  // (and the memoized CarLink) doesn't churn on every provider render. The
  // provider sits above the fleet, so this is always the real host in-app; the
  // no-op fallback keeps headless/tests safe.
  const toast = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;

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
        // onSelect records which transport connected so a successful poll tick
        // can surface it as `transport`. Names are 'ble' | 'pi' (see candidates).
        selectorRef.current = createSelectingTransport(candidates, (name) => {
          selectedTransportRef.current = name === 'pi' ? 'pi' : 'ble';
        });
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
    (cmd: CarCommand, rollback: () => void, affectedKeys?: VehicleStateKey[]) => {
      // Stamp the just-changed keys with a grace window BEFORE issuing the
      // command so a poll that fires mid-flight (or on a lagging sensor after)
      // can't revert the optimistic value. Recorded even if the gateway isn't
      // ready — harmless, and it keeps the UI honest until the car catches up.
      if (affectedKeys && affectedKeys.length) {
        const expiry = Date.now() + GRACE_MS;
        for (const key of affectedKeys) intentRef.current.set(key, expiry);
      }
      const gw = getGateway();
      if (!gw) return; // not linked / not ready → no-op (demo cars stay pure-optimistic)

      // Mark the affected fields pending only now that we're truly dispatching
      // (past the demo/unlinked guard), so demo cars never show a pending
      // affordance. Cleared on every terminal path below.
      const keys = affectedKeys && affectedKeys.length ? affectedKeys : null;
      const clearPending = () => {
        if (!keys) return;
        setPending((prev) => {
          const next = new Set(prev);
          for (const key of keys) next.delete(key);
          return next;
        });
      };
      if (keys) {
        setPending((prev) => {
          const next = new Set(prev);
          for (const key of keys) next.add(key);
          return next;
        });
      }
      const failToast = (outcome: Extract<CommandOutcome, { ok: false }>) => {
        toastRef.current.show(commandFailureMessage(commandActionLabel(cmd.type), outcome), 'error');
      };

      // Fire-and-forget: the gateway's per-VIN queue serializes commands. We
      // never surface the promise to the caller — a failure rolls the UI back,
      // toasts why, and heavy-haptics; success clears pending + light-haptics.
      void (async () => {
        try {
          const outcome = await gw.runCommand(cmd);
          clearPending();
          if (outcome.ok) {
            // Light confirmation — matches the app's impact/selection-only
            // haptic vocabulary (no notification feedback).
            Haptics.selectionAsync().catch(() => {});
          } else {
            rollback();
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
            failToast(outcome);
            console.warn('[useCarLink] command failed', cmd.type, outcome);
          }
        } catch (err) {
          clearPending();
          rollback();
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
          // A throw (unexpected — runCommand normally returns an outcome) has no
          // structured outcome; surface it as an unreachable-style failure.
          failToast({ ok: false, kind: 'unreachable', message: String(err) });
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

  // ── Foreground VCSEC poll ────────────────────────────────────────────────
  // While linked AND foregrounded, read the car's real lock/awake/closures
  // every POLL_MS and apply the (intent-filtered) patch through the PLAIN
  // telemetry path. First tick fires immediately on becoming linked/foreground
  // (connection 'connecting' → 'online'/'offline'). Single in-flight; stops on
  // background (which also tears the session down) and resumes on foreground.
  useEffect(() => {
    if (!linked) {
      setConnection('offline');
      return;
    }

    let stopped = false; // effect torn down (unlink/unmount)
    let paused = false; // app not foregrounded
    let inFlight = false; // a tick is awaiting the car
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      if (stopped || paused || inFlight) return;
      const gw = getGateway();
      if (!gw) {
        // Linked but the gateway isn't ready yet (config/keys still loading).
        // Leave connection as-is; the next tick retries once it's built.
        return;
      }
      inFlight = true;
      try {
        const st = await gw.readVcsecStatus();
        // Empty closureIntent — the grace is applied uniformly HERE, keyed by
        // VehicleStateKey, so telemetry.ts's closure-only keying is bypassed.
        const { patch } = vcsecStatusToPatch(st, {}, Date.now());
        const filtered = filterPatchUnderIntent(patch, intentRef.current, Date.now());
        if (stopped || paused) return; // backgrounded/unlinked while awaiting
        if (Object.keys(filtered).length) applyTelemetryRef.current(filtered);
        setLastUpdatedAt(Date.now());
        setConnection('online');
        if (selectedTransportRef.current) setTransport(selectedTransportRef.current);
      } catch {
        // A failed read means no clean contact this tick — drop to offline
        // (do NOT keep a stale 'online'). The loop keeps retrying every POLL_MS.
        if (!stopped && !paused) setConnection('offline');
      } finally {
        inFlight = false;
      }
    };

    const scheduleNext = () => {
      if (stopped || paused) return;
      timer = setTimeout(loop, POLL_MS);
    };
    const loop = async () => {
      await tick();
      scheduleNext();
    };

    const startPolling = () => {
      paused = false;
      if (timer || inFlight) return; // already running
      setConnection((prev) => (prev === 'online' ? prev : 'connecting'));
      void loop();
    };
    const stopPolling = () => {
      paused = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };

    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') startPolling();
      else if (next === 'background') {
        // Only a true background stops the poll (the session is torn down too).
        // iOS emits a transient 'inactive' for the app switcher / control center
        // / incoming call — ignore it so the status doesn't flash "Offline".
        stopPolling();
        setConnection('offline');
      }
    });

    // Kick off now if already foregrounded (the common case on becoming linked).
    if (AppState.currentState === 'active') startPolling();

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
      sub.remove();
    };
  }, [linked, getGateway]);

  return useMemo<CarLink>(
    () => ({ linked, connection, transport, lastUpdatedAt, pending, dispatch }),
    [linked, connection, transport, lastUpdatedAt, pending, dispatch],
  );
}
