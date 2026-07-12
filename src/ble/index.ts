// index.ts — the public src/ble surface.
//
// Everything the app/screens should import from the BLE stack goes through
// here. Internal engine guts (session.ts's handshake internals, crypto.ts's
// raw AES-GCM/AAD primitives, queue.ts, telemetry.ts's patch reducers, proto
// wire types) are deliberately NOT re-exported — they're implementation
// detail of gateway.ts's runCommand/readVcsecStatus/awakeSync loop, and
// leaking them here would let app code bypass the retry/fault-recovery
// policy those modules exist to enforce.

export { createCarGateway } from './gateway';
export type { CarGateway, CommandOutcome, CreateCarGatewayArgs } from './gateway';

export { PiClient, TransportError } from './transport';
export type { TransportErrorKind } from './transport';

export { buildCommand } from './commands';
export type { CarCommand, BuiltCommand } from './commands';

export { loadOrCreateDeviceKeys, deleteDeviceKeys, publicKeyBase64, deviceKeyFingerprint } from './keystore';

export { loadPiConfig, savePiConfig, clearPiConfig, parseEnrolUrl, isValidVin } from './config';

export type { PiConfig, DeviceKeys, SecretStore, PiTransport } from './types';
export type { VcsecStatus, InfotainmentSnapshot } from './telemetry';

// isCarLinkEnabled is the D7 kill switch: the whole BLE/CarLink surface is
// gated behind EXPO_PUBLIC_CAR_LINK=1. EXPO_PUBLIC_* env vars are inlined at
// build time (see .env.local / deploy-js.sh), so flipping this off ships a
// build with the feature statically disabled, not just hidden behind a
// runtime flag.
export function isCarLinkEnabled(): boolean {
  return process.env.EXPO_PUBLIC_CAR_LINK === '1';
}
