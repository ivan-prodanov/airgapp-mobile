import PassiveEntryModule, {
  type PassiveEntryLogEvent,
  type PassiveEntryFrameEvent,
  type PassiveEntryConnectionEvent,
} from './src/PassiveEntryModule';

export type { PassiveEntryConnectionEvent } from './src/PassiveEntryModule';

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

// ── model (b) byte-pipe: native owns the ONE central; TS moves bytes ──────────

// Write an already-framed (2-byte BE length prefix) message to 0212 via the
// native central. Returns false when the native module is absent.
export function passiveEntryWriteFrame(frameB64: string): boolean {
  return PassiveEntryModule?.writeFrame(frameB64) ?? false;
}

// Current link state + negotiated MTU (TS seeds blockLength = mtu-3).
export function passiveEntryConnectionState(): PassiveEntryConnectionEvent {
  return PassiveEntryModule?.connectionState() ?? { state: 'absent', mtu: 23 };
}

// The single-writer gate: true = foreground (TS signs via the pipe),
// false = background (native self-signs).
export function setPassiveEntryForegroundActive(active: boolean): void {
  PassiveEntryModule?.setForegroundResponderActive(active);
}

// Post the CPD "Child detected in car" alert — called by the JS foreground path
// when it decodes a CPDMessage; native self-posts in the background.
export function passiveEntryPostCpdWarning(): void {
  PassiveEntryModule?.postCpdWarning();
}

// Subscribe to raw 0213 notifications (foreground pipe mode). Returns unsubscribe.
export function onPassiveEntryFrame(listener: (dataB64: string) => void): () => void {
  const sub = PassiveEntryModule?.addListener('frame', (e: PassiveEntryFrameEvent) =>
    listener(e.dataB64),
  );
  return () => sub?.remove();
}

// Subscribe to native link-state changes. Returns unsubscribe.
export function onPassiveEntryConnectionState(
  listener: (e: PassiveEntryConnectionEvent) => void,
): () => void {
  const sub = PassiveEntryModule?.addListener('connectionState', listener);
  return () => sub?.remove();
}

// Subscribe to the car's LE bond being removed (user forgot the device in iOS
// Settings — peerRemovedPairingInformation). Returns unsubscribe.
export function onPassiveEntryBondRemoved(listener: () => void): () => void {
  const sub = PassiveEntryModule?.addListener('bondRemoved', () => listener());
  return () => sub?.remove();
}

// ── geographic wake source (survives a phone reboot; CB restoration doesn't) ──

// Feed the car's parked position (from telemetry) so native can monitor a region
// around it and re-arm BLE on arrival.
export function setPassiveEntryCarLocation(lat: number, lon: number): void {
  PassiveEntryModule?.setCarLocation(lat, lon);
}

// Ask for Location "Always" — required for a region entry to wake a terminated
// app. Call from the foreground once passive entry is armed.
export function requestPassiveEntryAlwaysLocation(): void {
  PassiveEntryModule?.requestAlwaysLocation();
}
