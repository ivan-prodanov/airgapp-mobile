import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  RoutableMessage,
  SessionInfo,
  Action,
  VCSECUnsignedMessage,
  encodeMessage,
  decodeMessage,
} from './proto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtures = JSON.parse(
  readFileSync(path.join(__dirname, '__fixtures__/goVectors.json'), 'utf8'),
);

function hexToBytes(hex: string): Uint8Array {
  return new Uint8Array(Buffer.from(hex, 'hex'));
}

// RoutableMessage is the frame envelope the Pi's demux keys on: uuid (request id) and
// fromDestination.routingAddress (16-byte VIN-scoped address) must survive byte-for-byte.
test('RoutableMessage encode->decode round-trips uuid and fromDestination.routingAddress', () => {
  const uuid = hexToBytes('0102030405060708090a0b0c0d0e0f10');
  const routingAddress = hexToBytes('aabbccddeeff00112233445566778899');

  const encoded = encodeMessage(RoutableMessage, {
    uuid,
    fromDestination: { routingAddress },
  });
  const decoded = decodeMessage(RoutableMessage, encoded);

  assert.deepEqual(new Uint8Array(decoded.uuid), uuid);
  assert.deepEqual(new Uint8Array(decoded.fromDestination.routingAddress), routingAddress);
});

// sessionInfoHex = "082a120704aabbccddeeff1a100102030405060708090a0b0c0d0e0f102587d61200"
// (a small Go-emitted SessionInfo, not a real 65-byte device key — asserting the actual
// decoded shape, not a guessed one).
test('decodes sessionInfoHex as Signatures.SessionInfo', () => {
  const decoded = decodeMessage(SessionInfo, hexToBytes(fixtures.sessionInfoHex));
  assert.equal(decoded.counter, 42);
  assert.equal(decoded.publicKey.length, 7);
  assert.equal(decoded.epoch.length, 16);
  assert.equal(decoded.clockTime, 1234567);
  assert.equal(decoded.status, 0); // SESSION_INFO_STATUS_OK
});

test('decodes rmSessionInfoReqHex as RoutableMessage with the sessionInfoRequest oneof case', () => {
  const decoded = decodeMessage(RoutableMessage, hexToBytes(fixtures.rmSessionInfoReqHex));
  assert.equal(decoded.payload, 'sessionInfoRequest');
  assert.ok(decoded.sessionInfoRequest);
  assert.ok(decoded.sessionInfoRequest.publicKey.length > 0);
});

test('decodes rmAesgcmPayloadHex as RoutableMessage with an AES-GCM signatureData payload', () => {
  const decoded = decodeMessage(RoutableMessage, hexToBytes(fixtures.rmAesgcmPayloadHex));
  assert.equal(decoded.payload, 'protobufMessageAsBytes');
  assert.equal(decoded.subSigData, 'signatureData');
  assert.ok(decoded.signatureData);
  assert.ok(decoded.signatureData.AES_GCM_PersonalizedData);
});

// actionHonkHex = "1203da0100" (a CarServer.Action wrapping VehicleAction.vehicleControlHonkHornAction).
test('decodes actionHonkHex as CarServer.Action with the honk vehicleAction case', () => {
  const decoded = decodeMessage(Action, hexToBytes(fixtures.actionHonkHex));
  assert.equal(decoded.actionMsg, 'vehicleAction');
  assert.equal(decoded.vehicleAction.vehicleActionMsg, 'vehicleControlHonkHornAction');
});

// vcsecGetStatusHex = "0a00" (a VCSEC.UnsignedMessage carrying an empty InformationRequest).
test('decodes vcsecGetStatusHex as VCSEC.UnsignedMessage with the InformationRequest case', () => {
  const decoded = decodeMessage(VCSECUnsignedMessage, hexToBytes(fixtures.vcsecGetStatusHex));
  assert.equal(decoded.subMessage, 'InformationRequest');
  assert.ok(decoded.InformationRequest);
});

test('encodeMessage throws on a bogus field set (delegates to type.verify)', () => {
  assert.throws(() => encodeMessage(RoutableMessage, { flags: 'not-a-number' }), /encode:/);
});
