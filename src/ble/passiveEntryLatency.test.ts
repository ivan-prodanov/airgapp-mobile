import test from 'node:test';
import assert from 'node:assert/strict';

import {
  noteChallengeArrived,
  noteAnswerWritten,
  noteChallengeDropped,
  latencyStats,
  formatLatencyStats,
  resetLatencyStats,
} from './passiveEntryLatency';

test('a challenge answered promptly records its latency', () => {
  resetLatencyStats();
  noteChallengeArrived(1000, false);
  noteAnswerWritten(1120);
  const s = latencyStats();
  assert.equal(s.total, 1);
  assert.equal(s.answered, 1);
  assert.equal(s.lost, 0);
  assert.equal(s.medianLatencyMs, 120);
});

test('a challenge arriving mid-exchange is recorded as LOST immediately', () => {
  // The defect: the responder is never consulted for these, so there is no
  // answer to wait for and no point leaving it pending.
  resetLatencyStats();
  noteChallengeArrived(1000, true);
  const s = latencyStats();
  assert.equal(s.total, 1);
  assert.equal(s.lost, 1);
  assert.equal(s.lostToDeafWindow, 1);
  assert.equal(s.answered, 0);
});

test('a DECLINED challenge is lost but NOT counted against the deaf window', () => {
  // Circuit breaker / rate limit / bad token are choices we made. Merging them
  // with the deaf window would let a real defect hide behind an intended one.
  resetLatencyStats();
  noteChallengeArrived(1000, false);
  noteChallengeDropped();
  const s = latencyStats();
  assert.equal(s.lost, 1);
  assert.equal(s.lostToDeafWindow, 0, 'declining is not being deaf');
});

test('the verdict line says FAIL when anything was lost to the deaf window', () => {
  resetLatencyStats();
  noteChallengeArrived(1000, false);
  noteAnswerWritten(1100);
  noteChallengeArrived(2000, true);
  const text = formatLatencyStats(latencyStats()).join('\n');
  assert.match(text, /FAIL/);
  assert.match(text, /1 challenge\(s\) arrived while we were deaf/);
});

test('the verdict line says PASS only when ZERO were lost to the deaf window', () => {
  // Deliberately strict: the pass condition is zero, not "few". A run that loses
  // one in twelve is a broken door lock, not a good result.
  resetLatencyStats();
  for (let i = 0; i < 12; i++) {
    noteChallengeArrived(1000 * i, false);
    noteAnswerWritten(1000 * i + 90);
  }
  const text = formatLatencyStats(latencyStats()).join('\n');
  assert.match(text, /PASS/);
  assert.doesNotMatch(text, /FAIL/);
});

test('median is robust to one slow answer, and worst still surfaces it', () => {
  resetLatencyStats();
  for (const [at, ans] of [
    [0, 80],
    [1000, 1090],
    [2000, 2085],
    [3000, 7000], // one 4s outlier — the symptom Ivan actually felt
  ] as const) {
    noteChallengeArrived(at, false);
    noteAnswerWritten(ans);
  }
  const s = latencyStats();
  assert.ok(s.medianLatencyMs !== null && s.medianLatencyMs < 200, 'median stays honest');
  assert.equal(s.worstLatencyMs, 4000, 'the outlier must not be smoothed away');
});

test('stats can be scoped to a probe window', () => {
  resetLatencyStats();
  noteChallengeArrived(1000, true); // before the window
  noteChallengeArrived(9000, true); // inside it
  assert.equal(latencyStats(5000).total, 1);
  assert.equal(latencyStats().total, 2);
});

test('an answer with no pending challenge is ignored, not miscounted', () => {
  // Ordinary pushes flow through the same path; a stray write must not invent a
  // zero-latency record and make the numbers look better than they are.
  resetLatencyStats();
  noteAnswerWritten(1000);
  assert.equal(latencyStats().total, 0);
});
