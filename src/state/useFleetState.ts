import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { CarCommand } from '../ble/commands';
import type { CarModel, VehicleStateKey, VehicleViewState } from '../types/vehicleTypes';
import { initialVehicleState } from '../types/vehicleTypes';
import {
  bindVehicleVin,
  activeIndex,
  activeVehicle,
  addVehicle,
  createInitialFleet,
  nextVehicleId,
  prevVehicleId,
  removeVehicle,
  setActiveVehicle,
  updateActiveVehicleState,
  updateEnrolledVehicleState,
  type FleetState,
  type Vehicle,
  actuateFrunkState,
  frunkActuateClaimedKeys,
} from './fleet';
import { buildVehicleActions, type VehicleActions } from './useVehicleState';
import { useCarLink, type CarLinkStatus } from './useCarLink';
import { diffToCommands, revertFields } from '../ble/reconcile';
import { securityChanged, securityFromState } from './securityStore';
import {
  chargeScheduleToInput,
  preconditionScheduleToInput,
  type AnySchedule,
  type ScheduleKind,
} from './schedules';

export interface Fleet {
  vehicles: Vehicle[];
  activeId: string;
  activeIndex: number;
  activeName: string;
  addVehicle: (
    model: CarModel,
    opts?: {
      name?: string;
      exteriorColor?: string;
      wheelType?: string;
      interiorTrim?: string;
      performance?: boolean;
    },
  ) => void;
  removeVehicle: (id: string) => void;
  setActiveVehicle: (id: string) => void;
  nextVehicle: () => void;
  prevVehicle: () => void;
  // ONE-SHOT car actions — those with no local-state counterpart, so the
  // state-diff reconciler above can never infer them. Navigation is the first:
  // "Send to Car" is an event, not a toggle. No-op for a demo (non-live) car.
  sendNavigation: (lat: number, lon: number, label?: string) => void;
  // Media transport. Same one-shot shape as sendNavigation and for the same
  // reason: play/pause/next/prev have no local-state counterpart the diff
  // reconciler could infer. The car owns the truth; we ask and re-read.
  sendMedia: (action: 'toggle' | 'next' | 'prev' | 'volumeUp' | 'volumeDown') => void;
  // Day-aware charge/precondition schedules. Same one-shot shape as the two
  // above and for the same reason: a schedule LIST has no scalar-state
  // counterpart the diff reconciler could infer. The local store stays the
  // source of truth; these push the change to the car. No-op for a demo car,
  // and for a save with no known car coordinates (the modern schedules are
  // location-keyed — see chargeScheduleToInput).
  sendSchedule: (s: AnySchedule, coord: { latitude: number; longitude: number } | null) => void;
  removeScheduleFromCar: (kind: ScheduleKind, carId: number) => void;
  // Reads the car's stored schedules and logs them raw (write-path verification).
  readSchedules: () => Promise<import('./useCarLink').ScheduleReadback>;
  // Reads closures + parental state into the active car so the Security & Drivers
  // page reflects the car. Resolves false on a demo/unlinked/sleeping car.
  readSecurity: () => Promise<boolean>;
}

export function useFleetState(): {
  active: [VehicleViewState, VehicleActions];
  activeId: string;
  fleet: Fleet;
  carLinkStatus: CarLinkStatus;
} {
  const [fleet, setFleet] = useState<FleetState>(createInitialFleet);

  // The plain apply for the OPTIMISTIC state commit + telemetry path. USER
  // actions go through applyActiveUser (below), which additionally reconciles
  // the prev→next diff into real car commands. Telemetry uses this plain apply
  // so it never loops back into a command.
  const applyActive = useCallback(
    (update: (state: VehicleViewState) => VehicleViewState) =>
      setFleet((current) => updateActiveVehicleState(current, update)),
    [],
  );

  // applyTelemetry is the PLAIN write path handed to the poll: merge the
  // (already intent-filtered) patch into the active car.
  //
  // ⚠️ Gated on the ACTIVE car being the LIVE one, not merely on a car being
  // enrolled. The old guard's comment said "for v1's single real car the active
  // car IS the live car" — true when written, FALSE since the fleet gained
  // addVehicle: swipe to a demo car and the real car's telemetry would overwrite
  // the demo car's state. The ref breaks the chicken-and-egg (useCarLink needs
  // applyTelemetry; the guard needs the result) and is read only inside the
  // async poll, well after it's populated.
  const activeIsLiveRef = useRef(false);
  // Whether the live car is actually REACHABLE right now (a read has recently
  // succeeded), read as a ref so the command callbacks stay stable. Optimism is
  // gated on this: we only pretend a command worked when the car can plausibly
  // act on it. An enrolled-but-offline car ("last seen a day ago") still gets the
  // command dispatched (it can wake a nearby asleep car), but NOT the optimistic
  // flip — the spinner shows it's trying and the control updates only on confirm.
  const reachableRef = useRef(false);
  // An optimistic play/pause, and how long it wins for. ONE FIELD, not the whole
  // `media` key — the earlier attempt stamped `media` with the 30s intent grace
  // and froze the entire card (title included) for half a minute.
  //
  // Needed because the read that follows a transport command can still report
  // the OLD status: the car takes a moment to act, so a read landing inside that
  // window flips the glyph back and the next one flips it again. Ivan: "pressing
  // pause/play is finicky". 4s covers a ~3.75s rotation plus the command's own
  // round trip; after that the car is authoritative, whatever it says.
  const pendingPlayback = useRef<{ status: number; until: number } | null>(null);
  // The live car's CONFIRMED state — a snapshot fed ONLY by the telemetry paths
  // (this + hydrateTelemetry), never by optimistic taps. It is the rollback
  // baseline: on a failed command we revert the affected keys to what the CAR
  // last told us, not to the render-time optimistic value. Without this, toggling
  // one control twice (climate on→off) made the second command capture the first
  // command's UNCONFIRMED optimistic value as its baseline, so its failure
  // "reverted" to a bright state and the control stuck on. (The full fix is
  // layering optimistic-over-confirmed everywhere — the roadmap P0 — but the
  // rollback target is the only place that bug actually bites.)
  //
  // It carries the same intent-filtered patch applyTelemetry applies, so a value
  // being optimistically contested (under intent grace) does NOT overwrite the
  // confirmed baseline until the car agrees or the grace lapses — exactly what we
  // want to roll back to.
  const confirmedStateRef = useRef<VehicleViewState>(initialVehicleState);
  const applyTelemetry = useCallback(
    (patch: Partial<VehicleViewState>) => {
      if (!activeIsLiveRef.current) return;
      confirmedStateRef.current = { ...confirmedStateRef.current, ...patch };
      const pending = pendingPlayback.current;
      let next = patch;
      if (pending && patch.media) {
        if (Date.now() >= pending.until) {
          pendingPlayback.current = null;
        } else if (patch.media.playbackStatus !== pending.status) {
          // Everything else in the patch (title, artist, elapsed) applies
          // normally — only the contested field is held.
          next = { ...patch, media: { ...patch.media, playbackStatus: pending.status } };
        }
      }
      applyActive((s) => ({ ...s, ...next }));
    },
    [applyActive],
  );
  // hydrateTelemetry is the LAUNCH-TIME rehydrate path (distinct from the live
  // applyTelemetry above). It seeds the ENROLLED car with its own persisted
  // last-known telemetry, UNGATED: at cold start the live gate is still false
  // (linked/vin haven't propagated, the VIN isn't bound to veh_1 yet), so
  // routing the cached patch through applyTelemetry silently dropped it — the
  // "cache doesn't work, battery stays empty until the car connects" bug. This
  // targets vehicles[0] (the real car) directly, so the value paints instantly
  // and dimmed; the first live tick then overwrites it with fresh data.
  const hydrateTelemetry = useCallback((patch: Partial<VehicleViewState>) => {
    // Cold-start cached telemetry is confirmed truth too — seed the baseline so a
    // command that fails before the first live poll still rolls back to the car's
    // last-known value rather than an optimistic one.
    confirmedStateRef.current = { ...confirmedStateRef.current, ...patch };
    setFleet((f) => updateEnrolledVehicleState(f, (s) => ({ ...s, ...patch })));
  }, []);
  // Latest active-car state, tracked in a ref so useCarLink's stable poll/push
  // closures can read the freshest snapshot at telemetry time (for the intent
  // grace's confirm-and-release). Assigned just below, once `current` exists.
  const activeStateRef = useRef<VehicleViewState>(initialVehicleState);
  const carLink = useCarLink({
    applyTelemetry,
    hydrateTelemetry,
    getActiveState: () => activeStateRef.current,
  });

  const current = activeVehicle(fleet);
  activeStateRef.current = current.state;

  // ── P3.T1: which vehicle IS the enrolled car? ────────────────────────────
  // Bind the enrolled VIN to the fleet's FIRST vehicle. That is the app's
  // existing assumption made explicit (the original 'veh_1' is the real car;
  // everything from addVehicle is a demo), and it's the seam the real
  // enrollment flow replaces once the user picks their car after Pi setup.
  useEffect(() => {
    const vin = carLink.vin;
    const first = fleet.vehicles[0];
    if (!vin || !first || first.vin === vin) return;
    setFleet((f) => (f.vehicles[0] ? bindVehicleVin(f, f.vehicles[0].id, vin) : f));
  }, [carLink.vin, fleet.vehicles]);

  // THE narrowing. `carLink.linked` only means "a car is enrolled"; a command is
  // only ever legitimate when the car ON SCREEN is that car. Without this,
  // tapping Lock on a demo Model S sent a real lock to the real Tesla.
  const activeIsLive = carLink.linked && !!carLink.vin && current.vin === carLink.vin;
  activeIsLiveRef.current = activeIsLive;
  reachableRef.current = carLink.connection === 'online';

  // dispatchToCar — the ONE door to the enrolled car. Every command MUST go
  // through here so the demo-car gate can never be forgotten: that is exactly how
  // "Open frunk"/honk/flash on a DEMO car reached the real Tesla (actuateFrunk,
  // unlockChargePort and fireCommand each called carLink.dispatch directly,
  // skipping the activeIsLive narrowing that Lock got via applyActiveUser). Reads
  // the ref so the gate is evaluated at call time and the callback stays stable.
  // Enforced by fleet.test.ts: the raw carLink dispatch call may appear ONLY here.
  const dispatchToCar = useCallback(
    (cmd: CarCommand, onFail: () => void = () => {}, keys: VehicleStateKey[] = []) => {
      if (!activeIsLiveRef.current) return;
      carLink.dispatch(cmd, onFail, keys);
    },
    [carLink],
  );

  // applyActiveUser wraps applyActive for USER-initiated mutations only: it
  // computes prev→next and, for a linked (live) car, dispatches the reconciled
  // command(s) with a field-scoped rollback, THEN commits the optimistic
  // update. Demo/unlinked cars skip the dispatch and stay pure-optimistic.
  //
  // `prev` is captured by closing over the current render's active state
  // (current.state) — NOT by computing the diff inside setFleet's updater.
  // That is deliberate: an updater runs on every setState (and could run
  // twice under StrictMode), so dispatching a command from inside it would
  // double-fire and could fire during a telemetry-driven commit. Event
  // handlers always invoke the latest render's closure, so `prev` here is the
  // most recently committed active state. current.state is in the dep list so
  // the wrapper (and `actions`) always see the freshest snapshot.
  const applyActiveUser = useCallback(
    (update: (state: VehicleViewState) => VehicleViewState) => {
      const prev = current.state;
      const next = update(prev);
      // Persist the enrolled car's PIN state (PIN-to-Drive + the four codes) to the Keychain the moment it
      // changes, so it survives a restart. Only for the live car — a demo car's PINs are ephemeral and would
      // otherwise be keyed to the enrolled VIN. The car never reports these over BLE, so this is the sole path
      // by which they persist (see securityStore).
      if (activeIsLive && securityChanged(securityFromState(prev), securityFromState(next))) {
        carLink.persistSecurity(securityFromState(next));
      }
      // Each command carries the fields IT owns. dispatch gets those keys, so:
      // the coalescer lanes per field, the grace window covers exactly them,
      // and a failure reverts only that command's fields (not every edit made
      // in the same tick — see revertFields).
      const cmds = activeIsLive ? diffToCommands(prev, next) : [];
      for (const { cmd, keys } of cmds) {
        // Roll back to the CONFIRMED baseline (what the car last told us), read
        // at failure time — NOT `prev` (the render-time optimistic snapshot),
        // which can itself be an unconfirmed value from a prior tap. See
        // confirmedStateRef.
        dispatchToCar(cmd, () => applyActive((s) => revertFields(s, confirmedStateRef.current, keys)), keys);
      }
      // The optimism gate applies ONLY to fields backed by a car command. UI-only
      // changes (cameraMode → which panel/screen shows, tire-pressure toggle, etc.)
      // must ALWAYS apply — gating them blanket-broke navigation on an offline car
      // (the Controls/Climate menu rows are setCameraMode, routed through here).
      // When the live car is UNREACHABLE we still dispatch above (it may wake a
      // nearby asleep car) but don't optimistically FLIP the command fields — apply
      // the update with those fields pinned to their pre-tap value; the spinner
      // shows they're being attempted, and they update on confirm.
      if (activeIsLive && !reachableRef.current) {
        // Pin only BOOLEAN command fields — a toggle flipping to "on" offline
        // falsely reads as success. A SETPOINT the user is dialing in (targetTempC,
        // chargeLimitPercent, chargingAmps, speedLimitMph…) is their chosen value,
        // not a success flag, so it must still move; it syncs to the car when
        // reachable. So gate booleans, let numbers/enums through.
        const commandKeys = cmds.flatMap((c) => c.keys).filter((k) => typeof prev[k] === 'boolean');
        applyActive((s) => revertFields(update(s), prev, commandKeys));
      } else {
        applyActive(update);
      }
    },
    [dispatchToCar, applyActive, current.state, activeIsLive, carLink.persistSecurity],
  );

  // Frunk actuate. Lives here rather than in buildVehicleActions because it is
  // the one control that needs BOTH a command and a state change, and they are
  // deliberately not in step:
  //
  //   • the command fires on EVERY tap — the car's actuator is a toggle and an
  //     aftermarket auto-close rides the same openFrunk, so the second tap has
  //     to reach the car;
  //   • the optimistic value only ever moves to OPEN (actuateFrunkState), so we
  //     never hold a CLOSED the car has not confirmed. That is the double-tap
  //     fix, recovered from their sendFrunkCommand.
  //
  // Dispatched explicitly, so reconcile.ts deliberately has no frunk diff rule —
  // a diff rule would send nothing on the second tap, which is the exact tap
  // that matters.
  const actuateFrunk = useCallback(() => {
    // Claim ONLY what we actually assert. affectedKeys stamps the intent-grace
    // window as well as the busy flag, and on a re-actuate we assert nothing —
    // claiming there would suppress the very "closed" read we are waiting for.
    // See frunkActuateClaimedKeys. dispatchToCar gates on the live car; the
    // optimistic OPEN below still applies so a DEMO car's frunk animates locally.
    //
    // On FAILURE, revert frunkOpen to the CONFIRMED baseline (what the car last
    // reported) so a failed actuate doesn't leave the frunk looking open (bright)
    // — the spinner covers the icon until then, so the user sees spinner → dim,
    // never a false success. The double-tap design is untouched: on SUCCESS the
    // optimistic OPEN stands, and both taps still reach the car.
    dispatchToCar(
      { type: 'openFrunk' },
      () => applyActive((s) => revertFields(s, confirmedStateRef.current, ['frunkOpen'])),
      frunkActuateClaimedKeys(current.state),
    );
    if (!activeIsLiveRef.current) {
      // DEMO car: there's no car read to ever bring the frunk back to CLOSED, so
      // actuateFrunkState (which only moves to OPEN) would leave it stuck open.
      // A demo is a pure visual mock, so just TOGGLE it locally.
      applyActive((s) => ({ ...s, frunkOpen: !s.frunkOpen }));
    } else if (reachableRef.current) {
      // Live + reachable: optimistic OPEN only; the car's read confirms the close
      // (the double-tap fix — never hold a CLOSED the car hasn't confirmed).
      applyActive(actuateFrunkState);
    }
    // Live + offline: no optimistic flip — the spinner shows it's being attempted.
  }, [dispatchToCar, applyActive, current.state]);

  // Unlatch the charge port so a seated cable can be removed. The port is already
  // "open" (cable in), so a chargePortOpen patch would diff to nothing and never
  // reach the car — dispatch openChargePort EXPLICITLY. No optimistic change and
  // no claimed keys (we assert nothing that a read could contradict). Frunk lesson.
  const unlockChargePort = useCallback(() => {
    dispatchToCar({ type: 'openChargePort' });
  }, [dispatchToCar]);

  // Fire-and-forget momentary commands (honk, flash, remote start, HomeLink, boombox) — no persistent
  // state to diff, so like the frunk they dispatch directly rather than through the reconciler.
  // A one-shot with an optimistic side effect (e.g. unlatch's driverFrontDoorOpen)
  // passes `optimistic` (a state updater) + `rollback`. The optimistic update is
  // gated on reachability exactly like applyActiveUser — but it MUST live here, not
  // in a bare a.patch(), because these fields have no reconciler command, so
  // applyActiveUser's gate can't see them and would let the door "open" offline.
  // Demo car → apply (visual mock); reachable live car → apply; offline → skip
  // (the spinner shows it's attempting; the door opens only once the car confirms).
  // Pure momentary commands (honk/flash) pass neither.
  const fireCommand = useCallback(
    (cmd: CarCommand, opts?: { optimistic?: (s: VehicleViewState) => VehicleViewState; rollback?: () => void }) => {
      if (opts?.optimistic && (!activeIsLiveRef.current || reachableRef.current)) {
        applyActive(opts.optimistic);
      }
      dispatchToCar(cmd, opts?.rollback);
    },
    [dispatchToCar, applyActive],
  );

  const actions = useMemo(
    () => ({ ...buildVehicleActions(applyActiveUser), actuateFrunk, unlockChargePort, fireCommand }),
    [applyActiveUser, actuateFrunk, unlockChargePort, fireCommand],
  );

  // One-shot commands bypass the state diff (nothing optimistic to mirror), but
  // still go through dispatchToCar so they share the live-car gate, the queue, the
  // grace window and the failure toast with every other command.
  const sendNavigation = useCallback(
    (lat: number, lon: number, label?: string) => {
      dispatchToCar({ type: 'navigateTo', lat, lon, label });
    },
    [dispatchToCar],
  );

  const sendSchedule = useCallback(
    (s: AnySchedule, coord: { latitude: number; longitude: number } | null) => {
      // The modern schedules are location-keyed; with no known car position we
      // can't build a faithful one, so we skip the push rather than send (0,0).
      // The local store still saved it — the car just doesn't get it until we
      // have a fix. (RESPONSE-15 open-Q5: user-supplied coords may be rejected;
      // verify against the car's schedule readback.)
      if (!coord) return;
      const cmd =
        s.kind === 'charging'
          ? ({ type: 'addChargeSchedule', sched: chargeScheduleToInput(s, coord) } as const)
          : ({ type: 'addPreconditionSchedule', sched: preconditionScheduleToInput(s, coord) } as const);
      dispatchToCar(cmd);
    },
    [dispatchToCar],
  );

  const removeScheduleFromCar = useCallback(
    (kind: ScheduleKind, carId: number) => {
      dispatchToCar(
        kind === 'charging'
          ? { type: 'removeChargeSchedule', id: carId }
          : { type: 'removePreconditionSchedule', id: carId },
      );
    },
    [dispatchToCar],
  );

  const sendMedia = useCallback(
    (action: 'toggle' | 'next' | 'prev' | 'volumeUp' | 'volumeDown') => {
      if (!activeIsLive) return;
      // `toggle` is the ONE media action with a local counterpart, so it is the
      // one that gets the optimistic mirror + rollback every other toggle in
      // this app uses. next/prev/volume have nothing to mirror — the car's
      // answer is the only truth — so they stay bare one-shots.
      //
      // Why this is needed at all: the official app derives the glyph straight
      // from MediaPlaybackStatus with NO optimistic update, and gets away with
      // it because their status arrives on a continuous Hermes stream. Ours
      // arrives on the 60s sync, so copying them verbatim leaves the button
      // showing the wrong glyph for up to a minute. Same derivation, but we
      // have to close the gap ourselves.
      const prev = current.state.media;
      const playing = prev?.playbackStatus === 1;
      const paused = prev?.playbackStatus === 2;
      if (action === 'toggle' && prev && (playing || paused)) {
        const optimistic = playing ? 2 : 1;
        const restore = prev.playbackStatus;
        applyActive((s) => (s.media ? { ...s, media: { ...s.media, playbackStatus: optimistic } } : s));
        pendingPlayback.current = { status: optimistic, until: Date.now() + 4000 };
        // ⚠️ NO affected keys, deliberately — and this is a FIX, not an omission.
        //
        // Passing ['media'] stamped the key with the 30s intent grace, and
        // `media` is ONE key holding title, artist, album and playbackStatus
        // together. So a single play/pause tap suppressed the WHOLE card's
        // telemetry for 30 seconds: press pause then next, and the title could
        // not change until the window expired. Ivan hit exactly that — "stuck
        // 20+ seconds". It is the frunk grace defect, which I filed this morning
        // and then built into media the same afternoon.
        //
        // The grace exists to stop a stale read reverting a fresh user change.
        // Media does not need it: the rotation re-reads media every ~3.75s, so
        // the optimistic glyph is corrected almost immediately — and if the car
        // REFUSED the command, being corrected is the right outcome, not
        // something to suppress for half a minute.
        dispatchToCar({ type: 'media', action }, () => {
          // The command failed: drop the hold immediately so the car's next read
          // is believed rather than suppressed for the rest of the window.
          pendingPlayback.current = null;
          applyActive((s) => (s.media ? { ...s, media: { ...s.media, playbackStatus: restore } } : s));
        });
        return;
      }
      dispatchToCar({ type: 'media', action });
    },
    [activeIsLive, dispatchToCar, applyActive, current.state],
  );

  const fleetApi = useMemo<Fleet>(
    () => ({
      sendNavigation,
      sendMedia,
      sendSchedule,
      removeScheduleFromCar,
      readSchedules: carLink.readSchedules,
      readSecurity: carLink.readSecurity,
      vehicles: fleet.vehicles,
      activeId: fleet.activeId,
      activeIndex: activeIndex(fleet),
      activeName: current.name,
      addVehicle: (model, opts) => setFleet((f) => addVehicle(f, model, opts)),
      removeVehicle: (id) => setFleet((f) => removeVehicle(f, id)),
      setActiveVehicle: (id) => setFleet((f) => setActiveVehicle(f, id)),
      nextVehicle: () => setFleet((f) => setActiveVehicle(f, nextVehicleId(f))),
      prevVehicle: () => setFleet((f) => setActiveVehicle(f, prevVehicleId(f))),
    }),
    [
      fleet,
      current,
      sendNavigation,
      sendMedia,
      sendSchedule,
      removeScheduleFromCar,
      carLink.readSchedules,
      carLink.readSecurity,
    ],
  );

  const active = useMemo<[VehicleViewState, VehicleActions]>(
    () => [current.state, actions],
    [current.state, actions],
  );

  const carLinkStatus = useMemo<CarLinkStatus>(
    () => ({
      // Consumers (Home's status line, the controls' pending state) must see
      // "the car in front of me is live", not "some car is enrolled".
      linked: activeIsLive,
      vin: carLink.vin,
      connection: carLink.connection,
      transport: carLink.transport,
      streaming: carLink.streaming,
      lastUpdatedAt: carLink.lastUpdatedAt,
      lastVehicleDataAt: carLink.lastVehicleDataAt,
      wakeInFlight: carLink.wakeInFlight,
      refresh: carLink.refresh,
      wake: carLink.wake,
      sendWithOutcome: carLink.sendWithOutcome,
      readSchedules: carLink.readSchedules,
      readSecurity: carLink.readSecurity,
      pending: carLink.pending,
      pendingCommands: carLink.pendingCommands,
      // NOT narrowed by activeIsLive: a bond wedge is a property of the PHONE,
      // so it is equally true whichever car is on screen.
      recoveryRemedy: carLink.recoveryRemedy,
      piConfigured: carLink.piConfigured,
      vehicleBleName: carLink.vehicleBleName,
    }),
    [
      activeIsLive,
      carLink.vin,
      carLink.connection,
      carLink.transport,
      carLink.streaming,
      carLink.lastUpdatedAt,
      carLink.lastVehicleDataAt,
      carLink.wakeInFlight,
      carLink.refresh,
      carLink.wake,
      carLink.pending,
      carLink.pendingCommands,
      carLink.recoveryRemedy,
      carLink.piConfigured,
      carLink.vehicleBleName,
    ],
  );

  return { active, activeId: fleet.activeId, fleet: fleetApi, carLinkStatus };
}
