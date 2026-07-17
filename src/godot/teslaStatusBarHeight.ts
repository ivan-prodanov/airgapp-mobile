// Tesla's `getAdjustedStatusBarHeight` — a HARDCODED device-identifier table,
// NOT the safe-area inset.
//
// Source: docs/superpowers/research/tesla-statusbar-table-FINDINGS.md — the
// verbatim branch chain of fn #32534 (iOS 1338493-1338578), read unfiltered and
// re-derived by two further agents. It SUPERSEDES the earlier summary in
// tesla-renderer-transitions-FINDINGS §2b, which was wrong twice over: it
// flattened four distinct return values into "-> 59", and its "other notch ->
// 47; non-notch -> 50" rule was FABRICATED — there is no notch predicate in this
// function at all. (Tesla's real HAS_NOTCH exists, but only feeds the hamburger
// padding and the bottom nav bar; never the status bar.)
//
// WHY WE MIRROR THIS AT ALL — measured on device, not inferred:
//   Every renderer frame is built from this number, and Climate BAKES IT INTO
//   ITS HEIGHT (`SCREEN_HEIGHT - sbh - 240`), so a wrong value silently rescales
//   the car. We used to pass `useSafeAreaInsets().top`, which on the target
//   phone (iPhone18,4, 420x912) reports 68 where Tesla's table says 59:
//     Controls  sbh absent from its formula   ->  pixel-exact
//     Home      height is the absolute 355    ->  right size, 9pt low
//     Climate   sbh is INSIDE the height      ->  604 vs 613 = 1.5% too small
//   which is exactly what the user reported. Nothing scales the car — we were
//   feeding the frame maths a different status-bar height than Tesla does.
//
// PURE — no react-native / expo imports, so it stays node-testable (same
// isolation rule as ble/*). VehicleCanvas binds the device id + window + inset.

export const TESLA_SBH_TALL = 59;
export const TESLA_SBH_WIDE = 47; // 12 / 13 / 14, non-mini
export const TESLA_SBH_MINI = 50; // 12 mini / 13 mini
export const TESLA_SBH_IPHONE_X = 44; // the library's notched value
export const TESLA_SBH_PLAIN = 20; // the library's pre-notch value

export interface WindowSize {
  width: number;
  height: number;
}

// Their fallback: `require(2451).getStatusBarHeight()` — stock
// react-native-status-bar-height, called with ZERO args:
//     ios: isIPhoneX ? 44 : 20
//     isIPhoneX = (W === 375 && H === 812) || (W === 414 && H === 896)
// computed ONCE at module-eval, so it never reacts to rotation.
//
// That library is correct for <= iPhone 11; Tesla's table is a patch on top for
// iPhone 12+. Which explains the two odd-looking rows: the SE 3 is deliberately
// routed BACK here (375x667 -> 20, correct), while the minis need exact
// carve-outs because the library would wrongly call them an iPhone X (they are
// also 375x812 -> 44, but their real inset is 50).
function teslaLibraryFallback(win: WindowSize, insetTop: number): number {
  const isIPhoneX =
    (win.width === 375 && win.height === 812) || (win.width === 414 && win.height === 896);
  if (isIPhoneX) return TESLA_SBH_IPHONE_X;

  // ⚠️ DELIBERATE DIVERGENCE FROM TESLA (findings §4 recommends it).
  // Their library returns 20 here — including for ANY iPhone newer than the
  // iPhone18,x generation, which falls through all 14 branches. That is ~39pt
  // short, and because Climate bakes sbh into its height it would silently
  // rescale the car on a future phone. Their table is an allowlist that needs an
  // app update per hardware generation and degrades to the SMALLEST value; we
  // would rather degrade to the real inset. Affects UNKNOWN devices only — every
  // shipping identifier is matched below, so parity is unaffected.
  return insetTop > 0 ? insetTop : TESLA_SBH_PLAIN;
}

// deviceId is the raw `hw.machine` string, e.g. "iPhone18,4". Tesla reads it via
// react-native-device-info's getDeviceId(); we use expo-device's Device.modelId,
// which surfaces the same value (findings §2 — same shape, INFERRED equal since
// both are native reads).
//
// ⚠️ THE ORDER IS LOAD-BEARING (findings §1c). Each exact `===` carve-out MUST
// precede the `.includes()` that would otherwise swallow it — and their tests
// really are unanchored `.includes`, not startsWith / regex / a map:
//     'iPhone13,1' before includes('iPhone13')  -> else the 12 mini regresses 50->47
//     'iPhone14,4' before includes('iPhone14')  -> else the 13 mini regresses 50->47
//     'iPhone14,6' before includes('iPhone14')  -> else the SE 3 gets a 27pt
//                                                  phantom notch on a notchless phone
export function teslaStatusBarHeight(
  deviceId: string | null,
  win: WindowSize,
  insetTop: number,
): number {
  const id = deviceId ?? '';
  if (id === 'iPhone13,1') return TESLA_SBH_MINI; // 12 mini
  if (id.includes('iPhone13')) return TESLA_SBH_WIDE; // 12 / Pro / Pro Max
  if (id === 'iPhone14,4') return TESLA_SBH_MINI; // 13 mini
  if (id === 'iPhone14,6') return teslaLibraryFallback(win, insetTop); // SE 3 -> 20
  if (id.includes('iPhone14')) return TESLA_SBH_WIDE; // 13 / 13 Pro / 14 / Plus
  if (id.includes('iPhone15')) return TESLA_SBH_TALL; // 14 Pro / 15
  if (id.includes('iPhone16')) return TESLA_SBH_TALL; // 15 Pro
  if (id.includes('iPhone17')) return TESLA_SBH_TALL; // 16 family
  if (id.includes('iPhone18')) return TESLA_SBH_TALL; // 17 / Air  (ours: iPhone18,4)
  return teslaLibraryFallback(win, insetTop);
}
