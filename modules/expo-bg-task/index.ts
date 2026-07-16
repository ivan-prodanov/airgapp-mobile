import BgTaskModule from './src/BgTaskModule';

// Ask iOS for a background-task assertion ("finish what you started", ~30s —
// comfortably more than our 25s command deadline) so work started just before
// the app is backgrounded still runs to completion instead of being suspended
// mid-flight. Returns an opaque id to pass to endBackgroundTask, or null if the
// assertion couldn't be taken (no native module, or iOS refused) — in which
// case the caller must simply proceed without one.
export function beginBackgroundTask(name: string): number | null {
  return BgTaskModule?.beginBackgroundTask(name) ?? null;
}

// Release an assertion taken by beginBackgroundTask. Idempotent and safe with
// an id that already expired or was never valid.
export function endBackgroundTask(id: number): void {
  BgTaskModule?.endBackgroundTask(id);
}
