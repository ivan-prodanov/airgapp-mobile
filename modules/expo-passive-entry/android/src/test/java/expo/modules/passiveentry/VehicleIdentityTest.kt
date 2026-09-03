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
