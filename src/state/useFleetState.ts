import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

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
} from './fleet';
import { buildVehicleActions, type VehicleActions } from './useVehicleState';
import { useCarLink, type CarLinkStatus } from './useCarLink';
import { diffToCommands, revertFields } from '../ble/reconcile';

export interface Fleet {
  vehicles: Vehicle[];
  activeId: string;
  activeIndex: number;
  activeName: string;
  addVehicle: (model: CarModel) => void;
  removeVehicle: (id: string) => void;
  setActiveVehicle: (id: string) => void;
  nextVehicle: () => void;
  prevVehicle: () => void;
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
  const applyTelemetry = useCallback(
    (patch: Partial<VehicleViewState>) => {
      if (!activeIsLiveRef.current) return;
      applyActive((s) => ({ ...s, ...patch }));
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
      if (activeIsLive) {
        const prev = current.state;
        const next = update(prev);
        // Each command carries the fields IT owns. dispatch gets those keys, so:
        // the coalescer lanes per field, the grace window covers exactly them,
        // and a failure reverts only that command's fields (not every edit made
        // in the same tick — see revertFields).
        for (const { cmd, keys } of diffToCommands(prev, next)) {
          carLink.dispatch(cmd, () => applyActive((s) => revertFields(s, prev, keys)), keys);
        }
      }
      applyActive(update);
    },
    [carLink, applyActive, current.state],
  );

  const actions = useMemo(() => buildVehicleActions(applyActiveUser), [applyActiveUser]);

  const fleetApi = useMemo<Fleet>(
    () => ({
      vehicles: fleet.vehicles,
      activeId: fleet.activeId,
      activeIndex: activeIndex(fleet),
      activeName: current.name,
      addVehicle: (model) => setFleet((f) => addVehicle(f, model)),
      removeVehicle: (id) => setFleet((f) => removeVehicle(f, id)),
      setActiveVehicle: (id) => setFleet((f) => setActiveVehicle(f, id)),
      nextVehicle: () => setFleet((f) => setActiveVehicle(f, nextVehicleId(f))),
      prevVehicle: () => setFleet((f) => setActiveVehicle(f, prevVehicleId(f))),
    }),
    [fleet, current],
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
      pending: carLink.pending,
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
      carLink.pending,
      carLink.recoveryRemedy,
      carLink.piConfigured,
      carLink.vehicleBleName,
    ],
  );

  return { active, activeId: fleet.activeId, fleet: fleetApi, carLinkStatus };
}
