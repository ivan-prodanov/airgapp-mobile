// Per-vehicle schedule store, persisted across launches via AsyncStorage (same pattern as useTrip).
// Each vehicle keeps its own list; switching the active car loads that car's schedules.
import { useEffect, useMemo, useState } from 'react';

import { useActiveVehicleId } from './VehicleProvider';
import { appStorage } from './appStorage';
import { load, makeSaver } from './persistence';
import {
  EMPTY_SCHEDULES,
  removeSchedule,
  setEnabled as setEnabledOp,
  upsertCharging,
  upsertPrecondition,
  type ChargingSchedule,
  type PreconditionSchedule,
  type ScheduleKind,
  type SchedulesState,
} from './schedules';

const keyFor = (vehicleId: string) => `schedules:v1:${vehicleId}`;

export function useSchedules() {
  const vehicleId = useActiveVehicleId();
  const [state, setState] = useState<SchedulesState>(EMPTY_SCHEDULES);
  // Gate writes until the initial async load lands, so we never clobber saved data with the empty default.
  const [loaded, setLoaded] = useState(false);

  // Debounced per-vehicle writer, rebuilt when the active car changes.
  const save = useMemo(() => makeSaver<SchedulesState>(appStorage, keyFor(vehicleId), 300), [vehicleId]);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    void load<SchedulesState>(appStorage, keyFor(vehicleId), EMPTY_SCHEDULES).then((s) => {
      if (cancelled) return;
      // Tolerate an older/partial shape by falling back to empty arrays.
      setState({ precondition: s.precondition ?? [], charging: s.charging ?? [] });
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [vehicleId]);

  const apply = (next: SchedulesState) => {
    setState(next);
    if (loaded) save(next);
  };

  return {
    schedules: state,
    savePrecondition: (s: PreconditionSchedule) => apply(upsertPrecondition(state, s)),
    saveCharging: (s: ChargingSchedule) => apply(upsertCharging(state, s)),
    remove: (kind: ScheduleKind, id: string) => apply(removeSchedule(state, kind, id)),
    setEnabled: (kind: ScheduleKind, id: string, enabled: boolean) =>
      apply(setEnabledOp(state, kind, id, enabled)),
  };
}
