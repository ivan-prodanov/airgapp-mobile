import { useEffect, useRef } from 'react';

// A debounced callback: each call (re)starts a `delayMs` timer; the LATEST args win and fire once the
// calls stop. Flushes any pending call on unmount, so a value entered right before the component goes
// away (e.g. closing a sheet mid-adjust) still lands. Used by the speed steppers to match the Tesla app,
// whose Adjust-Speed-Limit control carries `debounceMS: 1200` — it updates its own number immediately but
// only sends the car command ~1.2s after you stop, instead of one command per press.
export function useDebouncedCallback<A extends unknown[]>(
  fn: (...args: A) => void,
  delayMs: number,
): (...args: A) => void {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<A | null>(null);

  const flush = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const p = pending.current;
    pending.current = null;
    if (p) fnRef.current(...p);
  };

  // Flush on unmount so a pending value isn't dropped when the sheet closes.
  useEffect(() => flush, []);

  return (...args: A) => {
    pending.current = args;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, delayMs);
  };
}
