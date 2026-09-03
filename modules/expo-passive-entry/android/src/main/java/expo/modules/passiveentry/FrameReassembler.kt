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
