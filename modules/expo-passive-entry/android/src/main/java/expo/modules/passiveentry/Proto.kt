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
