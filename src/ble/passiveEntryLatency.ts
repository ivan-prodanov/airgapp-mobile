// passiveEntryLatency — make the deaf window VISIBLE.
//
// The bug this exists for (found 2026-07-26, present long before it):
// foregroundBleLink.onNativeFrame skips the always-on responder branch entirely
// while an exchange is in flight. Frames go to the correlator's inbox, and
// drainInbox hands the non-matching ones to onUnsolicited — which does not
// answer challenges. So a challenge arriving mid-exchange is not deferred, it is
// NEVER ANSWERED, and until now nothing anywhere counted that.
//
// That silence is the real defect. The 3-4s unlock was a symptom; the reason it
// went unnoticed for weeks is that a lost challenge produced no log line, no
// counter, nothing. So this module is deliberately ALWAYS ON rather than probe-
// only: the deaf window should be visible in ordinary use, not just when we go
// looking for it.
//
// Why this is not only about today's focused read. Every in-flight command opens
// the window, and a TIMED-OUT command holds it open for the full 4-6s. Timeouts
// happened long before the focused read existed, so this is a strong candidate
// for the intermittent misses already on record — the 11:32 walk-up that did
// nothing, and "most cases worked yesterday night, it's just one time it did
// not". Today's change did not create the bug; it raised the rate until it
// became reproducible.

export interface ChallengeRecord {
  atMs: number;
  // Was a command exchange in flight when this challenge arrived? If so the
  // responder was never consulted and the challenge is LOST.
  duringExchange: boolean;
  // Milliseconds from the challenge arriving to our answer being written.
  // null when we never answered it.
  answerLatencyMs: number | null;
}

export interface LatencyStats {
  total: number;
  answered: number;
  lost: number;
  // Of the lost ones, how many were lost specifically to the deaf window. Kept
  // apart from `lost` because a challenge can also go unanswered for legitimate
  // reasons — the circuit breaker, a rate limit, a malformed token — and
  // conflating those would hide the bug we are chasing behind the ones we chose.
  lostToDeafWindow: number;
  medianLatencyMs: number | null;
  worstLatencyMs: number | null;
}

const MAX_RECORDS = 200;
let records: ChallengeRecord[] = [];
// The challenge we are currently waiting to answer, so the write can be paired
// back to its arrival.
let pending: { atMs: number; duringExchange: boolean } | null = null;

// noteChallengeArrived — called for EVERY inbound challenge, answered or not.
export function noteChallengeArrived(atMs: number, duringExchange: boolean): void {
  // A challenge that arrives while we are deaf is closed out immediately: the
  // responder will never be called for it, so there is no answer to wait for.
  if (duringExchange) {
    push({ atMs, duringExchange: true, answerLatencyMs: null });
    return;
  }
  pending = { atMs, duringExchange: false };
}

// noteAnswerWritten — called when the sealed answer actually reaches the link.
// Not when we decide to answer: the whole question is how long the write takes
// to get out, so timing the decision would measure the wrong thing.
export function noteAnswerWritten(atMs: number): void {
  if (!pending) return;
  push({ ...pending, answerLatencyMs: Math.max(0, atMs - pending.atMs) });
  pending = null;
}

// noteChallengeDropped — the responder was consulted and declined (circuit
// breaker, rate limit, bad token). Distinct from the deaf window on purpose.
export function noteChallengeDropped(): void {
  if (!pending) return;
  push({ ...pending, answerLatencyMs: null });
  pending = null;
}

function push(r: ChallengeRecord): void {
  records.push(r);
  if (records.length > MAX_RECORDS) records = records.slice(-MAX_RECORDS);
}

export function latencyStats(since = 0): LatencyStats {
  const rs = records.filter((r) => r.atMs >= since);
  const latencies = rs
    .map((r) => r.answerLatencyMs)
    .filter((v): v is number => v !== null)
    .sort((a, b) => a - b);
  const median = latencies.length ? latencies[Math.floor(latencies.length / 2)] : null;
  return {
    total: rs.length,
    answered: latencies.length,
    lost: rs.length - latencies.length,
    lostToDeafWindow: rs.filter((r) => r.duringExchange).length,
    medianLatencyMs: median,
    worstLatencyMs: latencies.length ? latencies[latencies.length - 1] : null,
  };
}

export function recordsSince(since = 0): ChallengeRecord[] {
  return records.filter((r) => r.atMs >= since);
}

export function resetLatencyStats(): void {
  records = [];
  pending = null;
}

// formatLatencyStats — one block, written the way it should be read.
export function formatLatencyStats(s: LatencyStats): string[] {
  const out = [
    `challenges: ${s.total}  answered: ${s.answered}  LOST: ${s.lost}` +
      (s.lostToDeafWindow > 0 ? `  (${s.lostToDeafWindow} to the DEAF WINDOW)` : ''),
  ];
  if (s.answered > 0) out.push(`answer latency: median ${s.medianLatencyMs}ms, worst ${s.worstLatencyMs}ms`);
  // State the pass condition inline. A run that loses nothing is the ONLY
  // acceptable result, and burying that in prose invites "well, 1 of 12 is fine".
  out.push(
    s.lostToDeafWindow === 0
      ? 'PASS: no challenge was lost to an in-flight exchange.'
      : `FAIL: ${s.lostToDeafWindow} challenge(s) arrived while we were deaf and were never answered.`,
  );
  return out;
}
