import PassiveEntryModule, { type PassiveEntryLogEvent } from './src/PassiveEntryModule';

// Native background passive-entry responder. iOS-only; every export no-ops
// gracefully when the native module isn't present (old binary / non-iOS), so a
// JS-only deploy never crashes at import.

export function startPassiveEntry(vin: string): void {
  PassiveEntryModule?.start(vin);
}

export function stopPassiveEntry(): void {
  PassiveEntryModule?.stop();
}

export function isPassiveEntryRunning(): boolean {
  return PassiveEntryModule?.isRunning() ?? false;
}

// Subscribe to the native diagnostics stream. Returns an unsubscribe fn (no-op
// when the native module is absent).
export function onPassiveEntryLog(listener: (line: string) => void): () => void {
  const sub = PassiveEntryModule?.addListener('log', (e: PassiveEntryLogEvent) => listener(e.line));
  return () => sub?.remove();
}
