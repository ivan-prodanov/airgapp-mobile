// bytes.ts — byte <-> string helpers for the BLE transport layer.
//
// The Pi's /exchange endpoint speaks STANDARD base64 (not url-safe) in its
// payload_b64 / response_b64 fields. The browser reference used
// airgap.bytesToBase64 / base64ToBytes (thin wrappers over the DOM's
// btoa/atob). Neither btoa/atob nor Node's Buffer are guaranteed under
// React Native's Hermes runtime, so this is a self-contained pure-JS
// implementation — portable across Hermes, Node (tsx tests), and web.
//
// bytesToHex / hexToBytes are re-exported from crypto.ts so transport code
// (and P2) has one import site for all byte rendering.

export { bytesToHex, hexToBytes } from './crypto';

const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

// Reverse lookup table: char code → 6-bit value (or -1 for non-base64).
const B64_LOOKUP: Int8Array = (() => {
  const t = new Int8Array(256).fill(-1);
  for (let i = 0; i < B64_CHARS.length; i++) t[B64_CHARS.charCodeAt(i)] = i;
  return t;
})();

// bytesToBase64 encodes raw bytes as a standard (RFC 4648) base64 string
// with '=' padding.
export function bytesToBase64(u8: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 3 <= u8.length; i += 3) {
    const n = (u8[i] << 16) | (u8[i + 1] << 8) | u8[i + 2];
    out += B64_CHARS[(n >> 18) & 63] + B64_CHARS[(n >> 12) & 63] + B64_CHARS[(n >> 6) & 63] + B64_CHARS[n & 63];
  }
  const rem = u8.length - i;
  if (rem === 1) {
    const n = u8[i] << 16;
    out += B64_CHARS[(n >> 18) & 63] + B64_CHARS[(n >> 12) & 63] + '==';
  } else if (rem === 2) {
    const n = (u8[i] << 16) | (u8[i + 1] << 8);
    out += B64_CHARS[(n >> 18) & 63] + B64_CHARS[(n >> 12) & 63] + B64_CHARS[(n >> 6) & 63] + '=';
  }
  return out;
}

// base64ToBytes decodes a standard base64 string back to bytes. Whitespace
// and padding are tolerated; any other non-base64 character throws.
export function base64ToBytes(s: string): Uint8Array {
  // Strip whitespace and trailing padding — we compute length from the
  // significant character count.
  let clean = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0x3d) break; // '=' padding — everything after is padding
    if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) continue; // ws
    if (B64_LOOKUP[c] === -1) throw new Error(`invalid base64 character 0x${c.toString(16)}`);
    clean += s[i];
  }
  const outLen = Math.floor((clean.length * 6) / 8);
  const out = new Uint8Array(outLen);
  let bits = 0;
  let acc = 0;
  let o = 0;
  for (let i = 0; i < clean.length; i++) {
    acc = (acc << 6) | B64_LOOKUP[clean.charCodeAt(i)];
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 0xff;
    }
  }
  return out;
}
