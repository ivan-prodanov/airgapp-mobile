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

// Battery glyph geometry (findings §C3 prop defaults).
export const BATTERY_WIDTH = 35;
export const BATTERY_HEIGHT = 16;
export const BATTERY_BORDER_WIDTH = 1;
export const BATTERY_BORDER_RADIUS = 3;
export const BATTERY_FILL_RADIUS = 1;
// The terminal nub (their `battery_nipple` icon-font glyph).
export const BATTERY_NUB_WIDTH = 4;

// findings §C5: the fill turns amber at or below 20%, red at or below 7%.
export const BATTERY_WARNING_PCT = 20;
export const BATTERY_CRITICAL_PCT = 7;

// findings §C5 + §E. Dark-mode values: Tesla's home screen is dark.
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

// findings §C3 `getFillPercentage`: the fill never drops below 10% of the inner
// width, so an empty battery still reads as a battery rather than a hairline.
export function batteryFillFraction(pct: number): number {
  const x = pct / 100;
  return x >= 0.1 ? Math.min(1, x) : 0.1;
}

// findings §C3: width = round((35 - 2*border) * fill).
export function batteryFillWidth(pct: number): number {
  const inner = BATTERY_WIDTH - BATTERY_BORDER_WIDTH * 2;
  return Math.round(inner * batteryFillFraction(pct));
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
