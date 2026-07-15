import { useCallback, useMemo, useState } from 'react';

import type { CarModel, VehicleViewState } from '../types/vehicleTypes';
import {
  activeIndex,
  activeVehicle,
  addVehicle,
  createInitialFleet,
  nextVehicleId,
  prevVehicleId,
  removeVehicle,
  setActiveVehicle,
  updateActiveVehicleState,
  type FleetState,
  type Vehicle,
} from './fleet';
import { buildVehicleActions, type VehicleActions } from './useVehicleState';
import { useCarLink } from './useCarLink';
import { diffToCommands, revertLockedIfNeeded } from '../ble/reconcile';

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
} {
  const [fleet, setFleet] = useState<FleetState>(createInitialFleet);
  const carLink = useCarLink();

  // The plain apply for the OPTIMISTIC state commit + telemetry path. USER
  // actions go through applyActiveUser (below), which additionally reconciles
  // the prev→next diff into real car commands. Telemetry (future) keeps using
  // this plain apply so it never loops back into a command.
  const applyActive = useCallback(
    (update: (state: VehicleViewState) => VehicleViewState) =>
      setFleet((current) => updateActiveVehicleState(current, update)),
    [],
  );

  const current = activeVehicle(fleet);

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
      if (carLink.linked) {
        const prev = current.state;
        const next = update(prev);
        for (const cmd of diffToCommands(prev, next)) {
          carLink.dispatch(cmd, () => applyActive((s) => revertLockedIfNeeded(s, prev)));
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

  return { active, activeId: fleet.activeId, fleet: fleetApi };
}
