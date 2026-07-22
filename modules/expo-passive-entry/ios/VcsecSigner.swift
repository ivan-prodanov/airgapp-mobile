import CryptoKit
import Foundation

// VcsecSigner — the native routable VCSEC seal, byte-for-byte with the
// on-car-proven TS path (src/ble/session.ts buildRoutablePassiveResponse +
// crypto.ts buildAesGcmMetadata/aesGcmEncrypt). Layout derived from a decoded
// golden frame (routableSeal.golden.json); goldenSelfTest() proves the Swift
// output equals the TS oracle before this ever signs to the car.
enum VcsecSigner {

  // MARK: - hex helpers

  static func hex(_ b: [UInt8]) -> String { b.map { String(format: "%02x", $0) }.joined() }
  static func unhex(_ s: String) -> [UInt8] {
    var out = [UInt8](); var i = s.startIndex
    while i < s.endIndex {
      let j = s.index(i, offsetBy: 2)
      out.append(UInt8(s[i..<j], radix: 16) ?? 0); i = j
    }
    return out
  }

  // MARK: - protobuf primitives

  private static func varint(_ v: Int) -> [UInt8] {
    var n = UInt64(v); var out = [UInt8]()
    repeat {
      var b = UInt8(n & 0x7f); n >>= 7
      if n != 0 { b |= 0x80 }
      out.append(b)
    } while n != 0
    return out
  }
  private static func lenField(_ field: Int, _ bytes: [UInt8]) -> [UInt8] {
    varint(field << 3 | 2) + varint(bytes.count) + bytes
  }
  private static func varintField(_ field: Int, _ value: Int) -> [UInt8] {
    varint(field << 3 | 0) + varint(value)
  }
  private static func fixed32Field(_ field: Int, _ value: UInt32) -> [UInt8] {
    varint(field << 3 | 5)
      + [UInt8(value & 0xff), UInt8((value >> 8) & 0xff), UInt8((value >> 16) & 0xff), UInt8((value >> 24) & 0xff)]
  }
  private static func be32(_ v: UInt32) -> [UInt8] {
    [UInt8((v >> 24) & 0xff), UInt8((v >> 16) & 0xff), UInt8((v >> 8) & 0xff), UInt8(v & 0xff)]
  }

  // MARK: - AAD (crypto.ts buildAesGcmMetadata)

  // TLV entries [tag, len, value…] then TAG_END 0xff, hashed with SHA-256.
  // expiresAt/counter are BIG-endian HERE (addUint32); note the FRAME uses a
  // little-endian fixed32 for expiresAt — different, deliberately.
  static func aad(domain: UInt8, vin: String, epoch: [UInt8], expiresAt: UInt32,
                  counter: UInt32, flags: UInt32) -> [UInt8] {
    var m = [UInt8]()
    func entry(_ tag: UInt8, _ v: [UInt8]) { m.append(tag); m.append(UInt8(v.count)); m += v }
    entry(0, [5])                 // SIGNATURE_TYPE = AES_GCM_PERSONALIZED(5)
    entry(1, [domain])            // DOMAIN
    entry(2, Array(vin.utf8))     // PERSONALIZATION
    entry(3, epoch)               // EPOCH
    entry(4, be32(expiresAt))     // EXPIRES_AT
    entry(5, be32(counter))       // COUNTER
    if flags > 0 { entry(7, be32(flags)) }
    m.append(0xff)                // TAG_END
    return Array(SHA256.hash(data: Data(m)))
  }

  // MARK: - seal

  struct Sealed { let ciphertext: [UInt8]; let tag: [UInt8] }

  static func aesGcmSeal(key: [UInt8], nonce: [UInt8], plaintext: [UInt8], aad: [UInt8]) -> Sealed? {
    guard
      let n = try? AES.GCM.Nonce(data: Data(nonce)),
      let box = try? AES.GCM.seal(Data(plaintext), using: SymmetricKey(data: Data(key)),
                                  nonce: n, authenticating: Data(aad))
    else { return nil }
    return Sealed(ciphertext: Array(box.ciphertext), tag: Array(box.tag))
  }

  static func sealFrame(sessionKey: [UInt8], vin: String, epoch: [UInt8], counter: UInt32,
                        expiresAt: UInt32, routingAddress: [UInt8], myPubRaw: [UInt8],
                        nonce: [UInt8], flags: UInt32, uuid: [UInt8], inner: [UInt8])
    -> (aad: [UInt8], sealed: Sealed, frame: [UInt8])? {
    let a = aad(domain: 2, vin: vin, epoch: epoch, expiresAt: expiresAt, counter: counter, flags: flags)
    guard let sealed = aesGcmSeal(key: sessionKey, nonce: nonce, plaintext: inner, aad: a) else { return nil }

    let toDest = varintField(1, 2)                 // Destination.domain = 2
    let fromDest = lenField(2, routingAddress)     // Destination.routingAddress
    var gcm = [UInt8]()                             // AES_GCM_PersonalizedData
    gcm += lenField(1, epoch)
    gcm += lenField(2, nonce)
    gcm += varintField(3, Int(counter))
    gcm += fixed32Field(4, expiresAt)
    gcm += lenField(5, sealed.tag)
    let signer = lenField(1, myPubRaw)             // SignerIdentity.publicKey
    let sigData = lenField(1, signer) + lenField(5, gcm)

    var frame = [UInt8]()
    frame += lenField(6, toDest)
    frame += lenField(7, fromDest)
    frame += lenField(10, sealed.ciphertext)
    frame += lenField(13, sigData)
    frame += lenField(51, uuid)
    return (a, sealed, frame)
  }

  // MARK: - golden self-test (FIXED inputs identical to gen-routable-golden.ts)

  static func goldenSelfTest() -> String {
    let sessionKey = unhex(String(repeating: "42", count: 16))
    let vin = "5YJ3E1EA1AAA00001"
    let epoch = unhex(String(repeating: "07", count: 16))
    let routingAddress = unhex(String(repeating: "ab", count: 16))
    let myPubRaw = unhex("04" + String(repeating: "11", count: 64))
    let nonce = unhex("112233445566778899aabbcc")
    let inner = unhex("1a06080210001800")
    let expectedAad = "4f90a2e7a506e6d177eca87f5b258527f9a84f08019fea2191c17265cee3cb96"
    let expectedCt = "4a336cd58a6e9cf9"
    let expectedTag = "45bcc0f9a9f07eed0f14d3dbe123b1e1"
    let expectedFrame = "320208023a121210abababababababababababababababab52084a336cd58a6e9cf96a80010a430a4104111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111112a390a1007070707070707070707070707070707120c112233445566778899aabbcc182a2540420f002a1045bcc0f9a9f07eed0f14d3dbe123b1e19a030100"

    guard let r = sealFrame(sessionKey: sessionKey, vin: vin, epoch: epoch, counter: 42,
                            expiresAt: 1000000, routingAddress: routingAddress, myPubRaw: myPubRaw,
                            nonce: nonce, flags: 0, uuid: [0x00], inner: inner) else {
      return "GOLDEN: seal returned nil"
    }
    let aadOK = hex(r.aad) == expectedAad
    let ctOK = hex(r.sealed.ciphertext) == expectedCt
    let tagOK = hex(r.sealed.tag) == expectedTag
    let frameOK = hex(r.frame) == expectedFrame
    if aadOK && ctOK && tagOK && frameOK { return "GOLDEN: ✅ MATCH (frame \(r.frame.count)B)" }
    return "GOLDEN: ❌ MISMATCH aad=\(aadOK) ct=\(ctOK) tag=\(tagOK) frame=\(frameOK)\n"
      + "  aad   got=\(hex(r.aad))\n  ct    got=\(hex(r.sealed.ciphertext))\n"
      + "  tag   got=\(hex(r.sealed.tag))\n  frame got=\(hex(r.frame))"
  }
}
