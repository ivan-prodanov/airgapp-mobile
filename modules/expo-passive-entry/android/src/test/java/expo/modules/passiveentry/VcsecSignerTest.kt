package expo.modules.passiveentry

import java.math.BigInteger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The three goldens are the same fixed inputs as ios/VcsecSigner.swift and the TS oracle
 * (scripts/gen-routable-golden.ts / gen-ecdh-golden.ts). src/ble/nativeGoldens.test.ts pins the hex
 * constants in the Kotlin source to the ios golden JSON fixtures, so a drift on either side fails a test.
 */
class VcsecSignerTest {
  @Test fun routableSealGoldenMatches() {
    assertEquals("GOLDEN: ✅ MATCH (frame 169B)", VcsecSigner.goldenSelfTest())
  }

  @Test fun ecdhGoldenMatches() {
    assertEquals("ECDH: ✅ MATCH", VcsecSigner.ecdhGoldenSelfTest())
  }

  @Test fun handshakeGoldenMatches() {
    assertEquals("HANDSHAKE: ✅ MATCH", VcsecSigner.handshakeGoldenSelfTest())
  }

  // Expected values computed with the TS oracle (@noble/curves p256.getPublicKey(priv, false),
  // keystore.ts deviceKeyFingerprint) for the golden scalar 0x11..11.
  @Test fun devicePublicKeyMatchesNoble() {
    val pub = VcsecSigner.devicePublicKey("11".repeat(32))!!
    assertEquals(
      "040217e617f0b6443928278f96999e69a23a4f2c152bdf6d6cdf66e5b80282d4ed194a7debcb97712d2dda3ca85aa8765a56f45fc758599652f2897c65306e5794",
      VcsecSigner.hex(pub),
    )
    assertEquals("2b:ad:0f:d6:10:d9:9e:ae", VcsecSigner.fingerprint(pub))
  }

  @Test fun scalarMultiplicationEdges() {
    val g = P256Curve.multiplyG(BigInteger.ONE)!!
    assertEquals("6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296", g.first.toString(16))
    assertNull(P256Curve.multiplyG(BigInteger.ZERO))
    assertNull(P256Curve.multiplyG(BigInteger("FFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551", 16)))
    assertNull(VcsecSigner.devicePublicKey("00".repeat(32)))
  }

  @Test fun ecdhRejectsMalformedPeer() {
    assertNull(VcsecSigner.ecdhSessionKey(VcsecSigner.unhex("11".repeat(32)), VcsecSigner.unhex("04" + "00".repeat(64))))
    assertNull(VcsecSigner.ecdhSessionKey(VcsecSigner.unhex("11".repeat(32)), byteArrayOf(0x04, 0x01)))
  }

  @Test fun sealFrameIsDeterministicForFixedNonce() {
    val r = VcsecSigner.sealFrame(
      sessionKey = VcsecSigner.unhex("42".repeat(16)), vin = "5YJ3E1EA1AAA00001",
      epoch = VcsecSigner.unhex("07".repeat(16)), counter = 42, expiresAt = 1000000,
      routingAddress = VcsecSigner.unhex("ab".repeat(16)),
      myPubRaw = VcsecSigner.unhex("04" + "11".repeat(64)),
      nonce = VcsecSigner.unhex("112233445566778899aabbcc"), flags = 0, uuid = byteArrayOf(0x00),
      inner = VcsecSigner.unhex("1a06080210001800"),
    )!!
    assertEquals(169, r.frame.size)
    assertTrue(VcsecSigner.hex(r.frame).startsWith("320208023a121210abab"))
  }
}
