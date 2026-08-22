// wakeGate.ts — "wake the main computer before an Infotainment command" primitive.
//
// Factored out of the dispatch path so it's unit-testable with an injected clock/sleep. Mirrors what
// refresh() already does and what the Tesla app does at its USER_SENT_COMMAND tier: if the car isn't awake,
// send a (VCSEC-domain) wake and poll a FRESH readiness probe until the main computer reports awake, bounded
// by a deadline. The probe is deliberately a fresh read, never the possibly-stale cached `awake` flag (which
// is up to a poll-interval old, and arbitrarily stale right after a cold launch).

// Real waking takes ~10–60s over the cloud (Tesla Fleet API); a BLE VCSEC wake is faster, so 30s is generous.
export const WAKE_DEADLINE_MS = 30_000;
export const WAKE_POLL_MS = 2_000;

export type WakeResult = 'awake' | 'timeout' | 'aborted';

export interface WakeGateDeps {
  // Fresh readiness probe: true iff the main computer is awake right now. Must not throw (swallow → false).
  probeAwake: () => Promise<boolean>;
  // Send the (VCSEC) wake. Best-effort; must not throw.
  wake: () => Promise<void>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  // Supersession: if the command that triggered this wake is cancelled, stop waking.
  signal?: { readonly aborted: boolean };
}

// Ensure the car is awake enough to accept an Infotainment command. Returns 'awake' once it reports up,
// 'timeout' if it never came up within the deadline, or 'aborted' if the command was superseded meanwhile.
export async function ensureAwake(deps: WakeGateDeps): Promise<WakeResult> {
  if (deps.signal?.aborted) return 'aborted';
  if (await deps.probeAwake()) return 'awake'; // already up — no wake, no wait
  await deps.wake();
  const deadline = deps.now() + WAKE_DEADLINE_MS;
  while (deps.now() < deadline) {
    if (deps.signal?.aborted) return 'aborted';
    await deps.sleep(WAKE_POLL_MS);
    if (deps.signal?.aborted) return 'aborted';
    if (await deps.probeAwake()) return 'awake';
  }
  return 'timeout';
}
