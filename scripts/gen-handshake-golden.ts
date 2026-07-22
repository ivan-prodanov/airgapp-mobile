import { encodeMessage, decodeMessage, RoutableMessage, SessionInfo } from '../src/ble/proto';
import { MetadataBlockBuilder, TAG, SIGNATURE_TYPE, hmacSubkey, bytesToHex } from '../src/ble/crypto';

const hexb = (h: string) => Uint8Array.from(h.match(/../g)!.map((x) => parseInt(x, 16)));

// --- 1. SessionInfoRequest frame (to reproduce in Swift) ---
const myPubRaw = hexb('04' + '11'.repeat(64));
const routingAddress = hexb('ab'.repeat(16));
const challenge = hexb('cc'.repeat(16));
const reqFrame = encodeMessage(RoutableMessage, {
  toDestination: { domain: 2 },
  fromDestination: { routingAddress },
  sessionInfoRequest: { publicKey: myPubRaw },
  uuid: challenge,
});
console.log('REQ_FRAME =', bytesToHex(reqFrame));

// --- 2. SessionInfo field layout (encode known values, print hex) ---
const carPub = hexb('04' + '22'.repeat(64));
const epoch = hexb('07'.repeat(16));
const si = encodeMessage(SessionInfo, { counter: 258, publicKey: carPub, epoch, clockTime: 999999 });
console.log('SESSIONINFO_BYTES =', bytesToHex(si));
const dec = decodeMessage(SessionInfo, si) as any;
console.log('SESSIONINFO_DECODED =', JSON.stringify({ counter: dec.counter, clockTime: dec.clockTime, epochLen: dec.epoch?.length, pubLen: dec.publicKey?.length }));

// --- 3. HMAC golden (verify sessionInfo authenticity) ---
const sessionKey = hexb('42'.repeat(16));
const vin = '5YJ3E1EA1AAA00001';
const subkey = hmacSubkey(sessionKey, 'session info');
const m = new MetadataBlockBuilder();
m.add(TAG.SIGNATURE_TYPE, new Uint8Array([SIGNATURE_TYPE.HMAC]));
m.add(TAG.PERSONALIZATION, new TextEncoder().encode(vin));
m.add(TAG.CHALLENGE, challenge);
const tag = m.hmac(subkey, si);
console.log('HMAC_SUBKEY =', bytesToHex(subkey));
console.log('HMAC_TAG    =', bytesToHex(tag));
