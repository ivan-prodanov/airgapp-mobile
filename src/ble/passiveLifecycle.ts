// passiveLifecycle.ts — the single-writer rule for passive entry.
//
// With ONE enrolled key, the native background responder and the JS foreground
// responder share the car's per-key counter. They must NEVER sign concurrently,
// or they race that counter. The rule that guarantees it is trivial BECAUSE it's
// keyed off app lifecycle:
//
//   • Foreground → JS owns passive entry (the existing inline responder). Native
//     stands down.
//   • Background → JS is suspended, so it isn't driving the Pi and can't sign;
//     native is the ONLY possible signer, so it owns passive entry.
//
// So "who may sign" is a pure function of {appActive, nativeUp}. There is never a
// concurrent window in steady state; the only overlap is the brief lifecycle
// transition, which routable makes a recoverable reject rather than a hazard.
//
// Kept in TS (not just Swift) so the rule is unit-tested and unambiguous; the
// native side reads the same rule.

export type PassiveSigner = 'native' | 'js' | 'none';

export interface PassiveLifecycleState {
  // Is the app in the foreground (iOS "active")?
  appActive: boolean;
  // Is the native central up and holding a link it could answer on?
  nativeUp: boolean;
}

export function whoMaySign(state: PassiveLifecycleState): PassiveSigner {
  // Foreground: JS owns it, full stop — even if native happens to be up, it must
  // stand down so only one signer is live.
  if (state.appActive) return 'js';
  // Background: native if it's up; otherwise nobody (JS is suspended).
  return state.nativeUp ? 'native' : 'none';
}
