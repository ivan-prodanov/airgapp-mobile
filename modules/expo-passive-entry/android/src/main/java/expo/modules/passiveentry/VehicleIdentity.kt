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
