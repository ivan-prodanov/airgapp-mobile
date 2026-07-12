// __testutils__/fakeCar.ts — the scriptable "vehicle" end of the BLE protocol.
//
// Extracted from session.test.ts so BOTH session.test.ts and gateway.test.ts
// can drive the full handshake + command round-trip in pure Node, no hardware.
//
// Because our crypto is self-consistent, FakeCar derives the SAME session key
// the client derives (ECDH is symmetric), crafts a valid SessionInfo + HMAC
// tag on handshake, and on a command decrypts the request (proving the command
// AAD is correct) then seals a response under the shared key with the
// response-side AAD.
//
// Scriptability (new, additive — the default no-script behavior is byte-for-
// byte what session.test.ts relied on): pass `script`, a FIFO of per-command
// behaviors, to make a single FakeCar return, per COMMAND exchange, any of:
//   • { kind: 'ok', response? }  — seal a normal (optionally custom) response.
//   • { kind: 'fault', fault }   — reply status-only with operationStatus=1 and
//                                  the given MessageFault_E (semantic/transient).
//   • { kind: 'staleUuid' }      — seal a valid response but echo a mismatched
//                                  request_uuid → sendCommand throws "stale response".
//   • { kind: 'decryptFail' }    — seal then corrupt the response tag so
//                                  aesGcmDecrypt fails. On an ENCRYPTED-response
//                                  request this surfaces as a "stale frame"
//                                  (decrypt-fail-as-stale-frame). Only meaningful
//                                  when the request set FLAG_ENCRYPT_RESPONSE.
//   • { kind: 'throw', error }   — throw from exchange (e.g. a transport-dead
//                                  "closed pipe" error, or a TransportError).
// Handshake (SessionInfoRequest) exchanges NEVER consume the script.

import { p256 } from '@noble/curves/p256';
import { randomBytes } from '@noble/hashes/utils';

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
} from '../crypto';
import { RoutableMessage, SessionInfo, encodeMessage, decodeMessage } from '../proto';
import { base64ToBytes, bytesToBase64 } from '../bytes';
import { DOMAIN_INFOTAINMENT, DOMAIN_VEHICLE_SECURITY } from '../session';
import type { DeviceKeys, PiTransport } from '../types';

export const VIN = '5YJ3E1EA1AAAA0001';

export function makeDeviceKeys(): DeviceKeys {
  const priv = p256.utils.randomPrivateKey();
  return { privateScalar: priv, publicKeyRaw: p256.getPublicKey(priv, false) };
}

// computeSessionInfoTag reproduces exactly what openDirectSession does to
// verify the car's SessionInfo HMAC — so the fake car, holding the same
// derived key, can produce a tag that verifies (or, tampered, one that
// doesn't).
export function computeSessionInfoTag(
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

// CommandProgram scripts one command exchange. See the module doc comment.
export type CommandProgram =
  | { kind: 'ok'; response?: Uint8Array }
  | { kind: 'fault'; fault: number }
  | { kind: 'staleUuid' }
  | { kind: 'decryptFail' }
  | { kind: 'throw'; error: unknown };

export interface FakeCarOpts {
  vin?: string;
  epoch?: Uint8Array;
  counter?: number;
  clockTime?: number;
  cannedResponse?: Uint8Array;
  // Corruption modes for the negative tests (apply when no `script` is set).
  corruptTag?: boolean; // flip one byte of the SessionInfo HMAC tag (MITM)
  wrongRequestUuid?: boolean; // respond with a mismatched request_uuid
  wrongFromDomain?: boolean; // respond from a different domain
  responseFault?: number; // fault code baked into the encrypted response AAD
  // Per-command-exchange FIFO. When non-empty, the next entry is consumed on
  // each COMMAND exchange (handshakes never consume it). When exhausted /
  // absent, the opts-driven default behavior applies.
  script?: CommandProgram[];
}

export class FakeCar implements PiTransport {
  readonly opts: Required<Omit<FakeCarOpts, 'cannedResponse' | 'script'>> & { cannedResponse: Uint8Array };
  readonly script: CommandProgram[];
  // Per-domain derived key material, established at handshake, reused on
  // the command exchange over the same (shared) BLE session.
  private keyByDomain = new Map<number, Uint8Array>();
  // Instrumentation the tests assert on.
  openCount = 0;
  closeCount = 0;
  openedVins: string[] = [];
  handshakeDomains: number[] = [];
  commandExchanges = 0;
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
    this.script = o.script ?? [];
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
    this.handshakeDomains.push(domain);
    const devicePub = new Uint8Array(req.sessionInfoRequest!.publicKey!);
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
    this.commandExchanges += 1;
    const program: CommandProgram | null = this.script.length ? this.script.shift()! : null;

    // A 'throw' program models a transport-level failure: the exchange never
    // delivers a clean response (e.g. the BLE link died). Throw before doing
    // any command bookkeeping.
    if (program && program.kind === 'throw') throw program.error;

    const keyBytes = this.keyByDomain.get(domain)!;
    const gcm = req.signatureData!.AES_GCM_PersonalizedData!;
    const wireFlags = req.flags || 0;

    // Rebuild the command AAD exactly as the client did and decrypt — this
    // is the proof the command metadata (domain/epoch/expiry/counter/flags)
    // matches on both sides.
    const aad = buildAesGcmMetadata({
      domain,
      verifierName: this.opts.vin,
      epoch: new Uint8Array(gcm.epoch!),
      expiresAt: gcm.expiresAt!,
      counter: gcm.counter!,
      flags: wireFlags,
    });
    const plaintext = aesGcmDecrypt(
      keyBytes,
      new Uint8Array(gcm.nonce!),
      new Uint8Array(req.protobufMessageAsBytes!),
      new Uint8Array(gcm.tag!),
      aad,
    );
    this.decryptedCommands.push(plaintext);
    this.seenCommandCounters.push(gcm.counter!);

    // A 'fault' program replies status-only (no encrypted payload) — exactly
    // how the car rejects a well-formed but disallowed/failed command.
    if (program && program.kind === 'fault') {
      const resp = encodeMessage(RoutableMessage, {
        fromDestination: { domain },
        signedMessageStatus: { operationStatus: 1, signedMessageFault: program.fault },
        requestUuid: new Uint8Array(req.uuid),
      });
      return bytesToBase64(resp);
    }

    // Seal the response under the same key with the response-side AAD (binds
    // to this request via requestHash = hash of the request tag).
    this.respCounter += 1;
    const responseFlags = wireFlags;
    const requestHash = makeRequestHash(new Uint8Array(gcm.tag!));
    const respFault = program ? 0 : this.opts.responseFault;
    const respAad = buildAesGcmResponseMetadata({
      domain,
      verifierName: this.opts.vin,
      counter: this.respCounter,
      flags: responseFlags,
      requestHash,
      fault: respFault,
    });
    const payload = program && program.kind === 'ok' && program.response ? program.response : this.opts.cannedResponse;
    const nonce = randomBytes(12);
    const sealed = aesGcmEncryptWithNonce(keyBytes, payload, respAad, nonce);

    // decryptFail: corrupt the sealed tag so the client's decrypt throws.
    if (program && program.kind === 'decryptFail') sealed.tag[0] ^= 0xff;

    const wrongDomain = !program && this.opts.wrongFromDomain;
    const fromDomain = wrongDomain
      ? domain === DOMAIN_INFOTAINMENT
        ? DOMAIN_VEHICLE_SECURITY
        : DOMAIN_INFOTAINMENT
      : domain;
    const wrongUuid = (program && program.kind === 'staleUuid') || (!program && this.opts.wrongRequestUuid);
    const requestUuid = wrongUuid ? randomBytes(16) : new Uint8Array(req.uuid);

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
