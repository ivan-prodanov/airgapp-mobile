// session.ts — Tesla BLE session engine, ported from the browser reference
// (rpi-webclient/client/session.js, lines ~68–1155) to pure-sync TypeScript.
//
// This is the protocol state machine that drives a command from the client
// to the car without the Pi ever seeing plaintext or a session key. The Pi's
// role (behind the PiTransport interface) is reduced to "forward these opaque
// bytes over BLE and bring the response back."
//
// The flow for one command:
//
//   1. transport.openSession(vin)                          → open BLE link
//   2. RoutableMessage{ sessionInfoRequest{ pub, } , uuid=challenge }
//      → transport.exchange → car returns SessionInfo + HMAC tag
//   3. car_eph_pub = SessionInfo.publicKey
//      session_key = SHA1(ECDH(our_priv, car_eph_pub))[:16]
//      counter / epoch / clockTime seeded from SessionInfo
//   4. Encrypt inner Action → RoutableMessage{ ciphertext, AES_GCM sig }
//      → transport.exchange → car returns status and/or encrypted payload
//   5. transport.closeSession(id) when the last domain releases.
//
// Ported substitutions from the browser reference:
//   • airgap.loadProto() (async) removed — proto codec is sync (./proto).
//   • crypto.subtle.importKey removed — noble crypto is sync and takes the
//     raw 16-byte key; session.sessionKey IS the raw Uint8Array (no CryptoKey).
//   • crypto.getRandomValues → randomBytes (@noble/hashes/utils).
//   • the `api` object → the typed PiTransport (openSession/exchange/closeSession).
//   • IndexedDB persistence (_persistSessionMetadata / _hydrateSessionFromIdb)
//     dropped for v1 — in-memory only; a fresh handshake on launch is correct
//     and safe (deferred as P5.T1). _persistSessionMetadata is a no-op.

import { randomBytes } from '@noble/hashes/utils';
import { sha1 } from '@noble/hashes/sha1';

import {
  deriveSessionKeyMaterial,
  importPeerPubkey,
  hmacSubkey,
  buildAesGcmMetadata,
  buildAesGcmResponseMetadata,
  makeRequestHash,
  aesGcmEncrypt,
  aesGcmDecrypt,
  MetadataBlockBuilder,
  TAG,
  SIGNATURE_TYPE,
  bytesToHex,
} from './crypto';
import {
  RoutableMessage,
  SessionInfo,
  Action,
  VCSECUnsignedMessage,
  encodeMessage,
  decodeMessage,
} from './proto';
import { bytesToBase64, base64ToBytes } from './bytes';
import {
  encodeUnsignedAuthResponse,
  encodeAuthenticationResponse,
  AUTH_LEVEL,
} from './passiveEntryAuth';
import type { Domain, DeviceKeys, PiTransport, Session, SessionParams } from './types';

// DEBUG gates the non-security-critical success chatter. Kept false: RN
// Hermes Release doesn't surface console.log to device syslog anyway, and
// the security-critical warn/error paths (HMAC mismatch, stale frame) log
// unconditionally.
const DEBUG = false;
function debug(...args: unknown[]): void {
  if (DEBUG) console.log(...args);
}

// --- Tesla protocol constants ----------------------------------------------
//   COMMAND_LIFETIME_SEC: how far in the future the AAD's EXPIRES_AT lands.
//     The car rejects commands stamped past their lifetime → tight replay
//     window even if the bearer leaks.
//   ROUTING_ADDRESS_BYTES: 16 random bytes per session so the car routes
//     responses back to this client. BLE is point-to-point so mostly
//     symbolic, but we follow the SDK's shape.
const COMMAND_LIFETIME_SEC = 5;
const ROUTING_ADDRESS_BYTES = 16;
const SESSION_INFO_TIMEOUT_MS = 4000;
const COMMAND_TIMEOUT_MS = 6000;

// Retry policy constants (Tesla Android nb0/C24292a.java): 10 attempts,
// 100ms delay for transients. Semantic faults aren't retried.
export const MAX_BLE_ATTEMPTS = 10;
export const TRANSIENT_DELAY_MS = 100;

// SessionInfo.status — the car's verdict on whether our key is still enrolled.
// SESSION_INFO_STATUS_KEY_NOT_ON_WHITELIST(1) is how the official app knows to
// prompt "Set Up Phone Key" (research doc §2.5). We decoded SessionInfo from the
// first day and never read this field, so a de-enrolled key surfaced only as
// mystery transport failures — exactly the 2026-07-20 incident, where the car
// had to be restarted and the phone key re-added before ANY app worked.
export const SESSION_INFO_STATUS_KEY_NOT_ON_WHITELIST = 1;

// KeyNotOnWhitelistError is thrown when the car says our key is gone. Distinct
// from a transport fault ON PURPOSE: retrying/reconnecting cannot fix it, only
// re-enrollment can, so the UI must say so rather than spin.
export class KeyNotOnWhitelistError extends Error {
  readonly needsReEnrollment = true;
  constructor() {
    super('key is not on the car whitelist — re-enroll the phone key (tap the NFC card)');
    this.name = 'KeyNotOnWhitelistError';
  }
}

export const DOMAIN_INFOTAINMENT: Domain = 3;
export const DOMAIN_VEHICLE_SECURITY: Domain = 2;

// FLAG_ENCRYPT_RESPONSE — bit-position 1 on the RoutableMessage.flags
// bitfield (value 1 << 1 = 2). Set on state-read requests; the car
// otherwise refuses to send the response in the clear. The flag MUST appear
// in both the wire RoutableMessage AND the AAD metadata so the digests match.
export const FLAG_ENCRYPT_RESPONSE_BIT = 1 << 1;

export type FaultCategory = 'session-stale' | 'transient' | 'semantic';
export interface FaultVerdict {
  category: FaultCategory;
  retryable: boolean;
  delayMs: number;
}

// evaluateFault classifies a car-side fault into a retry policy. Mirrors
// Tesla Android's nb0/C24292a.java table:
//   session-stale: INVALID_SIGNATURE(5), INVALID_TOKEN_OR_COUNTER(6),
//     INCORRECT_EPOCH(15), INACTIVE_KEY(4), TIME_EXPIRED(17) — refresh
//     SessionInfo on the same BLE link, then retry (delay 0).
//   transient: BUSY(1), TIMEOUT(2), INTERNAL(11) — retry with a short
//     delay, no session action.
//   semantic: everything else — no retry, surface to user.
export function evaluateFault(fault: number): FaultVerdict {
  if (fault === 4 || fault === 5 || fault === 6 || fault === 15 || fault === 17) {
    return { category: 'session-stale', retryable: true, delayMs: 0 };
  }
  if (fault === 1 || fault === 2 || fault === 11) {
    return { category: 'transient', retryable: true, delayMs: TRANSIENT_DELAY_MS };
  }
  return { category: 'semantic', retryable: false, delayMs: 0 };
}

// --- Pi-session refcount cache ---------------------------------------------
//
// Both domains share ONE Pi-side BLE sessionId per VIN (the Pi is a single
// BLE session per VIN; opening a second would block on its per-VIN mutex).
// Refcount = number of in-memory cached domain sessions referencing that
// sessionId. The Pi-side closeSession only fires when the LAST reference
// releases. Safe now that the Pi demuxes responses by request_uuid.
const _piSessionRefcounts = new Map<string, number>();

function _piSessionAcquire(sessionId: string): number {
  const rc = (_piSessionRefcounts.get(sessionId) || 0) + 1;
  _piSessionRefcounts.set(sessionId, rc);
  return rc;
}

async function _piSessionRelease(transport: PiTransport, sessionId: string): Promise<boolean> {
  const rc = (_piSessionRefcounts.get(sessionId) || 1) - 1;
  if (rc > 0) {
    _piSessionRefcounts.set(sessionId, rc);
    return false; // another domain still holds this Pi session
  }
  _piSessionRefcounts.delete(sessionId);
  try {
    await transport.closeSession(sessionId);
  } catch (e) {
    console.warn('[ble] Pi closeSession failed:', errMsg(e));
  }
  return true;
}

// In-flight openSession dedup, keyed by VIN. Concurrent binds for the same VIN
// — classically the domain-3 poll tick and the event-stream reconnect firing
// in the same moment, before EITHER has populated _domainCache — must share ONE
// openSession, not each open a Pi-side link. The Pi is single-session: a second
// open used to block on its per-VIN mutex, and now (with the Pi's preempt-on-
// Open take-over) it actively CLOSES the first session mid-use, so the first
// caller's next exchange faults session-not-found. This collapses that race to
// a single open. Cleared when the openSession settles.
const _openInFlight = new Map<string, Promise<string>>();

// _findOrOpenPiSession returns the Pi-side sessionId for the given VIN.
// Reuses any in-memory _domainCache session on the same VIN; else joins an
// in-flight open for that VIN; else opens a fresh Pi-side BLE link. (IDB-
// persisted lookup dropped for v1.)
async function _findOrOpenPiSession(transport: PiTransport, vin: string): Promise<string> {
  for (const entry of _domainCache.values()) {
    if (entry.session.vin === vin && entry.session.sessionId) {
      debug('[ble] reusing in-memory Pi session for vin', vin.slice(-6));
      return entry.session.sessionId;
    }
  }
  const inflight = _openInFlight.get(vin);
  if (inflight) {
    debug('[ble] joining in-flight Pi openSession for vin', vin.slice(-6));
    return inflight;
  }
  debug('[ble] opening fresh Pi-side BLE session for vin', vin.slice(-6));
  const opening = transport.openSession(vin).finally(() => {
    _openInFlight.delete(vin);
  });
  _openInFlight.set(vin, opening);
  return opening;
}

// peekPiSessionId returns the Pi-side BLE sessionId currently cached for this
// VIN (one per VIN — the Pi is single-session), or null if no session is
// open. Unlike _findOrOpenPiSession, this NEVER opens one — it's a read-only
// peek so a caller (useCarLink's stream wiring) can tell whether a live
// session exists without paying for or triggering a handshake.
export function peekPiSessionId(vin: string): string | null {
  for (const entry of _domainCache.values()) {
    if (entry.session.vin === vin && entry.session.sessionId) return entry.session.sessionId;
  }
  return null;
}

async function _bindPiSession(transport: PiTransport, vin: string): Promise<string> {
  const sessionId = await _findOrOpenPiSession(transport, vin);
  _piSessionAcquire(sessionId);
  return sessionId;
}

// errMsg extracts a lowercase-safe message from an unknown thrown value.
function errMsg(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e) {
    const m = (e as { message?: unknown }).message;
    if (typeof m === 'string') return m;
  }
  return String(e);
}

// _persistSessionMetadata is a NO-OP in v1 (IDB persistence dropped). Kept as
// a call site so the reference's persist points stay visible; counter/epoch
// live only in memory and a fresh handshake on launch is correct and safe.
function _persistSessionMetadata(_session: Session): void {
  /* intentionally empty — deferred P5.T1 */
}

const MAX_SESSION_INFO_ATTEMPTS = 4;

// _requestSessionInfo runs the bounded SessionInfoRequest retry loop against
// an existing Pi sessionId and returns the decoded RoutableMessage carrying a
// SessionInfo from the expected domain. Shared by openDirectSession and
// refetchSessionInfo. The BLE link is shared across domains, so the car may
// push an unsolicited VCSEC notification ahead of the actual SessionInfo
// reply; the Pi's pre-send drain tosses the stale frame on the next exchange
// and the car re-replies. Bounded retry until we win the race.
async function _requestSessionInfo(
  transport: PiTransport,
  sessionId: string,
  domain: number,
  routingAddress: Uint8Array,
  myPubRaw: Uint8Array,
  challenge: Uint8Array,
): Promise<{ respMsg: ReturnType<typeof RoutableMessage.decode>; sessionInfoBytes: Uint8Array }> {
  const reqBytes = encodeMessage(RoutableMessage, {
    toDestination: { domain },
    fromDestination: { routingAddress },
    sessionInfoRequest: { publicKey: myPubRaw },
    uuid: challenge, // ← doubles as the HMAC challenge
  });

  let lastNonMatchSummary: string | null = null;
  for (let attempt = 1; attempt <= MAX_SESSION_INFO_ATTEMPTS; attempt++) {
    const respB64 = await transport.exchange(sessionId, bytesToBase64(reqBytes), SESSION_INFO_TIMEOUT_MS);
    const candidate = decodeMessage(RoutableMessage, base64ToBytes(respB64));

    const candidateDomain = candidate.fromDestination?.domain;
    const hasSessionInfo = candidate.sessionInfo != null && candidate.sessionInfo.length > 0;
    if (hasSessionInfo && candidateDomain === domain) {
      if (attempt > 1) debug('[ble] SessionInfo handshake succeeded on attempt', attempt, 'domain', domain);
      return { respMsg: candidate, sessionInfoBytes: new Uint8Array(candidate.sessionInfo) };
    }
    lastNonMatchSummary = `attempt=${attempt} fromDomain=${candidateDomain}`;
    console.warn('[ble] SessionInfo handshake got non-matching frame:', lastNonMatchSummary);
  }
  throw new Error(
    `expected session_info in response after ${MAX_SESSION_INFO_ATTEMPTS} attempts; last: ${lastNonMatchSummary}`,
  );
}

// _verifySessionInfoHmac verifies the car's SessionInfo HMAC tag — the
// anti-MITM check. The car HMAC'd the SessionInfo bytes with
// subkey("session info"), derived from the shared secret only the car and
// we can compute. A tag match proves the SessionInfo came from the car (not
// a MITM byte-forwarder), our pubkey is in the car's keychain, and both
// sides derived the same session key.
//
// This check is MANDATORY and load-bearing. Without it a compromised Pi could
// substitute its own ephemeral pubkey plus a matching HMAC under a key it
// knows, and decrypt every subsequent command. It is never bypassable: a
// missing tag, a length mismatch, or any byte difference throws.
function _verifySessionInfoHmac(
  keyBytes: Uint8Array,
  vin: string,
  challenge: Uint8Array,
  sessionInfoBytes: Uint8Array,
  respMsg: ReturnType<typeof RoutableMessage.decode>,
): void {
  const rawTag = respMsg.signatureData?.sessionInfoTag?.tag;
  if (!rawTag || rawTag.length === 0) {
    throw new Error('SessionInfo response missing signatureData.sessionInfoTag.tag — cannot verify');
  }
  const receivedTag = new Uint8Array(rawTag);
  const subkey = hmacSubkey(keyBytes, 'session info');
  const verifyMeta = new MetadataBlockBuilder();
  verifyMeta.add(TAG.SIGNATURE_TYPE, new Uint8Array([SIGNATURE_TYPE.HMAC]));
  verifyMeta.add(TAG.PERSONALIZATION, new TextEncoder().encode(vin));
  verifyMeta.add(TAG.CHALLENGE, challenge);
  const expectedTag = verifyMeta.hmac(subkey, sessionInfoBytes);

  if (expectedTag.length !== receivedTag.length) {
    throw new Error(
      `SessionInfo HMAC length mismatch: expected ${expectedTag.length}, received ${receivedTag.length}`,
    );
  }
  // Branch-free comparison — both sides are 32 bytes of HMAC output.
  let diff = 0;
  for (let i = 0; i < expectedTag.length; i++) diff |= expectedTag[i] ^ receivedTag[i];
  if (diff !== 0) {
    console.error('[ble] HMAC mismatch — expected:', bytesToHex(expectedTag));
    console.error('[ble] HMAC mismatch — received:', bytesToHex(receivedTag));
    throw new Error('SessionInfo HMAC verification FAILED — possible MITM, refusing to continue');
  }
  debug('[ble] SessionInfo HMAC ✓ (car authenticated)');
}

// openDirectSession does the full handshake against `domain` over a fresh (or
// shared) BLE session. Returns a Session holding the raw session key, counter,
// epoch and clock baseline. The caller must call session.close() when done.
export async function openDirectSession({
  transport,
  vin,
  deviceKeys,
  domain,
  dedicated,
}: SessionParams): Promise<Session> {
  if (!vin) throw new Error('openDirectSession: vin required');
  if (!deviceKeys?.publicKeyRaw || !deviceKeys?.privateScalar) {
    throw new Error('openDirectSession: deviceKeys must hold both halves');
  }

  const myPubRaw = deviceKeys.publicKeyRaw;

  // 1. Get the transport session. `dedicated` opens a FRESH one on THIS
  //    transport (no cache scan) so a caller's own central isn't handed another
  //    transport's cached session for the same VIN — the hedge-probe bug. Normal
  //    callers share one Pi session per VIN across domains via the refcount cache.
  const sessionId = dedicated ? await transport.openSession(vin) : await _bindPiSession(transport, vin);
  const releaseSession = () =>
    dedicated ? transport.closeSession(sessionId) : _piSessionRelease(transport, sessionId);
  const localBaselineMs = Date.now();

  try {
    // 2. SessionInfoRequest wrapped in a RoutableMessage. The HMAC challenge
    //    is the RoutableMessage `uuid` field (the car copies it into
    //    request_uuid AND uses it as the HMAC challenge — same bytes on both
    //    sides for verification to pass).
    const routingAddress = randomBytes(ROUTING_ADDRESS_BYTES);
    const challenge = randomBytes(16);

    const { respMsg, sessionInfoBytes } = await _requestSessionInfo(
      transport,
      sessionId,
      domain,
      routingAddress,
      myPubRaw,
      challenge,
    );
    const sessionInfo = decodeMessage(SessionInfo, sessionInfoBytes);
  assertKeyOnWhitelist(sessionInfo);
    assertKeyOnWhitelist(sessionInfo);

    if (!sessionInfo.publicKey || sessionInfo.publicKey.length !== 65) {
      throw new Error(`car returned malformed pubkey (len ${sessionInfo.publicKey?.length})`);
    }
    if (!sessionInfo.epoch || sessionInfo.epoch.length !== 16) {
      throw new Error(`car returned malformed epoch (len ${sessionInfo.epoch?.length})`);
    }

    // 3. Derive the AES-GCM session key. The raw bytes ARE the key (no
    //    CryptoKey in the noble port) and are also used for the HMAC subkey.
    const carEphPub = importPeerPubkey(new Uint8Array(sessionInfo.publicKey));
    const keyBytes = deriveSessionKeyMaterial(deviceKeys.privateScalar, carEphPub);

    // 4. Verify the SessionInfo HMAC (anti-MITM). Mandatory.
    _verifySessionInfoHmac(keyBytes, vin, challenge, sessionInfoBytes, respMsg);

    const session: Session = {
      sessionId,
      domain,
      vin,
      routingAddress,
      sessionKey: keyBytes, // raw key — no CryptoKey wrapping
      keyBytes,
      myPubRaw,
      vehiclePubRaw: new Uint8Array(sessionInfo.publicKey),
      epoch: new Uint8Array(sessionInfo.epoch),
      counter: sessionInfo.counter || 0,
      clockBase: sessionInfo.clockTime || 0,
      localBaselineMs,
      close: async () => {
        await releaseSession();
      },
    };

    _persistSessionMetadata(session);
    return session;
  } catch (e) {
    // Best-effort cleanup. For a shared session this is refcounted so we don't
    // tear one down another domain still holds; for a dedicated session it just
    // closes this transport's own link.
    await Promise.resolve(releaseSession()).catch(() => {});
    throw e;
  }
}

// isTransportDeadError detects Pi-side errors meaning "the BLE link backing
// this session is gone." Caller evicts + retries with a full handshake on a
// fresh Pi-side session.
//
// Primary signal: the TYPED error kind from transport.ts's TransportError —
// 'session-gone' (Pi 404: it doesn't know this session id, e.g. after the
// Pi's idle reaper drops it) or 'ble' (Pi 502: the radio/car errored, the
// link is dead). This is checked structurally (`(e as {kind}).kind`) rather
// than via `e instanceof TransportError` / a static import of transport.ts,
// so session.ts stays free of a hard dependency on transport.ts (avoiding a
// module cycle risk) while still catching a Pi 404 whose JSON error body
// text doesn't happen to match one of the substring fallbacks below. No
// `any` escapes this function — the narrowing is local.
//
// Fallback: message substring matches for reference-style/engine errors
// (FakeCar 'throw' programs in tests, and any transport that isn't
// PiClient) that don't carry a `kind`.
export function isTransportDeadError(e: unknown): boolean {
  if (e && typeof e === 'object') {
    const kind = (e as { kind?: unknown }).kind;
    if (typeof kind === 'string' && (kind === 'session-gone' || kind === 'ble')) return true;
  }
  const msg = errMsg(e).toLowerCase();
  return (
    msg.includes('closed pipe') ||
    msg.includes('ble send') ||
    msg.includes('ble connection closed') ||
    msg.includes('ble-session') ||
    msg.includes('session not found') ||
    msg.includes('no peripherals') ||
    msg.includes('not connected')
  );
}

// isStaleFrameError detects the "Pi returned stale response/frame" errors —
// the BLE link is fine, we just need to retry the command (a buffered frame
// from an earlier command or an unsolicited notification was returned).
export function isStaleFrameError(e: unknown): boolean {
  const msg = errMsg(e).toLowerCase();
  return msg.includes('stale response') || msg.includes('stale frame');
}

// _bytesEqual is a constant-time-ish equality check. Used by
// refetchSessionInfo to detect epoch changes.
function _bytesEqual(a: Uint8Array | null | undefined, b: Uint8Array | null | undefined): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// refetchSessionInfo does an in-place session-info refresh on an already-open
// BLE session (Tesla Android xe0/C32376j.java). On INVALID_SIGNATURE /
// INVALID_TOKEN_OR_COUNTER / INCORRECT_EPOCH / INACTIVE_KEY the app sends a
// fresh SessionInfoRequest on the same BLE connection, re-derives the AES key,
// and retries — no teardown, no full handshake. We swap the new sessionKey /
// vehiclePubRaw / counter / epoch / clockBase IN PLACE on the same Session,
// keeping sessionId / routingAddress / myPubRaw.
export async function refetchSessionInfo({
  transport,
  deviceKeys,
  session,
}: {
  transport: PiTransport;
  deviceKeys: DeviceKeys;
  session: Session;
}): Promise<Session> {
  const challenge = randomBytes(16);
  const { respMsg, sessionInfoBytes } = await _requestSessionInfo(
    transport,
    session.sessionId,
    session.domain,
    session.routingAddress,
    session.myPubRaw,
    challenge,
  );
  const sessionInfo = decodeMessage(SessionInfo, sessionInfoBytes);

  if (!sessionInfo.publicKey || sessionInfo.publicKey.length !== 65) {
    throw new Error(`refetchSessionInfo: malformed car pubkey (len ${sessionInfo.publicKey?.length})`);
  }
  if (!sessionInfo.epoch || sessionInfo.epoch.length !== 16) {
    throw new Error(`refetchSessionInfo: malformed epoch (len ${sessionInfo.epoch?.length})`);
  }

  const carEphPub = importPeerPubkey(new Uint8Array(sessionInfo.publicKey));
  const keyBytes = deriveSessionKeyMaterial(deviceKeys.privateScalar, carEphPub);

  // Verify HMAC over the new SessionInfo (same anti-MITM logic).
  _verifySessionInfoHmac(keyBytes, session.vin, challenge, sessionInfoBytes, respMsg);

  // Swap the new keying material IN PLACE. Counter/epoch merge follows
  // Tesla's de0/C15009g.java:303-319 pattern:
  //   • epoch changed → take the new state wholesale.
  //   • epoch same → keep the HIGHER counter (another client may have sent
  //     commands on this session).
  //   • bump localBaselineMs only if the new clockTime isn't a regression.
  const epochChanged = !_bytesEqual(session.epoch, new Uint8Array(sessionInfo.epoch));
  const newCounter = sessionInfo.counter || 0;
  const newClockTime = sessionInfo.clockTime || 0;

  session.sessionKey = keyBytes;
  session.keyBytes = keyBytes;
  session.vehiclePubRaw = new Uint8Array(sessionInfo.publicKey);
  session.epoch = new Uint8Array(sessionInfo.epoch);
  session.counter = epochChanged ? newCounter : Math.max(session.counter, newCounter);
  if (epochChanged || newClockTime >= session.clockBase) {
    session.localBaselineMs = Date.now();
  }
  session.clockBase = newClockTime;

  _persistSessionMetadata(session);
  debug('[ble] in-place SessionInfo refetch ✓ domain=' + session.domain, 'counter=' + session.counter);
  return session;
}

export interface CommandResult {
  routable: ReturnType<typeof RoutableMessage.decode>;
  decryptedPayload: Uint8Array | null;
  // Decrypts a LATER, unsolicited frame that the car sent as a consequence of
  // THIS request — i.e. a vehicle-data subscription push (VDS-M1 proved the car
  // emits these over BLE at the rate we ask for).
  //
  // It is a closure rather than exported keys on purpose: the session key stays
  // inside this module, and the caller gets only the ability to decrypt frames
  // bound to a request it already made.
  //
  // Returns the plaintext, plus WHICH candidate AAD worked. The car's response
  // AAD normally binds REQUEST_HASH to the tag of the request being answered,
  // but a push is not answering any single request, so which hash it uses is an
  // open question — the decryptor tries each candidate and reports the winner
  // instead of us guessing one and reading a failure as "wrong key".
  decryptPush?: (frame: Uint8Array) => { plaintext: Uint8Array; aadVariant: string } | null;
  // Attempts to open the encrypted-PII envelope (VehicleData field 11) that a
  // subscription push carries instead of a populated location_state. Same
  // "try bounded candidates and report the winner" contract as decryptPush.
  decryptPiiEnvelope?: (envelope: Uint8Array) => { stateId: number; plaintext: Uint8Array; variant: string } | null;
}

// buildRoutablePassiveResponse builds the ROUTABLE passive-entry answer — the
// modality the official app actually uses (RE RESPONSE #9, decompile-proven).
// It is the SAME AES_GCM_Personalized seal + RoutableMessage envelope as
// sendCommand (random nonce, NOT the legacy IV=counter), differing only in the
// inner payload (UnsignedMessage{authenticationResponse}) and two envelope
// fields. Returning bytes (not awaiting a reply) mirrors the passive-entry
// contract: the car answers by ACTING (unlocking) + an unsolicited commandStatus
// echoing our counter, not by a correlated reply — so this is sync, like the
// legacy responder it replaces.
//
// WHY ROUTABLE > LEGACY for us (RE #8 + #9): under one shared enrolled key the Pi
// and this responder share ONE (key,epoch) counter. The legacy seal's IV = the
// counter, so a counter collision would be AES-GCM nonce reuse (catastrophic).
// The routable seal's random 12-byte nonce makes the same collision a RECOVERABLE
// counter reject instead — which is why one enrolled key is now safe.
//
// Envelope specifics from RESPONSE #9 Q3: to.domain=VEHICLE_SECURITY;
// from.routing_address=<ours>; uuid={0x00} (the challenge uuid is NOT echoed);
// NO token anywhere (routable freshness is counter+epoch+expiresAt only; the
// AAD's TAG_CHALLENGE stays unset). flags=0 here so the car's status reply is
// plaintext (readable verdict) and TAG_FLAGS is omitted from the AAD.
export function buildRoutablePassiveResponse(
  session: Session,
  innerUnsignedMessageBytes: Uint8Array,
): { bytes: Uint8Array; counter: number } {
  if (session.counter >= 0xfffffffe) {
    throw new Error('session counter rolled over — close and re-open');
  }
  session.counter += 1;
  const counter = session.counter;

  const elapsedSec = Math.floor((Date.now() - session.localBaselineMs) / 1000);
  const expiresAt = (session.clockBase + elapsedSec + COMMAND_LIFETIME_SEC) >>> 0;

  // flags=0 → not encrypt-response → plaintext status reply; buildAesGcmMetadata
  // omits TAG_FLAGS when 0, matching the car (RESPONSE #9 Q3).
  const flags = 0;
  const aadDigest = buildAesGcmMetadata({
    domain: session.domain,
    verifierName: session.vin,
    epoch: session.epoch,
    expiresAt,
    counter,
    flags,
  });

  const env = aesGcmEncrypt(session.sessionKey, innerUnsignedMessageBytes, aadDigest);

  const bytes = encodeMessage(RoutableMessage, {
    toDestination: { domain: session.domain },
    fromDestination: { routingAddress: session.routingAddress },
    protobufMessageAsBytes: env.ciphertext,
    signatureData: {
      signerIdentity: { publicKey: session.myPubRaw },
      AES_GCM_PersonalizedData: {
        epoch: session.epoch,
        nonce: env.nonce,
        counter,
        expiresAt,
        tag: env.tag,
      },
    },
    // Single 0x00 byte — the app does NOT echo the challenge uuid (RESPONSE #9).
    uuid: new Uint8Array([0x00]),
    flags,
  });

  return { bytes, counter };
}

// buildStandingDriveAssertion (RESPONSE-11) — the proactive standing-DRIVE the
// official app sends unprompted on connect (q1.java connectionEstablished/G0).
// It's the passive UNLOCK response with authenticationLevel = DRIVE(2) instead of
// UNLOCK(1) — the whole delta is that one varint (08 02 vs 08 01) — sealed with
// the same routable envelope. The car holds it as our standing level and enables
// drive once it localizes us inside + a drive trigger (brake). Harmless when
// exterior (the car ignores an out-of-zone DRIVE).
export function buildStandingDriveAssertion(
  session: Session,
): { bytes: Uint8Array; counter: number } {
  const inner = encodeUnsignedAuthResponse(
    encodeAuthenticationResponse({ authenticationLevel: AUTH_LEVEL.DRIVE }),
  );
  return buildRoutablePassiveResponse(session, inner);
}

// buildRoutableCommandFrame — seal a command frame and RETURN THE BYTES (no
// send), so a caller can deliver the SAME bytes over two pipes (the RE #10
// hedge) or replay them for a probe. Mirrors sendCommand's proven build.
//
// `counter`/`uuid` are overridable ONLY for probes/hedging: pass an explicit
// counter to seal two frames at the SAME counter (a duplicate-reject probe), or
// omit to auto-take session.counter+1. When omitted the session counter is NOT
// mutated here (unlike sendCommand) — the caller owns counter lifecycle for the
// two-pipe single-writer discipline.
export function buildRoutableCommandFrame(
  session: Session,
  payloadBytes: Uint8Array,
  opts?: { counter?: number; uuid?: Uint8Array; flags?: number },
): { bytes: Uint8Array; counter: number; requestUuid: Uint8Array } {
  const wireFlags = opts?.flags ?? 0;
  const counter = opts?.counter ?? session.counter + 1;
  const elapsedSec = Math.floor((Date.now() - session.localBaselineMs) / 1000);
  const expiresAt = (session.clockBase + elapsedSec + COMMAND_LIFETIME_SEC) >>> 0;
  const aadDigest = buildAesGcmMetadata({
    domain: session.domain,
    verifierName: session.vin,
    epoch: session.epoch,
    expiresAt,
    counter,
    flags: wireFlags,
  });
  const env = aesGcmEncrypt(session.sessionKey, payloadBytes, aadDigest);
  const requestUuid = opts?.uuid ?? randomBytes(16);
  const bytes = encodeMessage(RoutableMessage, {
    toDestination: { domain: session.domain },
    fromDestination: { routingAddress: session.routingAddress },
    protobufMessageAsBytes: env.ciphertext,
    signatureData: {
      signerIdentity: { publicKey: session.myPubRaw },
      AES_GCM_PersonalizedData: {
        epoch: session.epoch,
        nonce: env.nonce,
        counter,
        expiresAt,
        tag: env.tag,
      },
    },
    uuid: requestUuid,
    flags: wireFlags,
  });
  return { bytes, counter, requestUuid };
}

// sendCommand ships a pre-encoded inner payload through the byte forwarder.
// The caller supplies the encoded bytes (VCSEC and Infotainment use different
// proto wrappers inside the ciphertext, so this path is domain-agnostic once
// the bytes are built). Renamed from the reference's sendDirectCommandWithApi.
export async function sendCommand({
  transport,
  session,
  payloadBytes,
  flags,
  timeoutMs,
}: {
  transport: PiTransport;
  session: Session;
  payloadBytes: Uint8Array;
  flags?: number;
  timeoutMs?: number;
}): Promise<CommandResult> {
  // flags is a bitfield on the RoutableMessage; the only bit we use is
  // FLAG_ENCRYPT_RESPONSE (value 2). It MUST appear in BOTH the wire
  // RoutableMessage AND the AAD metadata so the digests match on both sides.
  const wireFlags = flags || 0;

  // Counter is per-message monotonic from the SessionInfo seed. 0xFFFFFFFE is
  // the SDK's rollover guard.
  if (session.counter >= 0xfffffffe) {
    throw new Error('session counter rolled over — close and re-open');
  }
  session.counter += 1;
  const counter = session.counter;

  // Wall-clock-anchored expiry; the car checks against its own monotonic
  // clock derived from the same SessionInfo.clockTime.
  const elapsedSec = Math.floor((Date.now() - session.localBaselineMs) / 1000);
  const expiresAt = (session.clockBase + elapsedSec + COMMAND_LIFETIME_SEC) >>> 0;

  const aadDigest = buildAesGcmMetadata({
    domain: session.domain,
    verifierName: session.vin,
    epoch: session.epoch,
    expiresAt,
    counter,
    flags: wireFlags,
  });

  const env = aesGcmEncrypt(session.sessionKey, payloadBytes, aadDigest);

  const requestUuid = randomBytes(16);
  const cmdRoutable = encodeMessage(RoutableMessage, {
    toDestination: { domain: session.domain },
    fromDestination: { routingAddress: session.routingAddress },
    protobufMessageAsBytes: env.ciphertext,
    signatureData: {
      // signer_identity tells the car which keychain key signed this command
      // (raw SEC1 pubkey). Without it the car can't look us up.
      signerIdentity: { publicKey: session.myPubRaw },
      AES_GCM_PersonalizedData: {
        epoch: session.epoch,
        nonce: env.nonce,
        counter,
        expiresAt,
        tag: env.tag,
      },
    },
    uuid: requestUuid,
    flags: wireFlags,
  });

  const respB64 = await transport.exchange(
    session.sessionId,
    bytesToBase64(cmdRoutable),
    timeoutMs || COMMAND_TIMEOUT_MS,
  );
  const respMsg = decodeMessage(RoutableMessage, base64ToBytes(respB64));

  // The car echoes our uuid back as request_uuid on the matching response.
  // A mismatch means we received the response to a DIFFERENT request (the Pi
  // returned a buffered stale frame). Surface it loudly instead of letting
  // it masquerade as an opaque AES decrypt error.
  if (respMsg.requestUuid && respMsg.requestUuid.length > 0) {
    let matches = respMsg.requestUuid.length === requestUuid.length;
    if (matches) {
      for (let i = 0; i < requestUuid.length; i++) {
        if (respMsg.requestUuid[i] !== requestUuid[i]) {
          matches = false;
          break;
        }
      }
    }
    if (!matches) {
      const sent = bytesToHex(requestUuid).slice(0, 16);
      const got = bytesToHex(new Uint8Array(respMsg.requestUuid)).slice(0, 16);
      throw new Error(
        `Pi returned stale response: sent uuid=${sent}… got request_uuid=${got}… (Pi-side BLE channel has buffered a previous response)`,
      );
    }
  }

  // Stale-frame detection for unsolicited car broadcasts that carry NO
  // request_uuid: (1) from-domain mismatch, or (2) we requested encrypted-
  // response but got an unencrypted payload with no status.
  const respFromDomain = respMsg.fromDestination?.domain;
  if (respFromDomain != null && respFromDomain !== session.domain) {
    throw new Error(
      `Pi returned stale frame: expected from domain=${session.domain}, got from domain=${respFromDomain}`,
    );
  }
  const isEncryptedRequest = (wireFlags & FLAG_ENCRYPT_RESPONSE_BIT) !== 0;
  const hasAesGcm = !!respMsg.signatureData?.AES_GCM_ResponseData;
  const hasPayload = respMsg.protobufMessageAsBytes != null && respMsg.protobufMessageAsBytes.length > 0;
  const hasStatus = !!respMsg.signedMessageStatus;
  if (isEncryptedRequest && hasPayload && !hasAesGcm && !hasStatus) {
    throw new Error(
      'Pi returned stale frame: requested encrypted response but got unencrypted payload with no status (unsolicited car broadcast)',
    );
  }

  // Decrypt the payload if present. The car wraps command responses in an
  // AES-GCM ciphertext under the session key, with AAD that includes
  // REQUEST_HASH (a hash of OUR request's GCM tag) — so a response can't be
  // replayed against a different request.
  let decryptedPayload: Uint8Array | null = null;
  const gcmResp = respMsg.signatureData?.AES_GCM_ResponseData;
  const payloadBytesOut = respMsg.protobufMessageAsBytes;
  if (gcmResp && gcmResp.nonce && gcmResp.tag && payloadBytesOut && payloadBytesOut.length > 0) {
    const requestHash = makeRequestHash(env.tag);
    const responseDomain = respMsg.fromDestination?.domain ?? session.domain;
    const responseFlags = respMsg.flags || 0;
    const fault = respMsg.signedMessageStatus?.signedMessageFault || 0;

    const respAad = buildAesGcmResponseMetadata({
      domain: responseDomain,
      verifierName: session.vin,
      counter: gcmResp.counter || 0,
      flags: responseFlags,
      requestHash,
      fault,
    });
    try {
      decryptedPayload = aesGcmDecrypt(
        session.sessionKey,
        new Uint8Array(gcmResp.nonce),
        new Uint8Array(payloadBytesOut),
        new Uint8Array(gcmResp.tag),
        respAad,
      );
    } catch (e) {
      // A decrypt failure on a structurally valid response means the car
      // AAD'd it against a DIFFERENT request — the same stale-frame race,
      // expressed via the crypto layer. Treat as stale-frame ONLY when we
      // actually requested an encrypted response (otherwise the car may
      // legitimately reply status-only with an AES tag we can't decrypt and
      // the caller doesn't need the payload).
      const wasEncryptedRequest = (wireFlags & FLAG_ENCRYPT_RESPONSE_BIT) !== 0;
      console.warn('[ble] response decrypt failed:', errMsg(e));
      if (wasEncryptedRequest) {
        throw new Error(
          `Pi returned stale frame: decrypt failed against this request's AAD (counter=${gcmResp.counter}, requestHash mismatch — channel had a buffered response to a different request)`,
        );
      }
    }
  }

  _persistSessionMetadata(session);
  return {
    routable: respMsg,
    decryptedPayload,
    decryptPush: makePushDecryptor(session, env.tag),
    decryptPiiEnvelope: makePiiEnvelopeDecryptor(session),
  };
}

// makePiiEnvelopeDecryptor — see CommandResult.decryptPiiEnvelope.
//
// The envelope's shape is measured, not guessed (23 on-car pushes, 2026-07-26):
//
//   08 <n>      field 1 — a state selector; observed 8, which is
//               location_state's own field number inside VehicleData
//   12 <len>    field 2 — ciphertext (97-98B, entropy 7.91 bits/byte)
//   1a 1c       field 3 — 28 bytes = a 12-byte GCM nonce + a 16-byte GCM tag,
//               in one order or the other
//
// What is NOT measured is the key and the AAD, so both are searched. The session
// key is the only shared secret we hold, and it already comes from ECDH against
// the car's static key — the same secret the car would have if it derived a
// content key from the subscriber public key we supplied. If none of these open
// it, that is a real finding: it means the content key is NOT derived from
// anything we possess, which is the "Tesla-held key" branch of REQUEST-19 Q1c
// and the point at which this stops being solvable air-gapped.
function makePiiEnvelopeDecryptor(
  session: Session,
): (envelope: Uint8Array) => { stateId: number; plaintext: Uint8Array; variant: string } | null {
  return (envelope) => {
    let stateId = 0;
    let ciphertext: Uint8Array | null = null;
    let nonceTag: Uint8Array | null = null;
    let pos = 0;
    // Small inline scan: this runs on a field we have no proto for, and decoding
    // it through a generated message would require declaring a schema we have
    // deliberately not committed to.
    while (pos < envelope.length) {
      const tag = envelope[pos++];
      const field = tag >>> 3;
      const wire = tag & 0x07;
      if (wire === 0) {
        let v = 0;
        let shift = 0;
        while (pos < envelope.length) {
          const b = envelope[pos++];
          v += (b & 0x7f) * Math.pow(2, shift);
          if ((b & 0x80) === 0) break;
          shift += 7;
        }
        if (field === 1) stateId = v;
      } else if (wire === 2) {
        let len = 0;
        let shift = 0;
        while (pos < envelope.length) {
          const b = envelope[pos++];
          len += (b & 0x7f) * Math.pow(2, shift);
          if ((b & 0x80) === 0) break;
          shift += 7;
        }
        if (pos + len > envelope.length) break;
        const body = envelope.subarray(pos, pos + len);
        pos += len;
        if (field === 2) ciphertext = body;
        else if (field === 3) nonceTag = body;
      } else {
        break;
      }
    }
    if (!ciphertext || !nonceTag || nonceTag.length !== 28) return null;

    const splits = [
      { name: 'nonce-first', nonce: nonceTag.subarray(0, 12), tag: nonceTag.subarray(12) },
      { name: 'tag-first', nonce: nonceTag.subarray(16), tag: nonceTag.subarray(0, 16) },
    ];
    const aads: Array<{ name: string; aad: Uint8Array }> = [
      { name: 'empty-aad', aad: new Uint8Array(0) },
      { name: 'state-id-aad', aad: new Uint8Array([stateId]) },
      { name: 'vin-aad', aad: new TextEncoder().encode(session.vin) },
    ];
    for (const s of splits) {
      for (const a of aads) {
        try {
          const plaintext = aesGcmDecrypt(session.sessionKey, s.nonce, ciphertext, s.tag, a.aad);
          return { stateId, plaintext, variant: `${s.name}/${a.name}` };
        } catch {
          // wrong combination — keep searching
        }
      }
    }
    return null;
  };
}

// makePushDecryptor — see CommandResult.decryptPush.
//
// The candidates below are a deliberate, bounded search, not a shotgun. A push
// is structurally an AES_GCM_Response, so everything in its AAD is determined by
// the frame itself EXCEPT the REQUEST_HASH, which on a normal response binds the
// reply to the request that caused it. A subscription push has no single such
// request, so there are only a few things the car can plausibly put there, and
// trying them costs one AES-GCM verify each.
function makePushDecryptor(
  session: Session,
  requestTag: Uint8Array,
): (frame: Uint8Array) => { plaintext: Uint8Array; aadVariant: string } | null {
  const candidates: Array<{ name: string; requestHash: Uint8Array }> = [
    // The subscribe's own tag — the car treating every push as an answer to the
    // request that armed the subscription.
    { name: 'subscribe-request-hash', requestHash: makeRequestHash(requestTag) },
    // Type byte with an empty tag: "a response, to nothing in particular".
    { name: 'type-byte-only', requestHash: new Uint8Array([SIGNATURE_TYPE.AES_GCM_PERSONALIZED]) },
    // No REQUEST_HASH tag in the metadata block at all.
    { name: 'absent', requestHash: new Uint8Array(0) },
  ];
  return (frame) => {
    let msg: ReturnType<typeof RoutableMessage.decode>;
    try {
      msg = RoutableMessage.decode(frame);
    } catch {
      return null;
    }
    const gcm = msg.signatureData?.AES_GCM_ResponseData;
    const payload = msg.protobufMessageAsBytes;
    if (!gcm?.nonce || !gcm?.tag || !payload || payload.length === 0) return null;
    for (const c of candidates) {
      const aad = buildAesGcmResponseMetadata({
        domain: msg.fromDestination?.domain ?? session.domain,
        verifierName: session.vin,
        counter: gcm.counter || 0,
        flags: msg.flags || 0,
        requestHash: c.requestHash,
        fault: msg.signedMessageStatus?.signedMessageFault || 0,
      });
      try {
        const plaintext = aesGcmDecrypt(
          session.sessionKey,
          new Uint8Array(gcm.nonce),
          new Uint8Array(payload),
          new Uint8Array(gcm.tag),
          aad,
        );
        return { plaintext, aadVariant: c.name };
      } catch {
        // wrong candidate — try the next
      }
    }
    return null;
  };
}

// --- Domain session cache --------------------------------------------------
//
// The SessionInfo handshake costs a BLE round-trip; cache the open session
// per domain and reuse it. NO idle TTL (Tesla Android keeps the shared-secret
// cache until account change). Invalidation is reactive: on a session-stale
// fault the caller calls refreshCachedSession (in-place refetch) or
// evictSession (full re-handshake next time).
interface CacheEntry {
  session: Session;
}
const _domainCache = new Map<number, CacheEntry>();

export async function withCachedSession<T>(
  { transport, vin, deviceKeys, domain }: SessionParams,
  body: (session: Session, cached: boolean) => Promise<T> | T,
): Promise<T> {
  // 1. In-memory cache — instant reuse.
  const entry = _domainCache.get(domain);
  if (entry) {
    try {
      return await body(entry.session, true);
    } catch (e) {
      // Transport-dead (Pi-side BLE link gone) → drop the bad session and
      // fall through to a fresh handshake. Any OTHER error bubbles up.
      if (isTransportDeadError(e)) {
        console.warn('[ble] cached session transport dead — evicting + opening fresh:', errMsg(e));
        await evictSession(vin, domain);
      } else {
        throw e;
      }
    }
  }

  // 2. Cold start — full BLE handshake. openDirectSession may (in the fetch
  //    transport) hit a stale Pi sessionId; catch transport-dead, evict, and
  //    retry the cold start exactly once.
  let session: Session;
  try {
    session = await openDirectSession({ transport, vin, deviceKeys, domain });
  } catch (e) {
    if (!isTransportDeadError(e)) throw e;
    console.warn('[ble] cold-start hit stale Pi sessionId — evict + retry:', errMsg(e));
    await evictSession(vin, domain);
    session = await openDirectSession({ transport, vin, deviceKeys, domain });
  }
  _domainCache.set(domain, { session });
  try {
    return await body(session, false);
  } catch (e) {
    // Fresh handshake but the first command failed — evict and re-raise.
    _evict(domain);
    throw e;
  }
}

// refreshCachedSession is the reactive-invalidation entry point for
// session-stale faults. Tesla Android does NOT tear down the BLE link in these
// cases — it sends a fresh SessionInfoRequest on the existing session, gets
// new keying material, and retries. On failure (link genuinely dead) it falls
// back to evictSession so the next attempt does a full handshake.
export async function refreshCachedSession({
  transport,
  vin,
  domain,
  deviceKeys,
}: SessionParams): Promise<boolean> {
  const entry = _domainCache.get(domain);
  if (!entry) return false; // nothing to refresh — next withCachedSession handshakes
  try {
    await refetchSessionInfo({ transport, deviceKeys, session: entry.session });
    return true;
  } catch (e) {
    console.warn('[ble] in-place refresh failed, falling back to full evict:', errMsg(e));
    await evictSession(vin, domain);
    return false;
  }
}

// evictSession is the fallback for "session is genuinely dead, need a full
// handshake." The unit of liveness is (VIN, BLE link), NOT (VIN, domain):
// both domains share one Pi sessionId, so a transport-dead error from any one
// domain means the BLE link is dead for the whole VIN. We therefore tear down
// EVERY cached domain session for this VIN. (IDB row wipe dropped for v1.)
export type EvictScope =
  // The BLE link itself is gone — every domain riding it is dead.
  | 'link'
  // Only THIS domain's exchange failed. The link demonstrably carried our write,
  // so the other domain's session is still good and must be left alone.
  | 'domain';

export async function evictSession(
  vin: string,
  domain: Domain,
  opts?: { scope?: EvictScope },
): Promise<void> {
  // SCOPED EVICTION. Measured 2026-07-26 (PE-4): a domain-3 read timing out was
  // tearing down the domain-2 session too, so the next lock/unlock paid a full
  // cold handshake — 4171ms against a warm 91ms. The blanket teardown is right
  // for a dead link and wrong for a timeout: the car answered VCSEC normally
  // seconds later, so the link was never dead.
  //
  // A background readout must not be able to destroy the session that opens the
  // door. Same principle as the passive-entry fix, one layer up.
  if ((opts?.scope ?? 'link') === 'domain') {
    const entry = _domainCache.get(domain);
    if (entry && entry.session.vin === vin) {
      _evict(domain);
      // Deliberately NOT clearing _piSessionRefcounts here: the sessionId is
      // shared with the other domain, which is still using it. _evict's
      // session.close() decrements our reference and leaves theirs intact.
      console.warn('[ble] evicted domain', domain, 'for vin', vin.slice(-6), '· link presumed alive');
    }
    return;
  }
  const victims: { d: number; sessionId: string }[] = [];
  for (const [d, e] of _domainCache.entries()) {
    if (e.session.vin === vin) victims.push({ d, sessionId: e.session.sessionId });
  }
  // _evict triggers session.close() which decrements the refcount.
  for (const v of victims) _evict(v.d);
  // Zero any leftover refcounts for this VIN's sessionIds so the next
  // _bindPiSession opens fresh instead of pretending a session is still live.
  for (const v of victims) _piSessionRefcounts.delete(v.sessionId);

  console.warn(
    '[ble] evicted all sessions for vin',
    vin.slice(-6),
    '· dropped domains:',
    victims.map((v) => v.d).join(',') || '(none cached)',
    '· trigger=' + domain,
  );
}

function _evict(domain: number): void {
  const entry = _domainCache.get(domain);
  if (!entry) return;
  _domainCache.delete(domain);
  // Best-effort BLE close; don't wait.
  entry.session.close().catch(() => {});
}

// closeAllCachedSessions drops every domain's cached in-memory session.
export function closeAllCachedSessions(): void {
  for (const domain of [..._domainCache.keys()]) _evict(domain);
}

// __resetSessionCaches clears ALL module-level session state. Test-only: the
// caches are module singletons, so tests reset them for isolation.
export function __resetSessionCaches(): void {
  _domainCache.clear();
  _piSessionRefcounts.clear();
  _openInFlight.clear();
}

// --- Shared encode helpers (consumed by P1d builders) ----------------------

// encodeInfotainmentAction wraps a VehicleAction sub-message into a
// CarServer.Action and encodes it.
export function encodeInfotainmentAction(vehicleAction: object): Uint8Array {
  return encodeMessage(Action, { vehicleAction });
}

// encodeVCSECMessage wraps a sub_message into VCSEC.UnsignedMessage and
// encodes it. The fields object's single key picks the oneof case.
export function encodeVCSECMessage(subFields: object): Uint8Array {
  return encodeMessage(VCSECUnsignedMessage, subFields);
}

// ActionPayload is what an action builder returns: the wire bytes ready to be
// AES-GCM-encrypted, the BLE domain they target, and optional flags.
export interface ActionPayload {
  domain: Domain;
  bytes: Uint8Array;
  flags?: number;
}

// honkAction — the Infotainment "honk horn" command (the engine's own test
// vehicle; P1d ports the rest of the builder family).
export function honkAction(): ActionPayload {
  return { domain: DOMAIN_INFOTAINMENT, bytes: encodeInfotainmentAction({ vehicleControlHonkHornAction: {} }) };
}

// vcsecGetStatusAction — the VCSEC "give me current state" poll. Wraps an
// InformationRequest (type GET_STATUS = 0) and sets FLAG_ENCRYPT_RESPONSE so
// the car returns its FromVCSECMessage.vehicleStatus encrypted.
export function vcsecGetStatusAction(): ActionPayload {
  return {
    domain: DOMAIN_VEHICLE_SECURITY,
    flags: FLAG_ENCRYPT_RESPONSE_BIT,
    bytes: encodeVCSECMessage({ InformationRequest: { informationRequestType: 0 } }),
  };
}

// vcsecGetWhitelistEntryAction — ask the car what permissions IT actually
// granted our key. INFORMATION_REQUEST_TYPE_GET_WHITELIST_ENTRY_INFO(6),
// targeting our own entry via the InformationRequest `publicKey` oneof arm (we
// hold the raw SEC1 point; no need to derive the SHA1 keyId).
//
// Why it matters: we enroll with keyRole=ROLE_DRIVER and an EMPTY permission
// list, relying on the car to expand the role into concrete permissions. That
// expansion lives in VCSEC firmware and is the one passive-entry precondition
// no amount of static RE can settle (research doc §1.4). This read settles it.
// Parse the reply with parseWhitelistPermissions — the vendored proto drops the
// permissions field (see whitelistPermissions.ts).
// How to identify OUR entry to the car. InformationRequest carries a oneof
// (keyId | publicKey | slot) and the car's accepted arm is not documented
// anywhere we can read — the first on-car run targeting `publicKey` came back
// with no whitelistEntryInfo at all, so we try each arm rather than guess.
// `KeyIdentifier.publicKeySHA1` + research §1.2 ("keyId = SHA1(pubkey)[…]")
// make the SHA1 arms the strong candidates; the "[…]" is ambiguous about
// truncation, hence both full and 4-byte variants.
// vcsecGetWhitelistInfoAction — GET_WHITELIST_INFO(5). Returns WhitelistInfo
// { numberOfEntries, whitelistEntries[], slotMask }, i.e. the map of which slots
// hold keys. Needed to enumerate the car's OTHER keys as a control group: our
// own entry comes back without a permissions field, and the only way to tell
// "our enrollment granted nothing" from "the BLE reply never carries them" is to
// read an official key's entry and compare.
export function vcsecGetWhitelistInfoAction(): ActionPayload {
  return {
    domain: DOMAIN_VEHICLE_SECURITY,
    flags: FLAG_ENCRYPT_RESPONSE_BIT,
    bytes: encodeVCSECMessage({ InformationRequest: { informationRequestType: 5 } }),
  };
}

export type WhitelistTargetMode = 'slot' | 'keyId-sha1' | 'keyId-sha1-4' | 'publicKey';

// keyId-sha1-4 FIRST: proven on-car to be the arm this firmware accepts (a full
// 20-byte SHA1 target faulted 10/DECODING). 'slot' is listed for the enumeration
// path, which passes an explicit slot rather than iterating these modes.
export const WHITELIST_TARGET_MODES: readonly WhitelistTargetMode[] = [
  'keyId-sha1-4',
  'keyId-sha1',
  'publicKey',
];

export function vcsecGetWhitelistEntryAction(
  publicKeyRaw: Uint8Array,
  mode: WhitelistTargetMode = 'keyId-sha1-4',
  slot?: number,
): ActionPayload {
  const digest = sha1(publicKeyRaw);
  let request: Record<string, unknown>;
  if (mode === 'slot') {
    if (slot === undefined) throw new Error('slot mode requires a slot index');
    request = { informationRequestType: 6, slot };
  } else if (mode === 'publicKey') {
    request = { informationRequestType: 6, publicKey: publicKeyRaw };
  } else {
    request = {
      informationRequestType: 6,
      keyId: { publicKeySHA1: mode === 'keyId-sha1-4' ? digest.slice(0, 4) : digest },
    };
  }
  return {
    domain: DOMAIN_VEHICLE_SECURITY,
    flags: FLAG_ENCRYPT_RESPONSE_BIT,
    bytes: encodeVCSECMessage({ InformationRequest: request }),
  };
}

// peekLiveSession returns the cached, already-authenticated session for a domain
// WITHOUT opening or handshaking — used by the passive-entry responder, which
// must answer the car's challenge from whatever session is already warm. Returns
// null when there is none (then we cannot sign, and must not pretend to).
export function peekLiveSession(vin: string, domain: Domain): Session | null {
  const entry = _domainCache.get(domain);
  if (!entry) return null;
  if (entry.session.vin !== vin) return null;
  return entry.session;
}

// assertKeyOnWhitelist surfaces the car's "your key is gone" verdict as a typed,
// non-retryable error instead of letting the handshake continue and fail later
// as an opaque transport problem.
function assertKeyOnWhitelist(sessionInfo: { status?: number | null }): void {
  if (sessionInfo?.status === SESSION_INFO_STATUS_KEY_NOT_ON_WHITELIST) {
    console.warn('[ble] car reports KEY_NOT_ON_WHITELIST — re-enrollment required');
    throw new KeyNotOnWhitelistError();
  }
}
