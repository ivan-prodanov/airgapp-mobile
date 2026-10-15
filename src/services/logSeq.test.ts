import { test } from 'node:test';
import assert from 'node:assert/strict';

import { seqBaseFrom, storedSeq } from './logSeq';

// The log ring keys rows on `seq`, and logbus restarts `seq` at 0 on every boot. A July
// capture left MAX(seq) at ~37k, so the sink's noisy-category trim
// (`seq <= MAX(seq) - 20000`) deleted every new boot's poll/read rows the moment they
// landed — 812 gaps / 5,595 missing rows in one 88-minute boot on 2026-09-05. The stored
// seq must therefore continue from the table's max, so a restart never collides with,
// nor sorts below, what is already there.

test('a fresh table starts at 0', () => {
  assert.equal(seqBaseFrom(null), 0);
  assert.equal(seqBaseFrom(undefined), 0);
});

test('a restart continues after the highest stored seq', () => {
  assert.equal(seqBaseFrom(37836), 37837);
  assert.equal(storedSeq(37837, 0), 37837);
  assert.equal(storedSeq(37837, 5), 37842);
});

test('every stored seq of a new boot is above every stored seq of the old one', () => {
  const base = seqBaseFrom(37836);
  for (let s = 0; s < 1000; s++) assert.ok(storedSeq(base, s) > 37836);
});

test('junk from the DB is treated as an empty table', () => {
  assert.equal(seqBaseFrom(Number.NaN), 0);
  assert.equal(seqBaseFrom(-5), 0);
});
