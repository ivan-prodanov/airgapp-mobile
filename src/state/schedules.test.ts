import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EMPTY_SCHEDULES,
  carSchedulesToState,
  carToChargingSchedule,
  chargeScheduleToInput,
  formatDays,
  isComplete,
  locationKey,
  newCharging,
  newPrecondition,
  scheduleLocations,
  schedulesAt,
  preconditionScheduleToInput,
  removeSchedule,
  scheduleSubtitle,
  scheduleTitle,
  setEnabled,
  toggleDay,
  upsertCharging,
  upsertPrecondition,
  withCarIds,
} from './schedules';

test('formatDays summarizes day sets', () => {
  assert.equal(formatDays([1]), 'Tuesday');
  assert.equal(formatDays([1, 2]), 'Tue, Wed');
  assert.equal(formatDays([0, 1, 2, 3, 4]), 'Weekdays');
  assert.equal(formatDays([5, 6]), 'Weekends');
  assert.equal(formatDays([0, 1, 2, 3, 4, 5, 6]), 'Every day');
  assert.equal(formatDays([]), 'Never');
});

test('toggleDay adds/removes and stays sorted', () => {
  assert.deepEqual(toggleDay([], 2), [2]);
  assert.deepEqual(toggleDay([2, 0], 5), [0, 2, 5]);
  assert.deepEqual(toggleDay([0, 2, 5], 2), [0, 5]);
});

test('precondition title/subtitle match the row design', () => {
  const s = { ...newPrecondition(), days: [1], time: '08:00', repeatWeekly: true };
  assert.equal(scheduleTitle(s), 'Tuesday by 08:00');
  assert.equal(scheduleSubtitle(s), 'Repeat Weekly');
  assert.equal(scheduleSubtitle({ ...s, repeatWeekly: false }), 'Once');
});

test('charging title covers start/end combinations', () => {
  const base = { ...newCharging(), days: [1, 2] };
  assert.equal(scheduleTitle(base), '22:00 – 06:00');
  assert.equal(scheduleTitle({ ...base, endEnabled: false }), 'Start at 22:00');
  assert.equal(scheduleTitle({ ...base, startEnabled: false }), 'End by 06:00');
  assert.equal(scheduleSubtitle(base), 'Tue, Wed · Repeat Weekly');
});

test('isComplete requires a day (and a time for charging)', () => {
  assert.equal(isComplete(newPrecondition()), false); // no days
  assert.equal(isComplete({ ...newPrecondition(), days: [1] }), true);
  assert.equal(isComplete({ ...newCharging(), days: [1] }), true);
  assert.equal(
    isComplete({ ...newCharging(), days: [1], startEnabled: false, endEnabled: false }),
    false,
  );
});

test('upsert adds then replaces by id; remove + setEnabled work', () => {
  const a = { ...newPrecondition(), id: 'a', days: [1] };
  let st = upsertPrecondition(EMPTY_SCHEDULES, a);
  assert.equal(st.precondition.length, 1);
  st = upsertPrecondition(st, { ...a, time: '09:00' }); // same id → replace, not append
  assert.equal(st.precondition.length, 1);
  assert.equal(st.precondition[0].time, '09:00');

  const c = { ...newCharging(), id: 'c', days: [3] };
  st = upsertCharging(st, c);
  st = setEnabled(st, 'charging', 'c', false);
  assert.equal(st.charging[0].enabled, false);

  st = removeSchedule(st, 'precondition', 'a');
  assert.equal(st.precondition.length, 0);
  assert.equal(st.charging.length, 1); // unaffected
});

// ── Local model → car wire input (REQUEST-15 T5 wiring) ──────────────────────
const HOME = { latitude: 44.8, longitude: 20.4 };

test('newCharging / newPrecondition each get a distinct carId', () => {
  const a = newCharging();
  const b = newPrecondition();
  assert.equal(typeof a.carId, 'number');
  assert.notEqual(a.carId, b.carId, 'two schedules must not share the car key');
});

test('chargeScheduleToInput maps the local model onto the wire input', () => {
  const s = { ...newCharging(), carId: 42, days: [0, 2], startTime: '22:30', repeatWeekly: false };
  const inp = chargeScheduleToInput(s, HOME);
  assert.equal(inp.id, 42); // the car keys on carId, NOT the local string id
  assert.deepEqual(inp.days, [0, 2]);
  assert.equal(inp.startTime, '22:30'); // still HH:MM; the builder converts to minutes
  assert.equal(inp.oneTime, true, 'repeatWeekly:false -> one_time');
  assert.equal(inp.latitude, 44.8);
});

test('preconditionScheduleToInput carries time + coords + one_time', () => {
  const s = { ...newPrecondition(), carId: 7, time: '07:15', repeatWeekly: true };
  const inp = preconditionScheduleToInput(s, HOME);
  assert.equal(inp.id, 7);
  assert.equal(inp.preconditionTime, '07:15');
  assert.equal(inp.oneTime, false);
});

test('withCarIds backfills schedules persisted before carId existed', () => {
  // Simulate an old cache row with no carId (cast through unknown).
  const legacy = {
    charging: [{ id: 'x', kind: 'charging', days: [1], startEnabled: true, startTime: '22:00', endEnabled: false, endTime: '06:00', repeatWeekly: true, enabled: true }],
    precondition: [],
  } as unknown as Parameters<typeof withCarIds>[0];
  const fixed = withCarIds(legacy);
  assert.equal(typeof fixed.charging[0].carId, 'number', 'a legacy schedule gets a car key');
  // An already-keyed schedule is left as-is.
  const keyed = withCarIds({ charging: [{ ...newCharging(), carId: 99 }], precondition: [] });
  assert.equal(keyed.charging[0].carId, 99);
});

// ── Car → local (the inverse; car is source of truth) ────────────────────────
test('carToChargingSchedule decodes the car entry back to the local model', () => {
  // What the car returns for a Wed 06:00-19:00 charge schedule.
  const local = carToChargingSchedule({
    id: 1785403856,
    daysOfWeek: 4, // bit 2 = Wed under Mon=0
    startEnabled: true,
    startTime: 360, // 06:00
    endEnabled: true,
    endTime: 1140, // 19:00
    enabled: true,
    oneTime: false,
  });
  assert.equal(local.carId, 1785403856);
  assert.equal(local.id, 'car_1785403856'); // stable across reads → row doesn't re-mount
  assert.deepEqual(local.days, [2]);
  assert.equal(local.startTime, '06:00');
  assert.equal(local.endTime, '19:00');
  assert.equal(local.repeatWeekly, true); // !oneTime
  assert.equal(local.enabled, true);
});

test('a full round-trip local → wire input → car echo → local is stable', () => {
  const original = { ...newCharging(), carId: 1785403856, days: [3], startTime: '22:00', endTime: '06:00', repeatWeekly: false };
  const inp = chargeScheduleToInput(original, { latitude: 40, longitude: 25 });
  // Simulate the car echoing the stored values back (days as the bitmask the
  // builder encodes, times as minutes).
  const back = carToChargingSchedule({
    id: inp.id,
    daysOfWeek: 1 << 3, // Thu
    startEnabled: inp.startEnabled,
    startTime: 22 * 60,
    endEnabled: inp.endEnabled,
    endTime: 6 * 60,
    enabled: inp.enabled,
    oneTime: inp.oneTime,
  });
  assert.equal(back.carId, original.carId);
  assert.deepEqual(back.days, original.days);
  assert.equal(back.startTime, original.startTime);
  assert.equal(back.repeatWeekly, original.repeatWeekly);
});

test('carSchedulesToState — the car being EMPTY yields an empty list (the drift fix)', () => {
  // Deleting on the car must clear our UI, not leave a phantom row.
  assert.deepEqual(carSchedulesToState([], []), { charging: [], precondition: [] });
});

// ── Location scoping (bugs 7 & 8) ────────────────────────────────────────────
test('locationKey rounds coords (~110m) and rejects invalid input', () => {
  assert.equal(locationKey(42.69773, 23.32194), '42.698,23.322');
  assert.equal(locationKey(undefined, 23), null);
  assert.equal(locationKey(Number.NaN, 23), null);
});

test('scheduleLocations returns distinct places (nearby coords collapse to one)', () => {
  const a = { ...newCharging(), id: 'a', lat: 42.69773, lon: 23.32194 };
  const a2 = { ...newPrecondition(), id: 'a2', lat: 42.6977, lon: 23.3219 }; // same ~110m bucket
  const b = { ...newCharging(), id: 'b', lat: 40, lon: 25 };
  const keys = scheduleLocations({ charging: [a, b], precondition: [a2] })
    .map((l) => l.key)
    .sort();
  assert.deepEqual(keys, ['40.000,25.000', '42.698,23.322']);
});

test('schedulesAt filters by location; coordless schedules ride with Current', () => {
  const here = { ...newCharging(), id: 'h', lat: 42.698, lon: 23.322 };
  const there = { ...newCharging(), id: 't', lat: 40, lon: 25 };
  const legacy = { ...newCharging(), id: 'l' }; // no coords (demo/legacy)
  const state = { charging: [here, there, legacy], precondition: [] };
  const cur = schedulesAt(state, locationKey(42.698, 23.322), true);
  assert.deepEqual(cur.charging.map((s) => s.id).sort(), ['h', 'l']); // here + legacy, not there
  const oth = schedulesAt(state, locationKey(40, 25), false);
  assert.deepEqual(oth.charging.map((s) => s.id), ['t']); // only there; legacy does NOT ride here
});
