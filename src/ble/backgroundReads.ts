// backgroundReads — a global off-switch for the app's own background polling.
//
// Why this exists (measured 2026-07-26, the moment the focused read went live):
// the Car Link debug screen builds its OWN gateway via makeGateway(), which gets
// its own SessionQueue. useCarLink has a different one. Two queues, one BLE link,
// one monotonic session counter — precisely the race SessionQueue exists to
// prevent, just one level up where nothing was serializing them.
//
// It was survivable while the app polled every 20-60s and collisions were rare.
// With a focused read every 1.65s it is constant, and PE-4 caught it immediately:
// its "quiet" phase, which does no background work of its own, took 25 SECONDS
// and failed with
//
//   decrypt failed against this request's AAD (counter=2026, requestHash
//   mismatch — channel had a buffered response to a different request)
//
// which is two writers stepping on the same counter.
//
// The proper fix is one gateway for the app, shared by the debug screen. That is
// a real refactor of carlink.tsx and should be done deliberately. Until then this
// gives the probes a way to say "hold everything" so a measurement measures the
// thing it names, and — more importantly — so running a probe cannot corrupt the
// session the car is using.
//
// Counted rather than boolean: probes nest (PE-4 warms domain 3 inside its own
// suspend), and a plain flag would let the inner resume re-enable polling while
// the outer probe is still running.

let suspendCount = 0;

export function suspendBackgroundReads(): void {
  suspendCount += 1;
}

export function resumeBackgroundReads(): void {
  suspendCount = Math.max(0, suspendCount - 1);
}

export function backgroundReadsSuspended(): boolean {
  return suspendCount > 0;
}

// withBackgroundReadsSuspended — run fn with polling held off, and ALWAYS
// restore it. The finally matters more than usual: leaking a suspend would
// silently stop the app polling until relaunch, which looks exactly like the
// "all BLE messages ignored" symptom we have been chasing.
export async function withBackgroundReadsSuspended<T>(fn: () => Promise<T>): Promise<T> {
  suspendBackgroundReads();
  try {
    return await fn();
  } finally {
    resumeBackgroundReads();
  }
}

// Test-only reset.
export function __resetBackgroundReadSuspend(): void {
  suspendCount = 0;
}
