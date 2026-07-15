import { useCallback, useMemo, useRef, useState } from 'react';

import type { CarModel, VehicleStateKey, VehicleViewState } from '../types/vehicleTypes';
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
import { useCarLink, type CarLinkStatus } from './useCarLink';
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
  // (already intent-filtered) VCSEC patch into the active car. Guarded to the
  // linked car — for v1's single real car the active car IS the live car, so a
  // stray telemetry write can never land on a demo car. linkedRef breaks the
  // chicken-and-egg (useCarLink needs applyTelemetry; the guard needs `linked`)
  // and is read only inside the async poll, well after the ref is populated.
  const linkedRef = useRef(false);
  const applyTelemetry = useCallback(
    (patch: Partial<VehicleViewState>) => {
      if (!linkedRef.current) return;
      applyActive((s) => ({ ...s, ...patch }));
    },
    [applyActive],
  );
  const carLink = useCarLink({ applyTelemetry });
  linkedRef.current = carLink.linked;

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
        const commands = diffToCommands(prev, next);
        if (commands.length) {
          // The exact fields the user changed — passed to dispatch so the
          // grace window covers precisely those keys (for a lock, ['locked']),
          // stopping a lagging poll from reverting them.
          const changedKeys = (Object.keys(next) as VehicleStateKey[]).filter(
            (key) => prev[key] !== next[key],
          );
          for (const cmd of commands) {
            carLink.dispatch(cmd, () => applyActive((s) => revertLockedIfNeeded(s, prev)), changedKeys);
          }
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
      linked: carLink.linked,
      connection: carLink.connection,
      transport: carLink.transport,
      lastUpdatedAt: carLink.lastUpdatedAt,
      pending: carLink.pending,
    }),
    [carLink.linked, carLink.connection, carLink.transport, carLink.lastUpdatedAt, carLink.pending],
  );

  return { active, activeId: fleet.activeId, fleet: fleetApi, carLinkStatus };
}
