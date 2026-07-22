// Golden vectors for the routable passive seal — the oracle the Swift VcsecSigner
// must reproduce byte-for-byte. Uses the SAME primitives buildRoutablePassiveResponse
// uses, with FIXED inputs (fixed nonce + expiresAt) so it's deterministic.
import { buildAesGcmMetadata, aesGcmEncryptWithNonce } from '../src/ble/crypto';
import { encodeMessage, RoutableMessage } from '../src/ble/proto';
import { bytesToHex } from '../src/ble/bytes';
import { encodeUnsignedAuthResponse, encodeAuthenticationResponse, AUTH_LEVEL } from '../src/ble/passiveEntryAuth';
import { writeFileSync } from 'node:fs';

const hexb = (h: string) => Uint8Array.from(h.match(/../g)!.map((x) => parseInt(x, 16)));

// FIXED inputs (embed the SAME in Swift).
const sessionKey = hexb('42'.repeat(16));
const vin = '5YJ3E1EA1AAA00001';
const epoch = hexb('07'.repeat(16));
const counter = 42;
const expiresAt = 1000000;
const routingAddress = hexb('ab'.repeat(16));
const myPubRaw = hexb('04' + '11'.repeat(64)); // 65B SEC1-shaped dummy
const nonce = hexb('112233445566778899aabbcc');
const flags = 0;
const inner = encodeUnsignedAuthResponse(encodeAuthenticationResponse({ authenticationLevel: AUTH_LEVEL.DRIVE }));

const aad = buildAesGcmMetadata({ domain: 2, verifierName: vin, epoch, expiresAt, counter, flags });
const env = aesGcmEncryptWithNonce(sessionKey, inner, aad, nonce);
const frame = encodeMessage(RoutableMessage, {
  toDestination: { domain: 2 },
  fromDestination: { routingAddress },
  protobufMessageAsBytes: env.ciphertext,
  signatureData: {
    signerIdentity: { publicKey: myPubRaw },
    AES_GCM_PersonalizedData: { epoch, nonce, counter, expiresAt, tag: env.tag },
  },
  uuid: hexb('00'),
  flags,
});

const golden = {
  inputs: {
    sessionKey: bytesToHex(sessionKey), vin, epoch: bytesToHex(epoch), counter, expiresAt,
    routingAddress: bytesToHex(routingAddress), myPubRaw: bytesToHex(myPubRaw),
    nonce: bytesToHex(nonce), flags, innerHex: bytesToHex(inner),
  },
  aadHex: bytesToHex(aad),
  ciphertextHex: bytesToHex(env.ciphertext),
  tagHex: bytesToHex(env.tag),
  frameHex: bytesToHex(frame),
};
writeFileSync('modules/expo-passive-entry/ios/routableSeal.golden.json', JSON.stringify(golden, null, 2));
console.log('AAD    =', golden.aadHex);
console.log('CT     =', golden.ciphertextHex);
console.log('TAG    =', golden.tagHex);
console.log('FRAME  =', golden.frameHex);
