// hedgeGuard.ts — the correctness core of the two-pipe hedged exchange (RE #10).
//
// THE PROBLEM. When one crypto session (one counter) is delivered over two pipes
// (phone BLE + Pi), the fallback leg resends the BYTE-IDENTICAL frame (same
// counter N). If leg-1 already landed, the car has already consumed counter N,
// so leg-2 comes back as a REJECT — but the command DID execute. We must read
// that reject as "already landed" and NOT reseal at N+1 (which would double-fire
// an actuation like unlock).
//
// THE TRAP (RE #10 Q3). You CANNOT decide "landed" from the fault NUMBER: the
// universal and VCSEC fault enums assign opposite meanings to the same integers.
//   universal 6 = INVALID_TOKEN_OR_COUNTER = counter already consumed = LANDED
//   VCSEC     6 = FAULT_AES_DECRYPT_AUTH   = frame never validated    = NOT landed
// A bare-number guard would mark a never-run command done, or re-fire a landed
// one. So the guard keys off the fresh SignedSessionInfo the car attaches to a
// counter-reject, which is namespace-independent: if its epoch matches the epoch
// we sealed at AND its window-top has advanced to or past our counter N, then
// counter N was consumed by the car → the command LANDED.
//
// Pure — no I/O — so the whole decision is node-testable against the exact cases.

export type LegOutcome =
  | 'landed' // the command executed exactly once; do NOT reseal
  | 'not-landed' // the frame never took effect; a real failure to surface
  | 'indeterminate'; // cannot prove either way → caller must reconcile via state

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

export interface FallbackReply {
  // The epoch + counter we sealed the frame at (this command's identity).
  sealedEpoch: Uint8Array;
  sealedCounter: number;
  // A clean success on this leg (operationStatus == 0 / a real reply), regardless
  // of namespace. Short-circuits to landed.
  cleanSuccess: boolean;
  // The SignedSessionInfo the car attaches to a counter-reject, parsed to its
  // epoch + window-top (the highest counter the car has accepted). null when the
  // reject carried none (then we cannot prove landing — see RE #10 probe (b),
  // whether VCSEC attaches it is inferred).
  rejectSessionInfo: { epoch: Uint8Array; windowTop: number } | null;
}

// classifyFallbackReply decides whether the command already landed, per RE #10.
// INDETERMINATE deliberately never asserts success: for an actuation the caller
// must re-query the car's real state and reconcile, never assume.
export function classifyFallbackReply(reply: FallbackReply): LegOutcome {
  if (reply.cleanSuccess) return 'landed';

  const info = reply.rejectSessionInfo;
  if (!info) return 'indeterminate'; // no proof either way

  // An epoch roll mid-command (rare, ~1s window) makes the window-top
  // incomparable to our counter — cannot prove landing.
  if (!bytesEqual(info.epoch, reply.sealedEpoch)) return 'indeterminate';

  // Same epoch: the window-top is directly comparable. Under single-writer,
  // counter N belongs ONLY to this command, so a top at or past N means the car
  // consumed exactly our frame → landed. A top still below N means our frame was
  // rejected for a reason OTHER than a duplicate counter → genuinely not landed.
  return info.windowTop >= reply.sealedCounter ? 'landed' : 'not-landed';
}
