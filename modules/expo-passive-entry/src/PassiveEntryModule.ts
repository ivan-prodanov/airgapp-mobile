import { requireOptionalNativeModule } from 'expo';

export interface PassiveEntryLogEvent {
  line: string;
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
  setDeviceKey(privHex: string): boolean;
  deviceFingerprint(): string;
  // Native → JS diagnostics stream.
  addListener(event: 'log', listener: (e: PassiveEntryLogEvent) => void): EventSubscription;
}

// Optional on purpose: iOS-only, and a JS-only deploy onto a binary built before
// the module existed must not hard-crash at import — callers no-op instead.
export default requireOptionalNativeModule<PassiveEntryModule>('PassiveEntry');
