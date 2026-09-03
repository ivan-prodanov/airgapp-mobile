package expo.modules.passiveentry

import java.security.SecureRandom

/**
 * The AUTONOMOUS passive-entry responder — the protocol half of ios/PassiveEntryCentral.swift
 * (handleReply … sendSealed), ported line for line and validated on-car there. Runs only while native
 * is NOT in pipe mode (no activity visible), so it is the sole signer on the shared key at that time.
 *
 * Pure JVM: all I/O goes through lambdas, and VcsecResponderTest drives it with a fake link.
 */
class VcsecResponder(
  private val vin: String,
  private val store: WarmSessionStore,
  private val deviceKeyHex: () -> String?,
  private val writeFramed: (ByteArray) -> Unit,
  private val log: (String) -> Unit,
  private val onCpdWarning: (Int) -> Unit,
  private val nowSec: () -> Long = { System.currentTimeMillis() / 1000 },
  private val random: (Int) -> ByteArray = { n -> ByteArray(n).also { SecureRandom().nextBytes(it) } },
) {
  private val reassembler = FrameReassembler()
  private var challenge = ByteArray(0)
  private var sessionKey: ByteArray? = null
  private var counter = 0L
  private var epoch = ByteArray(0)
  private var clockBase = 0L
  private var handshakeWallSec = 0L
  private var myPubRaw = ByteArray(0)
  private var carPubRaw = ByteArray(0)
  // Safety cap: stop answering after this many in one link, so a wrong seal can't flood VCSEC (the
  // 2026-07-20 wedge lesson). A correct answer unlocks and the car stops challenging well before this.
  private var answersGiven = 0
  private val routingAddress = ByteArray(16) { 0xab.toByte() }

  val hasSession: Boolean get() = sessionKey != null

  /** Link subscribed: warm session FIRST (a challenge can beat the handshake), then a fresh handshake. */
  fun onLinkReady() {
    reassembler.reset()
    restoreWarmSession()
    startHandshake()
  }

  fun onLinkLost() {
    reassembler.reset()
    sessionKey = null
  }

  /** Every raw 0213 notification while autonomous. */
  fun onNotification(bytes: ByteArray) {
    for (frame in reassembler.push(bytes)) handleReply(frame)
  }

  private fun startHandshake() {
    val keyHex = deviceKeyHex()
    val myPub = keyHex?.let { VcsecSigner.devicePublicKey(it) }
    if (keyHex == null || myPub == null) {
      log("handshake ABORT: no device key stored (run Native key check once)")
      return
    }
    challenge = random(16)
    val frame = VcsecSigner.sessionInfoRequestFrame(myPub, routingAddress, challenge)
    log("handshake: writing SessionInfoRequest (${frame.size}B)")
    writeFramed(frame)
  }

  private fun handleReply(frame: ByteArray) {
    // A SessionInfo reply (field 15) completes the handshake…
    Proto.extractLenField(frame, 15)?.let { completeHandshake(frame, it); return }
    // …everything else we care about is inside payload(10) = FromVCSECMessage.
    val payload = Proto.extractLenField(frame, 10) ?: return
    // (a) Child Presence Detection: CPDMessage(55).CPDNotification(1) enum 1=INITIAL 2=ESCALATED.
    Proto.extractLenField(payload, 55)?.let { cpd ->
      val level = Proto.extractVarintField(cpd, 1) ?: 0L
      if (level != 0L) handleCpdWarning(level.toInt())
    }
    // (b) authenticationRequest(3) is a passive-entry CHALLENGE — answer it.
    Proto.extractLenField(payload, 3)?.let { answerChallenge(it); return }
    // (c) alert(45).alertHandlePulledWithoutAuth(1): the car's own account of a failed walk-up.
    Proto.extractLenField(payload, 45)?.let { alert -> Proto.extractLenField(alert, 1)?.let(::logHandlePulledWithoutAuth) }
    logUnhandledFields(payload)
    // The car asks for our capabilities (field 44) repeatedly until answered.
    if (44 in Proto.topLevelFieldNumbers(payload)) sendAppDeviceInfo()
  }

  private fun completeHandshake(frame: ByteArray, siBytes: ByteArray) {
    val sig = Proto.extractLenField(frame, 13)
    val tagField = sig?.let { Proto.extractLenField(it, 6) }?.let { Proto.extractLenField(it, 1) }
    val si = VcsecSigner.parseSessionInfo(siBytes)
    val keyHex = deviceKeyHex()
    val sk = if (si != null && keyHex != null) VcsecSigner.ecdhSessionKey(VcsecSigner.unhex(keyHex), si.publicKey) else null
    val myPub = keyHex?.let { VcsecSigner.devicePublicKey(it) }
    if (si == null || keyHex == null || sk == null || myPub == null) {
      log("handshake parse/ECDH failed")
      return
    }
    val want = VcsecSigner.sessionInfoHmac(sk, vin, challenge, siBytes)
    val hmacOK = tagField != null && want.contentEquals(tagField)
    if (!hmacOK) {
      // NOT necessarily junk. When the car REJECTS one of our signed frames (a counter/epoch fault) it
      // pushes a SessionInfo back so we can resync — one that is NOT bound to our handshake challenge.
      // With a session already established, adopt the car's counter/epoch in place ("fault-6 → swap
      // epoch/counter IN PLACE with no teardown", RESPONSE-15; measured stranded-desync 2026-07-26).
      // We never derive a session KEY from an unauthenticated frame, and a bogus counter is
      // self-correcting. With no session established it would be load-bearing, so refuse.
      if (sessionKey == null) {
        log("SessionInfo REJECTED (hmac mismatch, no live session) counter=${si.counter}")
        return
      }
      val before = counter
      counter = si.counter
      epoch = si.epoch
      clockBase = si.clockTime
      handshakeWallSec = nowSec()
      persistSession()
      log("SessionInfo RESYNC (fault path): counter $before → ${si.counter} epoch=${VcsecSigner.hex(si.epoch).take(8)} — swapped in place, no teardown")
      return
    }
    // MERGE with any warm session: take the HIGHER counter only when the epoch is byte-identical;
    // on an epoch change adopt the car's values wholesale.
    var mergedCounter = si.counter
    if (epoch.isNotEmpty() && epoch.contentEquals(si.epoch) && counter > si.counter) {
      mergedCounter = counter
      log("warm merge: keeping local counter $counter > car ${si.counter} (same epoch)")
    }
    sessionKey = sk
    counter = mergedCounter
    epoch = si.epoch
    clockBase = si.clockTime
    handshakeWallSec = nowSec()
    myPubRaw = myPub
    carPubRaw = si.publicKey
    answersGiven = 0
    persistSession()
    val said = if (counter != si.counter) " (car said ${si.counter})" else ""
    log("HANDSHAKE ✓ epoch=${VcsecSigner.hex(si.epoch).take(8)} counter=$counter$said clock=${si.clockTime} hmacOK=true")
    // Proactive standing DRIVE on every connect, exactly like the official app (q1.java
    // connectionEstablished → G0). The car holds it as our standing level; unlock/drive need no
    // challenge round trip at handle-pull time.
    assertStandingDrive()
    // Answer the capability probe the car keeps sending (measured 6+/session).
    sendAppDeviceInfo()
  }

  private fun answerChallenge(authReq: ByteArray) {
    if (sessionKey == null) return
    if (answersGiven >= MAX_ANSWERS) return
    // requestedLevel (field 3 of AuthenticationRequest); default DRIVE(2).
    val level = Proto.extractVarintField(authReq, 3) ?: 2L
    // UnsignedMessage{ authenticationResponse{ level, distance=0, rejection=0 } }
    val inner = byteArrayOf(0x1a, 0x06, 0x08, level.toByte(), 0x10, 0x00, 0x18, 0x00)
    answersGiven += 1
    sendSealed(inner, "auth ANSWERED #$answersGiven level=$level")
  }

  /**
   * AppDeviceInfo — answer the car's capability probe (FromVCSEC 44 → UnsignedMessage.appDeviceInfo
   * 40). Wire shape from the HW4 decompile: AppDeviceInfo{ 2=os, 3=UWBAvailable }, AppOperatingSystem
   * ANDROID = 1 (vc0/k.java), UWBAvailability UNAVAILABLE_UNSUPPORTED_DEVICE = 2 (vc0/b3.java).
   */
  private fun sendAppDeviceInfo() {
    if (sessionKey == null) return
    val info = byteArrayOf(0x10, 0x01, 0x18, 0x02)
    val inner = byteArrayOf(0xc2.toByte(), 0x02, info.size.toByte()) + info // tag 40<<3|2 = 322 → c2 02
    sendSealed(inner, "AppDeviceInfo (UWB unsupported)")
  }

  /** authenticationLevel = DRIVE(2): the standing authorization asserted on every connect. */
  private fun assertStandingDrive() {
    val inner = byteArrayOf(0x1a, 0x06, 0x08, 0x02, 0x10, 0x00, 0x18, 0x00)
    sendSealed(inner, "standing DRIVE asserted")
  }

  /** Seal [inner] with the live session and write it. The ONE place the counter bumps + persists. */
  private fun sendSealed(inner: ByteArray, label: String): Boolean {
    val sk = sessionKey ?: return false
    counter = (counter + 1) and 0xffffffffL
    val elapsed = (nowSec() - handshakeWallSec) and 0xffffffffL
    val expiresAt = (clockBase + elapsed + 5) and 0xffffffffL
    val nonce = random(12)
    val r = VcsecSigner.sealFrame(sk, vin, epoch, counter, expiresAt, routingAddress, myPubRaw, nonce, 0, byteArrayOf(0x00), inner)
    if (r == null) {
      log("$label: seal failed")
      return false
    }
    // Persist the bumped counter BEFORE the write goes out so a crash mid-write can never replay it.
    persistSession()
    log("$label sent counter=$counter out=${r.frame.size}B")
    writeFramed(r.frame)
    return true
  }

  private fun handleCpdWarning(level: Int) {
    log("CPD WARNING level=$level (1=initial,2=escalated) — child detected in car")
    onCpdWarning(level)
  }

  private fun logHandlePulledWithoutAuth(hp: ByteArray) {
    val sinceMs = Proto.extractVarintField(hp, 1) ?: -1
    val handle = Proto.extractVarintField(hp, 2) ?: -1
    val connections = Proto.extractVarintField(hp, 3) ?: -1
    val unknownDevice = (Proto.extractVarintField(hp, 4) ?: 0) != 0L
    val authRequested = (Proto.extractVarintField(hp, 5) ?: 0) != 0L
    val verdict = when {
      connections == 0L -> "car saw NO connection → we were not linked at pull time (relaunch/reconnect race)"
      !authRequested -> "car was linked to $connections but did NOT challenge → localisation, not our latency"
      else -> "car challenged over $connections connection(s) → our answer was late or refused"
    }
    log("HANDLE PULLED WITHOUT AUTH: connections=$connections authRequested=$authRequested unknownDevice=$unknownDevice handle=$handle sinceAlertSet=${sinceMs}ms — $verdict")
  }

  private fun logUnhandledFields(payload: ByteArray) {
    val fields = Proto.topLevelFieldNumbers(payload).filter { it !in KNOWN_PAYLOAD_FIELDS }
    if (fields.isEmpty()) return
    val names = fields.map {
      when (it) {
        44 -> "44=AppDeviceInfoRequest"
        47 -> "47=NISessionRequest"
        48 -> "48=NISessionStop"
        53 -> "53=NIBatchRequest"
        19 -> "19=FiraCapabilitiesRequest"
        39 -> "39=UnsecureNotification"
        else -> "$it"
      }
    }
    log("car PROBE (unanswered): [${names.joinToString(", ")}]")
  }

  // ── warm session (persist / restore across disconnect + process death) ─────

  private fun persistSession() {
    if (epoch.isEmpty() || carPubRaw.isEmpty()) return
    store.saveWarmSession(vin, WarmSessionStore.WarmSession(VcsecSigner.hex(epoch), counter, clockBase, handshakeWallSec, VcsecSigner.hex(carPubRaw)))
  }

  /**
   * Rebuild a signing-capable session from disk so a challenge arriving BEFORE the fresh handshake
   * completes can still be answered. Conservative: if the car rotated its epoch the early answer is
   * rejected and the car re-challenges at ~1 Hz, by which time the fresh session has landed.
   */
  private fun restoreWarmSession() {
    if (sessionKey != null) return
    val ws = store.warmSession(vin) ?: return
    val keyHex = deviceKeyHex() ?: return
    val myPub = VcsecSigner.devicePublicKey(keyHex) ?: return
    val carPub = VcsecSigner.unhex(ws.carPubHex)
    val sk = VcsecSigner.ecdhSessionKey(VcsecSigner.unhex(keyHex), carPub) ?: return
    sessionKey = sk
    carPubRaw = carPub
    myPubRaw = myPub
    epoch = VcsecSigner.unhex(ws.epochHex)
    counter = ws.counter and 0xffffffffL
    clockBase = ws.clockBase and 0xffffffffL
    handshakeWallSec = ws.wallSec
    answersGiven = 0
    log("warm session restored epoch=${ws.epochHex.take(8)} counter=$counter — can answer before handshake")
  }

  private companion object {
    const val MAX_ANSWERS = 20
    val KNOWN_PAYLOAD_FIELDS = setOf(1, 3, 4, 55) // vehicleStatus, authRequest, commandStatus, CPDMessage
  }
}
