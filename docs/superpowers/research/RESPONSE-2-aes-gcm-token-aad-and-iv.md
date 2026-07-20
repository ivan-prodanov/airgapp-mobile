# RE RESPONSE #2 — the exact AAD + IV for the AES_GCM_TOKEN seal

**Answers:** `REQUEST-2-aes-gcm-token-aad-and-iv.md`. **Source:** direct read of the Android seal
(`gf0/b.java` `k()`, `rb0/a.java` `h()`/`f()`, `com/teslamotors/plugins/ble/z.java` `a()`, `q1.java:1241/1250`) — literal GCM arguments, not a summary. **Confidence: HIGH** (it's the decompiled code path your car parsed as a legacy `SignedMessage`).

## The one-line fix

**Your AAD is correct. Your IV is wrong: it is the counter as a raw 4-BYTE big-endian value — not 12 bytes.**
All four of your 12-byte layouts fail for the same reason: AES-GCM derives its pre-counter block **J0** *differently* for a non-96-bit IV (via GHASH) than for a 12-byte IV (`IV‖0x00000001`). A 4-byte IV and any 12-byte arrangement of the same counter produce different keystream **and** a different tag — hence `FAULT_AES_DECRYPT_AUTH` every time. You never tested the layout the app actually uses.

## The seal, byte for byte (from the decompile)

```
// key: rb0/a.java f()  — same key your commands already use successfully
sessionKey = SHA1( ECDH_P256(ourPriv, carEphemeralPub).sharedSecret )[:16]      // 16 bytes

// gf0/b.java k(e3Var, tokenBytes):
counter  = L()                                                                  // uint32, monotonic
iv       = [ (counter>>24)&0xFF, (counter>>16)&0xFF, (counter>>8)&0xFF, counter&0xFF ]   // ← EXACTLY 4 BYTES, big-endian
plaintext= e3Var.encode()   // = serialized UnsignedMessage{ authenticationResponse(3)=... }   (your bytes, correct)
aad      = tokenBytes        // the raw 20-byte challenge token, verbatim (passed straight through q1.java:1241→1250)

// rb0/a.java h(plaintext, key, iv, aad):  BouncyCastle
//   AEADParameters(KeyParameter(sessionKey), macSize=128, nonce=iv /*4 bytes*/, associatedText=aad /*20-byte token*/)
//   GCMBlockCipher(AESEngine); init(encrypt=true); out = doFinal(plaintext)
//   → out = ciphertext ‖ tag(16)
ct  = out[:-16]
tag = out[-16:]

// com/teslamotors/plugins/ble/z.java a(sigType, ct, tag, counter, keyId):
SignedMessage{
  token(1)                  = <EMPTY>,                 // left null — NOT echoed
  protobufMessageAsBytes(2) = ct,
  signatureType(3)          = SIGNATURE_TYPE_AES_GCM_TOKEN (3),   // because tokenBytes != null (gf0/b.java k)
  signature(4)              = tag,                     // 16 bytes
  keyId(5)                  = SHA1(pubkey)[:4],
  counter(6)                = counter,                 // SAME value used to build the IV
}
send ToVCSECMessage{ signedMessage }
```

That's the complete `k()` body: `byte[] bArr2 = {(byte)((jL>>24)&255),(byte)((jL>>16)&255),(byte)((jL>>8)&255),(byte)(255&jL)}; … rb0.a.h(e3Var.encode(), this.f68845e /*key*/, bArr2 /*iv, 4B*/, bArr /*aad=token*/)`. The nonce handed to `AEADParameters` is that 4-byte array, nothing more.

## Your four questions, answered

- **Q1 (AAD): the bare 20-byte token, verbatim.** *Not* a metadata TLV block. The metadata/`CHALLENGE=6`
  TLV is the **universal** `AES_GCM_PERSONALIZED` path only; the legacy `AES_GCM_TOKEN` path feeds the raw
  token straight into the GCM `associatedText` arg. Your AAD was already right — don't change it.
- **Q2 (IV): the 4-byte big-endian counter, used directly as a variable-length GCM nonce.** This is the fix.
  Because it's a non-96-bit IV, GCM computes `J0 = GHASH_H( IV‖0¹² ‖ 0⁸‖len₆₄(32) )`, then the first
  encryption counter is `inc32(J0)` and the tag masks with `E_K(J0)`. A 12-byte IV skips GHASH entirely
  (`J0 = IV‖0x00000001`) — which is why your four attempts couldn't match no matter the byte order.
- **Q3 (path): legacy `SignedMessage` / `AES_GCM_TOKEN` — keep it.** Confirmed: this signer is
  `gf0/b.java` whose `getType()` returns `h0.d.LEGACY`, and your car replied with `signedMessageStatus`
  (the legacy status message). The universal `RoutableMessage` path is a *different* signer; you don't need
  to switch, and switching wouldn't be simpler here since the legacy path is what the whitelisted key uses
  for passive auth.
- **Q4 (plaintext): the wrapped `UnsignedMessage{authenticationResponse}` — you have it right.** The seal
  encrypts `e3Var.encode()` where `e3` = `UnsignedMessage`. Your `1a 06 08 02 10 00 18 00` is exactly that
  (`1a 06` = field 3 LEN 6, then `AuthenticationResponse{level=2, estimatedDistance=0, rejection=0}`). Do
  **not** seal the bare `AuthenticationResponse`.

## How to feed a 4-byte IV to GCM (the practical part)

Most of your eliminations came from a crypto lib that wants a 12-byte nonce. You need one that accepts an
arbitrary-length nonce (and does the GHASH `J0` itself):

- **Android native — trivial:** use BouncyCastle/SpongyCastle exactly like `rb0.a.h`:
  `GCMBlockCipher(new AESEngine()); init(true, new AEADParameters(new KeyParameter(key), 128, iv4, token))`.
  It accepts the 4-byte nonce and derives `J0` internally. (This is literally Tesla's code.)
- **iOS native — use CommonCrypto, not CryptoKit.** `CCCryptorGCM` / `CCCryptorGCMAddIV` accepts a
  4-byte IV. (CryptoKit's `AES.GCM.Nonce` *requires* 12 bytes and will reject this — that's a trap; Tesla's
  `TMCrypto.m` uses CommonCrypto for exactly this reason.)
- **Node (for a JS test harness):** `crypto.createCipheriv('aes-128-gcm', key, iv4)` — OpenSSL accepts a
  non-12-byte IV and computes `J0`. Then `setAAD(token)`, `update(pt)`, `final()`, `getAuthTag()`.
- **WebCrypto (`SubtleCrypto`) — will NOT work:** it hard-requires a 96-bit IV and gives you no `J0`
  override. If you're stuck on it, drop to a software GCM that lets you set `J0` (or compute it yourself,
  below).
- `@noble/ciphers` `gcm`: verify it accepts a 4-byte nonce before relying on it; if it 12-byte-only,
  compute `J0` manually and use raw CTR+GHASH.

**Manual `J0` for the 4-byte IV** (only if your lib can't take it), per NIST SP 800-38D §7.1:
```
H  = AES-ECB-encrypt(K, 0x00 * 16)
J0 = GHASH_H( IV(4B) ‖ 0x00*12   ‖   0x00*8 ‖ uint64_BE(bitlen(IV)=32) )
     // two 16-byte blocks: [ IV‖zeros ] , [ zeros‖0x0000000000000020 ]
// then encrypt with CTR starting at inc32(J0); tag = E_K(J0) XOR GHASH_H(AAD, ciphertext)
```

## Ranked test list (you said you can burn through these fast)

1. **IV = 4-byte counter BE32, AAD = bare 20-byte token, plaintext = UnsignedMessage** — the decompiled
   truth. Expect a **grant** (or at worst a semantic reject like `DEVICE_STATIONARY`, *not* `AES_DECRYPT_AUTH`).
   The `counter` you place in `SignedMessage.counter(6)` must be the **same** value you built the IV from.
2. If #1 still returns `AES_DECRYPT_AUTH`: your GCM lib silently coerced the 4-byte IV (some zero-extend to
   12). Verify by computing `J0` manually (above) and confirm the tag matches a BouncyCastle reference for
   the same inputs — then you know the lib was the culprit, not the recipe.
3. Only if 1–2 both fail (they shouldn't): re-capture and diff the exact `keyId`/`counter` echoed by the car
   against what you sent, to rule out a counter/keyId off-by-one.

I'd put >90% on #1 — it's the literal seal, and it's the one IV width you hadn't tried. Ping me with the
fault code if #1 doesn't grant and I'll trace the next layer (the `L()` counter seeding and whether the
first post-handshake counter is 0- or 1-based, which is the only remaining degree of freedom I can see).

## Provenance
Decompiled from the Android app (`com.teslamotors.tesla` 4.58.0) jadx sources: `gf0/b.java` `k()`
(signer, `getType()==LEGACY`), `rb0/a.java` `h()` (GCM) + `f()` (ECDH→SHA1 KDF), `com/teslamotors/plugins/
ble/z.java` `a()` (SignedMessage builder), `q1.java:1241/1250` (AAD=token pass-through). Cross-consistent
with iOS `TMCrypto.m` (`encryptAESGCM…:withIV:withAdditionalData:`, CommonCrypto). Supersedes the
"nonce = counter(4B BE)" line in `RESPONSE-passive-entry-challenge-protocol.md` §Q1 — which was right
about the bytes but didn't stress that the IV is passed at its native **4-byte width** (that's the load-bearing detail).
