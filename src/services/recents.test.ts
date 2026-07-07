import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupRecentsByDay, type RecentEntry } from './recents';
import type { Place } from './place';

const p = (id: string): Place => ({
  id, title: id, coordinate: { latitude: 42.7, longitude: 23.3 }, kind: 'recent', source: 'recent',
});
// Fixed "now" = 2026-07-07 12:00 local.
const NOW = new Date(2026, 6, 7, 12, 0, 0).getTime();
const DAY = 86_400_000;

test('buckets into Today / Yesterday / dated, newest group first', () => {
  const entries: RecentEntry[] = [
    { place: p('a'), savedAt: NOW - 60_000 },       // today
    { place: p('b'), savedAt: NOW - DAY - 60_000 }, // yesterday
    { place: p('c'), savedAt: new Date(2026, 6, 2, 9, 0, 0).getTime() }, // 2 Jul
  ];
  const groups = groupRecentsByDay(entries, NOW);
  assert.deepEqual(groups.map((g) => g.title), ['Today', 'Yesterday', '2 Jul']);
  assert.deepEqual(groups.map((g) => g.items.map((i) => i.id)), [['a'], ['b'], ['c']]);
});

test('keeps input order within a day and merges same-day entries', () => {
  const entries: RecentEntry[] = [
    { place: p('a'), savedAt: NOW - 1000 },
    { place: p('b'), savedAt: NOW - 2000 },
  ];
  const groups = groupRecentsByDay(entries, NOW);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].items.map((i) => i.id), ['a', 'b']);
});

test('empty input → no groups', () => {
  assert.deepEqual(groupRecentsByDay([], NOW), []);
});
