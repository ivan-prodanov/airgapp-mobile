// No-data display helper for readable NUMERIC fields.
//
// The readable numerics (battery %, interior/exterior temp) are `number | null`:
// `null` until a value is known — either a fresh read OR a rehydrated cache (see
// carLinkCache.ts). While null they render "—". Once a value lands it shows,
// dimmed until fresh via the `stale` flag. (This file used to host the READ_PROBE
// diagnostic that booted those fields to a NaN sentinel; that's retired now that
// the fields are genuinely nullable and the cache rehydrates last-known values.)
//
// Pure, no imports — safe to reference from screens.

// A value is "unknown" (renders "—") when it's null/undefined or non-finite.
export const isUnknownNum = (n: number | null | undefined): boolean =>
  n == null || !Number.isFinite(n);

// Render helper: "—" when unknown, else the formatted value.
export function showNum(n: number | null | undefined, fmt: (v: number) => string): string {
  return isUnknownNum(n) ? '—' : fmt(n as number);
}
