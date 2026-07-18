// READ PROBE — a diagnostic to PROVE telemetry reads land on device.
//
// When enabled, the readable NUMERIC fields boot to an "unknown" sentinel (NaN)
// instead of their mock defaults, and their display sites render "—" until the
// car's telemetry fills them. So on device you literally watch each field flip
// from "—" to a real value — a broken read stays "—" instead of hiding behind a
// plausible mock (battery 48 / 21°C etc.).
//
// This is the DIAGNOSTIC, scoped step (the user's call). It covers the three
// pure read-only NUMERICS — battery %, interior temp, exterior temp. It does NOT
// touch setpoints like targetTempC: those drive +/- steppers that would break on
// NaN, and a write self-verifies on the next poll anyway. The PROPER version
// (make every
// readable field genuinely nullable, booleans + enums too, and render Tesla's
// real no-data state) is MANDATORY later and gated on the miner's findings for
// how the official app displays a field before first data. See the test plan.
//
// Flip to `false` to restore the mock (e.g. for a showroom/demo build). Pure, no
// imports — safe to reference from types + screens.

export const READ_PROBE = true;

// The sentinel for "not read yet". NaN so any stray arithmetic is obviously
// wrong rather than a plausible 0.
export const NUM_UNKNOWN = Number.NaN;

export const isUnknownNum = (n: number): boolean => Number.isNaN(n);

// A readable numeric's boot value: unknown under the probe, else the mock.
export const probeNum = (mock: number): number => (READ_PROBE ? NUM_UNKNOWN : mock);

// Render helper: "—" when unknown, else the formatted value.
export function showNum(n: number, fmt: (v: number) => string): string {
  return isUnknownNum(n) ? '—' : fmt(n);
}
