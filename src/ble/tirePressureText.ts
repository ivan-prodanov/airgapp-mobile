import type { TirePressures } from '../types/vehicleTypes';

// recommendedColdPressure — the subtitle under "Controls".
//
// The value is the CAR's own placard figure (TirePressureState fields 18/19,
// "rcp values in bar"), never a per-model constant of ours. Front and rear are
// usually the same and the official app shows one number; when they genuinely
// differ, saying both is more useful than picking one and being wrong for two
// wheels.
//
// Returns null when the car has not supplied a recommendation — the caller then
// renders no subtitle at all rather than a placeholder, because a missing
// recommendation is not a recommendation of nothing.
export function recommendedColdPressure(tires: TirePressures): string | null {
  const { rcpFront, rcpRear } = tires;
  if (rcpFront === null && rcpRear === null) return null;
  const fmt = (v: number) => `${v.toFixed(1)} bar`;
  if (rcpFront !== null && rcpRear !== null) {
    return rcpFront === rcpRear
      ? `Recommended Cold Pressure: ${fmt(rcpFront)}`
      : `Recommended Cold Pressure: ${fmt(rcpFront)} front · ${fmt(rcpRear)} rear`;
  }
  // Only one axle reported. Say which, so the number is not read as applying to
  // all four wheels.
  return rcpFront !== null
    ? `Recommended Cold Pressure: ${fmt(rcpFront)} front`
    : `Recommended Cold Pressure: ${fmt(rcpRear as number)} rear`;
}
