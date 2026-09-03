# Android Passive Entry Rewrite — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `modules/expo-passive-entry/android` with a phone-key implementation that holds the car link in a foreground service, self-signs in the background, survives reboot, and identifies the car correctly — behind the unchanged TS contract.

**Architecture:** An application-scoped `PassiveEntryRuntime` (built at `Application.onCreate` through an Expo `Package` hook) owns one `PassiveEntryCentral` — a single-`HandlerThread` GATT state machine (standing `autoConnect` to the remembered MAC, bounded filtered discovery scans, INDICATE subscription, one write in flight) — and a `PassiveEntryService` (`connectedDevice` foreground service) that keeps it alive. `VcsecResponder` + `VcsecSigner` are a byte-for-byte JCA port of the Swift responder. Receivers cover boot, a process-death-surviving `PendingIntent` scan, and alarms. The `:share` process runs the same central in an ephemeral mode. Spec: `docs/superpowers/specs/2026-09-03-android-native-parity-design.md`.

**Tech Stack:** Kotlin (2.1), Expo Modules API (expo-modules-core 56.0.14), Android SDK 36 / minSdk 26, `android.bluetooth`, `androidx.core` (NotificationCompat, ServiceCompat, IntentCompat), Android Keystore, JCA (`AES/GCM/NoPadding`, `ECDH`, `HmacSHA256`), JUnit 4 for JVM unit tests, `node --test` for the cross-platform golden pin.

## Global Constraints

- Never run `expo prebuild`. `android/` and `ios/` are hand-maintained.
- The TS contract is frozen: `modules/expo-passive-entry/index.ts` and `src/PassiveEntryModule.ts` do not change. Every function and event name in `PassiveEntryModule.kt` mirrors the Swift module exactly.
- iOS behaviour is untouched: no file under `modules/expo-passive-entry/ios/` or `src/**` changes except the new test `src/ble/nativeGoldens.test.ts`.
- One shared key; routable seal only (`AES_GCM_PERSONALIZED`, random 12-byte nonce); commands stay in TS through the byte pipe; single-writer by lifecycle (foreground → TS signs, background → native signs).
- Build/deploy: `bash scripts/android/deploy-js.sh` (~40 s, covers `.kt` changes). Every gradle call exports `ANDROID_HOME=$HOME/Library/Android/sdk` and `JAVA_HOME=/Library/Java/JavaVirtualMachines/zulu-17.jdk/Contents/Home`, and keeps `--max-workers=2`.
- JVM unit tests: `cd android && ANDROID_HOME=$HOME/Library/Android/sdk JAVA_HOME=/Library/Java/JavaVirtualMachines/zulu-17.jdk/Contents/Home ./gradlew :expo-passive-entry:testReleaseUnitTest --max-workers=2`. Tested classes must not touch Android APIs (no `android.util.Log`, no `Context`) — take lambdas/interfaces instead.
- `pnpm test` (976 passing at baseline) and `npx tsc --noEmit -p tsconfig.json` must stay green before every commit.
- Kotlin block comments NEST: never write `/*` inside a KDoc (e.g. a path like `src/ble/*`).
- Copy for notifications is fixed: "Bluetooth Disabled" / "Phone Key will not work until Bluetooth is enabled"; "Child detected in car" / "Return to your vehicle immediately."; service notification title "Phone Key".
- Golden strings returned to the harness are exactly the Swift ones: `GOLDEN: ✅ MATCH (frame 169B)`, `ECDH: ✅ MATCH`, `HANDSHAKE: ✅ MATCH`.
- Constants from the decompiled official app (do not "improve"): reconnect delay 500 ms for GATT status 0/8/34, 2000 ms otherwise; subscribe with INDICATE when the characteristic offers it; MTU request 517; background sighting RSSI gate -95 dBm; standing-connect reinit every 4 h; background `PendingIntent` scan restarted every 25 min; BT-off reminder repeats every 4 h.
- Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

Code blocks whose info string carries `path=<file>` are the complete contents of that file. A materializer may write them verbatim.

---

## File map

| File | Responsibility |
|---|---|
| `modules/expo-passive-entry/android/build.gradle` | Drop `androidx.security`; add JUnit. |
| `modules/expo-passive-entry/android/src/main/AndroidManifest.xml` | Permissions, service, receivers. |
| `modules/expo-passive-entry/android/src/main/res/drawable/ic_stat_phone_key.xml` | Status-bar icon. |
| `.../passiveentry/Proto.kt` | Protobuf wire helpers (pure). |
| `.../passiveentry/VcsecSigner.kt` | Seal/handshake crypto, ECDH, pubkey, goldens (pure). |
| `.../passiveentry/VehicleIdentity.kt` | Name/beacon derivations + advertisement classifier (pure). |
| `.../passiveentry/FrameReassembler.kt` | 2-byte BE length framing (pure). |
| `.../passiveentry/VcsecResponder.kt` | Autonomous background responder (pure; lambdas for I/O). |
| `.../passiveentry/PassiveEntryStore.kt` | SharedPreferences persistence (+ `WarmSessionStore` interface). |
| `.../passiveentry/KeystoreKey.kt` | Keystore-wrapped device key. |
| `.../passiveentry/NativeLog.kt` | logcat + JS event + `files/airgapp-native.log`. |
| `.../passiveentry/Notifier.kt` | Channels and the three notifications. |
| `.../passiveentry/BleGuards.kt` | Permission gate (+ optional `POST_NOTIFICATIONS`). |
| `.../passiveentry/PassiveEntryCentral.kt` | The GATT state machine. |
| `.../passiveentry/PassiveEntryRuntime.kt` | Process singleton: mode, visibility, service/alarms/background scan. |
| `.../passiveentry/PassiveEntryApp.kt` + `PassiveEntryPackage.kt` | `Application.onCreate` hook. |
| `.../passiveentry/PassiveEntryService.kt` | Foreground service + BT-state receiver. |
| `.../passiveentry/PassiveEntryReceiver.kt` | Boot receiver + internal receiver (scan results, alarms). |
| `.../passiveentry/PassiveEntryModule.kt` | Expo bridge (frozen contract). |
| `modules/expo-passive-entry/android/src/test/java/expo/modules/passiveentry/*Test.kt` | JVM unit tests. |
| `src/ble/nativeGoldens.test.ts` | Pins Swift + Kotlin constants to the JSON fixtures. |
| `scripts/android/pull-logs.sh` | Pull the SQLite ring + native log. |
| `docs/android-parity.md`, `AGENTS.md` | Runbook updates. |

Deleted: nothing else — every existing file in the package is rewritten in place.

---

### Task 1: Pure crypto + protobuf (`Proto.kt`, `VcsecSigner.kt`) with JVM goldens

**Files:**
- Modify: `modules/expo-passive-entry/android/build.gradle`
- Create: `modules/expo-passive-entry/android/src/main/java/expo/modules/passiveentry/Proto.kt`
- Create: `modules/expo-passive-entry/android/src/main/java/expo/modules/passiveentry/VcsecSigner.kt`
- Test: `modules/expo-passive-entry/android/src/test/java/expo/modules/passiveentry/ProtoTest.kt`
- Test: `modules/expo-passive-entry/android/src/test/java/expo/modules/passiveentry/VcsecSignerTest.kt`

**Interfaces:**
- Produces `object Proto { varint(Long), lenField(Int, ByteArray), varintField(Int, Long), fixed32Field(Int, Long), be32(Long), readVarint(ByteArray, Int): Pair<Long, Int>, extractLenField(ByteArray, Int): ByteArray?, extractVarintField(ByteArray, Int): Long?, topLevelFieldNumbers(ByteArray): List<Int> }`.
- Produces `object VcsecSigner { hex, unhex, aad(...), aesGcmSeal(...): Sealed?, sealFrame(...): SealedFrame?, sessionInfoRequestFrame(myPubRaw, routingAddress, challenge), parseSessionInfo(bytes): ParsedSessionInfo?, sessionInfoHmac(sessionKey, vin, challenge, siBytes), ecdhSessionKey(myPriv, peerPub): ByteArray?, devicePublicKey(privHex): ByteArray?, fingerprint(pub): String, goldenSelfTest(), ecdhGoldenSelfTest(), handshakeGoldenSelfTest() }` and `internal object P256Curve { multiplyG(BigInteger): Pair<BigInteger, BigInteger>? }`.

- [ ] **Step 1: Add JUnit and drop the deprecated key library**

```gradle path=modules/expo-passive-entry/android/build.gradle
plugins {
  id 'com.android.library'
  id 'expo-module-gradle-plugin'
}

group = 'expo.modules.passiveentry'
version = '0.1.0'

android {
  namespace "expo.modules.passiveentry"
  defaultConfig {
    versionCode 1
    versionName "0.1.0"
  }
  lintOptions {
    abortOnError false
  }
}

dependencies {
  // The device key is wrapped with an Android Keystore AES-GCM key directly (KeystoreKey.kt);
  // androidx.security:security-crypto is deprecated and is deliberately not used.
  //
  // JVM unit tests for the pure classes (Proto, VcsecSigner, VehicleIdentity, FrameReassembler,
  // VcsecResponder): `./gradlew :expo-passive-entry:testReleaseUnitTest`.
  testImplementation 'junit:junit:4.13.2'
}
```

- [ ] **Step 2: Write the failing tests**

```kotlin path=modules/expo-passive-entry/android/src/test/java/expo/modules/passiveentry/ProtoTest.kt
package expo.modules.passiveentry

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ProtoTest {
  @Test fun varintEncodesMultiByte() {
    assertArrayEquals(byteArrayOf(0xAC.toByte(), 0x02), Proto.varint(300))
    assertArrayEquals(byteArrayOf(0x00), Proto.varint(0))
    assertEquals(300L to 2, Proto.readVarint(byteArrayOf(0xAC.toByte(), 0x02), 0))
  }

  @Test fun lenFieldAndVarintFieldRoundTrip() {
    val msg = Proto.varintField(1, 7) + Proto.lenField(2, byteArrayOf(1, 2, 3)) + Proto.fixed32Field(4, 0x01020304)
    assertEquals(7L, Proto.extractVarintField(msg, 1))
    assertArrayEquals(byteArrayOf(1, 2, 3), Proto.extractLenField(msg, 2))
    assertNull(Proto.extractLenField(msg, 9))
    assertNull(Proto.extractVarintField(msg, 9))
    assertEquals(listOf(1, 2, 4), Proto.topLevelFieldNumbers(msg))
  }

  @Test fun fixed32IsLittleEndianAndBe32IsBigEndian() {
    assertArrayEquals(byteArrayOf(0x25, 0x04, 0x03, 0x02, 0x01), Proto.fixed32Field(4, 0x01020304))
    assertArrayEquals(byteArrayOf(0x01, 0x02, 0x03, 0x04), Proto.be32(0x01020304))
  }

  @Test fun truncatedLenFieldReturnsNull() {
    // field 2, length 5, but only 2 bytes follow
    assertNull(Proto.extractLenField(byteArrayOf(0x12, 0x05, 0x01, 0x02), 2))
  }
}
```

```kotlin path=modules/expo-passive-entry/android/src/test/java/expo/modules/passiveentry/VcsecSignerTest.kt
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
```

- [ ] **Step 3: Run the tests and watch them fail to compile**

Run: `cd android && ANDROID_HOME=$HOME/Library/Android/sdk JAVA_HOME=/Library/Java/JavaVirtualMachines/zulu-17.jdk/Contents/Home ./gradlew :expo-passive-entry:testReleaseUnitTest --max-workers=2 2>&1 | tail -15`
Expected: `Unresolved reference: Proto` / `VcsecSigner` compile errors.

- [ ] **Step 4: Implement `Proto.kt`**

```kotlin path=modules/expo-passive-entry/android/src/main/java/expo/modules/passiveentry/Proto.kt
package expo.modules.passiveentry

import java.io.ByteArrayOutputStream

/**
 * Protobuf wire primitives — a byte-for-byte port of the writer/reader helpers in
 * ios/VcsecSigner.swift. Pure JVM (no Android imports) so the module's unit tests cover it.
 */
object Proto {
  fun varint(v: Long): ByteArray {
    val out = ByteArrayOutputStream(10)
    var n = v
    do {
      var b = (n and 0x7f).toInt()
      n = n ushr 7
      if (n != 0L) b = b or 0x80
      out.write(b)
    } while (n != 0L)
    return out.toByteArray()
  }

  fun lenField(field: Int, bytes: ByteArray): ByteArray =
    varint(((field shl 3) or 2).toLong()) + varint(bytes.size.toLong()) + bytes

  fun varintField(field: Int, value: Long): ByteArray =
    varint((field shl 3).toLong()) + varint(value)

  /** fixed32 is LITTLE-endian on the wire (the AAD uses be32 for the same numbers — different, deliberately). */
  fun fixed32Field(field: Int, value: Long): ByteArray =
    varint(((field shl 3) or 5).toLong()) + byteArrayOf(
      (value and 0xff).toByte(),
      ((value shr 8) and 0xff).toByte(),
      ((value shr 16) and 0xff).toByte(),
      ((value shr 24) and 0xff).toByte(),
    )

  fun be32(v: Long): ByteArray = byteArrayOf(
    ((v shr 24) and 0xff).toByte(),
    ((v shr 16) and 0xff).toByte(),
    ((v shr 8) and 0xff).toByte(),
    (v and 0xff).toByte(),
  )

  /** Reads a varint at [start]; returns (value, index just past it). */
  fun readVarint(b: ByteArray, start: Int): Pair<Long, Int> {
    var v = 0L
    var shift = 0
    var i = start
    while (i < b.size) {
      val x = b[i].toInt() and 0xff
      i++
      v = v or ((x and 0x7f).toLong() shl shift)
      if (x and 0x80 == 0) break
      shift += 7
    }
    return v to i
  }

  /** First occurrence of length-delimited [field], or null when absent or truncated. */
  fun extractLenField(b: ByteArray, field: Int): ByteArray? {
    var i = 0
    while (i < b.size) {
      val (tag, ni) = readVarint(b, i)
      i = ni
      val f = (tag shr 3).toInt()
      when ((tag and 7).toInt()) {
        0 -> { val (_, nj) = readVarint(b, i); i = nj }
        5 -> i += 4
        1 -> i += 8
        2 -> {
          val (ln, nj) = readVarint(b, i)
          i = nj
          val end = i + ln.toInt()
          if (ln < 0 || end > b.size) return null
          if (f == field) return b.copyOfRange(i, end)
          i = end
        }
        else -> return null
      }
    }
    return null
  }

  /** First occurrence of varint [field], or null. */
  fun extractVarintField(b: ByteArray, field: Int): Long? {
    var i = 0
    while (i < b.size) {
      val (tag, ni) = readVarint(b, i)
      i = ni
      val f = (tag shr 3).toInt()
      when ((tag and 7).toInt()) {
        0 -> { val (v, nj) = readVarint(b, i); i = nj; if (f == field) return v }
        2 -> { val (ln, nj) = readVarint(b, i); i = nj + ln.toInt() }
        5 -> i += 4
        1 -> i += 8
        else -> return null
      }
    }
    return null
  }

  /** Every top-level field number in wire order (diagnostics only). Stops at a malformed tag. */
  fun topLevelFieldNumbers(b: ByteArray): List<Int> {
    val out = ArrayList<Int>()
    var i = 0
    while (i < b.size) {
      val (tag, ni) = readVarint(b, i)
      i = ni
      val f = (tag shr 3).toInt()
      if (f == 0) break
      if (f !in out) out.add(f)
      when ((tag and 7).toInt()) {
        0 -> { val (_, n) = readVarint(b, i); i = n }
        1 -> i += 8
        2 -> { val (ln, n) = readVarint(b, i); i = n + ln.toInt() }
        5 -> i += 4
        else -> return out
      }
    }
    return out
  }
}
```

- [ ] **Step 5: Implement `VcsecSigner.kt`**

```kotlin path=modules/expo-passive-entry/android/src/main/java/expo/modules/passiveentry/VcsecSigner.kt
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
```

- [ ] **Step 6: Run the tests and watch them pass**

Run: `cd android && ANDROID_HOME=$HOME/Library/Android/sdk JAVA_HOME=/Library/Java/JavaVirtualMachines/zulu-17.jdk/Contents/Home ./gradlew :expo-passive-entry:testReleaseUnitTest --max-workers=2 2>&1 | tail -8`
Expected: `BUILD SUCCESSFUL` (the old `PassiveEntryCentral.kt` still compiles alongside; it is replaced in Task 5).

- [ ] **Step 7: Commit**

```bash
git add modules/expo-passive-entry/android
git commit -m "feat(android/ble): VcsecSigner + Proto — JCA port of the Swift seal/handshake with JVM goldens

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Vehicle identity + frame reassembly (pure, tested)

**Files:**
- Create: `modules/expo-passive-entry/android/src/main/java/expo/modules/passiveentry/VehicleIdentity.kt`
- Create: `modules/expo-passive-entry/android/src/main/java/expo/modules/passiveentry/FrameReassembler.kt`
- Test: `modules/expo-passive-entry/android/src/test/java/expo/modules/passiveentry/VehicleIdentityTest.kt`
- Test: `modules/expo-passive-entry/android/src/test/java/expo/modules/passiveentry/FrameReassemblerTest.kt`

**Interfaces:**
- Produces `object VehicleIdentity { BEACON_UUID, BEACON_UUID_BYTES, APPLE_COMPANY_ID, ADVERTISED_SERVICE, VCSEC_SERVICE, TX_CHAR, RX_CHAR, CCCD, BEACON_FILTER_DATA, BEACON_FILTER_MASK, localName(vin): String, expectedBeaconMinor(vin): Int?, parseIBeacon(mfg): IBeacon?, teslaBeacon(appleMfg): IBeacon?, enum Match { BEACON, NAME, SERVICE, NONE }, classify(appleMfg: ByteArray?, serviceUuids: List<UUID>, advName: String?, vin: String): Match }`.
- Produces `class FrameReassembler(maxFrame: Int = 1024) { push(bytes): List<ByteArray>; reset() }`.

- [ ] **Step 1: Write the failing tests**

```kotlin path=modules/expo-passive-entry/android/src/test/java/expo/modules/passiveentry/VehicleIdentityTest.kt
package expo.modules.passiveentry

import expo.modules.passiveentry.VehicleIdentity.Match
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class VehicleIdentityTest {
  private val vin = "XP7YGCELXTB844019"

  // Captured byte-exact from this car on 2026-09-03 (primary PDU, after Apple's company id):
  //   0215 74278bdab64445208f0c720eaf059935 0000 f3ab c5
  private val ourBeacon = VcsecSigner.unhex("021574278bdab64445208f0c720eaf0599350000f3abc5")
  private val otherTeslaBeacon = VcsecSigner.unhex("021574278bdab64445208f0c720eaf0599350000f3acc5")
  private val iPhoneMfg = VcsecSigner.unhex("1006031a8f5c3b2e")
  private val s1122 = listOf(VehicleIdentity.ADVERTISED_SERVICE)

  @Test fun localNameMatchesBleScanNameTs() {
    assertEquals("S8d2eb01195e4f42bC", VehicleIdentity.localName(vin))
  }

  @Test fun beaconMinorIsByteSwappedLast5Digits() {
    assertEquals(62379, VehicleIdentity.expectedBeaconMinor(vin))
    assertEquals(0x0400, VehicleIdentity.expectedBeaconMinor("ABCDEFGHIJKL4A019")) // "4A019" → leading digits "4"
    assertNull(VehicleIdentity.expectedBeaconMinor("1234"))
  }

  @Test fun parsesTheCapturedBeacon() {
    val b = VehicleIdentity.parseIBeacon(ourBeacon)!!
    assertEquals(VehicleIdentity.BEACON_UUID, b.uuid)
    assertEquals(0, b.major)
    assertEquals(0xF3AB, b.minor)
    assertNull(VehicleIdentity.parseIBeacon(iPhoneMfg))
    assertNull(VehicleIdentity.teslaBeacon(iPhoneMfg))
  }

  @Test fun beaconWithOurMinorIsTheCar() {
    assertEquals(Match.BEACON, VehicleIdentity.classify(ourBeacon, emptyList(), null, vin))
  }

  @Test fun beaconWithAnotherMinorDisqualifiesEvenWith1122() {
    assertEquals(Match.NONE, VehicleIdentity.classify(otherTeslaBeacon, s1122, null, vin))
  }

  @Test fun nameMatchIsTheCar() {
    assertEquals(Match.NAME, VehicleIdentity.classify(null, emptyList(), "S8d2eb01195e4f42bC", vin))
  }

  @Test fun anotherTeslasNameDisqualifiesEvenWith1122() {
    assertEquals(Match.NONE, VehicleIdentity.classify(null, s1122, "S0000000000000000C", vin))
  }

  @Test fun service1122AloneIsTheCar() {
    assertEquals(Match.SERVICE, VehicleIdentity.classify(null, s1122, null, vin))
    assertEquals(Match.SERVICE, VehicleIdentity.classify(iPhoneMfg, s1122, "TeslaFSD-8FCBA4", vin))
  }

  @Test fun unrelatedAdvertisersAreNone() {
    assertEquals(Match.NONE, VehicleIdentity.classify(iPhoneMfg, emptyList(), "iPhone", vin))
    assertEquals(Match.NONE, VehicleIdentity.classify(null, emptyList(), null, vin))
  }

  @Test fun beaconFilterPayloadIsTypeLenUuid() {
    assertEquals("021574278bdab64445208f0c720eaf059935", VcsecSigner.hex(VehicleIdentity.BEACON_FILTER_DATA))
    assertEquals(18, VehicleIdentity.BEACON_FILTER_MASK.size)
  }
}
```

```kotlin path=modules/expo-passive-entry/android/src/test/java/expo/modules/passiveentry/FrameReassemblerTest.kt
package expo.modules.passiveentry

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test

class FrameReassemblerTest {
  @Test fun frameSplitAcrossNotifications() {
    val r = FrameReassembler()
    assertEquals(0, r.push(byteArrayOf(0x00)).size)
    assertEquals(0, r.push(byteArrayOf(0x03, 0xAA.toByte())).size)
    val frames = r.push(byteArrayOf(0xBB.toByte(), 0xCC.toByte()))
    assertEquals(1, frames.size)
    assertArrayEquals(byteArrayOf(0xAA.toByte(), 0xBB.toByte(), 0xCC.toByte()), frames[0])
  }

  @Test fun twoFramesInOneNotificationAndATrailingPrefix() {
    val r = FrameReassembler()
    val frames = r.push(byteArrayOf(0x00, 0x01, 0x11, 0x00, 0x02, 0x22, 0x33, 0x00, 0x01))
    assertEquals(2, frames.size)
    assertArrayEquals(byteArrayOf(0x11), frames[0])
    assertArrayEquals(byteArrayOf(0x22, 0x33), frames[1])
    val tail = r.push(byteArrayOf(0x44))
    assertEquals(1, tail.size)
    assertArrayEquals(byteArrayOf(0x44), tail[0])
  }

  @Test fun oversizedLengthResetsTheStream() {
    val r = FrameReassembler(maxFrame = 8)
    assertEquals(0, r.push(byteArrayOf(0x7F, 0xFF.toByte(), 0x01)).size)
    val frames = r.push(byteArrayOf(0x00, 0x01, 0x55))
    assertEquals(1, frames.size)
    assertArrayEquals(byteArrayOf(0x55), frames[0])
  }
}
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `cd android && ANDROID_HOME=$HOME/Library/Android/sdk JAVA_HOME=/Library/Java/JavaVirtualMachines/zulu-17.jdk/Contents/Home ./gradlew :expo-passive-entry:testReleaseUnitTest --max-workers=2 2>&1 | tail -15`
Expected: `Unresolved reference: VehicleIdentity` / `FrameReassembler`.

- [ ] **Step 3: Implement `VehicleIdentity.kt`**

```kotlin path=modules/expo-passive-entry/android/src/main/java/expo/modules/passiveentry/VehicleIdentity.kt
package expo.modules.passiveentry

import java.nio.ByteBuffer
import java.security.MessageDigest
import java.util.UUID

/**
 * How THIS car is recognised in a BLE advertisement. Pure JVM — the ScanResult → bytes adapter lives
 * in PassiveEntryCentral so the decision itself is unit-tested.
 *
 * The car's identity is split across two packets (memory: android-ble-car-identity-ibeacon):
 *  - primary PDU = an Apple iBeacon under company id 0x004C carrying Tesla's fixed phone-key UUID
 *    and a VIN-derived minor — the half Android receives reliably, even at -90 dBm;
 *  - scan response = the local name S<sha1(vin)[:8]>C plus the 16-bit service 1122.
 * Any one of the three identifies the car. A Tesla beacon with ANOTHER minor, or another car's S…C
 * name, disqualifies the advertiser even if it also carries 1122 — the same rule the official app's
 * BLEService.i0 applies to the name.
 */
object VehicleIdentity {
  val BEACON_UUID: UUID = UUID.fromString("74278BDA-B644-4520-8F0C-720EAF059935")
  val BEACON_UUID_BYTES: ByteArray = uuidToBytes(BEACON_UUID)
  const val APPLE_COMPANY_ID = 0x004C

  /** The car ADVERTISES 16-bit service 1122 (on-car 2026-07-22); 00000211 is the GATT service once connected. */
  val ADVERTISED_SERVICE: UUID = UUID.fromString("00001122-0000-1000-8000-00805f9b34fb")
  val VCSEC_SERVICE: UUID = UUID.fromString("00000211-b2d1-43f0-9b88-960cebf8b91e")
  val TX_CHAR: UUID = UUID.fromString("00000212-b2d1-43f0-9b88-960cebf8b91e") // write
  val RX_CHAR: UUID = UUID.fromString("00000213-b2d1-43f0-9b88-960cebf8b91e") // indicate
  val CCCD: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")

  /** ScanFilter payload "an iBeacon carrying our UUID": type(02) len(15) + the 16 UUID bytes. */
  val BEACON_FILTER_DATA: ByteArray = byteArrayOf(0x02, 0x15) + BEACON_UUID_BYTES
  val BEACON_FILTER_MASK: ByteArray = ByteArray(BEACON_FILTER_DATA.size) { 0xFF.toByte() }

  private val DERIVED_NAME = Regex("^S[0-9A-Fa-f]{16}C$")

  /** "S" + lower_hex(sha1(utf8(vin))[0:8]) + "C" — byte-for-byte src/ble/bleScanName.ts vehicleLocalName. */
  fun localName(vin: String): String {
    val d = MessageDigest.getInstance("SHA-1").digest(vin.toByteArray(Charsets.UTF_8))
    return "S" + d.copyOf(8).joinToString("") { "%02x".format(it) } + "C"
  }

  /**
   * The iBeacon minor this VIN advertises — mirrors iOS CarRegionMonitor.expectedMajorMinor and
   * src/ble/bleBeacon.ts: last 5 VIN chars, leading digits only (NSString.integerValue semantics),
   * byte-swap the low 16 bits. Confirmed against the live advertisement: …844019 → 62379 (0xF3AB).
   */
  fun expectedBeaconMinor(vin: String): Int? {
    if (vin.length < 5) return null
    val digits = vin.takeLast(5).takeWhile { it.isDigit() }
    val v = digits.toLongOrNull() ?: 0L
    val lower = (v and 0xFFFF).toInt()
    return ((lower and 0xFF) shl 8) or ((lower shr 8) and 0xFF)
  }

  class IBeacon(val uuid: UUID, val major: Int, val minor: Int)

  /** Parse an iBeacon from the manufacturer data AFTER the company id (what ScanRecord.getManufacturerSpecificData(0x004C) returns). */
  fun parseIBeacon(mfg: ByteArray): IBeacon? {
    if (mfg.size < 22 || mfg[0] != 0x02.toByte() || mfg[1] != 0x15.toByte()) return null
    val bb = ByteBuffer.wrap(mfg, 2, 16)
    val uuid = UUID(bb.long, bb.long)
    val major = ((mfg[18].toInt() and 0xFF) shl 8) or (mfg[19].toInt() and 0xFF)
    val minor = ((mfg[20].toInt() and 0xFF) shl 8) or (mfg[21].toInt() and 0xFF)
    return IBeacon(uuid, major, minor)
  }

  /** A Tesla phone-key beacon (our UUID), whichever car it belongs to; null for anything else. */
  fun teslaBeacon(appleMfg: ByteArray?): IBeacon? = appleMfg?.let(::parseIBeacon)?.takeIf { it.uuid == BEACON_UUID }

  enum class Match { BEACON, NAME, SERVICE, NONE }

  /** Decide whether one advertisement is THIS car. [appleMfg] is the manufacturer data after company id 0x004C. */
  fun classify(appleMfg: ByteArray?, serviceUuids: List<UUID>, advName: String?, vin: String): Match {
    val beacon = teslaBeacon(appleMfg)
    if (beacon != null) return if (beacon.minor == expectedBeaconMinor(vin)) Match.BEACON else Match.NONE
    val want = localName(vin)
    if (advName == want) return Match.NAME
    if (advName != null && DERIVED_NAME.matches(advName)) return Match.NONE // a different Tesla's token
    if (ADVERTISED_SERVICE in serviceUuids) return Match.SERVICE
    return Match.NONE
  }

  private fun uuidToBytes(u: UUID): ByteArray =
    ByteBuffer.allocate(16).putLong(u.mostSignificantBits).putLong(u.leastSignificantBits).array()
}
```

- [ ] **Step 4: Implement `FrameReassembler.kt`**

```kotlin path=modules/expo-passive-entry/android/src/main/java/expo/modules/passiveentry/FrameReassembler.kt
package expo.modules.passiveentry

/**
 * Reassembles 0213 notifications into complete VCSEC frames: a 2-byte big-endian length prefix
 * followed by that many bytes, possibly split across several notifications, possibly followed by
 * the next frame's bytes in the same notification. Used ONLY by the autonomous (background)
 * responder — in pipe mode raw notifications go to TS, whose BleReassembler owns the stream, and two
 * reassemblers on one stream would fight.
 */
class FrameReassembler(private val maxFrame: Int = 1024) {
  private var buf = ByteArray(0)
  private var expected = -1

  fun push(bytes: ByteArray): List<ByteArray> {
    buf += bytes
    val out = ArrayList<ByteArray>()
    while (true) {
      if (expected < 0) {
        if (buf.size < 2) return out
        expected = ((buf[0].toInt() and 0xff) shl 8) or (buf[1].toInt() and 0xff)
        if (expected > maxFrame) {
          reset() // garbage length: the stream is desynced, start over at the next notification
          return out
        }
      }
      if (buf.size < expected + 2) return out
      out.add(buf.copyOfRange(2, 2 + expected))
      buf = buf.copyOfRange(2 + expected, buf.size)
      expected = -1
    }
  }

  fun reset() {
    buf = ByteArray(0)
    expected = -1
  }
}
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `cd android && ANDROID_HOME=$HOME/Library/Android/sdk JAVA_HOME=/Library/Java/JavaVirtualMachines/zulu-17.jdk/Contents/Home ./gradlew :expo-passive-entry:testReleaseUnitTest --max-workers=2 2>&1 | tail -8`
Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 6: Commit**

```bash
git add modules/expo-passive-entry/android
git commit -m "feat(android/ble): VehicleIdentity classifier + FrameReassembler (pure, JVM-tested)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Persistence, key wrapping, native log, notifications, permission guard

**Files:**
- Create: `modules/expo-passive-entry/android/src/main/java/expo/modules/passiveentry/PassiveEntryStore.kt`
- Modify (rewrite): `modules/expo-passive-entry/android/src/main/java/expo/modules/passiveentry/KeystoreKey.kt`
- Create: `modules/expo-passive-entry/android/src/main/java/expo/modules/passiveentry/NativeLog.kt`
- Create: `modules/expo-passive-entry/android/src/main/java/expo/modules/passiveentry/Notifier.kt`
- Create: `modules/expo-passive-entry/android/src/main/res/drawable/ic_stat_phone_key.xml`
- Modify (rewrite): `modules/expo-passive-entry/android/src/main/java/expo/modules/passiveentry/BleGuards.kt`

**Interfaces:**
- Produces `interface WarmSessionStore { class WarmSession(epochHex, counter: Long, clockBase: Long, wallSec: Long, carPubHex); warmSession(vin): WarmSession?; saveWarmSession(vin, s) }` and `class PassiveEntryStore(context) : WarmSessionStore { var vin: String?; rememberedMac(vin): String?; rememberMac(vin, mac: String?); var btOffRepeatScheduled: Boolean; var notificationsAsked: Boolean; carLocation(): Pair<Double, Double>?; setCarLocation(lat, lon) }`.
- Produces `object KeystoreKey { setKeyHex(context, hex): Boolean; getKeyHex(context): String? }` (unchanged signatures).
- Produces `class NativeLog(context) { var sink: ((String) -> Unit)?; log(line) }`.
- Produces `object Notifier { CHANNEL_SERVICE, CHANNEL_ALERTS, ID_SERVICE = 333, ID_BT_OFF = 444, ID_CPD = 445; ensureChannels(ctx); serviceNotification(ctx, vin, text): Notification; postBtOff(ctx); clearBtOff(ctx); postCpd(ctx); canPost(ctx): Boolean }`.
- Produces `object BleGuards { requiredPermissions(); missingPermissions(ctx); hasScanPermissions(ctx); optionalPermissions(ctx) }`.

These classes are Android-bound (SharedPreferences, Keystore, NotificationManager) and are exercised on the device in Task 6; the compile step below is the check here.

- [ ] **Step 1: `PassiveEntryStore.kt`**

```kotlin path=modules/expo-passive-entry/android/src/main/java/expo/modules/passiveentry/PassiveEntryStore.kt
package expo.modules.passiveentry

import android.content.Context
import android.content.SharedPreferences

/** Warm-session persistence seam so VcsecResponder is JVM-testable against an in-memory fake. */
interface WarmSessionStore {
  class WarmSession(val epochHex: String, val counter: Long, val clockBase: Long, val wallSec: Long, val carPubHex: String)

  fun warmSession(vin: String): WarmSession?
  fun saveWarmSession(vin: String, s: WarmSession)
}

/**
 * Everything native must remember across process death — the UserDefaults of
 * PassiveEntryCentral.swift. No key material lives here (that is KeystoreKey); the warm session
 * holds only the car's PUBLIC key and counters, exactly as on iOS, so plain SharedPreferences
 * (private to the app, encrypted at rest with the device) is sufficient.
 */
class PassiveEntryStore(context: Context) : WarmSessionStore {
  private val prefs: SharedPreferences =
    context.applicationContext.getSharedPreferences("passive_entry", Context.MODE_PRIVATE)

  /** The armed VIN. Present ⇔ passive entry is armed (iOS `isArmed()`); cleared by stop(). */
  var vin: String?
    get() = prefs.getString(KEY_VIN, null)?.takeIf { it.isNotEmpty() }
    set(value) {
      prefs.edit().apply { if (value.isNullOrEmpty()) remove(KEY_VIN) else putString(KEY_VIN, value) }.apply()
    }

  /** Keyed by VIN: a remembered address must never be reused for a different car. */
  fun rememberedMac(vin: String): String? = prefs.getString("peripheral_mac_$vin", null)

  fun rememberMac(vin: String, mac: String?) {
    prefs.edit().apply { if (mac == null) remove("peripheral_mac_$vin") else putString("peripheral_mac_$vin", mac) }.apply()
  }

  override fun warmSession(vin: String): WarmSessionStore.WarmSession? {
    val epoch = prefs.getString("sess.$vin.epoch", null) ?: return null
    val carPub = prefs.getString("sess.$vin.carPub", null) ?: return null
    return WarmSessionStore.WarmSession(
      epoch,
      prefs.getLong("sess.$vin.counter", 0),
      prefs.getLong("sess.$vin.clock", 0),
      prefs.getLong("sess.$vin.wall", 0),
      carPub,
    )
  }

  override fun saveWarmSession(vin: String, s: WarmSessionStore.WarmSession) {
    prefs.edit()
      .putString("sess.$vin.epoch", s.epochHex)
      .putLong("sess.$vin.counter", s.counter)
      .putLong("sess.$vin.clock", s.clockBase)
      .putLong("sess.$vin.wall", s.wallSec)
      .putString("sess.$vin.carPub", s.carPubHex)
      .apply()
  }

  /** "the repeating BT-off reminder is already scheduled" — once per off-episode, like iOS. */
  var btOffRepeatScheduled: Boolean
    get() = prefs.getBoolean("btOffRepeatScheduled", false)
    set(value) { prefs.edit().putBoolean("btOffRepeatScheduled", value).apply() }

  /** POST_NOTIFICATIONS is asked once, alongside the BLE grants; never nagged for. */
  var notificationsAsked: Boolean
    get() = prefs.getBoolean("notificationsAsked", false)
    set(value) { prefs.edit().putBoolean("notificationsAsked", value).apply() }

  /** The car's last parked position — stored for a later geofence leg (spec §5 Q2), not consumed yet. */
  fun carLocation(): Pair<Double, Double>? {
    if (!prefs.contains("car.lat") || !prefs.contains("car.lon")) return null
    return Double.fromBits(prefs.getLong("car.lat", 0)) to Double.fromBits(prefs.getLong("car.lon", 0))
  }

  fun setCarLocation(lat: Double, lon: Double) {
    prefs.edit().putLong("car.lat", lat.toBits()).putLong("car.lon", lon.toBits()).apply()
  }

  private companion object {
    const val KEY_VIN = "vin"
  }
}
```

- [ ] **Step 2: `KeystoreKey.kt` — Keystore-wrapped scalar, no deprecated library**

```kotlin path=modules/expo-passive-entry/android/src/main/java/expo/modules/passiveentry/KeystoreKey.kt
package expo.modules.passiveentry

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Native's OWN copy of the enrolled device key (the 32-byte P-256 private scalar, as hex — the exact
 * string expo-secure-store holds) — the Android counterpart of ios/KeychainKey.swift.
 *
 * WHY NOT A KEYSTORE EC KEY: a Keystore-held EC key can sign, but its raw scalar can never be
 * exported, and the VCSEC session key is SHA1(ECDH_X)[:16] over that scalar. So the scalar is
 * WRAPPED instead: an AES-256-GCM key that lives in the Android Keystore (never leaves the TEE)
 * encrypts the hex, and only the IV + ciphertext sit in SharedPreferences. That is exactly what
 * the deprecated androidx.security EncryptedSharedPreferences did internally, minus Tink.
 *
 * The wrapping key is created with no user-authentication requirement and is usable after the
 * first unlock while the device is locked — the same availability class as the iOS item
 * (`AfterFirstUnlockThisDeviceOnly`), which is what a walk-up with the phone in the pocket needs.
 */
object KeystoreKey {
  private const val PREFS = "airgapp.passiveentry.key"
  private const val KEY_BLOB = "deviceKeyHex.wrapped"
  private const val ALIAS = "airgapp.passiveentry.wrap"
  private const val IV_BYTES = 12

  fun setKeyHex(context: Context, hex: String): Boolean = runCatching {
    val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    // An empty string is the documented "wipe" path (JS calls setDeviceKey('') to unenroll).
    if (hex.isEmpty()) {
      prefs.edit().remove(KEY_BLOB).apply()
      return true
    }
    val c = Cipher.getInstance("AES/GCM/NoPadding")
    c.init(Cipher.ENCRYPT_MODE, wrappingKey()) // Keystore chooses the IV (randomized encryption)
    val iv = c.iv
    check(iv.size == IV_BYTES) { "unexpected GCM IV size ${iv.size}" }
    val ct = c.doFinal(hex.toByteArray(Charsets.UTF_8))
    prefs.edit().putString(KEY_BLOB, Base64.encodeToString(iv + ct, Base64.NO_WRAP)).apply()
    true
  }.getOrElse { false }

  fun getKeyHex(context: Context): String? = runCatching {
    val blob = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .getString(KEY_BLOB, null) ?: return null
    val bytes = Base64.decode(blob, Base64.NO_WRAP)
    if (bytes.size <= IV_BYTES) return null
    val c = Cipher.getInstance("AES/GCM/NoPadding")
    c.init(Cipher.DECRYPT_MODE, wrappingKey(), GCMParameterSpec(128, bytes.copyOf(IV_BYTES)))
    String(c.doFinal(bytes.copyOfRange(IV_BYTES, bytes.size)), Charsets.UTF_8)
  }.getOrNull()

  private fun wrappingKey(): SecretKey {
    val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    (ks.getEntry(ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
    val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
    gen.init(
      KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setKeySize(256)
        .build(),
    )
    return gen.generateKey()
  }
}
```

- [ ] **Step 3: `NativeLog.kt`**

```kotlin path=modules/expo-passive-entry/android/src/main/java/expo/modules/passiveentry/NativeLog.kt
package expo.modules.passiveentry

import android.content.Context
import android.util.Log
import java.io.File
import java.io.FileOutputStream
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.Executors

/**
 * Three sinks for every native line, like ios/PassiveEntryCentral.swift's log():
 *  - logcat (`adb logcat -s PassiveEntry:*`) — volatile, lost on reboot;
 *  - the JS `log` event, when a React context is alive (the app routes it into its SQLite ring);
 *  - `files/airgapp-native.log` — survives process death and reboot, the only record of what the
 *    service did while nothing else was running. Pull with `bash scripts/android/pull-logs.sh`.
 */
class NativeLog(context: Context) {
  private val file = File(context.applicationContext.filesDir, FILE_NAME)
  private val io = Executors.newSingleThreadExecutor { r -> Thread(r, "PassiveEntryLog").apply { isDaemon = true } }
  private val stamp = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSXXX", Locale.US)

  @Volatile var sink: ((String) -> Unit)? = null

  fun log(line: String) {
    Log.i(TAG, line)
    sink?.invoke(line)
    io.execute { append(line) }
  }

  private fun append(line: String) {
    runCatching {
      if (file.length() > MAX_BYTES) {
        val rotated = File(file.parentFile, "$FILE_NAME.1")
        rotated.delete()
        file.renameTo(rotated)
      }
      FileOutputStream(file, true).use { it.write("[native-passive] ${stamp.format(Date())} $line\n".toByteArray()) }
    }
  }

  companion object {
    const val TAG = "PassiveEntry"
    const val FILE_NAME = "airgapp-native.log"
    private const val MAX_BYTES = 1L shl 20
  }
}
```

- [ ] **Step 4: `Notifier.kt` + the status-bar icon**

```xml path=modules/expo-passive-entry/android/src/main/res/drawable/ic_stat_phone_key.xml
<?xml version="1.0" encoding="utf-8"?>
<!-- Status-bar glyph for the Phone Key service. Material "vpn_key" outline (Apache 2.0), white so
     the system tints it. Notification small icons must be monochrome. -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp"
    android:height="24dp"
    android:viewportWidth="24"
    android:viewportHeight="24">
  <path
      android:fillColor="#FFFFFFFF"
      android:pathData="M12.65,10C11.83,7.67 9.61,6 7,6c-3.31,0 -6,2.69 -6,6s2.69,6 6,6c2.61,0 4.83,-1.67 5.65,-4H17v4h4v-4h2v-4H12.65zM7,14c-1.1,0 -2,-0.9 -2,-2s0.9,-2 2,-2 2,0.9 2,2 -0.9,2 -2,2z" />
</vector>
```

```kotlin path=modules/expo-passive-entry/android/src/main/java/expo/modules/passiveentry/Notifier.kt
package expo.modules.passiveentry

import android.Manifest
import android.app.Notification
import android.app.PendingIntent
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationChannelCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat

/**
 * Local notifications posted from NATIVE code — the counterpart of ios/Notifier.swift. Two channels:
 * the foreground service's persistent, silent, low-importance card, and high-importance alerts
 * (Bluetooth off, child detected). Copy is the official app's (RESPONSE-13), same as iOS.
 *
 * Android 13+ gates every notification on the POST_NOTIFICATIONS runtime permission; the module
 * asks once alongside the BLE grants. A denial only mutes the reminders — the foreground service
 * still runs (Android shows its card in the notification shade regardless, unless the user hid
 * the channel).
 */
object Notifier {
  const val CHANNEL_SERVICE = "phone_key_service"
  const val CHANNEL_ALERTS = "phone_key_alerts"
  const val ID_SERVICE = 333
  const val ID_BT_OFF = 444
  const val ID_CPD = 445

  fun ensureChannels(ctx: Context) {
    NotificationManagerCompat.from(ctx).createNotificationChannelsCompat(
      listOf(
        NotificationChannelCompat.Builder(CHANNEL_SERVICE, NotificationManagerCompat.IMPORTANCE_LOW)
          .setName("Phone Key")
          .setDescription("Keeps the Bluetooth link to your car alive so it unlocks as you walk up")
          .setShowBadge(false)
          .build(),
        NotificationChannelCompat.Builder(CHANNEL_ALERTS, NotificationManagerCompat.IMPORTANCE_HIGH)
          .setName("Phone Key alerts")
          .setDescription("Bluetooth turned off, child detected in car")
          .build(),
      ),
    )
  }

  /** The foreground service card. [vin]'s last 6 characters name the car; [text] is the link state. */
  fun serviceNotification(ctx: Context, vin: String, text: String): Notification {
    ensureChannels(ctx)
    return NotificationCompat.Builder(ctx, CHANNEL_SERVICE)
      .setSmallIcon(R.drawable.ic_stat_phone_key)
      .setContentTitle("Phone Key")
      .setContentText(text)
      .setSubText("…${vin.takeLast(6)}")
      .setOngoing(true)
      .setSilent(true)
      .setShowWhen(false)
      .setCategory(NotificationCompat.CATEGORY_SERVICE)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
      .setContentIntent(launchIntent(ctx))
      .build()
  }

  fun postBtOff(ctx: Context) =
    post(ctx, ID_BT_OFF, "Bluetooth Disabled", "Phone Key will not work until Bluetooth is enabled")

  fun clearBtOff(ctx: Context) = NotificationManagerCompat.from(ctx).cancel(ID_BT_OFF)

  /** No debounce, like iOS: a child-in-car warning SHOULD keep nagging; a repeat replaces + re-alerts. */
  fun postCpd(ctx: Context) = post(ctx, ID_CPD, "Child detected in car", "Return to your vehicle immediately.")

  fun canPost(ctx: Context): Boolean =
    Build.VERSION.SDK_INT < 33 ||
      ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

  private fun post(ctx: Context, id: Int, title: String, body: String) {
    if (!canPost(ctx)) return
    ensureChannels(ctx)
    val n = NotificationCompat.Builder(ctx, CHANNEL_ALERTS)
      .setSmallIcon(R.drawable.ic_stat_phone_key)
      .setContentTitle(title)
      .setContentText(body)
      .setStyle(NotificationCompat.BigTextStyle().bigText(body))
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .setCategory(NotificationCompat.CATEGORY_STATUS)
      .setAutoCancel(true)
      .setContentIntent(launchIntent(ctx))
      .build()
    runCatching { NotificationManagerCompat.from(ctx).notify(id, n) }
  }

  private fun launchIntent(ctx: Context): PendingIntent? {
    val intent = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName) ?: return null
    return PendingIntent.getActivity(ctx, 0, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
  }
}
```

- [ ] **Step 5: `BleGuards.kt` — add the optional notification permission**

```kotlin path=modules/expo-passive-entry/android/src/main/java/expo/modules/passiveentry/BleGuards.kt
package expo.modules.passiveentry

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat

/**
 * The runtime-permission gate for BLE. Mirrors src/ble/blePermissions.ts (node-tested) so the two
 * cannot drift.
 *
 * This exists as an explicit precondition because the failure it prevents is INVISIBLE: on Android
 * 12+, starting a scan without BLUETOOTH_SCAN neither throws nor warns — it returns zero results
 * forever, indistinguishable from "the car isn't nearby". Better a clear refusal in the log.
 */
object BleGuards {
  fun requiredPermissions(): List<String> =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      listOf(Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT)
    } else {
      listOf(Manifest.permission.ACCESS_FINE_LOCATION)
    }

  fun missingPermissions(context: Context): List<String> =
    requiredPermissions().filter { ContextCompat.checkSelfPermission(context, it) != PackageManager.PERMISSION_GRANTED }

  fun hasScanPermissions(context: Context): Boolean = missingPermissions(context).isEmpty()

  /** Asked once alongside the BLE grants, never REQUIRED: denying it only mutes the reminders. */
  fun optionalPermissions(context: Context): List<String> =
    if (Build.VERSION.SDK_INT >= 33 &&
      ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
    ) {
      listOf(Manifest.permission.POST_NOTIFICATIONS)
    } else {
      emptyList()
    }
}
```

- [ ] **Step 6: Compile**

Run: `cd android && ANDROID_HOME=$HOME/Library/Android/sdk JAVA_HOME=/Library/Java/JavaVirtualMachines/zulu-17.jdk/Contents/Home ./gradlew :expo-passive-entry:compileReleaseKotlin --max-workers=2 2>&1 | tail -6`
Expected: `BUILD SUCCESSFUL` (the old central still references `KeystoreKey`'s unchanged signatures, so it keeps compiling).

- [ ] **Step 7: Commit**

```bash
git add modules/expo-passive-entry/android
git commit -m "feat(android/ble): store, Keystore-wrapped device key, native log file, notifications

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: The autonomous responder (`VcsecResponder.kt`), JVM-tested through a fake link

**Files:**
- Create: `modules/expo-passive-entry/android/src/main/java/expo/modules/passiveentry/VcsecResponder.kt`
- Test: `modules/expo-passive-entry/android/src/test/java/expo/modules/passiveentry/VcsecResponderTest.kt`

**Interfaces:**
- Consumes `VcsecSigner`, `Proto`, `FrameReassembler`, `WarmSessionStore` (Tasks 1–3).
- Produces `class VcsecResponder(vin, store: WarmSessionStore, deviceKeyHex: () -> String?, writeFramed: (ByteArray) -> Unit, log: (String) -> Unit, onCpdWarning: (Int) -> Unit, nowSec: () -> Long = …, random: (Int) -> ByteArray = …) { val hasSession: Boolean; onLinkReady(); onLinkLost(); onNotification(bytes) }`. `writeFramed` receives an UNFRAMED payload; the central adds the 2-byte length prefix and chunks it.

- [ ] **Step 1: Write the failing test**

```kotlin path=modules/expo-passive-entry/android/src/test/java/expo/modules/passiveentry/VcsecResponderTest.kt
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
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd android && ANDROID_HOME=$HOME/Library/Android/sdk JAVA_HOME=/Library/Java/JavaVirtualMachines/zulu-17.jdk/Contents/Home ./gradlew :expo-passive-entry:testReleaseUnitTest --max-workers=2 2>&1 | tail -15`
Expected: `Unresolved reference: VcsecResponder`.

- [ ] **Step 3: Implement `VcsecResponder.kt`**

```kotlin path=modules/expo-passive-entry/android/src/main/java/expo/modules/passiveentry/VcsecResponder.kt
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
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd android && ANDROID_HOME=$HOME/Library/Android/sdk JAVA_HOME=/Library/Java/JavaVirtualMachines/zulu-17.jdk/Contents/Home ./gradlew :expo-passive-entry:testReleaseUnitTest --max-workers=2 2>&1 | tail -8`
Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 5: Commit**

```bash
git add modules/expo-passive-entry/android
git commit -m "feat(android/ble): VcsecResponder — autonomous background passive-entry responder (port of the Swift)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: `PassiveEntryCentral.kt` — the single-thread GATT state machine

**Files:**
- Modify (rewrite): `modules/expo-passive-entry/android/src/main/java/expo/modules/passiveentry/PassiveEntryCentral.kt`

**Interfaces:**
- Consumes `PassiveEntryStore`, `NativeLog`, `VehicleIdentity`, `VcsecResponder`, `BleGuards`.
- Produces `class PassiveEntryCentral(context, mode: Mode, store, logger, handler: Handler, visible: () -> Boolean, responderFactory: ((String) -> VcsecResponder)?) { enum Mode { PERSISTENT, EPHEMERAL }; enum State { IDLE, DISCOVERING, STANDING, CONNECTING, NEGOTIATING, READY }; class Snapshot(state, mtu, armed); var onFrame; var onLinkState: ((Boolean, Int) -> Unit)?; var onStateChanged: ((State) -> Unit)?; val snapshot; arm(vin); disarm(); setPipeMode(active); onVisibilityChanged(visible); onBluetoothOff(); onBluetoothOn(); reinit(reason); onExternalScanResult(result: ScanResult); writeRaw(bytes): Boolean; writeFramed(payload); connectionSnapshot(): Pair<String, Int>; backgroundScanFilters(): List<ScanFilter> }`.

The old file (probe pass, census windows, three overlapping reconnect paths) is replaced wholesale. It is Android-bound, so the check is the compile step plus the device smoke in Task 6; the logic that can be tested on the JVM already is (Tasks 1, 2, 4).

- [ ] **Step 1: Write the file**

```kotlin path=modules/expo-passive-entry/android/src/main/java/expo/modules/passiveentry/PassiveEntryCentral.kt
package expo.modules.passiveentry

import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.ParcelUuid
import android.os.PowerManager
import android.os.SystemClock

/**
 * The GATT central that holds the link to the car — the BLE half of ios/PassiveEntryCentral.swift,
 * rebuilt around what Android actually provides (spec §1):
 *
 *  - ONE thread. Every field below is touched only on [handler] (the runtime's HandlerThread). GATT
 *    callbacks are delivered there via the connectGatt(…, handler) overload; scan callbacks and the
 *    JS bridge are posted onto it.
 *  - STANDING CONNECT, no scan. Once the car's address is known, connectGatt(autoConnect = true) is
 *    Android's pending connect: no timeout, controller-driven, lands the moment the car is in range
 *    (the official app enables it on API ≥ 34). Discovery scans exist for the first sighting and as a
 *    bounded fallback while the app is visible; background discovery is the runtime's PendingIntent
 *    scan, which feeds onExternalScanResult.
 *  - INDICATIONS. 0213 is subscribed with ENABLE_INDICATION_VALUE when the characteristic offers it —
 *    what the official app and the vehicle-command SDK do; NOTIFY is the fallback.
 *  - Every connectGatt is paired with close(): Android has ~32 GATT client slots per device and a
 *    leaked client is a permanent "connectGatt returns null" until Bluetooth is toggled.
 *  - One write in flight; chunks are queued and pumped from onCharacteristicWrite.
 *
 * Two modes share the code: PERSISTENT (main process — remembers the address, reconnects forever,
 * self-signs whenever the app is not visible) and EPHEMERAL (the :share process — a direct connect
 * for one send, nothing persisted, no responder: the iOS BleBytePipe).
 */
@SuppressLint("MissingPermission") // arm() refuses to run without BLUETOOTH_SCAN/CONNECT (BleGuards)
class PassiveEntryCentral(
  private val context: Context,
  val mode: Mode,
  private val store: PassiveEntryStore,
  private val logger: NativeLog,
  private val handler: Handler,
  private val visible: () -> Boolean,
  private val responderFactory: ((String) -> VcsecResponder)?,
) {
  enum class Mode { PERSISTENT, EPHEMERAL }

  enum class State { IDLE, DISCOVERING, STANDING, CONNECTING, NEGOTIATING, READY }

  class Snapshot(val state: State, val mtu: Int, val armed: Boolean)

  /** Pipe mode: every raw 0213 notification goes to TS (foreground). Autonomous: the responder. */
  var onFrame: ((ByteArray) -> Unit)? = null

  /** Link up/down for the byte pipe: (connected, mtu). */
  var onLinkState: ((Boolean, Int) -> Unit)? = null

  /** Every state transition — the runtime drives the service card and background discovery off it. */
  var onStateChanged: ((State) -> Unit)? = null

  @Volatile var snapshot = Snapshot(State.IDLE, DEFAULT_MTU, false)
    private set

  // Single-writer gate. true = FOREGROUND: native is a dumb byte pipe, TS signs. false = BACKGROUND:
  // native self-signs. PERSISTENT defaults to autonomous (safe when no JS is listening); EPHEMERAL is
  // always a pipe.
  @Volatile private var pipeMode = mode == Mode.EPHEMERAL

  // ── handler-thread state ───────────────────────────────────────────────────
  private var armed = false
  private var vin = ""
  private var state = State.IDLE
  private var gatt: BluetoothGatt? = null
  private var txChar: BluetoothGattCharacteristic? = null
  private var rxChar: BluetoothGattCharacteristic? = null
  private var mtu = DEFAULT_MTU
  private var mtuSettled = false
  private var responder: VcsecResponder? = null
  private var scanCallback: ScanCallback? = null
  private val windowAdvertisers = HashSet<String>()
  private var windowOtherTesla: String? = null
  private var windowWeakSighting: String? = null
  private val scanStarts = ArrayDeque<Long>()
  private var standingSince = 0L
  private var consecutiveErrors = 0
  private var cccdAttempts = 0
  private var loggedNoPermission = false
  private val writeQueue = ArrayDeque<ByteArray>()
  private var writeInFlight = false
  private var bringupLock: PowerManager.WakeLock? = null

  private val adapter: BluetoothAdapter?
    get() = (context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter

  private val blockLength: Int get() = (mtu - 3).coerceAtLeast(20)

  private fun log(line: String) = logger.log(line)

  // Timers: one Runnable each so they can be cancelled individually.
  private val scanWindowEnd = Runnable { endDiscoveryWindow() }
  private val scanRestart = Runnable { if (armed && state == State.DISCOVERING && visible()) beginDiscovery("window restart") }
  private val connectTimeout = Runnable { onConnectTimeout() }
  private val mtuTimeout = Runnable {
    if (state == State.NEGOTIATING && !mtuSettled) {
      log("MTU: no onMtuChanged within ${MTU_TIMEOUT_MS}ms — continuing at $mtu")
      onMtuSettled()
    }
  }
  private val discoveryTimeout = Runnable { if (state == State.NEGOTIATING) failBringup("service discovery timed out") }
  private val standingFallback = Runnable {
    if (armed && state == State.STANDING && visible()) beginDiscovery("standing connect has not landed")
  }
  private val reconnect = Runnable { reestablish("reconnect") }

  // ── public surface (any thread) ────────────────────────────────────────────

  fun arm(vin: String) = post { armLocked(vin) }

  fun disarm() = post { disarmLocked() }

  fun setPipeMode(active: Boolean) = post {
    if (pipeMode == active) return@post
    pipeMode = active
    log("foregroundResponderActive=$active")
    // Flipping to autonomous while connected: native needs its OWN session (TS's isn't shared).
    if (!active && state == State.READY) responder?.onLinkReady()
  }

  fun onVisibilityChanged(isVisible: Boolean) = post {
    if (!armed) return@post
    if (isVisible) {
      if (state == State.DISCOVERING && scanCallback == null) beginDiscovery("app visible")
      if (state == State.STANDING) {
        handler.removeCallbacks(standingFallback)
        handler.postDelayed(standingFallback, STANDING_FALLBACK_MS)
      }
    } else if (mode == Mode.PERSISTENT && state == State.DISCOVERING && scanCallback != null) {
      stopScan()
      log("app hidden — callback scan stopped; background discovery takes over")
    }
  }

  fun onBluetoothOff() = post {
    log("Bluetooth OFF — dropping the link")
    val wasReady = state == State.READY
    stopScan()
    handler.removeCallbacks(reconnect)
    teardownGatt(closeOnly = state == State.STANDING)
    responder?.onLinkLost()
    setState(State.IDLE)
    if (wasReady) onLinkState?.invoke(false, DEFAULT_MTU)
  }

  fun onBluetoothOn() = post { if (armed) reestablish("bluetooth on") }

  /** Periodic watchdog (4 h): a standing connect that never landed gets recreated (official app's REINITIALIZE_CONNECTION). */
  fun reinit(reason: String) = post {
    if (state != State.STANDING) return@post
    log("reinit ($reason): recreating the standing connect")
    teardownGatt(closeOnly = true)
    setState(State.IDLE)
    reestablish(reason)
  }

  /** A result from the runtime's PendingIntent scan (background discovery). */
  fun onExternalScanResult(result: ScanResult) = post { if (armed) handleScanResult(result, external = true) }

  /** Raw write to 0212 for the TS byte pipe: already framed by TS, split here to the negotiated size. */
  fun writeRaw(bytes: ByteArray): Boolean {
    if (snapshot.state != State.READY) {
      log("writeRaw: no connected tx")
      return false
    }
    post { enqueue(bytes) }
    return true
  }

  /** For the autonomous responder: add the 2-byte big-endian length prefix, then queue. */
  fun writeFramed(payload: ByteArray) {
    val framed = byteArrayOf(((payload.size shr 8) and 0xff).toByte(), (payload.size and 0xff).toByte()) + payload
    post { enqueue(framed) }
  }

  /** (state, mtu) for TS — mirrors connectionSnapshot() in the Swift. */
  fun connectionSnapshot(): Pair<String, Int> {
    val s = snapshot
    val ad = adapter
    val name = when {
      s.state == State.READY -> "connected"
      ad == null -> "unsupported"
      !ad.isEnabled -> "poweredOff"
      !BleGuards.hasScanPermissions(context) -> "unauthorized"
      else -> "disconnected"
    }
    return name to s.mtu
  }

  /** The filters the runtime's PendingIntent scan uses — identical to the foreground ones. */
  fun backgroundScanFilters(): List<ScanFilter> = buildFilters(store.vin ?: vin)

  // ── arm / disarm / reestablish ─────────────────────────────────────────────

  private fun armLocked(vin: String) {
    if (armed && this.vin == vin) {
      if (state == State.IDLE) reestablish("re-arm") // IDLE while armed = Bluetooth was off, or an ephemeral miss
      return
    }
    if (armed) disarmLocked()
    this.vin = vin
    armed = true
    consecutiveErrors = 0
    responder = responderFactory?.invoke(vin)
    log("arm vin=…${vin.takeLast(6)} name=${VehicleIdentity.localName(vin)} mode=$mode")
    reestablish("arm")
  }

  private fun disarmLocked() {
    if (!armed) return
    armed = false
    log("stop")
    stopScan()
    handler.removeCallbacks(reconnect)
    val wasReady = state == State.READY
    teardownGatt(closeOnly = state == State.STANDING)
    responder = null
    vin = ""
    setState(State.IDLE)
    if (wasReady) onLinkState?.invoke(false, DEFAULT_MTU)
  }

  /**
   * Get the link back UP. A remembered address means a STANDING connect (no scan) — measured on iOS
   * 2026-07-25, re-scanning after every disconnect left the link down 72% of the time. Scanning is
   * for the first sighting only, and only while the app is visible; in the background the runtime's
   * PendingIntent scan does the looking.
   */
  private fun reestablish(reason: String) {
    if (!armed) return
    if (state == State.CONNECTING || state == State.NEGOTIATING || state == State.READY) return
    handler.removeCallbacks(reconnect)
    val ad = adapter
    if (ad == null) {
      setState(State.IDLE)
      return
    }
    if (!ad.isEnabled) {
      if (state != State.IDLE) log("reestablish($reason): Bluetooth is off — waiting")
      setState(State.IDLE)
      return
    }
    if (!BleGuards.hasScanPermissions(context)) {
      if (!loggedNoPermission) {
        loggedNoPermission = true
        log("MISSING BLE runtime permissions — a scan would return zero results silently; waiting for the grant")
      }
      setState(State.IDLE)
      return
    }
    loggedNoPermission = false
    val mac = store.rememberedMac(vin)
    if (mode == Mode.EPHEMERAL) {
      // One send: dial the remembered address right away AND look for the car for 3 s, first wins.
      if (mac != null) directConnect(ad.getRemoteDevice(mac), "remembered address")
      beginDiscovery("ephemeral")
      return
    }
    if (mac != null) {
      standingConnect(ad.getRemoteDevice(mac))
      return
    }
    if (visible()) {
      beginDiscovery(reason)
    } else if (state != State.DISCOVERING) {
      log("no remembered address and app not visible — background discovery only")
      setState(State.DISCOVERING)
    }
  }

  // ── discovery scans (bounded) ──────────────────────────────────────────────

  private fun buildFilters(forVin: String): List<ScanFilter> {
    val filters = mutableListOf(
      // The car's PRIMARY packet: an Apple iBeacon with Tesla's fixed UUID. The one identifier Android
      // receives reliably (the name and 1122 ride in the scan response).
      ScanFilter.Builder()
        .setManufacturerData(VehicleIdentity.APPLE_COMPANY_ID, VehicleIdentity.BEACON_FILTER_DATA, VehicleIdentity.BEACON_FILTER_MASK)
        .build(),
      ScanFilter.Builder().setServiceUuid(ParcelUuid(VehicleIdentity.ADVERTISED_SERVICE)).build(),
      ScanFilter.Builder().setDeviceName(VehicleIdentity.localName(forVin)).build(),
    )
    store.rememberedMac(forVin)?.let { mac ->
      runCatching { ScanFilter.Builder().setDeviceAddress(mac).build() }.getOrNull()?.let(filters::add)
    }
    return filters
  }

  private fun beginDiscovery(reason: String) {
    if (!armed) return
    if (scanCallback != null) return
    val ad = adapter ?: return
    val scanner = ad.bluetoothLeScanner ?: run { log("no BLE scanner"); return }
    // Android blocks an app that starts more than 5 scans in 30 s (SCAN_FAILED_SCANNING_TOO_FREQUENTLY).
    val now = SystemClock.elapsedRealtime()
    while (scanStarts.isNotEmpty() && now - scanStarts.first() > 30_000L) scanStarts.removeFirst()
    if (scanStarts.size >= 4) {
      val wait = 30_000L - (now - scanStarts.first()) + 500L
      log("scan rate limit — next window in ${wait}ms")
      handler.removeCallbacks(scanRestart)
      handler.postDelayed(scanRestart, wait)
      if (state == State.IDLE) setState(State.DISCOVERING)
      return
    }
    scanStarts.addLast(now)
    val lowLatency = visible() || mode == Mode.EPHEMERAL
    val settings = ScanSettings.Builder()
      .setScanMode(if (lowLatency) ScanSettings.SCAN_MODE_LOW_LATENCY else ScanSettings.SCAN_MODE_LOW_POWER)
      .build()
    val filters = buildFilters(vin)
    val cb = object : ScanCallback() {
      override fun onScanResult(callbackType: Int, result: ScanResult) {
        post { if (scanCallback === this) handleScanResult(result, external = false) }
      }

      override fun onBatchScanResults(results: MutableList<ScanResult>) {
        post { if (scanCallback === this) results.forEach { handleScanResult(it, external = false) } }
      }

      override fun onScanFailed(errorCode: Int) {
        post { if (scanCallback === this) onScanFailed(errorCode) }
      }
    }
    windowAdvertisers.clear()
    windowOtherTesla = null
    windowWeakSighting = null
    try {
      scanner.startScan(filters, settings, cb)
    } catch (e: Exception) {
      log("startScan threw: ${e.message}")
      return
    }
    scanCallback = cb
    val windowMs = when {
      mode == Mode.EPHEMERAL && store.rememberedMac(vin) != null -> 3_000L
      mode == Mode.EPHEMERAL -> 10_000L
      else -> SCAN_WINDOW_MS
    }
    log("scanning ($reason): beacon|1122|name${if (filters.size == 4) "|address" else ""}, ${windowMs}ms window, ${if (lowLatency) "low-latency" else "low-power"}")
    handler.removeCallbacks(scanWindowEnd)
    handler.postDelayed(scanWindowEnd, windowMs)
    if (state == State.IDLE) setState(State.DISCOVERING)
  }

  private fun stopScan() {
    scanCallback?.let { cb -> runCatching { adapter?.bluetoothLeScanner?.stopScan(cb) } }
    scanCallback = null
    handler.removeCallbacks(scanWindowEnd)
    handler.removeCallbacks(scanRestart)
  }

  private fun endDiscoveryWindow() {
    if (scanCallback == null) return
    stopScan()
    val extra = buildString {
      windowOtherTesla?.let { append(" (another Tesla's beacon: $it)") }
      windowWeakSighting?.let { append(" (car heard but too weak: $it)") }
    }
    log("scan window ended — ${windowAdvertisers.size} advertiser(s), no car$extra")
    if (!armed) return
    when (mode) {
      Mode.EPHEMERAL -> if (state == State.DISCOVERING) {
        setState(State.IDLE)
        log("ephemeral: car not found")
      }
      Mode.PERSISTENT -> if (state == State.DISCOVERING && visible()) handler.postDelayed(scanRestart, SCAN_PAUSE_MS)
    }
  }

  private fun onScanFailed(code: Int) {
    scanCallback = null
    handler.removeCallbacks(scanWindowEnd)
    val why = when (code) {
      1 -> "ALREADY_STARTED"
      2 -> "APPLICATION_REGISTRATION_FAILED"
      3 -> "INTERNAL_ERROR"
      4 -> "FEATURE_UNSUPPORTED"
      5 -> "OUT_OF_HARDWARE_RESOURCES"
      6 -> "SCANNING_TOO_FREQUENTLY"
      else -> "unknown"
    }
    log("scan FAILED code=$code ($why)")
    if (armed && state == State.DISCOVERING && visible()) handler.postDelayed(scanRestart, 30_000L)
  }

  private fun handleScanResult(result: ScanResult, external: Boolean) {
    if (!armed) return
    val record = result.scanRecord
    val addr = result.device.address
    val apple = record?.getManufacturerSpecificData(VehicleIdentity.APPLE_COMPANY_ID)
    val uuids = record?.serviceUuids?.map { it.uuid } ?: emptyList()
    val name = record?.deviceName
    val match = VehicleIdentity.classify(apple, uuids, name, vin)
    if (match == VehicleIdentity.Match.NONE) {
      windowAdvertisers.add(addr)
      if (windowOtherTesla == null) {
        VehicleIdentity.teslaBeacon(apple)?.let { b ->
          windowOtherTesla = "minor=${b.minor} want=${VehicleIdentity.expectedBeaconMinor(vin)} rssi=${result.rssi}"
        }
      }
      return
    }
    // Official-app rule for a BACKGROUND sighting: do not dial a car at the edge of range.
    if (!visible() && result.rssi <= BACKGROUND_RSSI_GATE) {
      if (windowWeakSighting == null) windowWeakSighting = "$match rssi=${result.rssi}"
      return
    }
    sighted(result.device, result.rssi, match, external)
  }

  private fun sighted(device: BluetoothDevice, rssi: Int, match: VehicleIdentity.Match, external: Boolean) {
    val addr = device.address
    when (state) {
      State.NEGOTIATING, State.READY -> return
      State.CONNECTING -> {
        if (gatt?.device?.address == addr) return
        log("car sighted at $addr while connecting to ${gatt?.device?.address} — switching")
        teardownGatt(closeOnly = true)
      }
      State.STANDING -> {
        val standingFor = SystemClock.elapsedRealtime() - standingSince
        if (gatt?.device?.address == addr) {
          if (standingFor < STANDING_SIGHTING_GRACE_MS) return
          log("standing connect has not landed after ${standingFor}ms — direct connect instead")
        } else {
          log("car sighted at $addr but the remembered address is ${gatt?.device?.address} — replacing it")
          if (mode == Mode.PERSISTENT) store.rememberMac(vin, null)
        }
        teardownGatt(closeOnly = true)
      }
      State.DISCOVERING, State.IDLE -> {}
    }
    log("$match MATCH — rssi=$rssi $addr${if (external) " (background scan)" else ""} → connecting")
    stopScan()
    directConnect(device, match.name)
  }

  // ── connecting ─────────────────────────────────────────────────────────────

  private fun connectGatt(device: BluetoothDevice, autoConnect: Boolean): BluetoothGatt? =
    device.connectGatt(context, autoConnect, gattCallback, BluetoothDevice.TRANSPORT_LE, BluetoothDevice.PHY_LE_1M_MASK, handler)

  /** We have just SEEN the car: a direct connect is immediate. */
  private fun directConnect(device: BluetoothDevice, why: String) {
    teardownGatt(closeOnly = state == State.STANDING)
    setState(State.CONNECTING)
    log("connecting ${device.address} ($why)")
    val g = connectGatt(device, autoConnect = false)
    if (g == null) {
      log("connectGatt returned null — no GATT client slot; retrying later")
      consecutiveErrors += 1
      setState(State.IDLE)
      scheduleReconnect(DELAY_AFTER_ERROR)
      return
    }
    gatt = g
    handler.removeCallbacks(connectTimeout)
    handler.postDelayed(connectTimeout, CONNECT_TIMEOUT_MS)
  }

  /** The car may not be in range: autoConnect = true is Android's pending connect (no timeout, controller-driven). */
  private fun standingConnect(device: BluetoothDevice) {
    teardownGatt(closeOnly = true)
    setState(State.STANDING)
    standingSince = SystemClock.elapsedRealtime()
    val g = connectGatt(device, autoConnect = true)
    if (g == null) {
      log("standing connectGatt returned null — retrying later")
      setState(State.IDLE)
      scheduleReconnect(DELAY_AFTER_ERROR)
      return
    }
    gatt = g
    log("pending connect (standing, no scan) → ${device.address}")
    handler.removeCallbacks(standingFallback)
    if (visible()) handler.postDelayed(standingFallback, STANDING_FALLBACK_MS)
  }

  private fun onConnectTimeout() {
    if (state != State.CONNECTING) return
    log("connect timed out after ${CONNECT_TIMEOUT_MS}ms")
    consecutiveErrors += 1
    teardownGatt(closeOnly = true)
    setState(State.IDLE)
    if (mode == Mode.EPHEMERAL) return
    scheduleReconnect(DELAY_AFTER_ERROR)
  }

  private fun scheduleReconnect(delayMs: Long) {
    if (!armed || mode == Mode.EPHEMERAL) return
    handler.removeCallbacks(reconnect)
    // Hold the CPU through the delay (official app: tesla:ble-peripheral-reconnect, delay + 1 s).
    runCatching {
      (context.getSystemService(Context.POWER_SERVICE) as? PowerManager)
        ?.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "airgapp:ble-reconnect")
        ?.acquire(delayMs + 1_000L)
    }
    handler.postDelayed(reconnect, delayMs)
  }

  private fun delayFor(status: Int): Long = when (status) {
    0, 8, 34 -> DELAY_AFTER_NORMAL_DISCONNECT
    else -> DELAY_AFTER_ERROR
  }

  private fun statusName(status: Int): String = when (status) {
    0 -> "success"
    8 -> "connection timeout"
    19 -> "remote terminated"
    22 -> "local host terminated"
    34 -> "LMP response timeout"
    62 -> "failed to establish"
    133 -> "GATT_ERROR"
    else -> "0x%02x".format(status)
  }

  // ── GATT callbacks (delivered on the handler thread) ───────────────────────

  private val gattCallback = object : BluetoothGattCallback() {
    override fun onConnectionStateChange(g: BluetoothGatt, status: Int, newState: Int) = post {
      if (g !== gatt) { runCatching { g.close() }; return@post }
      when {
        newState == BluetoothProfile.STATE_CONNECTED && status == BluetoothGatt.GATT_SUCCESS -> onConnected()
        newState == BluetoothProfile.STATE_DISCONNECTED -> onDisconnected(status)
        newState == BluetoothProfile.STATE_CONNECTED -> onDisconnected(status) // connected-with-error: treat as a drop
        else -> log("connection state=$newState status=$status")
      }
    }

    override fun onMtuChanged(g: BluetoothGatt, newMtu: Int, status: Int) = post {
      if (g !== gatt) return@post
      if (status == BluetoothGatt.GATT_SUCCESS) mtu = newMtu
      log("MTU=$mtu (blockLength=$blockLength)${if (status != 0) " status=$status" else ""}")
      if (state == State.NEGOTIATING && !mtuSettled) onMtuSettled()
    }

    override fun onServicesDiscovered(g: BluetoothGatt, status: Int) = post {
      if (g !== gatt || state != State.NEGOTIATING) return@post
      handler.removeCallbacks(discoveryTimeout)
      if (status != BluetoothGatt.GATT_SUCCESS) { failBringup("service discovery status=$status"); return@post }
      val svc = g.getService(VehicleIdentity.VCSEC_SERVICE)
      if (svc == null) {
        if (mode == Mode.PERSISTENT) store.rememberMac(vin, null)
        failBringup("no VCSEC service on ${g.device.address} — not the car; address forgotten")
        return@post
      }
      txChar = svc.getCharacteristic(VehicleIdentity.TX_CHAR)
      rxChar = svc.getCharacteristic(VehicleIdentity.RX_CHAR)
      if (txChar == null || rxChar == null) { failBringup("missing tx/rx characteristic"); return@post }
      cccdAttempts = 0
      subscribe()
    }

    override fun onDescriptorWrite(g: BluetoothGatt, d: BluetoothGattDescriptor, status: Int) = post {
      if (g !== gatt || d.uuid != VehicleIdentity.CCCD || state != State.NEGOTIATING) return@post
      if (status != BluetoothGatt.GATT_SUCCESS) {
        cccdAttempts += 1
        if (cccdAttempts < 3) {
          log("CCCD write status=$status — retrying (${cccdAttempts}/3)")
          handler.postDelayed({ if (state == State.NEGOTIATING) subscribe() }, 1_000L)
        } else {
          failBringup("CCCD write failed status=$status")
        }
        return@post
      }
      becomeReady()
    }

    @Deprecated("pre-33 callback")
    override fun onCharacteristicChanged(g: BluetoothGatt, ch: BluetoothGattCharacteristic) {
      if (Build.VERSION.SDK_INT >= 33) return // the 3-arg overload is delivered instead
      @Suppress("DEPRECATION") val value = ch.value ?: return
      post { if (g === gatt && ch.uuid == VehicleIdentity.RX_CHAR) deliver(value) }
    }

    override fun onCharacteristicChanged(g: BluetoothGatt, ch: BluetoothGattCharacteristic, value: ByteArray) {
      post { if (g === gatt && ch.uuid == VehicleIdentity.RX_CHAR) deliver(value) }
    }

    override fun onCharacteristicWrite(g: BluetoothGatt, ch: BluetoothGattCharacteristic, status: Int) = post {
      if (g !== gatt || ch.uuid != VehicleIdentity.TX_CHAR) return@post
      writeInFlight = false
      if (status != BluetoothGatt.GATT_SUCCESS) {
        log("write chunk FAILED status=$status — dropping ${writeQueue.size} queued chunk(s)")
        writeQueue.clear()
        return@post
      }
      pump()
    }
  }

  private fun onConnected() {
    val g = gatt ?: return
    handler.removeCallbacks(connectTimeout)
    handler.removeCallbacks(standingFallback)
    stopScan()
    log("CONNECTED ${g.device.address} — requesting MTU $REQUESTED_MTU")
    // Remember it so every future re-establish is a standing connect (iOS stores the peripheral UUID here).
    if (mode == Mode.PERSISTENT) store.rememberMac(vin, g.device.address)
    acquireBringupLock()
    mtuSettled = false
    setState(State.NEGOTIATING)
    if (!g.requestMtu(REQUESTED_MTU)) {
      log("requestMtu refused — continuing at $mtu")
      onMtuSettled()
    } else {
      handler.removeCallbacks(mtuTimeout)
      handler.postDelayed(mtuTimeout, MTU_TIMEOUT_MS)
    }
  }

  private fun onMtuSettled() {
    mtuSettled = true
    handler.removeCallbacks(mtuTimeout)
    val g = gatt ?: return
    if (g.discoverServices()) {
      handler.removeCallbacks(discoveryTimeout)
      handler.postDelayed(discoveryTimeout, DISCOVERY_TIMEOUT_MS)
    } else {
      failBringup("discoverServices refused")
    }
  }

  /** INDICATE when the characteristic offers it (official app + vehicle-command), else NOTIFY. */
  private fun subscribe() {
    val g = gatt ?: return
    val rx = rxChar ?: return
    val useIndicate = rx.properties and BluetoothGattCharacteristic.PROPERTY_INDICATE != 0
    val cccd = rx.getDescriptor(VehicleIdentity.CCCD)
    if (cccd == null) { failBringup("rx has no CCCD 0x2902"); return }
    log("chars ok — subscribing (${if (useIndicate) "indicate" else "notify"}, props=0x%02x)".format(rx.properties))
    g.setCharacteristicNotification(rx, true)
    val value = if (useIndicate) BluetoothGattDescriptor.ENABLE_INDICATION_VALUE else BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
    val ok = if (Build.VERSION.SDK_INT >= 33) {
      g.writeDescriptor(cccd, value) == BluetoothGatt.GATT_SUCCESS
    } else {
      @Suppress("DEPRECATION")
      run { cccd.value = value; g.writeDescriptor(cccd) }
    }
    if (!ok) {
      cccdAttempts += 1
      if (cccdAttempts < 3) handler.postDelayed({ if (state == State.NEGOTIATING) subscribe() }, 1_000L)
      else failBringup("writeDescriptor refused")
    }
  }

  private fun becomeReady() {
    releaseBringupLock()
    consecutiveErrors = 0
    setState(State.READY)
    log("notifications enabled — link up (mtu=$mtu, ${if (pipeMode) "pipe" else "autonomous"})")
    onLinkState?.invoke(true, mtu)
    if (!pipeMode) responder?.onLinkReady()
  }

  private fun failBringup(why: String) {
    log("bring-up FAILED: $why")
    consecutiveErrors += 1
    teardownGatt(closeOnly = false)
    setState(State.IDLE)
    if (mode == Mode.EPHEMERAL) return
    scheduleReconnect(DELAY_AFTER_ERROR)
  }

  private fun onDisconnected(status: Int) {
    val wasReady = state == State.READY
    log("DISCONNECTED status=$status (${statusName(status)})")
    if (status != 0 && status != 8 && status != 34) consecutiveErrors += 1
    teardownGatt(closeOnly = false)
    responder?.onLinkLost()
    setState(State.IDLE)
    if (wasReady) onLinkState?.invoke(false, DEFAULT_MTU)
    if (!armed || mode == Mode.EPHEMERAL) return
    val delay = if (consecutiveErrors >= 5) {
      log("5 consecutive GATT errors — Bluetooth may need a toggle; pausing ${ERROR_STORM_PAUSE_MS}ms")
      consecutiveErrors = 0
      ERROR_STORM_PAUSE_MS
    } else {
      delayFor(status)
    }
    log("→ reconnect in ${delay}ms")
    scheduleReconnect(delay)
  }

  /** Close the GATT client (always) and reset link state. [closeOnly] skips disconnect() for a never-connected client. */
  private fun teardownGatt(closeOnly: Boolean) {
    handler.removeCallbacks(connectTimeout)
    handler.removeCallbacks(mtuTimeout)
    handler.removeCallbacks(discoveryTimeout)
    handler.removeCallbacks(standingFallback)
    val g = gatt
    gatt = null
    txChar = null
    rxChar = null
    writeQueue.clear()
    writeInFlight = false
    mtu = DEFAULT_MTU
    mtuSettled = false
    if (g != null) {
      if (!closeOnly) runCatching { g.disconnect() }
      runCatching { g.close() }
    }
    releaseBringupLock()
  }

  // ── writes: one GATT operation in flight ───────────────────────────────────

  private fun enqueue(bytes: ByteArray) {
    if (state != State.READY) {
      log("write dropped — link not ready (${bytes.size}B)")
      return
    }
    var off = 0
    while (off < bytes.size) {
      val end = minOf(off + blockLength, bytes.size)
      writeQueue.addLast(bytes.copyOfRange(off, end))
      off = end
    }
    pump()
  }

  private fun pump() {
    if (writeInFlight) return
    val g = gatt ?: return
    val tx = txChar ?: return
    val chunk = writeQueue.removeFirstOrNull() ?: return
    writeInFlight = true
    val ok = if (Build.VERSION.SDK_INT >= 33) {
      g.writeCharacteristic(tx, chunk, BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT) == BluetoothGatt.GATT_SUCCESS
    } else {
      @Suppress("DEPRECATION")
      run {
        tx.writeType = BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
        tx.value = chunk
        g.writeCharacteristic(tx)
      }
    }
    if (!ok) {
      log("writeCharacteristic refused — dropping ${writeQueue.size + 1} chunk(s)")
      writeInFlight = false
      writeQueue.clear()
    }
  }

  private fun deliver(bytes: ByteArray) {
    if (pipeMode) onFrame?.invoke(bytes) else responder?.onNotification(bytes)
  }

  // ── plumbing ───────────────────────────────────────────────────────────────

  private fun setState(s: State) {
    val changed = s != state
    state = s
    snapshot = Snapshot(s, mtu, armed)
    if (changed) onStateChanged?.invoke(s)
  }

  private fun acquireBringupLock() {
    releaseBringupLock()
    bringupLock = runCatching {
      (context.getSystemService(Context.POWER_SERVICE) as? PowerManager)
        ?.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "airgapp:ble-bringup")
        ?.also { it.acquire(BRINGUP_LOCK_MS) }
    }.getOrNull()
  }

  private fun releaseBringupLock() {
    bringupLock?.let { if (it.isHeld) runCatching { it.release() } }
    bringupLock = null
  }

  private inline fun post(crossinline block: () -> Unit) {
    if (Looper.myLooper() === handler.looper) block() else handler.post { block() }
  }

  private companion object {
    const val DEFAULT_MTU = 23
    const val REQUESTED_MTU = 517
    const val SCAN_WINDOW_MS = 20_000L
    const val SCAN_PAUSE_MS = 5_000L
    const val CONNECT_TIMEOUT_MS = 10_000L
    const val MTU_TIMEOUT_MS = 5_000L
    const val DISCOVERY_TIMEOUT_MS = 10_000L
    const val STANDING_FALLBACK_MS = 30_000L
    const val STANDING_SIGHTING_GRACE_MS = 10_000L
    const val BACKGROUND_RSSI_GATE = -95
    const val DELAY_AFTER_NORMAL_DISCONNECT = 500L
    const val DELAY_AFTER_ERROR = 2_000L
    const val ERROR_STORM_PAUSE_MS = 15_000L
    const val BRINGUP_LOCK_MS = 15_000L
  }
}
```

- [ ] **Step 2: Compile**

The old `PassiveEntryModule.kt` still calls `central.start(vin)`, `central.stop()`, `isRunning`, `onLog`, `setForegroundResponderActive` — it is rewritten in Task 6, so this step compiles the central alone:

Run: `cd android && ANDROID_HOME=$HOME/Library/Android/sdk JAVA_HOME=/Library/Java/JavaVirtualMachines/zulu-17.jdk/Contents/Home ./gradlew :expo-passive-entry:compileReleaseKotlin --max-workers=2 2>&1 | grep -E "^e:|BUILD" | grep -v PassiveEntryModule.kt | head`
Expected: no `e:` lines except those in `PassiveEntryModule.kt` (fixed next task).

- [ ] **Step 3: Commit together with Task 6** (the module cannot compile in between).

---

### Task 6: Runtime, application hook, foreground service, receivers, module, manifest — then the device smoke

**Files:**
- Create: `.../passiveentry/PassiveEntryRuntime.kt`
- Create: `.../passiveentry/PassiveEntryApp.kt`
- Create: `.../passiveentry/PassiveEntryPackage.kt`
- Create: `.../passiveentry/PassiveEntryService.kt`
- Create: `.../passiveentry/PassiveEntryReceiver.kt`
- Modify (rewrite): `.../passiveentry/PassiveEntryModule.kt`
- Modify (rewrite): `modules/expo-passive-entry/android/src/main/AndroidManifest.xml`

**Interfaces:**
- Consumes everything from Tasks 1–5.
- Produces `object PassiveEntryRuntime { ensure(context): Instance; peek(): Instance? }` and `class Instance { mode, store, log, central, handContext; start(vin); stop(); setForegroundResponderActive(active); startIfConfigured(reason); onServiceRunning(vin); onServiceStopped(); onBluetoothState(on); onPendingScanResults(results); onScanRestartAlarm(); onReinitAlarm(); onBtOffRepeatAlarm(); onActivityStarted(); onActivityStopped(); var onConnectionState: ((String, Int) -> Unit)? }`.
- Produces `PassiveEntryReceiver.ACTION_SCAN_RESULTS / ACTION_SCAN_RESTART / ACTION_REINIT / ACTION_BT_OFF_REPEAT` and `PassiveEntryReceiver.pending(ctx, action, mutable): PendingIntent`.

- [ ] **Step 1: `PassiveEntryRuntime.kt`**

```kotlin path=modules/expo-passive-entry/android/src/main/java/expo/modules/passiveentry/PassiveEntryRuntime.kt
package expo.modules.passiveentry

import android.app.ActivityManager
import android.app.AlarmManager
import android.app.Application
import android.app.PendingIntent
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.Process
import android.os.SystemClock
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat

/**
 * The process-wide owner of passive entry — the `PassiveEntryCentral.shared` of the Swift, plus the
 * pieces iOS gets from the OS for free: the foreground service, the boot/alarm/scan receivers, and
 * the "is the app really visible?" truth that gates the single-writer rule.
 *
 * Exactly one Instance per process. The main process runs PERSISTENT; the `:share` process (the
 * share sheet, see ShareActivity) runs EPHEMERAL and never touches the service or the store's VIN.
 */
object PassiveEntryRuntime {
  @Volatile private var instance: Instance? = null

  fun ensure(context: Context): Instance =
    instance ?: synchronized(this) { instance ?: Instance(context.applicationContext).also { instance = it } }

  fun peek(): Instance? = instance

  class Instance(val app: Context) {
    val mode: PassiveEntryCentral.Mode =
      if (currentProcessName(app).endsWith(":share")) PassiveEntryCentral.Mode.EPHEMERAL else PassiveEntryCentral.Mode.PERSISTENT
    val store = PassiveEntryStore(app)
    val log = NativeLog(app)
    private val thread = HandlerThread("PassiveEntry", Process.THREAD_PRIORITY_DEFAULT).apply { start() }
    val handler = Handler(thread.looper)

    @Volatile var visibleActivities = 0
      private set

    @Volatile var serviceRunning = false
      private set

    /** Module sink for the `connectionState` event. */
    @Volatile var onConnectionState: ((String, Int) -> Unit)? = null

    val central: PassiveEntryCentral = PassiveEntryCentral(
      context = app,
      mode = mode,
      store = store,
      logger = log,
      handler = handler,
      visible = { visibleActivities > 0 },
      responderFactory = if (mode == PassiveEntryCentral.Mode.PERSISTENT) { vin ->
        VcsecResponder(
          vin = vin,
          store = store,
          deviceKeyHex = { KeystoreKey.getKeyHex(app) },
          writeFramed = { central.writeFramed(it) },
          log = log::log,
          onCpdWarning = { Notifier.postCpd(app) },
        )
      } else null,
    )

    private var backgroundScanArmedAt = 0L

    init {
      central.onLinkState = { _, _ -> val (s, m) = central.connectionSnapshot(); onConnectionState?.invoke(s, m) }
      central.onStateChanged = { s -> handler.post { onCentralState(s) } }
    }

    // ── activity visibility (PassiveEntryApp) — the Android UIApplication.applicationState ──

    fun onActivityStarted() {
      visibleActivities += 1
      if (visibleActivities == 1) {
        central.onVisibilityChanged(true)
        if (mode == PassiveEntryCentral.Mode.PERSISTENT) disarmBackgroundDiscovery()
      }
    }

    fun onActivityStopped() {
      visibleActivities = maxOf(0, visibleActivities - 1)
      if (visibleActivities == 0 && mode == PassiveEntryCentral.Mode.PERSISTENT) {
        // The app is no longer visible: JS is about to stop listening (AppState → background). Flip
        // to autonomous natively as well, so the gate never depends on RN's timing.
        central.setPipeMode(false)
        central.onVisibilityChanged(false)
        handler.post { maybeArmBackgroundDiscovery() }
      }
    }

    // ── JS surface ─────────────────────────────────────────────────────────────

    fun start(vin: String) {
      when (mode) {
        PassiveEntryCentral.Mode.EPHEMERAL -> central.arm(vin)
        PassiveEntryCentral.Mode.PERSISTENT -> {
          store.vin = vin
          central.arm(vin)
          startService("start")
        }
      }
    }

    fun stop() {
      when (mode) {
        PassiveEntryCentral.Mode.EPHEMERAL -> central.disarm()
        PassiveEntryCentral.Mode.PERSISTENT -> {
          store.vin = null
          central.disarm()
          disarmBackgroundDiscovery()
          cancelAlarm(PassiveEntryReceiver.ACTION_REINIT)
          cancelAlarm(PassiveEntryReceiver.ACTION_BT_OFF_REPEAT)
          Notifier.clearBtOff(app)
          app.stopService(Intent(app, PassiveEntryService::class.java))
        }
      }
    }

    /** The single-writer gate. Only a genuinely visible app may claim the pipe (iOS: only `.active`). */
    fun setForegroundResponderActive(active: Boolean) {
      if (mode == PassiveEntryCentral.Mode.EPHEMERAL) return
      if (active && visibleActivities == 0) {
        log.log("foreground claim REFUSED (no activity visible) — staying autonomous")
        return
      }
      central.setPipeMode(active)
    }

    // ── service / receiver surface ─────────────────────────────────────────────

    /** Resume from persistence with no JS: boot, package update, a background sighting. */
    fun startIfConfigured(reason: String) {
      if (mode != PassiveEntryCentral.Mode.PERSISTENT) return
      val vin = store.vin
      if (vin == null) {
        log.log("startIfConfigured($reason): no armed vin — idle")
        return
      }
      if (!BleGuards.hasScanPermissions(app)) {
        log.log("startIfConfigured($reason): BLE permissions missing — idle until the app is opened")
        return
      }
      log.log("startIfConfigured($reason): armed for vin=…${vin.takeLast(6)}")
      central.arm(vin)
      startService(reason)
    }

    private fun startService(reason: String) {
      if (serviceRunning) return
      try {
        ContextCompat.startForegroundService(
          app,
          Intent(app, PassiveEntryService::class.java).putExtra(PassiveEntryService.EXTRA_REASON, reason),
        )
      } catch (e: Exception) {
        // Android 12+ refuses a foreground-service start from the background outside the exempt
        // triggers. The central is armed in-process regardless; the next exempt trigger (boot, the
        // user opening the app) promotes it.
        log.log("foreground service start refused ($reason): ${e.javaClass.simpleName}: ${e.message}")
      }
    }

    fun onServiceRunning(vin: String) {
      serviceRunning = true
      central.arm(vin)
      scheduleAlarm(PassiveEntryReceiver.ACTION_REINIT, REINIT_INTERVAL_MS, REINIT_INTERVAL_MS / 2)
      handler.post { updateNotification(central.snapshot.state) }
    }

    fun onServiceStopped() {
      serviceRunning = false
    }

    fun onBluetoothState(on: Boolean) {
      if (on) {
        Notifier.clearBtOff(app)
        cancelAlarm(PassiveEntryReceiver.ACTION_BT_OFF_REPEAT)
        store.btOffRepeatScheduled = false
        central.onBluetoothOn()
        return
      }
      // The Bluetooth service drops every scan registration with the radio: forget ours, or the next
      // arm trusts a registration that no longer exists until the 25-minute restart alarm.
      handler.post { backgroundScanArmedAt = 0L }
      central.onBluetoothOff()
      if (store.vin == null || store.btOffRepeatScheduled) return
      // Like iOS: one reminder per off-episode plus a repeat every few hours. Five seconds of grace,
      // like the official app, so a quick toggle does not nag.
      handler.postDelayed({
        if (adapterEnabled()) return@postDelayed
        Notifier.postBtOff(app)
        scheduleAlarm(PassiveEntryReceiver.ACTION_BT_OFF_REPEAT, BT_OFF_REPEAT_MS, BT_OFF_REPEAT_MS / 4)
        store.btOffRepeatScheduled = true
      }, 5_000L)
    }

    fun onBtOffRepeatAlarm() {
      if (adapterEnabled() || store.vin == null) return
      Notifier.postBtOff(app)
      scheduleAlarm(PassiveEntryReceiver.ACTION_BT_OFF_REPEAT, BT_OFF_REPEAT_MS, BT_OFF_REPEAT_MS / 4)
    }

    fun onReinitAlarm() {
      central.reinit("4h watchdog")
      if (serviceRunning) scheduleAlarm(PassiveEntryReceiver.ACTION_REINIT, REINIT_INTERVAL_MS, REINIT_INTERVAL_MS / 2)
    }

    fun onPendingScanResults(results: List<ScanResult>) {
      results.forEach { central.onExternalScanResult(it) }
    }

    fun onScanRestartAlarm() {
      handler.post {
        stopBackgroundScan()
        maybeArmBackgroundDiscovery()
      }
    }

    // ── background discovery: a PendingIntent scan that outlives the process ──

    private fun onCentralState(s: PassiveEntryCentral.State) {
      updateNotification(s)
      when {
        s == PassiveEntryCentral.State.READY || visibleActivities > 0 -> disarmBackgroundDiscovery()
        s == PassiveEntryCentral.State.DISCOVERING || s == PassiveEntryCentral.State.STANDING -> maybeArmBackgroundDiscovery()
      }
    }

    /**
     * The Android analog of the iOS beacon region: a hardware-filtered LOW_POWER scan whose results
     * are delivered to PassiveEntryReceiver by PendingIntent, so it keeps looking after the process
     * is gone and wakes us when the car (beacon | 1122 | name | address) appears. Re-issued every
     * 25 min by alarm because Android quietly stops delivering results for long-running scans.
     */
    private fun maybeArmBackgroundDiscovery() {
      if (mode != PassiveEntryCentral.Mode.PERSISTENT) return
      val vin = store.vin ?: return
      if (visibleActivities > 0) return
      val st = central.snapshot.state
      if (st != PassiveEntryCentral.State.DISCOVERING && st != PassiveEntryCentral.State.STANDING) return
      if (!BleGuards.hasScanPermissions(app)) return
      val scanner = adapter()?.bluetoothLeScanner ?: return
      if (backgroundScanArmedAt != 0L && SystemClock.elapsedRealtime() - backgroundScanArmedAt < BACKGROUND_SCAN_RESTART_MS - 60_000L) return
      val settings = ScanSettings.Builder()
        .setScanMode(ScanSettings.SCAN_MODE_LOW_POWER)
        .setCallbackType(ScanSettings.CALLBACK_TYPE_ALL_MATCHES)
        .setReportDelay(0)
        .build()
      val pi = PassiveEntryReceiver.pending(app, PassiveEntryReceiver.ACTION_SCAN_RESULTS, mutable = true)
      val rc = runCatching { scanner.startScan(central.backgroundScanFilters(), settings, pi) }.getOrElse { -1 }
      if (rc == 0) {
        backgroundScanArmedAt = SystemClock.elapsedRealtime()
        scheduleAlarm(PassiveEntryReceiver.ACTION_SCAN_RESTART, BACKGROUND_SCAN_RESTART_MS, 5 * 60_000L)
        log.log("background discovery armed (PendingIntent scan, low-power) for …${vin.takeLast(6)}")
      } else {
        log.log("background discovery could not start (code $rc)")
      }
    }

    private fun stopBackgroundScan() {
      if (backgroundScanArmedAt == 0L) return
      backgroundScanArmedAt = 0L
      runCatching {
        adapter()?.bluetoothLeScanner?.stopScan(PassiveEntryReceiver.pending(app, PassiveEntryReceiver.ACTION_SCAN_RESULTS, mutable = true))
      }
    }

    private fun disarmBackgroundDiscovery() {
      handler.post {
        if (backgroundScanArmedAt == 0L) return@post
        stopBackgroundScan()
        cancelAlarm(PassiveEntryReceiver.ACTION_SCAN_RESTART)
        log.log("background discovery stopped")
      }
    }

    // ── alarms (inexact; fine under Doze, no SCHEDULE_EXACT_ALARM needed) ─────

    private fun scheduleAlarm(action: String, delayMs: Long, windowMs: Long) {
      val am = app.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return
      val pi = PassiveEntryReceiver.pending(app, action, mutable = false)
      runCatching { am.setWindow(AlarmManager.RTC_WAKEUP, System.currentTimeMillis() + delayMs, windowMs, pi) }
    }

    private fun cancelAlarm(action: String) {
      val am = app.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return
      runCatching { am.cancel(PassiveEntryReceiver.pending(app, action, mutable = false)) }
    }

    // ── service card ───────────────────────────────────────────────────────────

    private fun updateNotification(s: PassiveEntryCentral.State) {
      if (!serviceRunning) return
      val vin = store.vin ?: return
      val text = when (s) {
        PassiveEntryCentral.State.READY -> "Connected to your car"
        PassiveEntryCentral.State.IDLE -> if (adapterEnabled()) "Waiting for your car" else "Bluetooth is off"
        else -> "Waiting for your car"
      }
      runCatching { NotificationManagerCompat.from(app).notify(Notifier.ID_SERVICE, Notifier.serviceNotification(app, vin, text)) }
    }

    private fun adapter() = (app.getSystemService(Context.BLUETOOTH_SERVICE) as? android.bluetooth.BluetoothManager)?.adapter

    private fun adapterEnabled(): Boolean = adapter()?.isEnabled == true

    private companion object {
      const val REINIT_INTERVAL_MS = 4L * 60 * 60 * 1000
      const val BT_OFF_REPEAT_MS = 4L * 60 * 60 * 1000
      const val BACKGROUND_SCAN_RESTART_MS = 25L * 60 * 1000
    }
  }

  private fun currentProcessName(context: Context): String {
    if (Build.VERSION.SDK_INT >= 28) return Application.getProcessName()
    val pid = Process.myPid()
    val am = context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
    return am?.runningAppProcesses?.firstOrNull { it.pid == pid }?.processName ?: context.packageName
  }
}
```

- [ ] **Step 2: `PassiveEntryApp.kt` and `PassiveEntryPackage.kt` — the `Application.onCreate` hook**

expo-modules-autolinking adds any `*Package.kt` that imports `expo.modules.core.interfaces.Package` to the generated package list, and `MainApplication.onCreate` dispatches `ApplicationLifecycleDispatcher.onApplicationCreate` to every listener — in every process, including one started by the service or a receiver with no React context. This is the Android analog of `PassiveEntryAppDelegate.swift`.

```kotlin path=modules/expo-passive-entry/android/src/main/java/expo/modules/passiveentry/PassiveEntryPackage.kt
package expo.modules.passiveentry

import android.content.Context
import expo.modules.core.interfaces.ApplicationLifecycleListener
import expo.modules.core.interfaces.Package

/** Discovered by expo-modules-autolinking (a `*Package.kt` importing `Package`); registers the app-create hook. */
class PassiveEntryPackage : Package {
  override fun createApplicationLifecycleListeners(context: Context): List<ApplicationLifecycleListener> =
    listOf(PassiveEntryApp())
}
```

```kotlin path=modules/expo-passive-entry/android/src/main/java/expo/modules/passiveentry/PassiveEntryApp.kt
package expo.modules.passiveentry

import android.app.Activity
import android.app.Application
import android.os.Bundle
import expo.modules.core.interfaces.ApplicationLifecycleListener

/**
 * The launch-time hook — what PassiveEntryAppDelegate.swift is on iOS. Builds the runtime with the
 * application context (so a service- or receiver-started process has one before any React context
 * exists) and registers the activity-visibility callbacks that make the single-writer gate honest.
 *
 * It deliberately does NOT start the foreground service: Application.onCreate in a process started
 * by a broadcast or alarm is not an exempt trigger on Android 12+, but the receiver's own onReceive
 * is — so PassiveEntryReceiver/PassiveEntryBootReceiver call startIfConfigured themselves.
 */
class PassiveEntryApp : ApplicationLifecycleListener {
  override fun onCreate(application: Application) {
    val rt = PassiveEntryRuntime.ensure(application)
    application.registerActivityLifecycleCallbacks(object : Application.ActivityLifecycleCallbacks {
      override fun onActivityStarted(activity: Activity) = rt.onActivityStarted()
      override fun onActivityStopped(activity: Activity) = rt.onActivityStopped()
      override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) {}
      override fun onActivityResumed(activity: Activity) {}
      override fun onActivityPaused(activity: Activity) {}
      override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) {}
      override fun onActivityDestroyed(activity: Activity) {}
    })
    rt.log.log("application created: mode=${rt.mode} armed=${rt.store.vin != null}")
  }
}
```

- [ ] **Step 3: `PassiveEntryService.kt`**

```kotlin path=modules/expo-passive-entry/android/src/main/java/expo/modules/passiveentry/PassiveEntryService.kt
package expo.modules.passiveentry

import android.app.Service
import android.bluetooth.BluetoothAdapter
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat

/**
 * The foreground service that keeps the phone key alive — Android's replacement for CoreBluetooth
 * state restoration. While it runs, the process is never cached-frozen or Doze-throttled out of its
 * GATT callbacks, and a swipe from recents does not end it (`onTaskRemoved` is a no-op, like the
 * official app's `BLEService` when background is allowed). It owns nothing itself: the runtime's
 * central is armed in onStartCommand and the card just reflects its state.
 *
 * Started by: `start(vin)` from JS (app visible), PassiveEntryBootReceiver (boot / package update),
 * and best-effort from a background sighting. Stopped by `stop()` (disarm).
 */
class PassiveEntryService : Service() {
  private var btReceiver: BroadcastReceiver? = null

  override fun onCreate() {
    super.onCreate()
    Notifier.ensureChannels(this)
    val rt = PassiveEntryRuntime.ensure(this)
    val r = object : BroadcastReceiver() {
      override fun onReceive(context: Context, intent: Intent) {
        when (intent.getIntExtra(BluetoothAdapter.EXTRA_STATE, -1)) {
          BluetoothAdapter.STATE_ON -> rt.onBluetoothState(true)
          BluetoothAdapter.STATE_OFF -> rt.onBluetoothState(false)
        }
      }
    }
    ContextCompat.registerReceiver(this, r, IntentFilter(BluetoothAdapter.ACTION_STATE_CHANGED), ContextCompat.RECEIVER_EXPORTED)
    btReceiver = r
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val rt = PassiveEntryRuntime.ensure(this)
    val vin = rt.store.vin
    if (vin == null || !BleGuards.hasScanPermissions(this)) {
      rt.log.log("service: nothing armed or BLE permissions missing — stopping")
      stopSelf()
      return START_NOT_STICKY
    }
    try {
      ServiceCompat.startForeground(
        this,
        Notifier.ID_SERVICE,
        Notifier.serviceNotification(this, vin, "Waiting for your car"),
        if (Build.VERSION.SDK_INT >= 29) ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE else 0,
      )
    } catch (e: Exception) {
      rt.log.log("startForeground failed: ${e.javaClass.simpleName}: ${e.message}")
      stopSelf()
      return START_NOT_STICKY
    }
    rt.log.log("service: foreground (reason=${intent?.getStringExtra(EXTRA_REASON) ?: "system restart"})")
    rt.onServiceRunning(vin)
    return START_STICKY
  }

  override fun onTaskRemoved(rootIntent: Intent?) {
    PassiveEntryRuntime.peek()?.log?.log("task removed — service keeps running")
  }

  override fun onDestroy() {
    btReceiver?.let { runCatching { unregisterReceiver(it) } }
    btReceiver = null
    PassiveEntryRuntime.peek()?.let { it.onServiceStopped(); it.log.log("service: destroyed") }
    super.onDestroy()
  }

  override fun onBind(intent: Intent?): IBinder? = null

  companion object {
    const val EXTRA_REASON = "reason"
  }
}
```

- [ ] **Step 4: `PassiveEntryReceiver.kt` — boot receiver + internal receiver**

```kotlin path=modules/expo-passive-entry/android/src/main/java/expo/modules/passiveentry/PassiveEntryReceiver.kt
package expo.modules.passiveentry

import android.app.PendingIntent
import android.bluetooth.le.BluetoothLeScanner
import android.bluetooth.le.ScanResult
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.content.IntentCompat

/**
 * BOOT_COMPLETED / MY_PACKAGE_REPLACED → bring the service back. Exported (system broadcasts), and it
 * handles nothing else — every internal action goes to the non-exported receiver below. Delivered
 * only if the app has been opened at least once since install (Android's stopped-state rule): the
 * same ceiling as iOS after a force-quit.
 */
class PassiveEntryBootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val action = intent.action ?: return
    if (action != Intent.ACTION_BOOT_COMPLETED && action != Intent.ACTION_MY_PACKAGE_REPLACED) return
    PassiveEntryRuntime.ensure(context).startIfConfigured(action.substringAfterLast('.'))
  }
}

/** Internal actions: PendingIntent scan results and the three alarms. Not exported. */
class PassiveEntryReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val rt = PassiveEntryRuntime.ensure(context)
    when (intent.action) {
      ACTION_SCAN_RESULTS -> {
        val error = intent.getIntExtra(BluetoothLeScanner.EXTRA_ERROR_CODE, -1)
        if (error != -1) {
          rt.log.log("background discovery error code=$error")
          return
        }
        val results = IntentCompat.getParcelableArrayListExtra(intent, BluetoothLeScanner.EXTRA_LIST_SCAN_RESULT, ScanResult::class.java)
          ?: return
        // Keep the process alive while the connect lands (goAsync gives ~10 s beyond onReceive).
        val pending = goAsync()
        rt.handler.postDelayed({ runCatching { pending.finish() } }, 10_000L)
        rt.onPendingScanResults(results)
        rt.startIfConfigured("car sighted")
      }
      ACTION_SCAN_RESTART -> rt.onScanRestartAlarm()
      ACTION_REINIT -> rt.onReinitAlarm()
      ACTION_BT_OFF_REPEAT -> rt.onBtOffRepeatAlarm()
    }
  }

  companion object {
    const val ACTION_SCAN_RESULTS = "expo.modules.passiveentry.SCAN_RESULTS"
    const val ACTION_SCAN_RESTART = "expo.modules.passiveentry.SCAN_RESTART"
    const val ACTION_REINIT = "expo.modules.passiveentry.REINIT"
    const val ACTION_BT_OFF_REPEAT = "expo.modules.passiveentry.BT_OFF_REPEAT"

    /** A stable PendingIntent per action (same request code + explicit component → same object, so cancel/stopScan match). */
    fun pending(ctx: Context, action: String, mutable: Boolean): PendingIntent {
      val intent = Intent(ctx, PassiveEntryReceiver::class.java).setAction(action)
      val code = when (action) {
        ACTION_SCAN_RESULTS -> 1
        ACTION_SCAN_RESTART -> 2
        ACTION_REINIT -> 3
        else -> 4
      }
      // Scan-result intents MUST be mutable: the Bluetooth service fills in the results extra.
      val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (mutable) PendingIntent.FLAG_MUTABLE else PendingIntent.FLAG_IMMUTABLE)
      return PendingIntent.getBroadcast(ctx, code, intent, flags)
    }
  }
}
```

- [ ] **Step 5: `PassiveEntryModule.kt` — the frozen contract over the runtime**

```kotlin path=modules/expo-passive-entry/android/src/main/java/expo/modules/passiveentry/PassiveEntryModule.kt
package expo.modules.passiveentry

import android.util.Base64
import androidx.core.os.bundleOf
import expo.modules.interfaces.permissions.PermissionsResponseListener
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Android counterpart of ios/PassiveEntryModule.swift. The TS contract in
 * modules/expo-passive-entry/index.ts is frozen and shared, so every function and event name here
 * mirrors the Swift one exactly. The module is a thin bridge: the process-wide runtime owns the
 * central, the service and persistence, and exists whether or not JS is running.
 */
class PassiveEntryModule : Module() {
  private fun runtime(): PassiveEntryRuntime.Instance =
    PassiveEntryRuntime.ensure(requireNotNull(appContext.reactContext) { "no react context" })

  override fun definition() = ModuleDefinition {
    Name("PassiveEntry")

    // bondRemoved is part of the shared contract; it never fires on Android (nothing bonds with the car).
    Events("log", "frame", "connectionState", "bondRemoved")

    OnCreate {
      val rt = runtime()
      rt.log.sink = { line -> sendEvent("log", bundleOf("line" to line)) }
      // model (b) byte pipe: every raw 0213 notification, base64 so it crosses the bridge intact.
      rt.central.onFrame = { bytes -> sendEvent("frame", bundleOf("dataB64" to Base64.encodeToString(bytes, Base64.NO_WRAP))) }
      rt.onConnectionState = { state, mtu -> sendEvent("connectionState", bundleOf("state" to state, "mtu" to mtu)) }
    }

    OnDestroy {
      PassiveEntryRuntime.peek()?.let {
        it.log.sink = null
        it.central.onFrame = null
        it.onConnectionState = null
      }
    }

    // The share sheet's activity is going away: an ephemeral central must not outlive it.
    OnActivityDestroys {
      PassiveEntryRuntime.peek()?.let { if (it.mode == PassiveEntryCentral.Mode.EPHEMERAL) it.stop() }
    }

    // ── lifecycle ────────────────────────────────────────────────────────────

    Function("start") { vin: String ->
      val rt = runtime()
      val missing = BleGuards.missingPermissions(rt.app)
      if (missing.isEmpty()) {
        rt.start(vin)
        askForNotificationsOnce(rt)
        return@Function
      }
      if (rt.mode == PassiveEntryCentral.Mode.EPHEMERAL) {
        rt.log.log("start: BLE permissions missing in the share process — open the app once to grant them")
        return@Function
      }
      val pm = appContext.permissions
      if (pm == null) {
        rt.log.log("start: no permissions manager — cannot ask for ${missing.joinToString()}")
        return@Function
      }
      val ask = missing + BleGuards.optionalPermissions(rt.app)
      rt.store.notificationsAsked = true
      rt.log.log("start: asking for ${ask.joinToString()}")
      pm.askForPermissions(
        PermissionsResponseListener {
          if (BleGuards.hasScanPermissions(rt.app)) rt.start(vin)
          else rt.log.log("start: BLE permissions DENIED — passive entry unavailable until granted in Settings")
        },
        *ask.toTypedArray(),
      )
    }

    Function("stop") { runtime().stop() }

    Function("isRunning") { runtime().central.snapshot.state == PassiveEntryCentral.State.READY }

    // ── byte pipe ────────────────────────────────────────────────────────────

    Function("writeFrame") { frameB64: String ->
      val bytes = runCatching { Base64.decode(frameB64, Base64.DEFAULT) }.getOrNull() ?: return@Function false
      runtime().central.writeRaw(bytes)
    }

    Function("connectionState") {
      val (state, mtu) = runtime().central.connectionSnapshot()
      bundleOf("state" to state, "mtu" to mtu)
    }

    Function("setForegroundResponderActive") { active: Boolean -> runtime().setForegroundResponderActive(active) }

    // ── device key ───────────────────────────────────────────────────────────

    Function("setDeviceKey") { privHex: String -> KeystoreKey.setKeyHex(runtime().app, privHex) }

    Function("deviceFingerprint") {
      val hex = KeystoreKey.getKeyHex(runtime().app) ?: return@Function "no key"
      val pub = VcsecSigner.devicePublicKey(hex) ?: return@Function "no key"
      VcsecSigner.fingerprint(pub)
    }

    // ── goldens (pure crypto, no car, no key) ────────────────────────────────

    Function("sealGolden") { VcsecSigner.goldenSelfTest() }
    Function("ecdhGolden") { VcsecSigner.ecdhGoldenSelfTest() }
    Function("handshakeGolden") { VcsecSigner.handshakeGoldenSelfTest() }

    // ── notifications + wake sources ─────────────────────────────────────────

    Function("postCpdWarning") { Notifier.postCpd(runtime().app) }

    // Stored for a later geofence leg (spec §5 Q2); reboot/process death are covered by the boot
    // receiver and the PendingIntent beacon scan, which need no location permission.
    Function("setCarLocation") { lat: Double, lon: Double -> runtime().store.setCarLocation(lat, lon) }

    Function("requestAlwaysLocation") {
      runtime().log.log("requestAlwaysLocation: no geofence leg on Android yet — boot receiver + background scan carry the wake")
    }
  }

  /** POST_NOTIFICATIONS (Android 13+) — asked once, never nagged; a denial only mutes the reminders. */
  private fun askForNotificationsOnce(rt: PassiveEntryRuntime.Instance) {
    if (rt.mode != PassiveEntryCentral.Mode.PERSISTENT || rt.store.notificationsAsked) return
    val optional = BleGuards.optionalPermissions(rt.app)
    if (optional.isEmpty()) return
    val pm = appContext.permissions ?: return
    rt.store.notificationsAsked = true
    pm.askForPermissions(PermissionsResponseListener { }, *optional.toTypedArray())
  }
}
```

- [ ] **Step 6: The manifest**

```xml path=modules/expo-passive-entry/android/src/main/AndroidManifest.xml
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:tools="http://schemas.android.com/tools">
  <!-- Android 12+ split the install-time BLUETOOTH/BLUETOOTH_ADMIN pair into runtime
       permissions. neverForLocation is load-bearing: WITHOUT it the platform also demands
       ACCESS_FINE_LOCATION before delivering ANY scan result, and a scan missing that
       permission returns zero results silently — indistinguishable from "the car isn't
       nearby". We never derive location from a scan result. -->
  <uses-permission android:name="android.permission.BLUETOOTH_SCAN"
                   android:usesPermissionFlags="neverForLocation"
                   tools:targetApi="s" />
  <uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />
  <!-- The foreground service that replaces CoreBluetooth state restoration. connectedDevice is
       the type the official Tesla app declares (foregroundServiceType=0x10). -->
  <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
  <uses-permission android:name="android.permission.FOREGROUND_SERVICE_CONNECTED_DEVICE" />
  <uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />
  <uses-permission android:name="android.permission.WAKE_LOCK" />
  <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
  <uses-feature android:name="android.hardware.bluetooth_le" android:required="true" />

  <application>
    <service
        android:name="expo.modules.passiveentry.PassiveEntryService"
        android:exported="false"
        android:foregroundServiceType="connectedDevice" />
    <!-- Exported: BOOT_COMPLETED / MY_PACKAGE_REPLACED are protected system broadcasts, nothing
         else can send them. Internal actions go to the non-exported receiver below. -->
    <receiver
        android:name="expo.modules.passiveentry.PassiveEntryBootReceiver"
        android:exported="true">
      <intent-filter>
        <action android:name="android.intent.action.BOOT_COMPLETED" />
        <action android:name="android.intent.action.MY_PACKAGE_REPLACED" />
      </intent-filter>
    </receiver>
    <receiver
        android:name="expo.modules.passiveentry.PassiveEntryReceiver"
        android:exported="false" />
  </application>
</manifest>
```

- [ ] **Step 7: Build, run the JVM tests, deploy**

Run: `cd android && ANDROID_HOME=$HOME/Library/Android/sdk JAVA_HOME=/Library/Java/JavaVirtualMachines/zulu-17.jdk/Contents/Home ./gradlew :expo-passive-entry:testReleaseUnitTest --max-workers=2 2>&1 | tail -6`
Expected: `BUILD SUCCESSFUL`.

Run: `bash scripts/android/deploy-js.sh`
Expected: `✓ done`.

- [ ] **Step 8: Device smoke — service, permissions, goldens, key**

Open the app on the S22 (it is linked to the car already, so the arming effect runs). Grant the BLE prompt if shown.

Run: `adb shell dumpsys activity services local.airgapp.mobile | grep -E "PassiveEntryService|isForeground" | head -4`
Expected: a `ServiceRecord{… PassiveEntryService}` line and `isForeground=true`.

Run: `adb logcat -d -s PassiveEntry:* | tail -30`
Expected, in order: `application created: mode=PERSISTENT armed=true`, `arm vin=…844019 name=S8d2eb01195e4f42bC mode=PERSISTENT`, `service: foreground (reason=start)`, then either `pending connect (standing, no scan) → <mac>` (address remembered) or `scanning (arm): beacon|1122|name, 20000ms window, low-latency` followed by `scan window ended — N advertiser(s), no car` lines (no car at the desk). No `probe`, no census.

In the app's carlink harness tap **Native seal golden** and **Native key check**.
Expected: `GOLDEN: ✅ MATCH (frame 169B)`, `ECDH: ✅ MATCH`, `HANDSHAKE: ✅ MATCH`, and `key check: … → MATCH ✅`.

- [ ] **Step 9: Device smoke — background gate, Bluetooth toggle, boot receiver**

Press Home.

Run: `adb logcat -d -s PassiveEntry:* | grep -E "foregroundResponderActive|app hidden|background discovery" | tail -5`
Expected: `foregroundResponderActive=false` and, if no address is remembered, `app hidden — callback scan stopped; background discovery takes over` + `background discovery armed (PendingIntent scan, low-power) for …844019`.

Run: `adb shell dumpsys activity services local.airgapp.mobile | grep -c "isForeground=true"`
Expected: `1` (still foreground after backgrounding).

Run: `adb shell svc bluetooth disable; sleep 8; adb shell dumpsys notification --noredact 2>/dev/null | grep -c "Bluetooth Disabled"`
Expected: `1` or more (the reminder posted).

Run: `adb shell svc bluetooth enable; sleep 6; adb shell dumpsys notification --noredact 2>/dev/null | grep -c "Bluetooth Disabled"; adb logcat -d -s PassiveEntry:* | tail -3`
Expected: `0` and a `bluetooth on` reestablish line.

Run (the shell may not send the protected `BOOT_COMPLETED` broadcast on One UI — a reinstall fires the same receiver through `MY_PACKAGE_REPLACED`, which is also an exempt foreground-service trigger): `adb install -r android/app/build/outputs/apk/release/app-release.apk; sleep 12; adb shell dumpsys activity services local.airgapp.mobile | grep -c "isForeground=true"; adb logcat -d -s 'PassiveEntry:*' | grep -E "startIfConfigured|service: foreground" | tail -2`
Expected: `1`, `startIfConfigured(MY_PACKAGE_REPLACED): armed for vin=…844019` and `service: foreground (reason=MY_PACKAGE_REPLACED)`. (Measured 2026-09-03: also `background discovery armed (PendingIntent scan, low-power)` when no address is remembered, and `dumpsys alarm` lists `expo.modules.passiveentry.REINIT` + `SCAN_RESTART`.)

Reopen the app.
Run: `adb logcat -d -s PassiveEntry:* | grep "foregroundResponderActive" | tail -1`
Expected: `foregroundResponderActive=true`.

- [ ] **Step 10: Commit (Tasks 5 + 6 together)**

```bash
git add modules/expo-passive-entry/android
git commit -m "feat(android/ble): rewrite the phone-key central — foreground service, standing autoConnect, indications, boot + background-scan wake

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Cross-platform golden pin, log pulling, docs, memory

**Files:**
- Create: `src/ble/nativeGoldens.test.ts`
- Create: `scripts/android/pull-logs.sh`
- Modify: `docs/android-parity.md` (the BLE rows + Phase 4 rows + the share-sheet "two centrals" note)
- Modify: `AGENTS.md` (Android log pull)
- Modify: `/Users/ivan/.claude/projects/-Users-ivan-Work-airgapp-mobile/memory/android-port.md` (+ index line)

- [ ] **Step 1: Write the failing node test**

```ts path=src/ble/nativeGoldens.test.ts
// Both native signers (Swift and Kotlin) hardcode the routable-seal and ECDH goldens generated by
// scripts/gen-routable-golden.ts / gen-ecdh-golden.ts and checked into ios/*.golden.json. This pins
// every fixture value to BOTH sources so neither can drift from the TS oracle — and it pins the
// Kotlin unit test's public-key/fingerprint expectations to what @noble produces right now.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { p256 } from '@noble/curves/p256';
import { sha256 } from '@noble/hashes/sha256';

const MOD = join(import.meta.dirname, '..', '..', 'modules', 'expo-passive-entry');
const swift = readFileSync(join(MOD, 'ios', 'VcsecSigner.swift'), 'utf8').toLowerCase();
const kotlin = readFileSync(join(MOD, 'android', 'src', 'main', 'java', 'expo', 'modules', 'passiveentry', 'VcsecSigner.kt'), 'utf8').toLowerCase();
const kotlinTest = readFileSync(
  join(MOD, 'android', 'src', 'test', 'java', 'expo', 'modules', 'passiveentry', 'VcsecSignerTest.kt'),
  'utf8',
).toLowerCase();

const seal = JSON.parse(readFileSync(join(MOD, 'ios', 'routableSeal.golden.json'), 'utf8')) as {
  inputs: Record<string, string | number>;
  aadHex: string;
  ciphertextHex: string;
  tagHex: string;
  frameHex: string;
};
const ecdh = JSON.parse(readFileSync(join(MOD, 'ios', 'ecdh.golden.json'), 'utf8')) as {
  myPrivHex: string;
  peerPubHex: string;
  sessionKeyHex: string;
};

test('routable-seal golden outputs are hardcoded identically in the Swift and the Kotlin signer', () => {
  for (const [name, hex] of Object.entries({
    aad: seal.aadHex,
    ciphertext: seal.ciphertextHex,
    tag: seal.tagHex,
    frame: seal.frameHex,
  })) {
    assert.ok(swift.includes(hex.toLowerCase()), `Swift is missing the ${name} golden`);
    assert.ok(kotlin.includes(hex.toLowerCase()), `Kotlin is missing the ${name} golden`);
  }
});

test('routable-seal golden inputs (vin, nonce, inner) appear in both signers', () => {
  const { vin, nonce, innerHex } = seal.inputs as { vin: string; nonce: string; innerHex: string };
  for (const needle of [vin.toLowerCase(), nonce.toLowerCase(), innerHex.toLowerCase()]) {
    assert.ok(swift.includes(needle), `Swift is missing input ${needle}`);
    assert.ok(kotlin.includes(needle), `Kotlin is missing input ${needle}`);
  }
});

test('ECDH golden peer key and session key are hardcoded identically in both signers', () => {
  for (const hex of [ecdh.peerPubHex, ecdh.sessionKeyHex]) {
    assert.ok(swift.includes(hex.toLowerCase()), `Swift is missing ${hex.slice(0, 12)}…`);
    assert.ok(kotlin.includes(hex.toLowerCase()), `Kotlin is missing ${hex.slice(0, 12)}…`);
  }
});

test('the Kotlin unit test expects exactly the public key and fingerprint noble derives for the golden scalar', () => {
  const priv = Uint8Array.from(Buffer.from(ecdh.myPrivHex, 'hex'));
  const pub = p256.getPublicKey(priv, false);
  const pubHex = Buffer.from(pub).toString('hex');
  const fingerprint = Array.from(sha256(pub).slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join(':');
  assert.ok(kotlinTest.includes(pubHex), 'VcsecSignerTest.kt public-key expectation drifted from noble');
  assert.ok(kotlinTest.includes(fingerprint), 'VcsecSignerTest.kt fingerprint expectation drifted from noble');
});
```

- [ ] **Step 2: Run it**

Run: `pnpm test 2>&1 | grep -A12 "nativeGoldens" | head -30; pnpm test 2>&1 | tail -4`
Expected: the four tests pass (the Kotlin from Task 1 already carries the constants); `pass 980`, `fail 0`.

- [ ] **Step 3: `scripts/android/pull-logs.sh`**

```bash path=scripts/android/pull-logs.sh
#!/usr/bin/env bash
#
# Pull the app's logs off the Galaxy S22. Counterpart of scripts/godot-ios/pull-logs.sh.
#
#   bash scripts/android/pull-logs.sh            # last 200 app-log lines + the native passive-entry log tail
#   bash scripts/android/pull-logs.sh 1000       # last 1000
#   bash scripts/android/pull-logs.sh all ble    # everything, only the 'ble' category
#
# TWO logs, because two runtimes: the JS logbus ring (files/SQLite/carlink-log.db, also carries the
# native `log` event lines under cat=region while JS is alive) and files/airgapp-native.log, which
# the passive-entry service writes itself — the only record of what happened while JS was not
# running (boot, background, the share process). Both need `debuggable true` (adb run-as).
set -uo pipefail

PKG="local.airgapp.mobile"
LIMIT="${1:-200}"
CAT="${2:-}"
OUT="${TMPDIR:-/tmp}/airgapp-android-logs"
mkdir -p "$OUT"

adb get-state >/dev/null 2>&1 || { echo "ERROR: no adb device attached." >&2; exit 1; }

echo "=== app log (SQLite ring) ==="
# The ring is in WAL mode: without the -wal/-shm sidecars the newest rows are invisible.
for f in carlink-log.db carlink-log.db-wal carlink-log.db-shm; do
  adb shell "run-as $PKG cat files/SQLite/$f" > "$OUT/$f" 2>/dev/null || true
  [ -s "$OUT/$f" ] || rm -f "$OUT/$f"
done
if [ -s "$OUT/carlink-log.db" ]; then
  node -e '
    const { DatabaseSync } = require("node:sqlite");
    const [db, limit, cat] = [new DatabaseSync(process.argv[1]), process.argv[2], process.argv[3]];
    const where = cat ? `where cat = ${JSON.stringify(cat)}` : "";
    const lim = limit === "all" ? "" : `limit ${Number(limit)}`;
    // ORDER BY t, not seq: `seq` is the JS logbus counter and restarts at 0 on every app boot,
    // so a fresh boot writes LOW seq values that replace the oldest rows — the ring wraps.
    const rows = db.prepare(`select t, level, cat, msg, data from log ${where} order by t desc ${lim}`).all().reverse();
    for (const r of rows) console.log([new Date(r.t).toISOString(), r.level, r.cat, r.msg, r.data].filter(Boolean).join(" | "));
  ' "$OUT/carlink-log.db" "$LIMIT" "$CAT"
else
  echo "(no SQLite log yet)"
fi

echo
echo "=== native passive-entry log (files/airgapp-native.log) ==="
adb shell "run-as $PKG cat files/airgapp-native.log" > "$OUT/airgapp-native.log" 2>/dev/null
if [ -s "$OUT/airgapp-native.log" ]; then
  if [ "$LIMIT" = "all" ]; then cat "$OUT/airgapp-native.log"; else tail -n "$LIMIT" "$OUT/airgapp-native.log"; fi
else
  echo "(no native log yet — the passive-entry service has not run)"
fi
echo
echo "copies: $OUT/carlink-log.db, $OUT/airgapp-native.log"
```

Run: `chmod +x scripts/android/pull-logs.sh && bash scripts/android/pull-logs.sh 20 | tail -25`
Expected: both sections print; the native section shows the service lines from Task 6.

- [ ] **Step 4: Update `docs/android-parity.md`**

Replace the three BLE/Phase-4 rows and the share-sheet "Known risk" section with the new state. In the **At parity** table replace the `BLE scan` row with:

```markdown
| **Phone key (BLE)** | Rewritten 2026-09-03 (spec: `docs/superpowers/specs/2026-09-03-android-native-parity-design.md`). Foreground service (`connectedDevice`) holds the link; standing `autoConnect` to the remembered address; bounded filtered discovery (iBeacon + `1122` + name); **indications** on 0213 (what the official app and `vehicle-command` use); native self-signing in the background (`VcsecResponder`, byte-for-byte port of the Swift, JVM-tested); warm session; boot receiver + a process-death-surviving `PendingIntent` beacon scan for the wake; BT-off reminder (+4 h repeat); CPD alert. Goldens: `GOLDEN/ECDH/HANDSHAKE ✅ MATCH` on device. **At-car verification pending** (Task 8 of the plan). |
```

In **Accepted deltas** replace the background-passive-entry row with:

```markdown
| **A persistent "Phone Key" notification while armed** | Android has no CoreBluetooth state restoration; a `connectedDevice` foreground service is the only way to hold a link while backgrounded (the official Tesla app does exactly this — `BLEService`, notification 333). Low-importance channel, silent, tap opens the app. |
| **Reboot wake = boot receiver + background scan, not a geofence** | iOS needs Location Always for its beacon/circular regions; Android's `BOOT_COMPLETED` receiver and a hardware-filtered `PendingIntent` scan cover reboot and process death with no location permission. A geofence leg is optional (spec §5 Q2). |
| **`bondRemoved` never fires** | Nothing bonds with the car on Android (neither the official app nor `vehicle-command`), so there is no LE bond to lose. |
```

In **Open / unverified** delete the "BLE discovery: match the advertised service…" and "Phase 4" rows and add:

```markdown
| **Phone key at the car** | Connect → MTU → indications → foreground command through the pipe → background walk-up (`HANDSHAKE ✓`, `standing DRIVE asserted`, unlock). Needs the phone at the car with the official app's Bluetooth OFF (it does its own passive entry). |
```

Replace the "Known risk: two BLE centrals" section with:

```markdown
### The share sheet's BLE arm

The `:share` process runs the same `PassiveEntryCentral` in EPHEMERAL mode — the iOS `BleBytePipe.swift` shape: no service, no persistence, no responder; a direct connect to the remembered address plus a 3 s discovery scan, closed when the sheet's activity is destroyed. Two GATT clients from two processes share one ACL on Android (the Bluetooth process owns the link), exactly as two `CBCentralManager`s do across processes on iOS, so this is not the in-process two-central contention that broke passive entry on iOS.
```

- [ ] **Step 5: Update `AGENTS.md`** — in "Reading what the app did", after the logcat line, add:

```markdown
The passive-entry service also writes its own `files/airgapp-native.log` (survives process death and
reboot — the only record of a boot/background wake). `bash scripts/android/pull-logs.sh` pulls both.
```

- [ ] **Step 6: Memory** — in `android-port.md` replace the "Still open" paragraph's Phase-4 sentence with a pointer to the spec + "at-car verification pending", and add the index line in `MEMORY.md` for the spec.

- [ ] **Step 7: Typecheck, test, commit**

Run: `npx tsc --noEmit -p tsconfig.json && pnpm test 2>&1 | tail -4`
Expected: no tsc output; `fail 0`.

```bash
git add src/ble/nativeGoldens.test.ts scripts/android/pull-logs.sh docs/android-parity.md AGENTS.md
git commit -m "test(ble): pin Swift + Kotlin signer goldens to the JSON fixtures; android pull-logs; docs

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: At-car acceptance (manual — needs the phone at the car)

No files. This is the exit criterion of the spec; it cannot run at the desk (the car is at -90 dBm there and the primary PDU is caught only intermittently — memory: android-ble-car-identity-ibeacon).

- [ ] **Step 1: Control the confound.** Turn the official Tesla app's Bluetooth OFF on the iPhone (it does its own passive entry and would unlock the car regardless).

- [ ] **Step 2: First connect (app open, at the car).** Open airgapp next to the awake car.

Run: `bash scripts/android/pull-logs.sh 60 | grep -E "MATCH|CONNECTED|MTU=|subscribing|link up|no car"`
Expected: `BEACON MATCH — rssi=… → connecting` (or NAME/SERVICE), `CONNECTED <mac> — requesting MTU 517`, `MTU=<n> (blockLength=<n-3>)`, `chars ok — subscribing (indicate, props=0x..)`, `notifications enabled — link up (mtu=<n>, pipe)`. The blue transport dot in the app follows.

- [ ] **Step 3: Foreground command through the pipe.** Lock/unlock from the app.
Expected: the car reacts; the app log shows the command round-trip over `native-pipe`.

- [ ] **Step 4: Background walk-up.** Press Home, lock the phone, walk >30 m away until `DISCONNECTED`, wait 20 s, walk back and pull the handle.

Run: `bash scripts/android/pull-logs.sh 80 | grep -E "foregroundResponderActive|pending connect|CONNECTED|link up|warm session|HANDSHAKE|standing DRIVE|AppDeviceInfo|auth ANSWERED|HANDLE PULLED"`
Expected: `foregroundResponderActive=false`, `pending connect (standing, no scan) → <mac>`, `CONNECTED … link up (…, autonomous)`, `warm session restored …` (second time onwards), `HANDSHAKE ✓ epoch=… counter=…`, `standing DRIVE asserted sent counter=…`, `AppDeviceInfo (UWB unsupported) sent counter=…`, and the car unlocks (usually with NO `auth ANSWERED` — the standing DRIVE pre-authorizes, as measured on iOS 2026-07-26). A `HANDLE PULLED WITHOUT AUTH` line means the car's account of a failed pull — read its verdict.

- [ ] **Step 5: Reboot survival.** With the phone linked, reboot it, unlock once, do not open the app, walk to the car.
Expected in the native log: `startIfConfigured(BOOT_COMPLETED): armed for vin=…`, `service: foreground (reason=BOOT_COMPLETED)`, then the walk-up sequence of Step 4.

- [ ] **Step 6: Record the outcome** in `docs/android-parity.md` (move the phone-key row to verified or note the failure with the log lines) and in memory.
