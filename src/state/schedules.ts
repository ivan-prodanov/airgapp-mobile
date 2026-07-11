// Pure data model + formatters for the Set Schedules screen. No React / AsyncStorage here so it stays
// node-testable; the hook (useSchedules.ts) owns persistence and the screen owns UI.
//
// Two schedule kinds mirror the Tesla app:
//  - Precondition: "precondition by <time>" on chosen days (climate + battery preheat).
//  - Charging:     start-at and/or end-by times on chosen days.
// Days are indexed 0=Mon … 6=Sun to match the on-screen "M T W T F S S" header order.

export type ScheduleKind = 'precondition' | 'charging';

export const DAY_CHIP_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']; // header row, Monday-first
const DAY_FULL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const DAY_ABBR = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export interface PreconditionSchedule {
  id: string;
  kind: 'precondition';
  time: string; // 'HH:MM' 24h
  days: number[]; // sorted, unique, 0=Mon … 6=Sun
  repeatWeekly: boolean;
  enabled: boolean;
}

export interface ChargingSchedule {
  id: string;
  kind: 'charging';
  startEnabled: boolean;
  startTime: string; // 'HH:MM'
  endEnabled: boolean;
  endTime: string; // 'HH:MM'
  days: number[];
  repeatWeekly: boolean;
  enabled: boolean;
}

export type AnySchedule = PreconditionSchedule | ChargingSchedule;

export interface SchedulesState {
  precondition: PreconditionSchedule[];
  charging: ChargingSchedule[];
}

export const EMPTY_SCHEDULES: SchedulesState = { precondition: [], charging: [] };

// Defaults for a freshly-opened "+" popup. Days start empty → the Create button is disabled until the
// user picks at least one (matches the Charging screenshot, where Create is greyed with no day chosen).
export function newPrecondition(): PreconditionSchedule {
  return { id: uid(), kind: 'precondition', time: '08:00', days: [], repeatWeekly: true, enabled: true };
}

export function newCharging(): ChargingSchedule {
  return {
    id: uid(),
    kind: 'charging',
    startEnabled: true,
    startTime: '22:00',
    endEnabled: true,
    endTime: '06:00',
    days: [],
    repeatWeekly: true,
    enabled: true,
  };
}

// A schedule is completable (Create/Save enabled) only with ≥1 day, and — for charging — at least one
// of the start/end times switched on.
export function isComplete(s: AnySchedule): boolean {
  if (s.days.length === 0) return false;
  if (s.kind === 'charging') return s.startEnabled || s.endEnabled;
  return true;
}

// Toggle one day in/out of a day array, keeping it sorted + unique.
export function toggleDay(days: number[], day: number): number[] {
  const has = days.includes(day);
  const next = has ? days.filter((d) => d !== day) : [...days, day];
  return next.sort((a, b) => a - b);
}

// "Tuesday" / "Tue, Wed" / "Weekdays" / "Weekends" / "Every day" — the compact day summary.
export function formatDays(days: number[]): string {
  if (days.length === 0) return 'Never';
  if (days.length === 7) return 'Every day';
  const set = [...days].sort((a, b) => a - b);
  if (set.length === 5 && set.every((d, i) => d === i)) return 'Weekdays'; // Mon–Fri
  if (set.length === 2 && set[0] === 5 && set[1] === 6) return 'Weekends'; // Sat+Sun
  if (set.length === 1) return DAY_FULL[set[0]];
  return set.map((d) => DAY_ABBR[d]).join(', ');
}

// Row title under each category. Precondition folds the days into the title ("Tuesday by 08:00");
// charging shows its time range there and carries the days in the subtitle instead.
export function scheduleTitle(s: AnySchedule): string {
  if (s.kind === 'precondition') return `${formatDays(s.days)} by ${s.time}`;
  if (s.startEnabled && s.endEnabled) return `${s.startTime} – ${s.endTime}`;
  if (s.startEnabled) return `Start at ${s.startTime}`;
  if (s.endEnabled) return `End by ${s.endTime}`;
  return 'Charging';
}

export function scheduleSubtitle(s: AnySchedule): string {
  const repeat = s.repeatWeekly ? 'Repeat Weekly' : 'Once';
  if (s.kind === 'precondition') return repeat;
  return `${formatDays(s.days)} · ${repeat}`;
}

// Insert-or-replace by id, preserving order (edited items keep their slot).
export function upsertPrecondition(state: SchedulesState, s: PreconditionSchedule): SchedulesState {
  return { ...state, precondition: upsert(state.precondition, s) };
}
export function upsertCharging(state: SchedulesState, s: ChargingSchedule): SchedulesState {
  return { ...state, charging: upsert(state.charging, s) };
}
export function removeSchedule(state: SchedulesState, kind: ScheduleKind, id: string): SchedulesState {
  const key = kind === 'precondition' ? 'precondition' : 'charging';
  return { ...state, [key]: state[key].filter((s) => s.id !== id) } as SchedulesState;
}
export function setEnabled(
  state: SchedulesState,
  kind: ScheduleKind,
  id: string,
  enabled: boolean,
): SchedulesState {
  const key = kind === 'precondition' ? 'precondition' : 'charging';
  const list = (state[key] as AnySchedule[]).map((s) => (s.id === id ? { ...s, enabled } : s));
  return { ...state, [key]: list } as SchedulesState;
}

function upsert<T extends { id: string }>(list: T[], item: T): T[] {
  const i = list.findIndex((x) => x.id === item.id);
  if (i === -1) return [...list, item];
  const next = list.slice();
  next[i] = item;
  return next;
}

// Per-launch-unique id. Date.now alone collides when two schedules are created in the same ms, so mix in
// randomness (this runs in the app, where Date.now/Math.random are available).
export function uid(): string {
  return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}
