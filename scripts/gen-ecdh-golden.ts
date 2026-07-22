// ECDH golden: verify the native P-256 ECDH + SHA1-KDF (sessionKey = SHA1(X)[:16])
// matches the TS path, given fixed key material. Car-free.
import { p256 } from '@noble/curves/p256';
import { deriveSessionKey, bytesToHex } from '../src/ble/crypto';
import { writeFileSync } from 'node:fs';

const hexb = (h: string) => Uint8Array.from(h.match(/../g)!.map((x) => parseInt(x, 16)));

// FIXED valid P-256 scalars (embed the same in Swift).
const myPriv = hexb('11'.repeat(32));
const peerPriv = hexb('22'.repeat(32));
const peerPub = p256.getPublicKey(peerPriv, false); // 65B 0x04||X||Y (the "car" pubkey)

const sessionKey = deriveSessionKey(myPriv, peerPub);
const golden = {
  myPrivHex: bytesToHex(myPriv),
  peerPubHex: bytesToHex(peerPub),
  sessionKeyHex: bytesToHex(sessionKey),
};
writeFileSync('modules/expo-passive-entry/ios/ecdh.golden.json', JSON.stringify(golden, null, 2));
console.log('peerPub    =', golden.peerPubHex);
console.log('sessionKey =', golden.sessionKeyHex);
