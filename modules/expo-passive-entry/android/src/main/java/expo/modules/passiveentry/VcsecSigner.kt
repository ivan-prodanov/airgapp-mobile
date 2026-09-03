package expo.modules.passiveentry

import java.io.ByteArrayOutputStream
import java.math.BigInteger
import java.security.AlgorithmParameters
import java.security.KeyFactory
import java.security.MessageDigest
import java.security.spec.ECGenParameterSpec
import java.security.spec.ECParameterSpec
import java.security.spec.ECPoint
import java.security.spec.ECPrivateKeySpec
import java.security.spec.ECPublicKeySpec
import javax.crypto.Cipher
import javax.crypto.KeyAgreement
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * The native routable VCSEC seal + SessionInfo handshake crypto — a byte-for-byte port of
 * ios/VcsecSigner.swift, which is itself proven against the TS oracle (scripts/gen-routable-golden.ts,
 * gen-ecdh-golden.ts). Pure JCA, no Android imports: the goldens run on the JVM under
 * `./gradlew :expo-passive-entry:testReleaseUnitTest`, and src/ble/nativeGoldens.test.ts pins every hex
 * constant below to ios/routableSeal.golden.json and ios/ecdh.golden.json.
 */
object VcsecSigner {
  fun hex(b: ByteArray): String = b.joinToString("") { "%02x".format(it) }

  fun unhex(s: String): ByteArray = ByteArray(s.length / 2) { s.substring(2 * it, 2 * it + 2).toInt(16).toByte() }

  // ── AAD (crypto.ts buildAesGcmMetadata) ────────────────────────────────────
  // TLV entries [tag, len, value…] then TAG_END 0xff, hashed with SHA-256. expiresAt/counter are
  // BIG-endian here; the frame carries expiresAt as a little-endian fixed32 — different, deliberately.
  fun aad(domain: Int, vin: String, epoch: ByteArray, expiresAt: Long, counter: Long, flags: Long): ByteArray {
    val m = ByteArrayOutputStream()
    fun entry(tag: Int, v: ByteArray) { m.write(tag); m.write(v.size); m.write(v) }
    entry(0, byteArrayOf(5))                       // SIGNATURE_TYPE = AES_GCM_PERSONALIZED(5)
    entry(1, byteArrayOf(domain.toByte()))         // DOMAIN
    entry(2, vin.toByteArray(Charsets.UTF_8))      // PERSONALIZATION
    entry(3, epoch)                                // EPOCH
    entry(4, Proto.be32(expiresAt))                // EXPIRES_AT
    entry(5, Proto.be32(counter))                  // COUNTER
    if (flags > 0) entry(7, Proto.be32(flags))
    m.write(0xff)                                  // TAG_END
    return sha256(m.toByteArray())
  }

  // ── seal ───────────────────────────────────────────────────────────────────
  class Sealed(val ciphertext: ByteArray, val tag: ByteArray)

  fun aesGcmSeal(key: ByteArray, nonce: ByteArray, plaintext: ByteArray, aad: ByteArray): Sealed? = runCatching {
    val c = Cipher.getInstance("AES/GCM/NoPadding")
    c.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, nonce))
    c.updateAAD(aad)
    val out = c.doFinal(plaintext)
    Sealed(out.copyOfRange(0, out.size - 16), out.copyOfRange(out.size - 16, out.size))
  }.getOrNull()

  class SealedFrame(val aad: ByteArray, val sealed: Sealed, val frame: ByteArray)

  /** RoutableMessage{ toDestination(6), fromDestination(7), protobufMessageAsBytes(10), signatureData(13), uuid(51) }. */
  fun sealFrame(
    sessionKey: ByteArray, vin: String, epoch: ByteArray, counter: Long, expiresAt: Long,
    routingAddress: ByteArray, myPubRaw: ByteArray, nonce: ByteArray, flags: Long, uuid: ByteArray, inner: ByteArray,
  ): SealedFrame? {
    val a = aad(2, vin, epoch, expiresAt, counter, flags)
    val sealed = aesGcmSeal(sessionKey, nonce, inner, a) ?: return null
    val toDest = Proto.varintField(1, 2)                 // Destination.domain = VEHICLE_SECURITY(2)
    val fromDest = Proto.lenField(2, routingAddress)     // Destination.routingAddress
    val gcm = Proto.lenField(1, epoch) +                 // AES_GCM_PersonalizedData
      Proto.lenField(2, nonce) +
      Proto.varintField(3, counter) +
      Proto.fixed32Field(4, expiresAt) +
      Proto.lenField(5, sealed.tag)
    val signer = Proto.lenField(1, myPubRaw)             // SignerIdentity.publicKey
    val sigData = Proto.lenField(1, signer) + Proto.lenField(5, gcm)
    val frame = Proto.lenField(6, toDest) +
      Proto.lenField(7, fromDest) +
      Proto.lenField(10, sealed.ciphertext) +
      Proto.lenField(13, sigData) +
      Proto.lenField(51, uuid)
    return SealedFrame(a, sealed, frame)
  }

  // ── SessionInfoRequest handshake ───────────────────────────────────────────
  /** Outgoing SessionInfoRequest; uuid(51) doubles as the HMAC challenge. */
  fun sessionInfoRequestFrame(myPubRaw: ByteArray, routingAddress: ByteArray, challenge: ByteArray): ByteArray =
    Proto.lenField(6, Proto.varintField(1, 2)) +
      Proto.lenField(7, Proto.lenField(2, routingAddress)) +
      Proto.lenField(14, Proto.lenField(1, myPubRaw)) +
      Proto.lenField(51, challenge)

  class ParsedSessionInfo(val counter: Long, val publicKey: ByteArray, val epoch: ByteArray, val clockTime: Long)

  /** Signatures.SessionInfo: counter(1 varint), publicKey(2), epoch(3), clockTime(4 fixed32 LE). */
  fun parseSessionInfo(b: ByteArray): ParsedSessionInfo? {
    var counter = 0L
    var clock = 0L
    var pub = ByteArray(0)
    var epoch = ByteArray(0)
    var i = 0
    while (i < b.size) {
      val (tag, ni) = Proto.readVarint(b, i)
      i = ni
      val f = (tag shr 3).toInt()
      when ((tag and 7).toInt()) {
        0 -> { val (v, nj) = Proto.readVarint(b, i); i = nj; if (f == 1) counter = v and 0xffffffffL }
        2 -> {
          val (ln, nj) = Proto.readVarint(b, i)
          i = nj
          val end = i + ln.toInt()
          if (end > b.size) return null
          val v = b.copyOfRange(i, end)
          i = end
          if (f == 2) pub = v else if (f == 3) epoch = v
        }
        5 -> {
          if (i + 4 > b.size) return null
          if (f == 4) {
            clock = (b[i].toLong() and 0xff) or
              ((b[i + 1].toLong() and 0xff) shl 8) or
              ((b[i + 2].toLong() and 0xff) shl 16) or
              ((b[i + 3].toLong() and 0xff) shl 24)
          }
          i += 4
        }
        1 -> i += 8
        else -> return null
      }
    }
    return ParsedSessionInfo(counter, pub, epoch, clock)
  }

  /** subkey = HMAC(sessionKey, "session info"); tag = HMAC(subkey, TLV[SIG_TYPE=HMAC(6), PERSONALIZATION, CHALLENGE] ‖ 0xff ‖ sessionInfoBytes). */
  fun sessionInfoHmac(sessionKey: ByteArray, vin: String, challenge: ByteArray, sessionInfoBytes: ByteArray): ByteArray {
    val subkey = hmac(sessionKey, "session info".toByteArray(Charsets.UTF_8))
    val meta = ByteArrayOutputStream()
    fun entry(tag: Int, v: ByteArray) { meta.write(tag); meta.write(v.size); meta.write(v) }
    entry(0, byteArrayOf(6))
    entry(2, vin.toByteArray(Charsets.UTF_8))
    entry(6, challenge)
    meta.write(0xff)
    meta.write(sessionInfoBytes)
    return hmac(subkey, meta.toByteArray())
  }

  // ── ECDH + device key ──────────────────────────────────────────────────────
  private val p256: ECParameterSpec by lazy {
    AlgorithmParameters.getInstance("EC").apply { init(ECGenParameterSpec("secp256r1")) }
      .getParameterSpec(ECParameterSpec::class.java)
  }

  /** sessionKey = SHA1(ECDH_X(myPriv, peerPub))[:16] — the raw 32-byte X coordinate, matching noble's point[1:33]. */
  fun ecdhSessionKey(myPriv: ByteArray, peerPub: ByteArray): ByteArray? = runCatching {
    require(peerPub.size == 65 && peerPub[0] == 0x04.toByte()) { "peer public key must be a 65-byte uncompressed point" }
    val kf = KeyFactory.getInstance("EC")
    val priv = kf.generatePrivate(ECPrivateKeySpec(BigInteger(1, myPriv), p256))
    val point = ECPoint(BigInteger(1, peerPub.copyOfRange(1, 33)), BigInteger(1, peerPub.copyOfRange(33, 65)))
    val pub = kf.generatePublic(ECPublicKeySpec(point, p256))
    val ka = KeyAgreement.getInstance("ECDH")
    ka.init(priv)
    ka.doPhase(pub, true)
    val x = leftPad(ka.generateSecret(), 32)
    MessageDigest.getInstance("SHA-1").digest(x).copyOf(16)
  }.getOrNull()

  /** 65-byte SEC1 uncompressed public key (0x04‖X‖Y) for a private scalar — matches noble p256.getPublicKey(priv, false). */
  fun devicePublicKey(privHex: String): ByteArray? = runCatching {
    val (x, y) = P256Curve.multiplyG(BigInteger(1, unhex(privHex))) ?: return null
    byteArrayOf(0x04) + leftPad(x.toByteArray(), 32) + leftPad(y.toByteArray(), 32)
  }.getOrNull()

  /** SHA256(publicKeyRaw)[:8] colon-hex — equals keystore.ts deviceKeyFingerprint. */
  fun fingerprint(pub: ByteArray): String = sha256(pub).copyOf(8).joinToString(":") { "%02x".format(it) }

  // ── goldens (FIXED inputs identical to the Swift + TS generators) ──────────
  fun goldenSelfTest(): String {
    val sessionKey = unhex("42".repeat(16))
    val vin = "5YJ3E1EA1AAA00001"
    val epoch = unhex("07".repeat(16))
    val routingAddress = unhex("ab".repeat(16))
    val myPubRaw = unhex("04" + "11".repeat(64))
    val nonce = unhex("112233445566778899aabbcc")
    val inner = unhex("1a06080210001800")
    val expectedAad = "4f90a2e7a506e6d177eca87f5b258527f9a84f08019fea2191c17265cee3cb96"
    val expectedCt = "4a336cd58a6e9cf9"
    val expectedTag = "45bcc0f9a9f07eed0f14d3dbe123b1e1"
    val expectedFrame = "320208023a121210abababababababababababababababab52084a336cd58a6e9cf96a80010a430a4104111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111112a390a1007070707070707070707070707070707120c112233445566778899aabbcc182a2540420f002a1045bcc0f9a9f07eed0f14d3dbe123b1e19a030100"
    val r = sealFrame(sessionKey, vin, epoch, 42, 1000000, routingAddress, myPubRaw, nonce, 0, byteArrayOf(0x00), inner)
      ?: return "GOLDEN: seal returned nil"
    val aadOK = hex(r.aad) == expectedAad
    val ctOK = hex(r.sealed.ciphertext) == expectedCt
    val tagOK = hex(r.sealed.tag) == expectedTag
    val frameOK = hex(r.frame) == expectedFrame
    if (aadOK && ctOK && tagOK && frameOK) return "GOLDEN: ✅ MATCH (frame ${r.frame.size}B)"
    return "GOLDEN: ❌ MISMATCH aad=$aadOK ct=$ctOK tag=$tagOK frame=$frameOK\n" +
      "  aad   got=${hex(r.aad)}\n  ct    got=${hex(r.sealed.ciphertext)}\n" +
      "  tag   got=${hex(r.sealed.tag)}\n  frame got=${hex(r.frame)}"
  }

  fun ecdhGoldenSelfTest(): String {
    val myPriv = unhex("11".repeat(32))
    val peerPub = unhex("04d65a93977caa3d1b081852ff57a79e465f1660577304baead505dd3a48589cf350185e895372df6221ea3a137557e473fddb6755f05bd507c3c533fce9c91285")
    val expected = "b628048f414afe9a606f6c97195bb2e4"
    val sk = ecdhSessionKey(myPriv, peerPub) ?: return "ECDH: derive nil"
    return if (hex(sk) == expected) "ECDH: ✅ MATCH" else "ECDH: ❌ MISMATCH got=${hex(sk)} want=$expected"
  }

  fun handshakeGoldenSelfTest(): String {
    val myPub = unhex("04" + "11".repeat(64))
    val routing = unhex("ab".repeat(16))
    val challenge = unhex("cc".repeat(16))
    val reqExpected = "320208023a121210abababababababababababababababab72430a4104111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111119a0310cccccccccccccccccccccccccccccccc"
    val siBytes = unhex("088202124104222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222221a1007070707070707070707070707070707253f420f00")
    val hmacExpected = "d94c42e7791044578ce847d7b6013a8690857106eaed7da7bb4c1e7c27aa6ff8"
    val sessionKey = unhex("42".repeat(16))
    val vin = "5YJ3E1EA1AAA00001"
    val reqOK = hex(sessionInfoRequestFrame(myPub, routing, challenge)) == reqExpected
    val hmacOK = hex(sessionInfoHmac(sessionKey, vin, challenge, siBytes)) == hmacExpected
    val si = parseSessionInfo(siBytes)
    val parseOK = si != null && si.counter == 258L && si.clockTime == 999999L && si.epoch.size == 16 && si.publicKey.size == 65
    return if (reqOK && hmacOK && parseOK) "HANDSHAKE: ✅ MATCH" else "HANDSHAKE: ❌ req=$reqOK hmac=$hmacOK parse=$parseOK"
  }

  // ── helpers ────────────────────────────────────────────────────────────────
  private fun sha256(b: ByteArray): ByteArray = MessageDigest.getInstance("SHA-256").digest(b)

  private fun hmac(key: ByteArray, data: ByteArray): ByteArray =
    Mac.getInstance("HmacSHA256").apply { init(SecretKeySpec(key, "HmacSHA256")) }.doFinal(data)

  /** Fixed-width big-endian: strips a BigInteger sign byte, pads a short value with leading zeros. */
  internal fun leftPad(b: ByteArray, size: Int): ByteArray = when {
    b.size == size -> b
    b.size > size -> b.copyOfRange(b.size - size, b.size)
    else -> ByteArray(size - b.size) + b
  }
}

/**
 * secp256r1 scalar multiplication of the base point in affine coordinates. JCA can derive a shared
 * secret from a private scalar but offers no way to recover the PUBLIC point from one; this is the
 * 50 lines that gap costs. Speed is irrelevant (one call per key check / handshake) and the result is
 * pinned to noble's output by VcsecSignerTest.
 */
internal object P256Curve {
  private val p = BigInteger("FFFFFFFF00000001000000000000000000000000FFFFFFFFFFFFFFFFFFFFFFFF", 16)
  private val a = p.subtract(BigInteger.valueOf(3))
  private val n = BigInteger("FFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551", 16)
  private val gx = BigInteger("6B17D1F2E12C4247F8BCE6E563A440F277037D812DEB33A0F4A13945D898C296", 16)
  private val gy = BigInteger("4FE342E2FE1A7F9B8EE7EB4A7C0F9E162BCE33576B315ECECBB6406837BF51F5", 16)
  private val two = BigInteger.valueOf(2)
  private val three = BigInteger.valueOf(3)

  /** k·G, or null when k is not in [1, n-1]. */
  fun multiplyG(k: BigInteger): Pair<BigInteger, BigInteger>? {
    if (k.signum() <= 0 || k >= n) return null
    var result: Pair<BigInteger, BigInteger>? = null
    var addend: Pair<BigInteger, BigInteger>? = gx to gy
    for (i in 0 until k.bitLength()) {
      if (k.testBit(i)) result = add(result, addend)
      addend = add(addend, addend)
    }
    return result
  }

  private fun add(P: Pair<BigInteger, BigInteger>?, Q: Pair<BigInteger, BigInteger>?): Pair<BigInteger, BigInteger>? {
    if (P == null) return Q
    if (Q == null) return P
    val (x1, y1) = P
    val (x2, y2) = Q
    val lambda = if (x1 == x2) {
      if (y1.add(y2).mod(p).signum() == 0) return null // P = -Q → infinity
      x1.multiply(x1).multiply(three).add(a).multiply(y1.multiply(two).modInverse(p))
    } else {
      y2.subtract(y1).multiply(x2.subtract(x1).modInverse(p))
    }.mod(p)
    val x3 = lambda.multiply(lambda).subtract(x1).subtract(x2).mod(p)
    val y3 = lambda.multiply(x1.subtract(x3)).subtract(y1).mod(p)
    return x3 to y3
  }
}
