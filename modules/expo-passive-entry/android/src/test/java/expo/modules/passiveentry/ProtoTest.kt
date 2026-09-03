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
