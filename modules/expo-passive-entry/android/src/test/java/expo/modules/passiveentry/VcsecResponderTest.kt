package expo.modules.passiveentry

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Drives the responder exactly as the car would, over a fake link. The car's public key is the ECDH
 * golden's peer key, so the session key the responder derives is the golden b628…, which lets the
 * test forge SessionInfo replies with a valid HMAC.
 */
class VcsecResponderTest {
  private val vin = "5YJ3E1EA1AAA00001"
  private val privHex = "11".repeat(32)
  private val carPub = VcsecSigner.unhex(
    "04d65a93977caa3d1b081852ff57a79e465f1660577304baead505dd3a48589cf350185e895372df6221ea3a137557e473fddb6755f05bd507c3c533fce9c91285",
  )
  private val sessionKey = VcsecSigner.unhex("b628048f414afe9a606f6c97195bb2e4")
  private val epoch = ByteArray(16) { 7 }

  private val writes = ArrayList<ByteArray>()
  private val logs = ArrayList<String>()
  private var cpd: Int? = null
  private val store = object : WarmSessionStore {
    val m = HashMap<String, WarmSessionStore.WarmSession>()
    override fun warmSession(vin: String) = m[vin]
    override fun saveWarmSession(vin: String, s: WarmSessionStore.WarmSession) { m[vin] = s }
  }

  private fun responder(now: Long = 1_700_000_000L) = VcsecResponder(
    vin, store, { privHex }, { writes.add(it) }, { logs.add(it) }, { cpd = it },
    nowSec = { now }, random = { n -> ByteArray(n) { 0x5a } },
  )

  /** What the car sends: a 2-byte big-endian length prefix, then the frame. */
  private fun framed(bytes: ByteArray) = byteArrayOf((bytes.size shr 8).toByte(), (bytes.size and 0xff).toByte()) + bytes

  /** RoutableMessage{ sessionInfo(15), signatureData(13){ sessionInfoTag(6){ tag(1) } } }. */
  private fun sessionInfoReply(challenge: ByteArray, counter: Long, clock: Long, bound: Boolean): ByteArray {
    val si = Proto.varintField(1, counter) + Proto.lenField(2, carPub) + Proto.lenField(3, epoch) + Proto.fixed32Field(4, clock)
    val tag = VcsecSigner.sessionInfoHmac(sessionKey, vin, if (bound) challenge else ByteArray(16), si)
    return Proto.lenField(15, si) + Proto.lenField(13, Proto.lenField(6, Proto.lenField(1, tag)))
  }

  /** RoutableMessage{ protobufMessageAsBytes(10) = FromVCSECMessage{ authenticationRequest(3){ requestedLevel(3) } } }. */
  private fun challengeFrame(level: Long) = Proto.lenField(10, Proto.lenField(3, Proto.varintField(3, level)))

  private fun challengeOf(request: ByteArray) = Proto.extractLenField(request, 51)!!

  /** The counter inside a sealed frame: signatureData(13) → AES_GCM_PersonalizedData(5) → counter(3). */
  private fun counterOf(frame: ByteArray) =
    Proto.extractVarintField(Proto.extractLenField(Proto.extractLenField(frame, 13)!!, 5)!!, 3)

  @Test fun handshakeThenStandingDriveAndAppDeviceInfo() {
    val r = responder()
    r.onLinkReady()
    assertEquals(1, writes.size)
    val req = writes[0]
    assertNotNull(Proto.extractLenField(req, 14)) // sessionInfoRequest
    assertEquals(16, challengeOf(req).size)
    assertFalse(r.hasSession)

    r.onNotification(framed(sessionInfoReply(challengeOf(req), 100, 5000, bound = true)))
    assertTrue(r.hasSession)
    assertTrue(logs.joinToString("\n"), logs.any { it.startsWith("HANDSHAKE ✓") })
    assertEquals(3, writes.size) // request, standing DRIVE, AppDeviceInfo
    assertEquals(101L, counterOf(writes[1]))
    assertEquals(102L, counterOf(writes[2]))
    assertEquals(102L, store.warmSession(vin)!!.counter)
    assertTrue(logs.any { it.startsWith("standing DRIVE asserted sent counter=101") })
    assertTrue(logs.any { it.startsWith("AppDeviceInfo (UWB unsupported) sent counter=102") })
  }

  @Test fun challengeIsAnsweredWithTheRequestedLevel() {
    val r = responder()
    r.onLinkReady()
    r.onNotification(framed(sessionInfoReply(challengeOf(writes[0]), 100, 5000, bound = true)))
    r.onNotification(framed(challengeFrame(1)))
    assertEquals(4, writes.size)
    assertEquals(103L, counterOf(writes[3]))
    assertTrue(logs.any { it.startsWith("auth ANSWERED #1 level=1 sent counter=103") })
  }

  @Test fun challengeBeforeAnySessionIsIgnored() {
    val r = responder()
    r.onLinkReady()
    r.onNotification(framed(challengeFrame(2)))
    assertEquals(1, writes.size)
  }

  @Test fun unboundSessionInfoIsRejectedWithoutASessionAndResyncsWithOne() {
    val r = responder()
    r.onLinkReady()
    val challenge = challengeOf(writes[0])
    r.onNotification(framed(sessionInfoReply(challenge, 100, 5000, bound = false)))
    assertFalse(r.hasSession)
    assertTrue(logs.any { it.startsWith("SessionInfo REJECTED (hmac mismatch, no live session)") })

    r.onNotification(framed(sessionInfoReply(challenge, 100, 5000, bound = true)))
    assertTrue(r.hasSession)
    r.onNotification(framed(sessionInfoReply(challenge, 500, 6000, bound = false)))
    assertTrue(logs.any { it.startsWith("SessionInfo RESYNC (fault path): counter 102 → 500") })
    r.onNotification(framed(challengeFrame(2)))
    assertEquals(501L, counterOf(writes.last()))
  }

  @Test fun warmSessionAnswersBeforeTheHandshakeCompletes() {
    store.saveWarmSession(vin, WarmSessionStore.WarmSession(VcsecSigner.hex(epoch), 300, 5000, 1_699_999_000, VcsecSigner.hex(carPub)))
    val r = responder()
    r.onLinkReady()
    assertTrue(r.hasSession)
    assertTrue(logs.any { it.startsWith("warm session restored") })
    r.onNotification(framed(challengeFrame(2)))
    assertEquals(2, writes.size) // request + answer, no reply from the car yet
    assertEquals(301L, counterOf(writes[1]))

    // The real handshake lands with a LOWER counter on the same epoch: keep the higher local one.
    r.onNotification(framed(sessionInfoReply(challengeOf(writes[0]), 100, 5000, bound = true)))
    assertTrue(logs.any { it.startsWith("warm merge: keeping local counter 301 > car 100") })
    assertEquals(302L, counterOf(writes[2]))
  }

  @Test fun cpdWarningIsSurfaced() {
    val r = responder()
    r.onLinkReady()
    r.onNotification(framed(Proto.lenField(10, Proto.lenField(55, Proto.varintField(1, 2)))))
    assertEquals(2, cpd)
  }

  @Test fun splitNotificationsReassemble() {
    val r = responder()
    r.onLinkReady()
    val reply = framed(sessionInfoReply(challengeOf(writes[0]), 100, 5000, bound = true))
    r.onNotification(reply.copyOfRange(0, 20))
    r.onNotification(reply.copyOfRange(20, reply.size))
    assertTrue(r.hasSession)
  }

  @Test fun answersAreCappedAtTwentyPerLink() {
    val r = responder()
    r.onLinkReady()
    r.onNotification(framed(sessionInfoReply(challengeOf(writes[0]), 100, 5000, bound = true)))
    repeat(25) { r.onNotification(framed(challengeFrame(2))) }
    assertEquals(3 + 20, writes.size)
  }
}
