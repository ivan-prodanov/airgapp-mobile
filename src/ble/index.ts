// index.ts — the public src/ble surface.
//
// Everything the app/screens should import from the BLE stack goes through
// here. Internal engine guts (session.ts's handshake internals, crypto.ts's
// raw AES-GCM/AAD primitives, queue.ts, proto wire types) are deliberately
// NOT re-exported — they're implementation detail of gateway.ts's
// runCommand/readVcsecStatus/awakeSync loop, and leaking them here would let
// app code bypass the retry/fault-recovery policy those modules exist to
// enforce. telemetry.ts's patch reducers (vcsecStatusToPatch/
// infotainmentToPatch/CLOSURE_INTENT_GRACE_MS) ARE re-exported below — they
// are pure stateless mappers with no session/crypto/retry involvement, so
// exposing them doesn't bypass any policy.

export { createCarGateway } from './gateway';
export type { CarGateway, CommandOutcome, CreateCarGatewayArgs, InfotainmentStateKey } from './gateway';
export type { CarActionStatus } from './carActionStatus';
// Session lifecycle — callers must free the Pi's single BLE session on
// teardown (screen unmount / app background) so it isn't orphaned (the Pi
// holds bleMu for ~5 min otherwise, blocking the next session).
export { closeAllCachedSessions, closeCachedSession, peekPiSessionId } from './session';

export { PiClient, TransportError } from './transport';
export type { TransportErrorKind } from './transport';

export { createSelectingTransport } from './transportSelector';
export type { TransportCandidate } from './transportSelector';

export { buildCommand } from './commands';
export type { CarCommand, BuiltCommand } from './commands';

export { loadOrCreateDeviceKeys, loadDeviceKeys, deleteDeviceKeys, publicKeyBase64, deviceKeyFingerprint } from './keystore';

export {
  loadPiConfig,
  savePiConfig,
  clearPiConfig,
  loadCarConfig,
  saveCarConfig,
  clearCarConfig,
  parseEnrolUrl,
  isValidVin,
} from './config';

export type { PiConfig, CarConfig, DeviceKeys, SecretStore, PiTransport, CarTransport } from './types';

// The telemetry patch reducers are pure stateless mappers (decoded snapshot
// -> Partial<VehicleViewState>, no session/crypto/retry involved) that
// useCarLink needs to turn gateway reads into view-state patches. Exposing
// them does NOT bypass any policy — see telemetry.ts's header comment for
// why the rest of the engine's guts stay unexported.
export { vcsecStatusToPatch, infotainmentToPatch, CLOSURE_INTENT_GRACE_MS } from './telemetry';
export type { VcsecStatus, InfotainmentSnapshot } from './telemetry';

// isCarLinkEnabled is the D7 kill switch: the whole BLE/CarLink surface is
// gated behind EXPO_PUBLIC_CAR_LINK=1. EXPO_PUBLIC_* env vars are inlined at
// build time (see .env.local / deploy-js.sh), so flipping this off ships a
// build with the feature statically disabled, not just hidden behind a
// runtime flag.
export function isCarLinkEnabled(): boolean {
  return process.env.EXPO_PUBLIC_CAR_LINK === '1';
}
