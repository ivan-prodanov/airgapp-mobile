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

// ⚠️ INCOMPLETE — verified for the phones we ship to, SUSPECT for the rest.
// Brief #9 (tesla-statusbar-table-RESEARCH-BRIEF.md) asks for the verbatim
// function; until it lands, treat anything outside iPhone15..18 as unverified.
//
// The findings summarise their table as "these identifiers -> 59", but that list
// cannot be literally right — it contradicts the devices' real geometry:
//     iPhone14,6 = iPhone SE 3   -> real inset 20 (home button, NO notch!)
//     iPhone13,1 = iPhone 12 mini-> real inset 50
//     iPhone14,7 = iPhone 14     -> real inset 47
//     iPhone15,2 = iPhone 14 Pro -> real inset 59  ✓
// A 59pt status bar on a no-notch SE isn't credible, and a bare `iPhone13` prefix
// makes the `iPhone13,1` entry redundant UNLESS they return different values. So
// their function is probably a branch chain returning a DIFFERENT constant per
// generation (13,1->50, 13->47, 14,4->50, 14,6->20, 14->47, 15+->59), which the
// summary flattened onto its last value. That shape matches every real inset.
//
// We keep 59-for-everything-listed because (a) it is what the findings state and
// (b) it is verified correct on our target (iPhone18,4 -> 59, measured). But on a
// 12/13/14, a mini or an SE this will likely feed 59 where Tesla feeds 47/50/20 —
// the exact bug class we just spent four turns finding, on a device we don't own.
const TALL_PREFIXES = [
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
  // ⚠️ OUR PREDICATE, NOT THEIRS. The findings give the two VALUES ("other notch
  // -> 47; non-notch -> 50") but never the test that chooses between them, so
  // this inset check is an invention — flagged rather than passed off as parity.
  // Brief #9 asks for their real condition.
  return insetTop > 20 ? TESLA_SBH_NOTCH : TESLA_SBH_PLAIN;
}
