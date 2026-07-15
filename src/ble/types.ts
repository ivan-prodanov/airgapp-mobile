// types.ts — shared interfaces for the BLE session engine.
//
// PiTransport is the narrow contract the engine needs from the Pi-side
// BLE forwarder: open a per-VIN BLE link, exchange opaque bytes over it,
// close it. The concrete fetch-backed implementation is built in Phase 2;
// the engine (session.ts) and its tests only depend on this interface, so
// a fake "car" transport can drive the full handshake + round-trip in Node.
//
// The browser reference (rpi-webclient/client/session.js) called an `api`
// object with `api.request('POST', '/sessions', { vin })` etc. and read a
// `.response_b64` field off the exchange result. We collapse that into three
// typed methods; `exchange` returns the response_b64 string directly.
export interface PiTransport {
  // POST /sessions { vin } → session_id
  openSession(vin: string): Promise<string>;
  // POST /sessions/{id}/exchange { payload_b64, timeout_ms } → response_b64
  exchange(sessionId: string, payloadB64: string, timeoutMs: number): Promise<string>;
  // DELETE /sessions/{id}
  closeSession(sessionId: string): Promise<void>;
}

// CarTransport is the transport-agnostic alias for PiTransport. PiTransport
// is the legacy name (it was written against the Pi-forwarder-only design);
// CarTransport is the name new code should reach for once a direct-BLE
// transport (talking to the car without a Pi forwarder in between) lands
// alongside PiClient as a second implementation of this same shape. Purely
// additive — PiTransport itself and its consumers are untouched.
export type CarTransport = PiTransport;

// DeviceKeys is the client's long-term P-256 identity. privateScalar is the
// 32-byte big-endian scalar (JWK `d`); publicKeyRaw is the 65-byte SEC1
// uncompressed point (0x04 || X || Y) the car uses as our keychain lookup id.
// The browser reference carried a WebCrypto CryptoKeyPair; the noble port
// takes raw bytes because there is no opaque CryptoKey concept.
export interface DeviceKeys {
  privateScalar: Uint8Array;
  publicKeyRaw: Uint8Array;
}

// SecretStore is the injectable, async key-value store keystore.ts and
// config.ts persist SENSITIVE material through: the device private scalar
// and the Pi bearer token. It is intentionally storage-agnostic — tests
// inject an in-memory implementation (see __testutils__/memorySecretStore.ts),
// and the app is expected to inject an `expo-secure-store`/iOS-Keychain-backed
// adapter in production. That adapter is a documented Phase-2 HARDWARE task
// (adding the native module needs a rebuild, per AGENTS.md) and is
// deliberately NOT implemented here — see keystore.ts's header comment for
// the seam. Callers must NEVER default this to AsyncStorage: AsyncStorage is
// plaintext on-disk storage and unsuitable for a private key or bearer token.
export interface SecretStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

// PiConfig is the persisted shape of one Pi connection: the base URL +
// bearer token (both secret — the token is what proves this device is
// enrolled) plus optional user-facing/display metadata. Owned by config.ts
// (load/save/clear/parseEnrolUrl); kept here alongside the other shared BLE
// interfaces so keystore.ts, config.ts, transport.ts and index.ts all share
// one definition instead of each declaring their own shape.
export interface PiConfig {
  baseUrl: string;
  token: string;
  vin?: string;
  nickname?: string;
  vehicleId?: string;
}

// Domain is the BLE routing domain a session targets.
//   2 = VEHICLE_SECURITY (VCSEC — lock/unlock, closures, status)
//   3 = INFOTAINMENT     (CarServer — climate, charging, honk, state reads)
export type Domain = 2 | 3;

// Session is one open, handshaken per-domain session. sessionKey and keyBytes
// are the SAME raw 16-byte AES-GCM key (the browser reference kept sessionKey
// as an opaque WebCrypto CryptoKey and keyBytes as the raw material; the noble
// port has no CryptoKey, so both fields hold the raw Uint8Array — kept
// separate only to preserve the reference's field shape for callers).
export interface Session {
  sessionId: string;
  domain: Domain;
  vin: string;
  routingAddress: Uint8Array;
  sessionKey: Uint8Array;
  keyBytes: Uint8Array;
  myPubRaw: Uint8Array;
  vehiclePubRaw: Uint8Array;
  epoch: Uint8Array;
  counter: number;
  clockBase: number;
  localBaselineMs: number;
  close(): Promise<void>;
}

// SessionParams is the common argument bag for the cache/handshake entry
// points (withCachedSession, openDirectSession, refreshCachedSession).
export interface SessionParams {
  transport: PiTransport;
  vin: string;
  deviceKeys: DeviceKeys;
  domain: Domain;
}
