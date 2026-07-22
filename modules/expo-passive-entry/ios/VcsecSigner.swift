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

  // MARK: - protobuf reading (for parsing the car's reply)

  static func readVarint(_ b: [UInt8], _ start: Int) -> (Int, Int) {
    var v = 0, s = 0, i = start
    while i < b.count { let x = b[i]; i += 1; v |= Int(x & 0x7f) << s; if x & 0x80 == 0 { break }; s += 7 }
    return (v, i)
  }
  // First occurrence of a length-delimited field's bytes (nil if absent).
  static func extractLenField(_ b: [UInt8], _ field: Int) -> [UInt8]? {
    var i = 0
    while i < b.count {
      let (tag, ni) = readVarint(b, i); i = ni
      let f = tag >> 3, wt = tag & 7
      switch wt {
      case 0: let (_, nj) = readVarint(b, i); i = nj
      case 5: i += 4
      case 1: i += 8
      case 2:
        let (ln, nj) = readVarint(b, i); i = nj
        if i + ln > b.count { return nil }
        let val = Array(b[i..<i + ln]); i += ln
        if f == field { return val }
      default: return nil
      }
    }
    return nil
  }

  // MARK: - SessionInfoRequest handshake

  // The outgoing SessionInfoRequest frame (RoutableMessage). uuid doubles as the
  // HMAC challenge. Fields: toDestination(6), fromDestination(7),
  // sessionInfoRequest(14){publicKey(1)}, uuid(51).
  static func sessionInfoRequestFrame(myPubRaw: [UInt8], routingAddress: [UInt8], challenge: [UInt8]) -> [UInt8] {
    var f = [UInt8]()
    f += lenField(6, varintField(1, 2))          // toDestination.domain = 2
    f += lenField(7, lenField(2, routingAddress)) // fromDestination.routingAddress
    f += lenField(14, lenField(1, myPubRaw))      // sessionInfoRequest.publicKey
    f += lenField(51, challenge)                  // uuid = challenge
    return f
  }

  struct ParsedSessionInfo { let counter: UInt32; let publicKey: [UInt8]; let epoch: [UInt8]; let clockTime: UInt32 }

  // Signatures.SessionInfo: counter(1 varint), publicKey(2), epoch(3), clockTime(4 fixed32 LE).
  static func parseSessionInfo(_ b: [UInt8]) -> ParsedSessionInfo? {
    var counter: UInt32 = 0, clock: UInt32 = 0, pub = [UInt8](), epoch = [UInt8]()
    var i = 0
    while i < b.count {
      let (tag, ni) = readVarint(b, i); i = ni
      let f = tag >> 3, wt = tag & 7
      switch wt {
      case 0: let (v, nj) = readVarint(b, i); i = nj; if f == 1 { counter = UInt32(truncatingIfNeeded: v) }
      case 2:
        let (ln, nj) = readVarint(b, i); i = nj
        if i + ln > b.count { return nil }
        let val = Array(b[i..<i + ln]); i += ln
        if f == 2 { pub = val } else if f == 3 { epoch = val }
      case 5:
        if i + 4 > b.count { return nil }
        if f == 4 { clock = UInt32(b[i]) | UInt32(b[i+1]) << 8 | UInt32(b[i+2]) << 16 | UInt32(b[i+3]) << 24 }
        i += 4
      case 1: i += 8
      default: return nil
      }
    }
    return ParsedSessionInfo(counter: counter, publicKey: pub, epoch: epoch, clockTime: clock)
  }

  // The car authenticates SessionInfo with HMAC: subkey = HMAC(sessionKey,
  // "session info"); tag = HMAC(subkey, metaTLV[SIG_TYPE=HMAC(6),
  // PERSONALIZATION=vin, CHALLENGE=challenge] ‖ 0xff ‖ sessionInfoBytes).
  static func sessionInfoHmac(sessionKey: [UInt8], vin: String, challenge: [UInt8], sessionInfoBytes: [UInt8]) -> [UInt8] {
    let subkey = HMAC<SHA256>.authenticationCode(for: Data("session info".utf8), using: SymmetricKey(data: Data(sessionKey)))
    var meta = [UInt8]()
    func entry(_ tag: UInt8, _ v: [UInt8]) { meta.append(tag); meta.append(UInt8(v.count)); meta += v }
    entry(0, [6])              // SIGNATURE_TYPE = HMAC
    entry(2, Array(vin.utf8))  // PERSONALIZATION
    entry(6, challenge)        // CHALLENGE
    meta.append(0xff)
    meta += sessionInfoBytes
    return Array(HMAC<SHA256>.authenticationCode(for: Data(meta), using: SymmetricKey(data: Data(subkey))))
  }

  static func handshakeGoldenSelfTest() -> String {
    let myPub = unhex("04" + String(repeating: "11", count: 64))
    let routing = unhex(String(repeating: "ab", count: 16))
    let challenge = unhex(String(repeating: "cc", count: 16))
    let reqExpected = "320208023a121210abababababababababababababababab72430a4104111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111119a0310cccccccccccccccccccccccccccccccc"
    let siBytes = unhex("088202124104222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222221a1007070707070707070707070707070707253f420f00")
    let hmacExpected = "d94c42e7791044578ce847d7b6013a8690857106eaed7da7bb4c1e7c27aa6ff8"
    let sessionKey = unhex(String(repeating: "42", count: 16))
    let vin = "5YJ3E1EA1AAA00001"

    let reqOK = hex(sessionInfoRequestFrame(myPubRaw: myPub, routingAddress: routing, challenge: challenge)) == reqExpected
    let hmacOK = hex(sessionInfoHmac(sessionKey: sessionKey, vin: vin, challenge: challenge, sessionInfoBytes: siBytes)) == hmacExpected
    let si = parseSessionInfo(siBytes)
    let parseOK = si?.counter == 258 && si?.clockTime == 999999 && si?.epoch.count == 16 && si?.publicKey.count == 65
    return (reqOK && hmacOK && parseOK) ? "HANDSHAKE: ✅ MATCH" : "HANDSHAKE: ❌ req=\(reqOK) hmac=\(hmacOK) parse=\(parseOK)"
  }

  // MARK: - ECDH + device key (session key derivation)

  // sessionKey = SHA1( ECDH_X(myPriv, peerPub) )[:16]. ECDH_X is the raw 32-byte
  // X-coordinate — CryptoKit's P256 SharedSecret IS that X (not HKDF'd), matching
  // noble's point[1:33] in crypto.ts deriveSessionKey.
  static func ecdhSessionKey(myPriv: [UInt8], peerPub: [UInt8]) -> [UInt8]? {
    guard
      let priv = try? P256.KeyAgreement.PrivateKey(rawRepresentation: Data(myPriv)),
      let pub = try? P256.KeyAgreement.PublicKey(x963Representation: Data(peerPub)),
      let shared = try? priv.sharedSecretFromKeyAgreement(with: pub)
    else { return nil }
    let x = shared.withUnsafeBytes { Data($0) } // 32-byte X-coordinate
    return Array(Insecure.SHA1.hash(data: x).prefix(16))
  }

  // The 65-byte SEC1 uncompressed public key (0x04||X||Y) for a private scalar —
  // matches noble p256.getPublicKey(priv, false).
  static func devicePublicKey(privHex: String) -> [UInt8]? {
    guard let priv = try? P256.KeyAgreement.PrivateKey(rawRepresentation: Data(unhex(privHex))) else { return nil }
    return Array(priv.publicKey.x963Representation)
  }

  // deviceKeyFingerprint: SHA256(publicKeyRaw)[:8], colon-hex — matches
  // keystore.ts deviceKeyFingerprint, so native can prove it holds the same key.
  static func fingerprint(pub: [UInt8]) -> String {
    Array(SHA256.hash(data: Data(pub)).prefix(8)).map { String(format: "%02x", $0) }.joined(separator: ":")
  }

  static func ecdhGoldenSelfTest() -> String {
    let myPriv = unhex(String(repeating: "11", count: 32))
    let peerPub = unhex("04d65a93977caa3d1b081852ff57a79e465f1660577304baead505dd3a48589cf350185e895372df6221ea3a137557e473fddb6755f05bd507c3c533fce9c91285")
    let expected = "b628048f414afe9a606f6c97195bb2e4"
    guard let sk = ecdhSessionKey(myPriv: myPriv, peerPub: peerPub) else { return "ECDH: derive nil" }
    return hex(sk) == expected ? "ECDH: ✅ MATCH" : "ECDH: ❌ MISMATCH got=\(hex(sk)) want=\(expected)"
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
