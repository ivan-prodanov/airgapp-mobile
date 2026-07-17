// Tesla's `statusBarHeight` — a HARDCODED device-identifier lookup, NOT the real
// safe-area inset.
//
// Source: docs/superpowers/research/tesla-renderer-transitions-FINDINGS.md §2b
// (iOS ~1338500), verbatim: identifiers `iPhone13,1 / iPhone13 / iPhone14,4 /
// iPhone14,6 / iPhone14 / iPhone15 / iPhone16 / iPhone17 / iPhone18` -> 59;
// any other notched device -> 47; non-notch -> 50. `Specifications.statusBarOffset`
// (#32533) returns exactly this on iOS (and 0 on Android).
//
// WHY THIS FILE EXISTS — measured on device, not inferred:
//   Their frames are built from THIS number, and two of them bake it in:
//     Home     top = statusBarHeight + 60,  height = 355            (absolute)
//     Controls top = 0,                     height = SCREEN_H - 20  (no sbh)
//     Climate  top = statusBarHeight,       height = SCREEN_H - sbh - 240
//   We were passing `useSafeAreaInsets().top`, which on the target phone
//   (420x912) reports **68**, not 59. Consequences, exactly as observed:
//     - Controls: sbh absent from the formula      -> pixel-exact ("exact copy")
//     - Home:     height is the absolute 355       -> same SIZE, 9pt low
//     - Climate:  sbh is INSIDE the height         -> 604 vs 613 = 1.5% SMALL
//   That 1.5% was the "zoomed out a little" / "mirrors slightly inward" the RE
//   could never explain: nothing scales the car — we just fed the frame maths a
//   different status-bar height than Tesla does.
//
// So: to match their render we must reproduce their LOOKUP, including the fact
// that it ignores the device's actual inset (e.g. under Display Zoom).

// PURE — no react-native / expo imports, so this stays node-testable (the same
// isolation rule as ble/*: anything importing a native module can't load under
// tsx). VehicleCanvas binds Device.modelId + Platform.OS to it.

export const TESLA_SBH_TALL = 59;
export const TESLA_SBH_NOTCH = 47;
export const TESLA_SBH_PLAIN = 50;

// The identifier prefixes their table maps to 59. Matched as a prefix so a whole
// generation (e.g. every `iPhone17,x`) resolves, which is how their list reads
// (bare `iPhone14` alongside the specific `iPhone14,4`).
const TALL_PREFIXES = [
  'iPhone13,1',
  'iPhone13',
  'iPhone14,4',
  'iPhone14,6',
  'iPhone14',
  'iPhone15',
  'iPhone16',
  'iPhone17',
  'iPhone18',
];

// modelId is e.g. "iPhone17,2". `insetTop` is only used to tell a notched device
// from a non-notched one for models outside their list — their table predates
// anything newer, so a device they never listed still needs a branch.
export function teslaStatusBarHeight(modelId: string | null, insetTop: number): number {
  if (modelId && TALL_PREFIXES.some((p) => modelId.startsWith(p))) return TESLA_SBH_TALL;
  // Not in their list: fall back to their own notch/non-notch split. A real inset
  // above the classic 20pt status bar means a notch/island of some kind.
  return insetTop > 20 ? TESLA_SBH_NOTCH : TESLA_SBH_PLAIN;
}
