import { requireOptionalNativeModule } from 'expo';

export interface PassiveEntryLogEvent {
  line: string;
}

// A raw 0213 notification forwarded from the native central (foreground pipe
// mode). base64 so it crosses the bridge without byte mangling.
export interface PassiveEntryFrameEvent {
  dataB64: string;
}

export interface PassiveEntryConnectionEvent {
  state: string; // 'connected' | 'disconnected' | a CBManagerState name
  mtu: number; // negotiated ATT MTU (TS uses mtu-3 as blockLength)
}

// Minimal shape of an Expo event subscription — avoids a direct dependency on
// expo-modules-core's type entrypoint (not resolvable from this local module's
// tsconfig), and all we use is remove().
interface EventSubscription {
  remove(): void;
}

declare class PassiveEntryModule {
  // Start the native central for `vin` (Task 1 scaffold: echoes over `log`).
  start(vin: string): void;
  // Stop the native central.
  stop(): void;
  // Whether the native central is currently holding a link.
  isRunning(): boolean;
  // Native seal golden self-test (pure crypto; returns MATCH/MISMATCH).
  sealGolden(): string;
  ecdhGolden(): string;
  handshakeGolden(): string;
  setDeviceKey(privHex: string): boolean;
  deviceFingerprint(): string;
  // model (b) byte-pipe: write an already-framed message to 0212 (raw).
  writeFrame(frameB64: string): boolean;
  // Current link state + negotiated MTU.
  connectionState(): PassiveEntryConnectionEvent;
  // Single-writer gate: true = foreground (TS signs), false = background (native).
  setForegroundResponderActive(active: boolean): void;
  // Native → JS streams.
  addListener(event: 'log', listener: (e: PassiveEntryLogEvent) => void): EventSubscription;
  addListener(event: 'frame', listener: (e: PassiveEntryFrameEvent) => void): EventSubscription;
  addListener(
    event: 'connectionState',
    listener: (e: PassiveEntryConnectionEvent) => void,
  ): EventSubscription;
}

// Optional on purpose: iOS-only, and a JS-only deploy onto a binary built before
// the module existed must not hard-crash at import — callers no-op instead.
export default requireOptionalNativeModule<PassiveEntryModule>('PassiveEntry');
