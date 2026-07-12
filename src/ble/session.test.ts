import { test } from 'node:test';
import assert from 'node:assert/strict';

import { p256 } from '@noble/curves/p256';
import { randomBytes } from '@noble/hashes/utils';

import {
  openDirectSession,
  sendCommand,
  evaluateFault,
  isTransportDeadError,
  isStaleFrameError,
  withCachedSession,
  evictSession,
  closeAllCachedSessions,
  honkAction,
  vcsecGetStatusAction,
  encodeInfotainmentAction,
  encodeVCSECMessage,
  __resetSessionCaches,
  DOMAIN_INFOTAINMENT,
  DOMAIN_VEHICLE_SECURITY,
} from './session';
import type { DeviceKeys, Domain, PiTransport } from './types';
import {
  deriveSessionKeyMaterial,
  hmacSubkey,
  buildAesGcmMetadata,
  buildAesGcmResponseMetadata,
  makeRequestHash,
  aesGcmDecrypt,
  aesGcmEncryptWithNonce,
  MetadataBlockBuilder,
  TAG,
  SIGNATURE_TYPE,
} from './crypto';
import {
  RoutableMessage,
  SessionInfo,
  encodeMessage,
  decodeMessage,
} from './proto';
import { base64ToBytes, bytesToBase64 } from './bytes';

const VIN = '5YJ3E1EA1AAAA0001';

function makeDeviceKeys(): DeviceKeys {
  const priv = p256.utils.randomPrivateKey();
  return { privateScalar: priv, publicKeyRaw: p256.getPublicKey(priv, false) };
}

// computeSessionInfoTag reproduces exactly what openDirectSession does to
// verify the car's SessionInfo HMAC — so the fake car, holding the same
// derived key, can produce a tag that verifies (or, tampered, one that
// doesn't).
function computeSessionInfoTag(
  keyBytes: Uint8Array,
  vin: string,
  challenge: Uint8Array,
  sessionInfoBytes: Uint8Array,
): Uint8Array {
  const subkey = hmacSubkey(keyBytes, 'session info');
  const m = new MetadataBlockBuilder();
  m.add(TAG.SIGNATURE_TYPE, new Uint8Array([SIGNATURE_TYPE.HMAC]));
  m.add(TAG.PERSONALIZATION, new TextEncoder().encode(vin));
  m.add(TAG.CHALLENGE, challenge);
  return m.hmac(subkey, sessionInfoBytes);
}

interface FakeCarOpts {
  vin?: string;
  epoch?: Uint8Array;
  counter?: number;
  clockTime?: number;
  cannedResponse?: Uint8Array;
  // Corruption modes for the negative tests.
  corruptTag?: boolean; // flip one byte of the SessionInfo HMAC tag (MITM)
  wrongRequestUuid?: boolean; // respond with a mismatched request_uuid
  wrongFromDomain?: boolean; // respond from a different domain
  responseFault?: number; // fault code baked into the encrypted response AAD
}

// FakeCar plays the vehicle end of the protocol over the PiTransport
// interface. Because our crypto is self-consistent, it derives the SAME
// session key the client derives (ECDH is symmetric), crafts a valid
// SessionInfo + HMAC tag on handshake, and on a command decrypts the
// request (proving the command AAD is correct) then seals a response under
// the shared key with the response-side AAD. No hardware, no network.
class FakeCar implements PiTransport {
  readonly opts: Required<Omit<FakeCarOpts, 'cannedResponse'>> & { cannedResponse: Uint8Array };
  // Per-domain derived key material, established at handshake, reused on
  // the command exchange over the same (shared) BLE session.
  private keyByDomain = new Map<number, Uint8Array>();
  // Instrumentation the tests assert on.
  openCount = 0;
  closeCount = 0;
  openedVins: string[] = [];
  decryptedCommands: Uint8Array[] = [];
  seenCommandCounters: number[] = [];
  private carPriv = p256.utils.randomPrivateKey();
  private carPub = p256.getPublicKey(this.carPriv, false);
  private respCounter = 100;

  constructor(o: FakeCarOpts = {}) {
    this.opts = {
      vin: o.vin ?? VIN,
      epoch: o.epoch ?? randomBytes(16),
      counter: o.counter ?? 5,
      clockTime: o.clockTime ?? 1_700_000_000,
      cannedResponse: o.cannedResponse ?? new Uint8Array([0xca, 0xfe, 0xba, 0xbe]),
      corruptTag: o.corruptTag ?? false,
      wrongRequestUuid: o.wrongRequestUuid ?? false,
      wrongFromDomain: o.wrongFromDomain ?? false,
      responseFault: o.responseFault ?? 0,
    };
  }

  async openSession(vin: string): Promise<string> {
    this.openCount += 1;
    this.openedVins.push(vin);
    return 'pi-sess-1';
  }

  async closeSession(_sessionId: string): Promise<void> {
    this.closeCount += 1;
  }

  async exchange(_sessionId: string, payloadB64: string, _timeoutMs: number): Promise<string> {
    const req = decodeMessage(RoutableMessage, base64ToBytes(payloadB64));
    const domain = req.toDestination?.domain as number;
    if (req.sessionInfoRequest && req.sessionInfoRequest.publicKey?.length) {
      return this.handshakeReply(req, domain);
    }
    if (req.protobufMessageAsBytes && req.protobufMessageAsBytes.length) {
      return this.commandReply(req, domain);
    }
    throw new Error('FakeCar: unexpected request shape');
  }

  private handshakeReply(req: ReturnType<typeof RoutableMessage.decode>, domain: number): string {
    const devicePub = new Uint8Array(req.sessionInfoRequest!.publicKey);
    const keyBytes = deriveSessionKeyMaterial(this.carPriv, devicePub);
    this.keyByDomain.set(domain, keyBytes);

    const challenge = new Uint8Array(req.uuid); // uuid doubles as HMAC challenge
    const sessionInfoBytes = encodeMessage(SessionInfo, {
      publicKey: this.carPub,
      epoch: this.opts.epoch,
      counter: this.opts.counter,
      clockTime: this.opts.clockTime,
      status: 0,
    });
    const tag = computeSessionInfoTag(keyBytes, this.opts.vin, challenge, sessionInfoBytes);
    if (this.opts.corruptTag) tag[0] ^= 0xff;

    const resp = encodeMessage(RoutableMessage, {
      toDestination: { routingAddress: req.fromDestination!.routingAddress },
      fromDestination: { domain },
      sessionInfo: sessionInfoBytes,
      signatureData: { sessionInfoTag: { tag } },
      requestUuid: challenge,
    });
    return bytesToBase64(resp);
  }

  private commandReply(req: ReturnType<typeof RoutableMessage.decode>, domain: number): string {
    const keyBytes = this.keyByDomain.get(domain)!;
    const gcm = req.signatureData!.AES_GCM_PersonalizedData!;
    const wireFlags = req.flags || 0;

    // Rebuild the command AAD exactly as the client did and decrypt — this
    // is the proof the command metadata (domain/epoch/expiry/counter/flags)
    // matches on both sides.
    const aad = buildAesGcmMetadata({
      domain,
      verifierName: this.opts.vin,
      epoch: new Uint8Array(gcm.epoch),
      expiresAt: gcm.expiresAt,
      counter: gcm.counter,
      flags: wireFlags,
    });
    const plaintext = aesGcmDecrypt(
      keyBytes,
      new Uint8Array(gcm.nonce),
      new Uint8Array(req.protobufMessageAsBytes),
      new Uint8Array(gcm.tag),
      aad,
    );
    this.decryptedCommands.push(plaintext);
    this.seenCommandCounters.push(gcm.counter);

    // Seal the canned response under the same key with the response-side
    // AAD (binds to this request via requestHash = hash of the request tag).
    this.respCounter += 1;
    const responseFlags = wireFlags;
    const requestHash = makeRequestHash(new Uint8Array(gcm.tag));
    const respAad = buildAesGcmResponseMetadata({
      domain,
      verifierName: this.opts.vin,
      counter: this.respCounter,
      flags: responseFlags,
      requestHash,
      fault: this.opts.responseFault,
    });
    const nonce = randomBytes(12);
    const sealed = aesGcmEncryptWithNonce(keyBytes, this.opts.cannedResponse, respAad, nonce);

    const fromDomain = this.opts.wrongFromDomain
      ? domain === DOMAIN_INFOTAINMENT
        ? DOMAIN_VEHICLE_SECURITY
        : DOMAIN_INFOTAINMENT
      : domain;
    const requestUuid = this.opts.wrongRequestUuid ? randomBytes(16) : new Uint8Array(req.uuid);

    const resp = encodeMessage(RoutableMessage, {
      fromDestination: { domain: fromDomain },
      protobufMessageAsBytes: sealed.ciphertext,
      signatureData: {
        AES_GCM_ResponseData: { nonce: sealed.nonce, counter: this.respCounter, tag: sealed.tag },
      },
      requestUuid,
      flags: responseFlags,
    });
    return bytesToBase64(resp);
  }
}

// --- (a) evaluateFault table ------------------------------------------------

test('evaluateFault: session-stale family (4/5/6/15/17) → retryable, delay 0', () => {
  for (const f of [4, 5, 6, 15, 17]) {
    assert.deepEqual(evaluateFault(f), { category: 'session-stale', retryable: true, delayMs: 0 }, `fault ${f}`);
  }
});

test('evaluateFault: transient family (1/2/11) → retryable, delay 100', () => {
  for (const f of [1, 2, 11]) {
    assert.deepEqual(evaluateFault(f), { category: 'transient', retryable: true, delayMs: 100 }, `fault ${f}`);
  }
});

test('evaluateFault: everything else → semantic, non-retryable', () => {
  for (const f of [0, 3, 7, 8, 9, 10, 12, 13, 14, 16, 18, 99]) {
    assert.deepEqual(evaluateFault(f), { category: 'semantic', retryable: false, delayMs: 0 }, `fault ${f}`);
  }
});

// --- (b) transport-dead / stale-frame predicates ----------------------------

test('isTransportDeadError matches the Pi-side dead-link strings', () => {
  for (const msg of [
    'BLE send: send ATT request failed: io: read/write on closed pipe',
    'BLE connection closed',
    'BLE-SESSION not found',
    'session not found',
    'no peripherals',
    'device not connected',
  ]) {
    assert.equal(isTransportDeadError(new Error(msg)), true, msg);
  }
  assert.equal(isTransportDeadError(new Error('car returned BAD_PARAMETER')), false);
  assert.equal(isTransportDeadError(null), false);
});

test('isStaleFrameError matches stale response / stale frame only', () => {
  assert.equal(isStaleFrameError(new Error('Pi returned stale response: sent uuid=…')), true);
  assert.equal(isStaleFrameError(new Error('Pi returned stale frame: expected from domain=3')), true);
  assert.equal(isStaleFrameError(new Error('closed pipe')), false);
});

// --- (c) handshake happy path -----------------------------------------------

test('openDirectSession completes the handshake and derives the shared key', async () => {
  __resetSessionCaches();
  const car = new FakeCar({ counter: 7, clockTime: 1_700_000_123 });
  const deviceKeys = makeDeviceKeys();

  const session = await openDirectSession({
    transport: car,
    vin: VIN,
    deviceKeys,
    domain: DOMAIN_INFOTAINMENT,
  });

  // The key the engine derived must equal ECDH(devicePriv, carPub) → sha1[:16],
  // recomputed independently here from the car's advertised pubkey.
  const expectedKey = deriveSessionKeyMaterial(deviceKeys.privateScalar, session.vehiclePubRaw);
  assert.deepEqual(new Uint8Array(session.keyBytes), expectedKey);
  assert.deepEqual(new Uint8Array(session.sessionKey), expectedKey);
  assert.equal(session.counter, 7);
  assert.equal(session.clockBase, 1_700_000_123);
  assert.equal(session.epoch.length, 16);
  assert.equal(session.domain, DOMAIN_INFOTAINMENT);
  assert.equal(session.vin, VIN);
  assert.equal(session.sessionId, 'pi-sess-1');
  assert.equal(car.openCount, 1);
  await session.close();
  assert.equal(car.closeCount, 1);
});

// --- (d) handshake MITM reject ----------------------------------------------

test('openDirectSession rejects a tampered SessionInfo HMAC tag (MITM)', async () => {
  __resetSessionCaches();
  const car = new FakeCar({ corruptTag: true });
  await assert.rejects(
    openDirectSession({ transport: car, vin: VIN, deviceKeys: makeDeviceKeys(), domain: DOMAIN_INFOTAINMENT }),
    /HMAC verification FAILED/,
  );
  // The failed handshake must have released the Pi session it opened.
  assert.equal(car.openCount, 1);
  assert.equal(car.closeCount, 1);
});

// --- (e) command round-trip -------------------------------------------------

test('sendCommand encrypts a honk, exchanges, and decrypts the response', async () => {
  __resetSessionCaches();
  const canned = new Uint8Array([1, 2, 3, 4, 5]);
  const car = new FakeCar({ cannedResponse: canned });
  const session = await openDirectSession({
    transport: car,
    vin: VIN,
    deviceKeys: makeDeviceKeys(),
    domain: DOMAIN_INFOTAINMENT,
  });

  const honk = honkAction();
  const { routable, decryptedPayload } = await sendCommand({
    transport: car,
    session,
    payloadBytes: honk.bytes,
    flags: honk.flags,
  });

  // The car decrypted our command to exactly the honk bytes → command AAD OK.
  assert.deepEqual(new Uint8Array(car.decryptedCommands[0]), new Uint8Array(honk.bytes));
  // And we decrypted its sealed response → response AAD (requestHash) OK.
  assert.deepEqual(decryptedPayload && new Uint8Array(decryptedPayload), canned);
  assert.ok(routable);
  await session.close();
});

// --- (f) counter monotonic --------------------------------------------------

test('sendCommand increments the wire counter on each call', async () => {
  __resetSessionCaches();
  const car = new FakeCar({ counter: 20 });
  const session = await openDirectSession({
    transport: car,
    vin: VIN,
    deviceKeys: makeDeviceKeys(),
    domain: DOMAIN_INFOTAINMENT,
  });
  const honk = honkAction();
  await sendCommand({ transport: car, session, payloadBytes: honk.bytes });
  await sendCommand({ transport: car, session, payloadBytes: honk.bytes });
  // Seed counter was 20; first send uses 21, second 22.
  assert.deepEqual(car.seenCommandCounters, [21, 22]);
  assert.equal(session.counter, 22);
  await session.close();
});

// --- (g) stale-frame throws -------------------------------------------------

test('sendCommand throws on a mismatched request_uuid (stale response)', async () => {
  __resetSessionCaches();
  const car = new FakeCar({ wrongRequestUuid: true });
  const session = await openDirectSession({
    transport: car,
    vin: VIN,
    deviceKeys: makeDeviceKeys(),
    domain: DOMAIN_INFOTAINMENT,
  });
  await assert.rejects(
    sendCommand({ transport: car, session, payloadBytes: honkAction().bytes }),
    /stale response/,
  );
  await session.close();
});

test('sendCommand throws on a from-domain mismatch (stale frame)', async () => {
  __resetSessionCaches();
  const car = new FakeCar({ wrongFromDomain: true });
  const session = await openDirectSession({
    transport: car,
    vin: VIN,
    deviceKeys: makeDeviceKeys(),
    domain: DOMAIN_INFOTAINMENT,
  });
  await assert.rejects(
    sendCommand({ transport: car, session, payloadBytes: honkAction().bytes }),
    /stale frame/,
  );
  await session.close();
});

// --- (h) withCachedSession reuse + refcount ---------------------------------

test('withCachedSession reuses a cached session for the same domain', async () => {
  __resetSessionCaches();
  const car = new FakeCar();
  const deviceKeys = makeDeviceKeys();
  const params = { transport: car, vin: VIN, deviceKeys, domain: DOMAIN_INFOTAINMENT as Domain };

  const seen: boolean[] = [];
  await withCachedSession(params, async (_s, cached) => {
    seen.push(cached);
  });
  await withCachedSession(params, async (_s, cached) => {
    seen.push(cached);
  });

  // Only ONE handshake / Pi openSession across two calls.
  assert.equal(car.openCount, 1);
  assert.deepEqual(seen, [false, true]);
  closeAllCachedSessions();
});

test('both domains share one Pi session; closeSession fires only after the last release', async () => {
  __resetSessionCaches();
  const car = new FakeCar();
  const deviceKeys = makeDeviceKeys();

  await withCachedSession(
    { transport: car, vin: VIN, deviceKeys, domain: DOMAIN_VEHICLE_SECURITY },
    async () => {},
  );
  await withCachedSession(
    { transport: car, vin: VIN, deviceKeys, domain: DOMAIN_INFOTAINMENT },
    async () => {},
  );

  // Second domain reused the same Pi sessionId (refcount 2), so only one open.
  assert.equal(car.openCount, 1);
  assert.equal(car.closeCount, 0);

  // VIN-scoped evict releases BOTH cached domains; the Pi DELETE only fires
  // when the refcount reaches 0 — exactly once.
  await evictSession(VIN, DOMAIN_VEHICLE_SECURITY);
  assert.equal(car.closeCount, 1);
});

// --- action builders sanity -------------------------------------------------

test('honkAction / vcsecGetStatusAction target the right domains + flags', () => {
  const honk = honkAction();
  assert.equal(honk.domain, DOMAIN_INFOTAINMENT);
  assert.deepEqual(
    new Uint8Array(honk.bytes),
    new Uint8Array(encodeInfotainmentAction({ vehicleControlHonkHornAction: {} })),
  );
  assert.ok(honk.flags === undefined || honk.flags === 0);

  const status = vcsecGetStatusAction();
  assert.equal(status.domain, DOMAIN_VEHICLE_SECURITY);
  assert.equal(status.flags, 1 << 1);
  assert.deepEqual(
    new Uint8Array(status.bytes),
    new Uint8Array(encodeVCSECMessage({ InformationRequest: { informationRequestType: 0 } })),
  );
});
