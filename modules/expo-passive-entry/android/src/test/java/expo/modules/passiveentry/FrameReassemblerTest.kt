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
