import { useCallback, useMemo, useRef } from 'react';
import { useFocusEffect, useRouter, type Href } from 'expo-router';

import { NAV_GUARD_MS, createNavGuard } from './navGuard';

// A router whose forward navigations survive a double-tap.
//
// `router.push` pushes unconditionally (see navGuard.ts), and the screen you
// are leaving keeps taking touches for the whole ~350ms `slide_from_right` —
// so tapping Location twice quickly used to stack two Location screens and
// cost the user two back presses. This wraps push/navigate in a leading-edge
// guard: the first tap navigates immediately (no added latency for a normal
// press) and the rest of the burst is dropped.
//
// ONE guard per screen, shared by every row: call this once and use it for all
// of that screen's destinations, so tapping Location and then Charging mid-
// slide cannot stack them either.
export function useNavigateOnce(windowMs: number = NAV_GUARD_MS) {
  const router = useRouter();
  const guard = useRef(createNavGuard(windowMs)).current;

  // Whatever we pushed has been dismissed — the next press is a fresh intent,
  // so don't leave the row dead for the tail of the window.
  useFocusEffect(
    useCallback(() => {
      guard.reset();
    }, [guard]),
  );

  return useMemo(
    () => ({
      push: (href: Href) => {
        if (guard.allow(Date.now())) router.push(href);
      },
      navigate: (href: Href) => {
        if (guard.allow(Date.now())) router.navigate(href);
      },
    }),
    [guard, router],
  );
}
