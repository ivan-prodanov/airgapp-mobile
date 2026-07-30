// Pure data model + formatters for the Set Schedules screen. No React / AsyncStorage here so it stays
// node-testable; the hook (useSchedules.ts) owns persistence and the screen owns UI.
//
// Two schedule kinds mirror the Tesla app:
//  - Precondition: "precondition by <time>" on chosen days (climate + battery preheat).
//  - Charging:     start-at and/or end-by times on chosen days.
// Days are indexed 0=Mon … 6=Sun to match the on-screen "M T W T F S S" header order.

import type { ChargeScheduleInput, PreconditionScheduleInput } from '@/ble/builders';

export type ScheduleKind = 'precondition' | 'charging';

export const DAY_CHIP_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']; // header row, Monday-first
const DAY_FULL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const DAY_ABBR = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export interface PreconditionSchedule {
  id: string;
  // The car's schedule key: epoch SECONDS at creation, exactly as the Tesla app
  // assigns it (getInitialChargeSchedule -> setId(round(Date.now()/1000))). Kept
  // for the life of the schedule, so edit/toggle re-add the SAME car schedule and
  // delete targets it. Distinct from the local string `id` the UI uses. See
  // nextCarId for why epoch seconds and not ms.
  carId: number;
  kind: 'precondition';
  time: string; // 'HH:MM' 24h
  days: number[]; // sorted, unique, 0=Mon … 6=Sun
  repeatWeekly: boolean;
  enabled: boolean;
}

export interface ChargingSchedule {
  id: string;
  carId: number; // see PreconditionSchedule.carId
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
  return {
    id: uid(),
    carId: nextCarId(),
    kind: 'precondition',
    time: '08:00',
    days: [],
    repeatWeekly: true,
    enabled: true,
  };
}

export function newCharging(): ChargingSchedule {
  return {
    id: uid(),
    carId: nextCarId(),
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

// carId is the car's schedule key, generated EXACTLY as the Tesla app does in
// getInitialChargeSchedule: `setId(Math.round(Date.now() / 1000))` — epoch
// SECONDS, not ms.
//
// This is the fix for the readback bug. My first cut used Date.now() * 1000
// (~1.75e15), which overflowed the car's id field and came back as ~2^64
// garbage — I misread that as "the car reassigns the id". It doesn't: epoch
// seconds (~1.75e9) is exactly why Tesla uses that scale — it stays in range and
// round-trips verbatim, so remove/edit (keyed on this id) match the car's stored
// schedule. `Math.max(last+1, …)` only guards the one case Tesla ignores: two
// schedules created inside the same second.
let lastCarId = 0;
export function nextCarId(): number {
  lastCarId = Math.max(Math.round(Date.now() / 1000), lastCarId + 1);
  return lastCarId;
}

// Backfill carId on schedules persisted before this field existed, so every
// schedule the store hands out can be pushed to / removed from the car.
export function withCarIds(state: SchedulesState): SchedulesState {
  const fix = <T extends { carId?: number }>(s: T): T =>
    typeof s.carId === 'number' ? s : { ...s, carId: nextCarId() };
  return {
    precondition: state.precondition.map(fix),
    charging: state.charging.map(fix),
  };
}

// ── Local model → car wire input (pure, so it is unit-tested without a car) ───
//
// The car's modern schedules are location-keyed; offline we supply the car's own
// last-known coordinates (RESPONSE-15 open-Q5 flags whether user coords are
// accepted as UNVERIFIED — confirm against the car's schedule readback).
// `repeatWeekly === false` maps to the car's `one_time` flag.
export function chargeScheduleToInput(
  s: ChargingSchedule,
  coord: { latitude: number; longitude: number },
): ChargeScheduleInput {
  return {
    id: s.carId,
    name: '',
    days: s.days,
    startEnabled: s.startEnabled,
    startTime: s.startTime,
    endEnabled: s.endEnabled,
    endTime: s.endTime,
    enabled: s.enabled,
    oneTime: !s.repeatWeekly,
    latitude: coord.latitude,
    longitude: coord.longitude,
  };
}

export function preconditionScheduleToInput(
  s: PreconditionSchedule,
  coord: { latitude: number; longitude: number },
): PreconditionScheduleInput {
  return {
    id: s.carId,
    name: '',
    days: s.days,
    preconditionTime: s.time,
    enabled: s.enabled,
    oneTime: !s.repeatWeekly,
    latitude: coord.latitude,
    longitude: coord.longitude,
  };
}

// ── Car wire → local model (the INVERSE — the car is the source of truth) ─────
//
// The Tesla app displays the schedules the CAR holds, not a local list. These
// map a read-back entry to our display model so the screen can do the same:
// the local string `id` is derived from carId (stable across reads, so the row
// does not re-mount on every sync), days come from the bitmask, times from
// minutes, repeatWeekly from !oneTime.
export interface CarSchedule {
  id: number | undefined;
  daysOfWeek: number | undefined;
  startEnabled?: boolean | undefined;
  startTime?: number | undefined;
  endEnabled?: boolean | undefined;
  endTime?: number | undefined;
  preconditionTime?: number | undefined;
  enabled: boolean | undefined;
  oneTime: boolean | undefined;
}

const minutesToHHMM = (m: number | undefined): string => {
  const v = typeof m === 'number' && m >= 0 ? m : 0;
  return `${String(Math.floor(v / 60) % 24).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
};
const bitmaskToDays = (mask: number | undefined): number[] => {
  const m = typeof mask === 'number' ? mask : 0;
  const days: number[] = [];
  for (let i = 0; i < 7; i++) if ((m & (1 << i)) !== 0) days.push(i);
  return days;
};

export function carToChargingSchedule(r: CarSchedule): ChargingSchedule {
  const carId = typeof r.id === 'number' ? r.id : 0;
  return {
    id: `car_${carId}`,
    carId,
    kind: 'charging',
    startEnabled: r.startEnabled ?? false,
    startTime: minutesToHHMM(r.startTime),
    endEnabled: r.endEnabled ?? false,
    endTime: minutesToHHMM(r.endTime),
    days: bitmaskToDays(r.daysOfWeek),
    repeatWeekly: !r.oneTime,
    enabled: r.enabled ?? true,
  };
}

export function carToPreconditionSchedule(r: CarSchedule): PreconditionSchedule {
  const carId = typeof r.id === 'number' ? r.id : 0;
  return {
    id: `car_${carId}`,
    carId,
    kind: 'precondition',
    time: minutesToHHMM(r.preconditionTime),
    days: bitmaskToDays(r.daysOfWeek),
    repeatWeekly: !r.oneTime,
    enabled: r.enabled ?? true,
  };
}

export function carSchedulesToState(
  charge: CarSchedule[],
  precond: CarSchedule[],
): SchedulesState {
  return {
    charging: charge.map(carToChargingSchedule),
    precondition: precond.map(carToPreconditionSchedule),
  };
}
