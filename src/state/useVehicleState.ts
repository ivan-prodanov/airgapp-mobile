import { useCallback, useState } from 'react';
import {
  initialVehicleState,
  modelYProductConfig,
  type CameraMode,
  type SeatClimateMode,
  type SeatPosition,
  type SteeringWheelClimateMode,
  type VehicleStateKey,
  type VehicleViewState,
} from '../types/vehicleTypes';

export interface VehicleActions {
  setCameraMode: (cameraMode: CameraMode) => void;
  setScreenCameraMode: (cameraMode: CameraMode) => void;
  toggle: (key: VehicleStateKey) => void;
  patch: (patch: Partial<VehicleViewState>) => void;
  cycleSteeringWheelClimate: () => void;
  cycleSeatClimate: (seat: SeatPosition) => void;
}

export function useVehicleState(): [VehicleViewState, VehicleActions] {
  const [state, setState] = useState<VehicleViewState>(initialVehicleState);

  const patch = useCallback((partial: Partial<VehicleViewState>) => {
    setState((current) => ({ ...current, ...partial }));
  }, []);

  const toggle = useCallback((key: VehicleStateKey) => {
    setState((current) => {
      const value = current[key];
      if (typeof value !== 'boolean') {
        return current;
      }
      return { ...current, [key]: !value };
    });
  }, []);

  const setCameraMode = useCallback((cameraMode: CameraMode) => {
    setState((current) => ({ ...current, cameraMode }));
  }, []);

  const setScreenCameraMode = useCallback((cameraMode: CameraMode) => {
    setState((current) => ({
      ...current,
      cameraMode,
      tirePressureVisible: cameraMode === 'TOP_DOWN' ? current.tirePressureVisible : false,
    }));
  }, []);

  const cycleSteeringWheelClimate = useCallback(() => {
    setState((current) => {
      const caps = modelYProductConfig.climate_capabilities.steeringWheel;
      const sequence: SteeringWheelClimateMode[] = ['off'];
      if (caps.heating) {
        sequence.push('heat');
      }
      if (caps.auto) {
        sequence.push('auto');
      }
      return { ...current, steeringWheelClimateMode: nextInSequence(sequence, current.steeringWheelClimateMode) };
    });
  }, []);

  const cycleSeatClimate = useCallback((seat: SeatPosition) => {
    setState((current) => {
      const caps = modelYProductConfig.climate_capabilities.seats[seat];
      const sequence = seatClimateSequence(caps.heatLevels, caps.coolLevels, caps.auto);
      return {
        ...current,
        seatClimateModes: {
          ...current.seatClimateModes,
          [seat]: nextSeatMode(sequence, current.seatClimateModes[seat]),
        },
      };
    });
  }, []);

  return [state, { setCameraMode, setScreenCameraMode, toggle, patch, cycleSteeringWheelClimate, cycleSeatClimate }];
}

function nextInSequence<T>(sequence: T[], current: T): T {
  const index = sequence.indexOf(current);
  return sequence[(index + 1) % sequence.length] ?? sequence[0];
}

function seatClimateSequence(heatLevels: 0 | 1 | 2 | 3, coolLevels: 0 | 1 | 2 | 3, auto: boolean): SeatClimateMode[] {
  const sequence: SeatClimateMode[] = [{ mode: 'off', level: 0 }];
  for (let level = 1; level <= heatLevels; level += 1) {
    sequence.push({ mode: 'heat', level: level as 1 | 2 | 3 });
  }
  if (auto) {
    sequence.push({ mode: 'auto', level: 0 });
  }
  for (let level = 1; level <= coolLevels; level += 1) {
    sequence.push({ mode: 'cool', level: level as 1 | 2 | 3 });
  }
  return sequence;
}

function nextSeatMode(sequence: SeatClimateMode[], current: SeatClimateMode): SeatClimateMode {
  const index = sequence.findIndex((item) => item.mode === current.mode && item.level === current.level);
  return sequence[(index + 1) % sequence.length] ?? sequence[0];
}
