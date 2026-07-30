import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EMPTY_SCHEDULES,
  chargeScheduleToInput,
  formatDays,
  isComplete,
  newCharging,
  newPrecondition,
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
