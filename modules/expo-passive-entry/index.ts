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

// Verify the native routable seal matches the TS golden byte-for-byte.
export function passiveEntrySealGolden(): string {
  return PassiveEntryModule?.sealGolden() ?? 'native module absent';
}

// Verify native P-256 ECDH + SHA1-KDF matches the TS golden.
export function passiveEntryEcdhGolden(): string {
  return PassiveEntryModule?.ecdhGolden() ?? 'native module absent';
}

export function passiveEntryHandshakeGolden(): string {
  return PassiveEntryModule?.handshakeGolden() ?? 'native module absent';
}

// Hand native its own background-readable copy of the enrolled key (once).
export function setPassiveEntryDeviceKey(privHex: string): boolean {
  return PassiveEntryModule?.setDeviceKey(privHex) ?? false;
}

// Native's fingerprint of the stored key — compare to JS deviceKeyFingerprint.
export function passiveEntryDeviceFingerprint(): string {
  return PassiveEntryModule?.deviceFingerprint() ?? 'native module absent';
}

// Subscribe to the native diagnostics stream. Returns an unsubscribe fn (no-op
// when the native module is absent).
export function onPassiveEntryLog(listener: (line: string) => void): () => void {
  const sub = PassiveEntryModule?.addListener('log', (e: PassiveEntryLogEvent) => listener(e.line));
  return () => sub?.remove();
}
