import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EMPTY_SCHEDULES,
  formatDays,
  isComplete,
  newCharging,
  newPrecondition,
  removeSchedule,
  scheduleSubtitle,
  scheduleTitle,
  setEnabled,
  toggleDay,
  upsertCharging,
  upsertPrecondition,
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
