// The Home battery indicator's colours, fill geometry and text.
//
// Source of truth: docs/superpowers/research/tesla-status-assets-FINDINGS.md
// §C3/§C4/§C5 (`MiniBatteryView` #117269, `getBatteryColor` #117267,
// `ChargeStatus` #117220). Every hex and number below is theirs, recovered from
// the bundle — do not "adjust" them to taste.
//
// NB: the official palette is the app's own JS palette, NOT the native
// colors.xml one; the two differ by ~1 unit (#00E286 vs #00e185, #ffc107 vs
// #ffc106) and this file uses the RN values (findings §C5).

// Battery glyph geometry — Round 4 §1 dumped the verbatim literals and CORRECTED
// two of Round 3's numbers (the fill inset, and the body being filled).
export const BATTERY_WIDTH = 35;
export const BATTERY_HEIGHT = 16;
export const BATTERY_BORDER_WIDTH = 1;
export const BATTERY_BORDER_RADIUS = 3;
export const BATTERY_FILL_RADIUS = 1;
// findings §1c: the fill is inset by `borderWidth*2 + 2` = 4 on BOTH axes — so
// height is 16-4 = 12 (Round 3 said 14, i.e. flush) and the width budget is
// 35-4 = 31. This inset is what gives the fill its visible margin.
export const BATTERY_FILL_INSET = BATTERY_BORDER_WIDTH * 2 + 2;
export const BATTERY_FILL_HEIGHT = BATTERY_HEIGHT - BATTERY_FILL_INSET;
// findings §1d: the nub is drawn into a 4x16 box, abutting the body with no gap.
export const BATTERY_NUB_WIDTH = 4;

// findings §C5: the fill turns amber at or below 20%, red at or below 7%.
export const BATTERY_WARNING_PCT = 20;
export const BATTERY_CRITICAL_PCT = 7;

// findings §C5 + §E. Dark-mode values: Tesla's home screen is dark.
// findings §1b: `pillBackgroundColor` is BOTH the body's backgroundColor AND its
// borderColor on the non-Cybertruck path — the body is a SOLID rounded rect,
// not a stroke around a transparent interior. It also colours the nub.
export const BatteryColors = {
  charging: '#00E286',
  critical: '#ff0000',
  warning: '#ffc107',
  normalDark: '#8A8B8C',
  // The battery outline + nub (`pillBackgroundColor`, dark).
  pillDark: '#2D2F34',
} as const;

// findings §E: the status text and the battery % share ONE token
// (`theme.textColorLight`) — same hex, differing only in size/weight. The
// muting is baked into the token; do NOT layer an opacity on top.
export const TEXT_COLOR_LIGHT_DARK = '#8A8B8B';

// getBatteryColor (#117267), checked in their order. We model the two states we
// have (charging / normal) plus the two thresholds; their powershare/solar
// branches (priorities 4-5) have no equivalent in this app.
export function batteryFillColor(pct: number, charging: boolean): string {
  if (charging) return BatteryColors.charging;
  const soc = Math.round(pct);
  if (soc <= BATTERY_CRITICAL_PCT) return BatteryColors.critical;
  if (soc <= BATTERY_WARNING_PCT) return BatteryColors.warning;
  return BatteryColors.normalDark;
}

// findings §C5: the % TEXT does not turn amber/red when low — only the glyph
// fill does. It turns green only while charging.
export function batteryTextColor(charging: boolean): string {
  return charging ? BatteryColors.charging : TEXT_COLOR_LIGHT_DARK;
}

// findings §1c `getFillPercentage`: the fill never drops below 10% of the inner
// width, so an empty battery still reads as a battery rather than a hairline.
export function batteryFillFraction(pct: number): number {
  const x = pct / 100;
  return x >= 0.1 ? Math.min(1, x) : 0.1;
}

// findings §1c, verbatim: width = round((measuredWidth - 4) * fill).
export function batteryFillWidth(pct: number): number {
  return Math.round((BATTERY_WIDTH - BATTERY_FILL_INSET) * batteryFillFraction(pct));
}

// findings §C4: percent mode renders the integer + '%' with NO space ("75%");
// distance mode renders the preformatted range + unit ("312 km").
export function batteryLabel(
  mode: 'percent' | 'distance',
  pct: number,
  rangeKm: number | null,
  unit: 'km' | 'mi',
): string {
  if (mode === 'percent' || rangeKm === null) return `${Math.round(pct)}%`;
  const value = unit === 'mi' ? rangeKm / 1.60934 : rangeKm;
  return `${Math.round(value)} ${unit}`;
}
