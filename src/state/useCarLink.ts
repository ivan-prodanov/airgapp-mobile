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
  peekPiSessionId,
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
import { infotainmentToPatch, vcsecStatusToPatch } from '@/ble/telemetry';
import { decodeUnsolicitedVcsecStatus } from '@/ble/vcsecPush';
import { filterPatchUnderIntent, GRACE_MS } from '@/ble/intentGrace';
import { createCoalescer, type Coalescer } from '@/ble/coalesce';
import { withTransportLogging } from '@/ble/loggingTransport';
import { logd, logi, logw, loge } from '@/services/logbus';
import { startPiEventStream } from './piEventStream';
import { commandActionLabel, commandFailureText } from '@/ble/commandMessages';
import { notifyCommandFailure } from '@/services/commandNotification';
import { useToast } from '@/components/ToastHost';
import { beginBackgroundTask, endBackgroundTask } from '../../modules/expo-bg-task';
import { appStorage } from './appStorage';
import { loadCarLinkCache, makeCarLinkCacheSaver, type CarLinkCache } from './carLinkCache';
import type { VehicleStateKey, VehicleViewState } from '@/types/vehicleTypes';

// Short scan budget for the 'auto' selector's BLE candidate so that when the
// car isn't in range we fall back to the Pi in ~6s instead of waiting out
// DirectBleTransport's full default scan. Matches carlink.tsx.
const AUTO_BLE_SCAN_TIMEOUT_MS = 6000;

// Persisted name of the last transport that connected, so a cold start seeds the
// selector's preference (see lastGoodTransportRef). Non-secret → appStorage.
const LAST_TRANSPORT_KEY = 'ble.lastTransport.v1';

// Foreground VCSEC poll cadence. readVcsecStatus works while the car sleeps
// (VCSEC stays awake) so it's cheap and never wakes the car; 20s is frequent
// enough for a live lock/awake/closures indicator without spamming the link.
const POLL_MS = 20_000;

// How often the poll does the HEAVY infotainment (charge/range) read. VCSEC runs
// every POLL_MS; this rides on top far less often. Charge state changes slowly,
// and a cold domain-3 open is ~8s of shared-queue time — see the tick.
const INFOTAINMENT_MS = 60_000;

// Flat backoff before retrying a dropped Pi event-stream socket. The 20s poll
// is the backstop meanwhile (it'll re-establish the stream on its next
// successful tick regardless), so a single flat delay is enough — no
// exponential ladder needed.
const STREAM_RECONNECT_MS = 2000;

// OPTIMISTIC_TIMEOUT_MS is the hard wall-clock cap on a pending record — the
// official app's `OPTIMISTIC_TIMEOUT_MS = TimeInMs.THIRTY_SECONDS` (findings
// §2.3, hasm:1435013). Their expiry selector is a PURE time comparison
// re-evaluated on every render — `isExpired(cmd) = cmd.startTime + 30000 < now`
// — not a setTimeout that can be dropped; the pending record is discarded and
// the spinner clears regardless of whether any response ever arrives.
//
// Relationship to the gateway's 25s deadline: that deadline is the PRIMARY —
// it settles the command and surfaces the failure toast. This 30s expiry is the
// BACKSTOP that guarantees the UI never lies even if the promise never settles,
// or if iOS suspended us so no JS timer could fire (a suspended app's
// Promise.race timer does NOT run — that is exactly how a spinner survived a
// background/foreground round-trip). Being a pure `now >= startTime + 30s`
// comparison, it is true the moment we next render, however long we were frozen.
export const OPTIMISTIC_TIMEOUT_MS = 30_000;

// How often to re-evaluate the expiry comparison while something is pending.
// React won't re-render on its own as wall-clock time passes, so a light 1s
// ticker runs ONLY while the pending map is non-empty (see the prune effect).
const PENDING_TICK_MS = 1000;

// Stable empty Set so the common (nothing pending) case never churns identity.
const EMPTY_PENDING: ReadonlySet<VehicleStateKey> = new Set();

// CarLinkStatus is the car-link surface consumers render from: read-only state
// plus refresh(), the one user-initiated action a screen can take against the
// link itself. Commands still go through dispatch (CarLink), which is
// deliberately NOT exposed here.
export interface CarLinkStatus {
  // A car is ENROLLED (enabled + config + device keys + a VIN to bind to).
  //
  // ⚠️ This says nothing about WHICH vehicle is on screen. The fleet layer
  // narrows it to "the ACTIVE car is the live one" before re-exposing it under
  // the same name — see useFleetState. Consumers get the narrowed version.
  linked: boolean;
  // The enrolled car's VIN, so the fleet can tell which of its vehicles is real.
  vin: string | null;
  // 'offline' = no successful contact yet / last poll failed / backgrounded.
  // 'connecting' = first contact in flight. 'online' = last read succeeded.
  connection: 'offline' | 'connecting' | 'online';
  // Which transport the selector used on the last successful read.
  transport: 'ble' | 'pi' | null;
  // Whether the live-push WS event-STREAM is currently open (Pi path only). BLE
  // delivers pushes natively on its held connection, so this stays false for BLE
  // — consumers treat a connected BLE link as inherently live. Drives the
  // brightness of the transport dot: bright = live pushes, dim = poll-only.
  streaming: boolean;
  // Date.now() of the last successful read (null until the first one lands).
  lastUpdatedAt: number | null;
  // Date.now() of the last read that found the car AWAKE and reporting —
  // survives app restarts. Home renders the status line from this (it is what
  // ages into "Last seen 2 hours ago"); null only for a never-fetched car.
  lastVehicleDataAt: number | null;
  // A user-requested wake/refresh is in flight — our analogue of their
  // `canWake` ("a wake was REQUESTED"). Drives the header spinner, and ONLY
  // this does: an automatic poll must never spin.
  wakeInFlight: boolean;
  // Pull-to-refresh / tap-status: really wake the car and re-read it, like
  // their vehicleWakeUp(vin, PULL_DOWN_REFRESH). No-op for a demo/unlinked car.
  refresh: () => void;
  // VehicleStateKeys with a real command in flight (dispatched, not yet
  // confirmed/failed) AND not past the OPTIMISTIC_TIMEOUT_MS wall-clock cap.
  // Controls read this to show a pending affordance; demo/unlinked cars never
  // populate it (dispatch no-ops before adding).
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
  // The active (live) car's current view state, read at telemetry time so the
  // intent grace can CONFIRM-AND-RELEASE: a read matching the optimistic value
  // clears the grace early (see filterPatchUnderIntent). A getter, not a value,
  // so the stable poll/push closures always see the freshest snapshot.
  getActiveState: () => VehicleViewState;
}

export function useCarLink({ applyTelemetry, getActiveState }: UseCarLinkOptions): CarLink {
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
  // The last transport that SUCCESSFULLY connected, persisted across launches
  // (LAST_TRANSPORT_KEY). Seeds the selector so a cold start / post-teardown
  // rebuild tries the transport that actually worked last time FIRST, instead of
  // re-paying BLE's ~10s connect timeout when the car is out of range. Survives
  // teardown (which nulls selectorRef) because it lives here, not in the selector.
  const lastGoodTransportRef = useRef<'ble' | 'pi' | null>(null);
  // Pi event-stream lifecycle (P3): the stop fn for the currently-open
  // WebSocket stream and the Pi sessionId it's bound to, plus any pending
  // reconnect timer. Refs (not state) — managing the stream must never
  // trigger a re-render, same reasoning as selectedTransportRef above.
  const streamStopRef = useRef<(() => void) | null>(null);
  const streamSessionIdRef = useRef<string | null>(null);
  const streamReconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Always points at the CURRENT stopStream (stable useCallback, set right
  // after its declaration below) so onSelect — defined earlier in getGateway,
  // before stopStream exists textually — can stop the stream immediately on a
  // transport flip without a circular useCallback dependency.
  const stopStreamRef = useRef<null | (() => void)>(null);
  // Optimistic-intent map: VehicleStateKey → grace expiry (Date.now()+GRACE_MS).
  // Stamped by dispatch, consumed (and pruned) by the poll's strip filter.
  const intentRef = useRef<Map<VehicleStateKey, number>>(new Map());
  // How many dispatched commands are still in flight, and whether a background
  // teardown is waiting on them. Counts EVERY command — including one with no
  // affectedKeys (no pending affordance) — because finishing the command, not
  // showing a spinner, is what the deferral protects. See teardown below.
  const inFlightRef = useRef(0);
  // Last INFOTAINMENT (charge/range) read. Throttles the heavy domain-3 poll so
  // it can't block interactive commands — see the poll tick.
  const lastInfotainmentAtRef = useRef(0);
  const deferredTeardownRef = useRef(false);
  // Keep the latest applyTelemetry without restarting the poll effect: its
  // identity can change per render, but the poll must not tear down/rebuild.
  const applyTelemetryRef = useRef(applyTelemetry);
  applyTelemetryRef.current = applyTelemetry;
  const getActiveStateRef = useRef(getActiveState);
  getActiveStateRef.current = getActiveState;
  // The unsolicited-push handler, held in a ref so the BLE transport's make()
  // (built before the handler is declared, and only once) always reads the
  // current one. Assigned just below its useCallback.
  const handleVcsecPushRef = useRef<(frame: Uint8Array) => void>(() => {});

  const [linked, setLinked] = useState(false);
  const [vin, setVin] = useState<string | null>(null);
  const [connection, setConnection] = useState<CarLinkStatus['connection']>('offline');
  const [transport, setTransport] = useState<CarLinkStatus['transport']>(null);
  // Mirrors whether the Pi event-stream socket is open (see startStream/stopStream).
  const [streaming, setStreaming] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  // Our analogue of the official app's `last_received_vehicle_data_timestamp`:
  // the last read that found the car AWAKE and reporting. Distinct from
  // lastUpdatedAt (any successful contact) because VCSEC keeps answering while
  // the car sleeps — see the mapping note in ble/vehicleStatusText.ts. This is
  // what ages into "Asleep 5 minutes" / "Last seen 2 hours ago", and it is
  // rehydrated from disk so a cold start never shows "Connecting" for a car we
  // have seen before (findings §B).
  const [lastVehicleDataAt, setLastVehicleDataAt] = useState<number | null>(null);
  const [wakeInFlight, setWakeInFlight] = useState(false);
  // The poll's tick, republished each effect run so refresh() can reuse it
  // (same read + intent-filter + stamp path) instead of duplicating it.
  const tickRef = useRef<((opts?: { forceInfotainment?: boolean }) => Promise<void>) | null>(null);
  // Latest cacheable telemetry, mirrored so the debounced saver can persist a
  // whole snapshot on each awake read without re-rendering.
  const cacheRef = useRef<CarLinkCache | null>(null);
  const saveCacheRef = useRef<((v: CarLinkCache) => void) | null>(null);
  // Fields with an in-flight command → the Date.now() the command STARTED.
  // Every dispatch that adds keys removes exactly those on completion (ok,
  // fail, or throw); the startTime is what lets the exposed Set below expire an
  // entry no completion ever came for (see OPTIMISTIC_TIMEOUT_MS).
  const [pendingMap, setPendingMap] = useState<ReadonlyMap<VehicleStateKey, number>>(
    () => new Map(),
  );

  // ── Render-time pending expiry (findings §2.3) ───────────────────────────
  // The exposed Set is DERIVED here, on every render, by the pure comparison
  // `now >= startTime + OPTIMISTIC_TIMEOUT_MS` — so an entry no completion ever
  // came for cannot outlive 30s, even if JS was frozen the whole time and no
  // timer ever fired. Identity is kept stable while membership is unchanged
  // (reuse the previous Set) so consumers don't re-render on every tick.
  const exposedPendingRef = useRef<ReadonlySet<VehicleStateKey>>(EMPTY_PENDING);
  const live: VehicleStateKey[] = [];
  const nowAtRender = Date.now();
  for (const [key, startTime] of pendingMap) {
    if (nowAtRender < startTime + OPTIMISTIC_TIMEOUT_MS) live.push(key);
  }
  const prevExposed = exposedPendingRef.current;
  const unchanged = prevExposed.size === live.length && live.every((key) => prevExposed.has(key));
  const pending: ReadonlySet<VehicleStateKey> = unchanged ? prevExposed : new Set(live);
  exposedPendingRef.current = pending;

  // prunePending drops expired entries from the map. It is the RE-RENDER
  // TRIGGER (the comparison above only runs when React renders): the 1s ticker
  // below and the AppState → 'active' handler call it, and a real change to the
  // map is what schedules the render that makes the spinner disappear.
  const prunePending = useCallback(() => {
    const now = Date.now();
    setPendingMap((prev) => {
      let next: Map<VehicleStateKey, number> | null = null;
      for (const [key, startTime] of prev) {
        if (now >= startTime + OPTIMISTIC_TIMEOUT_MS) {
          if (!next) next = new Map(prev);
          next.delete(key);
        }
      }
      return next ?? prev; // unchanged identity → no re-render
    });
  }, []);

  // The ticker runs ONLY while something is pending, and only re-renders when
  // it actually prunes something (prunePending returns the same map otherwise).
  useEffect(() => {
    if (pendingMap.size === 0) return;
    const id = setInterval(prunePending, PENDING_TICK_MS);
    return () => clearInterval(id);
  }, [pendingMap, prunePending]);

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
        // Seed the transport preference from last session BEFORE cfgRef/keysRef
        // are set — those are what let getGateway build the selector, so the seed
        // must be in place first or the first cold open re-pays the BLE timeout.
        const savedTxp = await appStorage.getItem(LAST_TRANSPORT_KEY);
        if (cancelled) return;
        if (savedTxp === 'ble' || savedTxp === 'pi') lastGoodTransportRef.current = savedTxp;
        cfgRef.current = cfg;
        keysRef.current = keys;
        setLinked(!!cfg?.vin);
        setVin(cfg?.vin ?? null);
        // Rehydrate the cached telemetry BEFORE the first poll lands, so the
        // header opens on "Last seen {age} ago" + cached battery rather than
        // "Connecting" + a mock level (findings §B).
        if (cfg?.vin) {
          saveCacheRef.current = makeCarLinkCacheSaver(appStorage, cfg.vin);
          const cached = await loadCarLinkCache(appStorage, cfg.vin);
          if (cancelled) return;
          if (cached) {
            cacheRef.current = cached;
            setLastVehicleDataAt(cached.lastVehicleDataAt);
            const patch: Partial<VehicleViewState> = {};
            // `!= null` (loose) — a cache written under an older schema is
            // missing today's keys, and `undefined !== null` would happily write
            // undefined into state. That's how "NaN km" shipped.
            if (cached.batteryLevel != null) patch.batteryLevel = cached.batteryLevel;
            if (cached.rangeMiles != null) patch.rangeMiles = cached.rangeMiles;
            if (cached.charging != null) patch.charging = cached.charging;
            if (cached.awake != null) patch.awake = cached.awake;
            if (cached.interiorTempC != null) patch.interiorTempC = cached.interiorTempC;
            if (cached.exteriorTempC != null) patch.exteriorTempC = cached.exteriorTempC;
            if (cached.targetTempC != null) patch.targetTempC = cached.targetTempC;
            if (cached.chargeLimitPercent != null) patch.chargeLimitPercent = cached.chargeLimitPercent;
            if (cached.chargingAmps != null) patch.chargingAmps = cached.chargingAmps;
            if (Object.keys(patch).length) applyTelemetryRef.current(patch);
          }
        }
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
          make: () =>
            withTransportLogging(
              'ble',
              new DirectBleTransport({
                scanTimeoutMs: AUTO_BLE_SCAN_TIMEOUT_MS,
                // Route the car's unsolicited VCSEC pushes into the live apply
                // path — closures/lock update instantly while this link is held
                // open, with the poll as backstop.
                onUnsolicited: handleVcsecPushRef.current,
              }),
            ),
        });
        if (cfg.baseUrl && cfg.token) {
          candidates.push({
            name: 'pi',
            make: () => withTransportLogging('pi', wrapPiClient({ baseUrl: cfg.baseUrl, token: cfg.token }, store)),
          });
        }
        // onSelect records which transport connected so a successful poll tick
        // can surface it as `transport`. Names are 'ble' | 'pi' (see candidates).
        selectorRef.current = createSelectingTransport(
          candidates,
          (name) => {
            const txp = name === 'pi' ? 'pi' : 'ble';
            selectedTransportRef.current = txp;
            // Remember + persist the winner (only on change — opens are frequent,
            // the transport rarely flips) so the next launch seeds this.
            if (lastGoodTransportRef.current !== txp) {
              lastGoodTransportRef.current = txp;
              void appStorage.setItem(LAST_TRANSPORT_KEY, txp);
            }
            // BLE delivers unsolicited frames directly, so the Pi stream must
            // stop the instant BLE wins — closes the double-feed window that
            // syncStream would otherwise only close on the next poll.
            if (txp === 'ble') stopStreamRef.current?.();
          },
          { initialLastGood: lastGoodTransportRef.current },
        );
      }
      gatewayRef.current = createCarGateway({
        transport: selectorRef.current,
        vin: cfg.vin,
        deviceKeys: keys,
      });
    }
    return gatewayRef.current;
  }, []);

  // ── Pi event-stream lifecycle (P3) ──────────────────────────────────────
  // Streams live VCSEC push frames over the Pi's WebSocket into the SAME
  // handleVcsecPush the direct-BLE unsolicited path uses (handleVcsecPushRef,
  // via DirectBleTransport's onUnsolicited). Only Pi needs this: direct BLE
  // already delivers unsolicited frames itself, so streaming on top of it
  // would double-feed the same frame through both paths.

  // stopStream tears down the current stream socket (if any) and cancels any
  // pending reconnect timer. Idempotent.
  const stopStream = useCallback(() => {
    if (streamReconnectTimerRef.current) {
      clearTimeout(streamReconnectTimerRef.current);
      streamReconnectTimerRef.current = null;
    }
    if (streamStopRef.current) {
      streamStopRef.current();
      streamStopRef.current = null;
    }
    streamSessionIdRef.current = null;
    setStreaming(false);
  }, []);
  stopStreamRef.current = stopStream;

  // startStreamRef lets scheduleReconnect call the CURRENT startStream
  // without a direct reference — same ref-indirection pattern as
  // handleVcsecPushRef, needed here to avoid a useCallback circular
  // dependency (scheduleReconnect restarts the stream; startStream schedules
  // a reconnect on close).
  const startStreamRef = useRef<(sessionId: string) => void>(() => {});

  // scheduleReconnect retries a dropped stream after a flat backoff, but only
  // if we're still linked + Pi-selected + foregrounded + the Pi still has a
  // live session for this VIN (it may have moved to a different sessionId by
  // the time the timer fires — e.g. a fresh handshake after this one died).
  const scheduleReconnect = useCallback(() => {
    if (streamReconnectTimerRef.current) return; // already scheduled
    streamReconnectTimerRef.current = setTimeout(() => {
      streamReconnectTimerRef.current = null;
      const cfg = cfgRef.current;
      if (!cfg?.vin) return; // unlinked/torn down meanwhile
      if (selectedTransportRef.current !== 'pi') return; // BLE took over
      if (AppState.currentState !== 'active') return; // backgrounded
      const liveId = peekPiSessionId(cfg.vin);
      if (!liveId) return; // no Pi session open right now; the next poll tick restarts it
      startStreamRef.current(liveId);
    }, STREAM_RECONNECT_MS);
  }, []);

  // startStream (re)opens the event-stream socket for `sessionId`, tearing
  // down any previous one first.
  const startStream = useCallback(
    (sessionId: string) => {
      const cfg = cfgRef.current;
      if (!cfg?.baseUrl || !cfg?.token) return;
      stopStream();
      streamSessionIdRef.current = sessionId;
      streamStopRef.current = startPiEventStream({
        baseUrl: cfg.baseUrl,
        token: cfg.token,
        sessionId,
        onFrame: (f) => {
          logi('stream', 'frame', { bytes: f.length });
          handleVcsecPushRef.current(f);
        },
        onStatus: (s) => {
          if (s === 'open') {
            logi('stream', 'open', { sessionId });
            setStreaming(true);
            return;
          }
          // 'closed' — only react if this callback still belongs to the
          // CURRENT stream; a superseded stream's belated close (e.g. we
          // already moved to a new sessionId) must not schedule a reconnect
          // for a session we've already left behind.
          if (streamSessionIdRef.current !== sessionId) return;
          logw('stream', 'closed', { sessionId });
          setStreaming(false);
          streamStopRef.current = null;
          streamSessionIdRef.current = null;
          scheduleReconnect();
        },
      });
    },
    [stopStream, scheduleReconnect],
  );
  startStreamRef.current = startStream;

  // syncStream reconciles the event-stream with the transport the poll tick
  // that just called this actually used. Called only after a SUCCESSFUL poll
  // tick (see the tick below) — never for a demo/unlinked car, since the poll
  // itself never runs for one.
  const syncStream = useCallback(() => {
    const cfg = cfgRef.current;
    if (!cfg?.vin || selectedTransportRef.current !== 'pi') {
      // BLE selected (delivers pushes itself) or nothing to stream against.
      stopStream();
      return;
    }
    const sessionId = peekPiSessionId(cfg.vin);
    if (!sessionId) {
      // No live Pi session cached — shouldn't happen right after a
      // successful Pi poll, but never stream against nothing.
      stopStream();
      return;
    }
    if (sessionId === streamSessionIdRef.current) return; // already streaming this one
    startStream(sessionId);
  }, [stopStream, startStream]);

  // teardown frees the Pi's single session + drops the BLE link and resets the
  // gateway/selector refs so the next dispatch rebuilds a fresh gateway.
  const teardown = useCallback(() => {
    deferredTeardownRef.current = false;
    stopStream();
    closeAllCachedSessions();
    const sel = selectorRef.current;
    selectorRef.current = null;
    gatewayRef.current = null;
    if (sel) sel.closeSession('').catch(() => {});
  }, [stopStream]);

  // teardownWhenIdle is the background path: tearing the transport down under
  // an in-flight command is exactly what killed it (and left the control
  // spinning). If anything is in flight, DEFER — settleInFlight runs it once
  // the last command lands. The gateway's 25s deadline bounds that wait, which
  // fits inside iOS's background grace window.
  const teardownWhenIdle = useCallback(() => {
    if (inFlightRef.current > 0) {
      deferredTeardownRef.current = true;
      return;
    }
    teardown();
  }, [teardown]);

  // settleInFlight retires one command and, if it was the last one a
  // backgrounded teardown was waiting on, runs that teardown now — unless the
  // user came back to the app in the meantime, in which case the session stays
  // up (the poll wants it).
  const settleInFlight = useCallback(() => {
    inFlightRef.current = Math.max(0, inFlightRef.current - 1);
    if (inFlightRef.current > 0 || !deferredTeardownRef.current) return;
    deferredTeardownRef.current = false;
    if (AppState.currentState !== 'active') teardown();
  }, [teardown]);

  // runDispatch is the REAL send. It is never called directly — the coalescer
  // (below) owns when it runs, so that a burst of user input can't put two
  // commands for the same field in flight with racing rollbacks. Resolves when
  // the command has fully settled, which is what lets the coalescer release the
  // lane and fire the burst's final value.
  // The optimistic value is protected from the instant the user acts, not from
  // whenever the command reaches the car — a poll that lands in between must not
  // revert it. Recorded even if the gateway isn't ready: harmless, and it keeps
  // the UI honest until the car catches up.
  const stampIntent = useCallback((keys?: readonly VehicleStateKey[]) => {
    if (!keys || !keys.length) return;
    const expiry = Date.now() + GRACE_MS;
    for (const key of keys) intentRef.current.set(key, expiry);
  }, []);

  const runDispatch = useCallback(
    (cmd: CarCommand, rollback: () => void, affectedKeys?: readonly VehicleStateKey[]): Promise<void> => {
      // Re-stamp the grace window as the command actually goes out, extending it
      // from the send rather than from the (possibly much earlier) user action.
      // The first stamp happens at SUBMIT time — see dispatch — because the
      // optimistic value needs protecting from the moment the user acts, and a
      // coalesced burst can sit queued behind an in-flight command.
      stampIntent(affectedKeys);
      const gw = getGateway();
      // not linked / not ready → no-op (demo cars stay pure-optimistic)
      if (!gw) return Promise.resolve();

      // Mark the affected fields pending only now that we're truly dispatching
      // (past the demo/unlinked guard), so demo cars never show a pending
      // affordance. Cleared on every terminal path below.
      const keys = affectedKeys && affectedKeys.length ? affectedKeys : null;
      const clearPending = () => {
        if (!keys) return;
        setPendingMap((prev) => {
          const next = new Map(prev);
          for (const key of keys) next.delete(key);
          return next;
        });
      };
      if (keys) {
        // startTime is the deadline's anchor: the exposed Set filters this
        // entry out once now >= startTime + OPTIMISTIC_TIMEOUT_MS, whatever
        // happens (or doesn't) to the command.
        const startTime = Date.now();
        setPendingMap((prev) => {
          const next = new Map(prev);
          for (const key of keys) next.set(key, startTime);
          return next;
        });
      }
      // onFailure is the single failure surface for BOTH terminal paths below.
      // On screen: roll back, heavy-haptic, toast. Off screen: a toast nobody
      // would see and a haptic nobody would feel are pointless — post the local
      // notification instead (what the official app does), and still roll back
      // so the UI is honest whenever the user does come back.
      const onFailure = (outcome: Extract<CommandOutcome, { ok: false }>) => {
        rollback();
        // Only a true 'background' means the user can't see us. iOS also emits a
        // transient 'inactive' for the app switcher / control center / a call
        // banner while the app is still on screen — notifying then would fire a
        // banner at someone who is looking right at the app. Same reasoning the
        // poll uses for ignoring transient 'inactive' (see bed492f).
        if (AppState.currentState === 'background') {
          void notifyCommandFailure();
        } else {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
          toastRef.current.show(commandFailureText(commandActionLabel(cmd.type), outcome));
        }
      };

      // Fire-and-forget: the gateway's per-VIN queue serializes commands. We
      // never surface the promise to the caller — a failure rolls the UI back
      // and tells the user (toast or notification); success light-haptics.
      const t0 = Date.now();
      logi('cmd', 'dispatch', { type: cmd.type, keys: affectedKeys, inFlight: inFlightRef.current });
      inFlightRef.current += 1;
      // Hold an iOS background-task assertion for the command's lifetime. iOS
      // suspends the JS runtime shortly after the app is backgrounded, so a
      // command dispatched right before a lock/home press used to freeze
      // mid-flight: it never settled, never failed, and the failure
      // notification only fired when the app was reopened and JS thawed. The
      // assertion buys ~30s — more than our 25s command deadline — so the
      // command settles and notifies while still backgrounded. Best-effort:
      // if the assertion can't be taken we still run the command.
      let bgId: number | null = null;
      try {
        bgId = beginBackgroundTask('carlink-command');
      } catch {
        bgId = null;
      }
      return (async () => {
        try {
          const outcome = await gw.runCommand(cmd);
          logi('cmd', 'settle', { type: cmd.type, ms: Date.now() - t0, outcome: outcome.ok ? 'ok' : outcome.kind });
          if (outcome.ok) {
            // Light confirmation — matches the app's impact/selection-only
            // haptic vocabulary (no notification feedback).
            if (AppState.currentState !== 'background') Haptics.selectionAsync().catch(() => {});
          } else {
            onFailure(outcome);
            console.warn('[useCarLink] command failed', cmd.type, outcome);
          }
        } catch (err) {
          // A throw (unexpected — runCommand normally returns an outcome) has no
          // structured outcome; surface it as an unreachable-style failure.
          onFailure({ ok: false, kind: 'unreachable', message: String(err) });
          loge('cmd', 'threw', { type: cmd.type, ms: Date.now() - t0, err: String(err) });
        } finally {
          // EVERY terminal path — ok, fail, throw, deadline — lands here, so a
          // control can never be left spinning forever (the stuck-spinner bug:
          // a backgrounded command used to have its transport torn out from
          // under it and never settle).
          clearPending();
          settleInFlight();
          if (bgId != null) {
            try {
              endBackgroundTask(bgId);
            } catch {
              // Releasing is best-effort too — never let it mask a terminal path.
            }
          }
        }
      })();
    },
    [getGateway, settleInFlight, stampIntent],
  );

  // ── C2: rapid-input coalescing ──────────────────────────────────────────
  // One command in flight per FIELD; a burst keeps only its latest value and
  // neutralises the superseded rollbacks. A single tap is unaffected — it goes
  // straight through, no debounce. See ble/coalesce.ts for the reasoning.
  //
  // Built once and kept in a ref: a per-render coalescer would forget which
  // lanes are busy and defeat the whole point. runDispatch is read through a ref
  // for the same reason — its identity changes when getGateway does, and the
  // coalescer must not be rebuilt mid-burst.
  const runDispatchRef = useRef(runDispatch);
  runDispatchRef.current = runDispatch;
  const coalescerRef = useRef<Coalescer<CarCommand> | null>(null);
  if (!coalescerRef.current) {
    coalescerRef.current = createCoalescer<CarCommand>((cmd, rollback, keys) =>
      runDispatchRef.current(cmd, rollback, keys as readonly VehicleStateKey[]),
    );
  }

  const dispatch = useCallback(
    (cmd: CarCommand, rollback: () => void, affectedKeys?: VehicleStateKey[]) => {
      // Stamp on USER ACTION, before the coalescer decides when (or whether)
      // this one reaches the car.
      stampIntent(affectedKeys);
      coalescerRef.current?.submit({ cmd, rollback, keys: affectedKeys ?? [] });
    },
    [stampIntent],
  );

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      // Returning to the foreground cancels a teardown that was waiting on an
      // in-flight command — we're staying connected. It also re-checks the
      // pending expiry: while iOS had us suspended no timer fired, so a spinner
      // could be stranded well past its 30s cap — pruning here clears it the
      // instant the user is looking at the screen again.
      if (next === 'active') {
        deferredTeardownRef.current = false;
        prunePending();
      } else if (next === 'background') {
        // Backgrounding CANCELS a user-requested wake, exactly as the official
        // app's `cancelAllDataRequests()` does on APP_BACKGROUND (findings §3).
        // Without this the spinner survives the round trip: iOS suspends JS
        // mid-refresh, so the wake's promise never settles and its `finally`
        // never runs — you come back to a still-spinning header. The session is
        // being torn down here anyway, so the in-flight read is already doomed.
        setWakeInFlight(false);
        teardownWhenIdle();
      }
    });
    return () => {
      sub.remove();
      // Unmount is unconditional: the tree is going away, so a deferred
      // teardown would never run and the Pi's single session would be orphaned
      // for ~5 min.
      teardown();
    };
  }, [teardown, teardownWhenIdle, prunePending]);

  // Persist the infotainment-derived fields so a cold start can paint the real
  // battery/range immediately (their cached vehicle_data slice — findings §B),
  // instead of falling back to the mock.
  const cacheInfotainment = useCallback((patch: Partial<VehicleViewState>) => {
    const base = cacheRef.current;
    if (!base) return; // no timestamp yet; the awake stamp below seeds it
    const next: CarLinkCache = {
      ...base,
      batteryLevel: patch.batteryLevel ?? base.batteryLevel,
      rangeMiles: patch.rangeMiles ?? base.rangeMiles,
      charging: patch.charging ?? base.charging,
      interiorTempC: patch.interiorTempC ?? base.interiorTempC,
      exteriorTempC: patch.exteriorTempC ?? base.exteriorTempC,
      targetTempC: patch.targetTempC ?? base.targetTempC,
      chargeLimitPercent: patch.chargeLimitPercent ?? base.chargeLimitPercent,
      chargingAmps: patch.chargingAmps ?? base.chargingAmps,
    };
    cacheRef.current = next;
    saveCacheRef.current?.(next);
  }, []);

  // stampRead records a successful contact with the car.
  //
  // lastVehicleDataAt is our analogue of their vehicle_data timestamp, and it
  // must NOT advance while the car sleeps — VCSEC answers when asleep, so
  // stamping unconditionally would pin the status to a live "Parked" forever
  // and "Asleep {age}" could never appear. But only a KNOWN-asleep read may
  // block the stamp: `awake` is absent from the patch whenever the car reports
  // sleepStatus 'unknown' (a proto enum defaulting to 0), and treating that as
  // "no vehicle data" made the age grow forever while reads were succeeding —
  // the "Last seen 3 minutes ago while parked next to the car" bug.
  const stampRead = useCallback((patch: Partial<VehicleViewState>, at: number) => {
    setLastUpdatedAt(at);
    if (patch.awake === false) {
      // Reachable but asleep: keep the age growing, only record the state.
      if (cacheRef.current) {
        const next: CarLinkCache = { ...cacheRef.current, awake: false };
        cacheRef.current = next;
        saveCacheRef.current?.(next);
      }
      return;
    }
    setLastVehicleDataAt(at);
    const next: CarLinkCache = {
      ...(cacheRef.current ?? {
        batteryLevel: null,
        rangeMiles: null,
        charging: null,
        awake: null,
        interiorTempC: null,
        exteriorTempC: null,
        targetTempC: null,
        chargeLimitPercent: null,
        chargingAmps: null,
      }),
      lastVehicleDataAt: at,
      awake: true,
    };
    cacheRef.current = next;
    saveCacheRef.current?.(next);
  }, []);

  // Apply an UNSOLICITED VCSEC push (car-initiated VehicleStatus on a closure /
  // lock / presence change) the INSTANT it arrives on a held-open BLE link —
  // instead of waiting up to POLL_MS. Same apply path as the poll's VCSEC read
  // (vcsecStatusToPatch → intent filter → applyTelemetry, which itself gates on
  // the active-live car), minus the infotainment/connection/stamp bits: a push
  // is a VCSEC delta, not a full tick, and the poll remains the backstop that
  // owns the freshness timestamp. Non-VCSEC / encrypted / solicited frames are
  // filtered out by the decoder (returns null). Only DirectBleTransport ever
  // calls this — Pi is request/response, so instant-over-Pi needs streaming.
  const handleVcsecPush = useCallback((frame: Uint8Array) => {
    const status = decodeUnsolicitedVcsecStatus(frame);
    if (!status) return;
    const now = Date.now();
    const { patch } = vcsecStatusToPatch(status, {}, now);
    const filtered = filterPatchUnderIntent(patch, intentRef.current, now, getActiveStateRef.current());
    if (Object.keys(filtered).length === 0) return;
    applyTelemetryRef.current(filtered);
    logi('push', 'vcsec', { locked: patch.locked, closures: status.closures });
  }, []);
  handleVcsecPushRef.current = handleVcsecPush;

  // refresh: the real pull-to-refresh. Wakes the car, then re-reads it — the
  // spinner runs for the whole round trip. Replaces a demo stub that only set
  // `awake: true` on a 1.4s timer and never contacted the car, which is why the
  // age never moved (and why an asleep car misreported as "Last seen …").
  const refresh = useCallback(() => {
    const gw = getGateway();
    if (!gw) return; // demo/unlinked, or keys still loading
    setWakeInFlight(true);
    void (async () => {
      try {
        // Tolerate a failed/timed-out wake: the read below is what refreshes
        // the UI, and an already-awake car makes this a no-op anyway. The
        // gateway's own deadline bounds this, so the spinner can't hang.
        await gw.wake().catch(() => {});
        // A user-initiated refresh must actually refresh — bypass the
        // infotainment throttle so charge/range update NOW, not on the next
        // 60s window, AND force the infotainment (battery/range) read even if
        // the car is still mid-wake, like the Tesla app's pull-to-refresh.
        //
        // RETRY: the domain-3 (charge/battery) read intermittently times out on
        // a cold open (~30% observed), so a single attempt often leaves the
        // battery empty. Retry a few times until it lands — the tick stamps
        // lastInfotainmentAtRef only on SUCCESS, so a non-zero value after the
        // tick means the read succeeded. Bounded so the spinner can't hang.
        for (let attempt = 0; attempt < 3; attempt++) {
          lastInfotainmentAtRef.current = 0;
          await tickRef.current?.({ forceInfotainment: true });
          if (lastInfotainmentAtRef.current !== 0) break; // infotainment landed
          if (attempt < 2) await new Promise((r) => setTimeout(r, 600));
        }
      } finally {
        setWakeInFlight(false);
      }
    })();
  }, [getGateway]);

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

    const tick = async (opts?: { forceInfotainment?: boolean }) => {
      if (stopped || paused || inFlight) return;
      // ⚠️ Interactive commands own the BLE link; the background poll yields.
      // Everything for the live car runs through ONE per-VIN FIFO, so a poll
      // that's mid-flight blocks a user's Lock behind it. Cheap to skip a 20s
      // liveness tick; expensive to make someone wait 8s for a lock because a
      // background read got there first. A tick lands as soon as the command
      // settles (inFlightRef hits 0).
      if (inFlightRef.current > 0) {
        logd('poll', 'skip: command in flight', { inFlight: inFlightRef.current });
        return;
      }
      const gw = getGateway();
      if (!gw) {
        // Linked but the gateway isn't ready yet (config/keys still loading).
        // Leave connection as-is; the next tick retries once it's built.
        return;
      }
      inFlight = true;
      try {
        const vt0 = Date.now();
        const st = await gw.readVcsecStatus();
        logi('poll', 'vcsec', { ms: Date.now() - vt0, txp: selectedTransportRef.current });
        // Empty closureIntent — the grace is applied uniformly HERE, keyed by
        // VehicleStateKey, so telemetry.ts's closure-only keying is bypassed.
        const { patch } = vcsecStatusToPatch(st, {}, Date.now());
        const filtered = filterPatchUnderIntent(patch, intentRef.current, Date.now(), getActiveStateRef.current());
        if (stopped || paused) return; // backgrounded/unlinked while awaiting
        // READ SNAPSHOT (diagnostic): what the car reported (st.closures), what the
        // mapper produced (trunkRaw/frunkRaw), and what survived the intent filter
        // (…Applied). Triangulates a wrong closure to: bad sensor value vs mapping
        // bug vs a stale optimistic intent masking the real read.
        logi('read', 'vcsec', {
          awake: patch.awake,
          locked: patch.locked,
          closures: st.closures,
          trunkRaw: patch.trunkOpen,
          trunkApplied: filtered.trunkOpen,
          frunkRaw: patch.frunkOpen,
        });
        if (Object.keys(filtered).length) applyTelemetryRef.current(filtered);
        stampRead(patch, Date.now());
        setConnection('online');

        // ── INFOTAINMENT read (charge / climate / drive / location) ─────────
        // VCSEC gives us lock/awake/closures and nothing else — no state of
        // charge, no range. Without this the battery % stayed on its MOCK 48 and
        // `rangeMiles` was permanently null, so tapping the battery rendered a
        // blank label (correctly, per findings §2b — there was genuinely no
        // range to show).
        //
        // Gated on AWAKE: awakeSync explicitly does not wake the car, and its
        // reads simply fault on a sleeping one. Best-effort — a failure here
        // must not knock the connection offline, because the VCSEC read above
        // already succeeded and is what 'online' means.
        // Throttled to INFOTAINMENT_MS, NOT every VCSEC tick. This read is the
        // heavy one — domain 3, needs the car awake, and its session evicts the
        // moment the car dozes, so an every-20s cold re-open was blocking user
        // commands in the shared FIFO for ~8s each (the "every command took
        // 8-10s until it suddenly went fast" report — the "fast" was the car
        // finally staying awake so domain 3 cached). Charge/range move slowly;
        // 60s is plenty, and it's skipped entirely while a command is in flight
        // or one landed in the last INFOTAINMENT_MS. The VCSEC half above keeps
        // Home live every tick regardless.
        // A user-initiated refresh (opts.forceInfotainment) requests charge/range
        // even if this tick's VCSEC read hasn't flipped awake yet — the car may be
        // mid-wake right after refresh's gw.wake(). awakeSync faults harmlessly on
        // a still-asleep car (caught below), matching the Tesla app, which fetches
        // vehicle_data on pull-to-refresh. The automatic poll keeps the awake gate.
        const now = Date.now();
        if (
          (patch.awake === true || opts?.forceInfotainment === true) &&
          inFlightRef.current === 0 &&
          now - lastInfotainmentAtRef.current >= INFOTAINMENT_MS
        ) {
          try {
            const it0 = Date.now();
            const snap = await gw.awakeSync();
            logi('poll', 'infotainment', { ms: Date.now() - it0 });
            if (stopped || paused) return;
            lastInfotainmentAtRef.current = Date.now();
            const infoPatch = filterPatchUnderIntent(
              infotainmentToPatch(snap),
              intentRef.current,
              Date.now(),
              getActiveStateRef.current(),
            );
            if (Object.keys(infoPatch).length) {
              applyTelemetryRef.current(infoPatch);
              cacheInfotainment(infoPatch);
            }
          } catch (e) {
            // Asleep mid-read, or the infotainment session faulted. The VCSEC
            // half stands; retry after the throttle window (don't hammer a cold
            // domain-3 open every tick — that WAS the bug).
            logw('poll', 'infotainment failed', { err: String(e) });
            lastInfotainmentAtRef.current = Date.now();
          }
        }
        if (selectedTransportRef.current) setTransport(selectedTransportRef.current);
        // Reconcile the event-stream with whichever transport this successful
        // tick actually used — starts/rotates it for Pi, stops it for BLE
        // (direct BLE delivers unsolicited pushes itself; see the header).
        syncStream();
      } catch (e) {
        // A failed read means no clean contact this tick — drop to offline
        // (do NOT keep a stale 'online'). The loop keeps retrying every POLL_MS.
        logw('poll', 'vcsec failed → offline', { err: String(e) });
        if (!stopped && !paused) setConnection('offline');
      } finally {
        inFlight = false;
      }
    };

    tickRef.current = tick;

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
      // Defensive: only `teardown()` (unmount/background) owns the stream
      // today, but a future `linked` false transition runs THIS cleanup
      // without necessarily going through teardown — stop the stream (and
      // any pending reconnect timer) here too so one can't be left running.
      // No-op-safe: stopStream() is idempotent.
      stopStream();
    };
  }, [linked, getGateway, stopStream]);

  return useMemo<CarLink>(
    () => ({
      linked,
      vin,
      connection,
      transport,
      streaming,
      lastUpdatedAt,
      lastVehicleDataAt,
      wakeInFlight,
      pending,
      dispatch,
      refresh,
    }),
    [linked, vin, connection, transport, streaming, lastUpdatedAt, lastVehicleDataAt, wakeInFlight, pending, dispatch, refresh],
  );
}
