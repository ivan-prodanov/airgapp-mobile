// The re-entry guard behind useNavigateOnce, kept as plain logic so it is
// testable without a renderer (see navGuard.test.ts).
//
// Why it exists: `router.push` has NO double-push protection. In expo-router
// 56 `push(href)` is `linkTo(href, { event: 'PUSH' })`, every call is appended
// to the routing queue, and `routingQueue.run` dispatches each one — so two
// taps dispatch two StackActions.push and the user lands on two identical
// screens. The outgoing screen stays mounted and touchable for the whole
// ~350ms `slide_from_right`, which is plenty of time to tap again.

// One screen transition's worth of deafness. Long enough to cover the slide,
// short enough that a deliberate second press (back, then tap again) still
// goes through.
export const NAV_GUARD_MS = 700;

export interface NavGuard {
  // Records and permits a navigation, or returns false if one just happened.
  // Synchronous by design: a lone tap must navigate on the very same frame, so
  // this is a leading-edge guard, NOT a trailing debounce like
  // components/useDebouncedCallback (which delays until the presses stop).
  allow(now: number): boolean;
  // Reopen the guard right away — the screen was focused again, so whatever we
  // pushed has been dismissed and the next press is a fresh intent.
  reset(): void;
}

export function createNavGuard(windowMs: number = NAV_GUARD_MS): NavGuard {
  // The timestamp of the last press we let through; -Infinity = wide open.
  let lastAllowed = -Infinity;
  return {
    allow(now) {
      // Measured from the ALLOWED press, not from the last attempt, so a fast
      // tapper cannot keep pushing the window forward and lock the row out.
      if (now - lastAllowed < windowMs) return false;
      lastAllowed = now;
      return true;
    },
    reset() {
      lastAllowed = -Infinity;
    },
  };
}
