// bleFraming.ts — write-side chunking + notification reassembly for the
// direct phone→Tesla BLE transport.
//
// Ported from the vehicle-command Go SDK (ble.go:67-127). See
// docs/superpowers/plans/tesla-ble-transport-spec.md §3 (write framing)
// and §4 (notification reassembly).
//
// Both directions share ONE wire framing: a 2-byte BIG-ENDIAN length
// prefix (the payload's byte length) followed by the payload bytes. On
// write, that (prefix+payload) buffer is split into blockLength-sized
// chunks and written to the TX characteristic sequentially. On read, the
// inbound notification stream is accumulated and re-split by the same
// prefix — chunk boundaries on the wire do NOT line up with message
// boundaries, so this is a real reassembler, not a 1:1 pairing.

// RX_STALE_GAP_MS: if more than this many milliseconds elapse between two
// pushes to the reassembler, any partial (incomplete) buffer accumulated
// so far is stale and discarded before the new bytes are appended — a
// gap this large means the car's chunk stream desynced (e.g. the phone
// went to sleep, or two separate sends got interleaved).
export const RX_STALE_GAP_MS = 1000;

// MAX_BLE_MESSAGE_SIZE: an inbound message-length prefix claiming more
// than this many bytes is treated as corrupt (never a real Tesla
// RoutableMessage) — the whole accumulated buffer is dropped so the
// reassembler can resync on the next fresh message.
export const MAX_BLE_MESSAGE_SIZE = 1024;

// frameForWrite prepends the 2-byte big-endian length prefix to payload,
// then splits the whole (prefix+payload) buffer into blockLength-sized
// chunks for sequential GATT writes. The last chunk may be shorter than
// blockLength. Does NOT cap payload size against MAX_BLE_MESSAGE_SIZE —
// that's an inbound corruption guard, not an outbound constraint — but a
// payload whose length can't fit the 2-byte prefix (> 0xffff) is a
// programming error and throws.
export function frameForWrite(payload: Uint8Array, blockLength: number): Uint8Array[] {
  if (blockLength <= 0) {
    throw new Error(`frameForWrite: blockLength must be positive, got ${blockLength}`);
  }
  if (payload.length > 0xffff) {
    throw new Error(
      `frameForWrite: payload length ${payload.length} exceeds the 2-byte length-prefix range (0xffff)`,
    );
  }

  const framed = new Uint8Array(2 + payload.length);
  framed[0] = (payload.length >> 8) & 0xff;
  framed[1] = payload.length & 0xff;
  framed.set(payload, 2);

  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < framed.length; offset += blockLength) {
    chunks.push(framed.slice(offset, offset + blockLength));
  }
  // An empty payload with blockLength > 0 still yields the 2-byte
  // prefix as a (possibly sole) chunk — framed.length is always >= 2,
  // so the loop above always runs at least once.
  return chunks;
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

// BleReassembler is stateful — one instance per BLE connection. Feed it
// raw notification bytes as they arrive (in order); it returns zero or
// more COMPLETE message payloads (length prefix already stripped) each
// time enough bytes have accumulated to close out one or more messages.
export class BleReassembler {
  private buf: Uint8Array = new Uint8Array(0);
  private lastPushMs: number | null = null;

  // push accepts the next chunk of raw notification bytes plus the
  // caller's current clock (injected for testability — the transport
  // passes Date.now()). Returns any complete messages that became
  // available as a result of this push, in the order they close out.
  push(bytes: Uint8Array, nowMs: number): Uint8Array[] {
    if (
      this.lastPushMs !== null &&
      nowMs - this.lastPushMs > RX_STALE_GAP_MS &&
      this.buf.length > 0
    ) {
      // Inter-chunk gap exceeded the stale threshold: whatever partial
      // message we were accumulating can never be completed correctly
      // (the tail bytes, if they ever arrive, belong to a different
      // logical message) — discard it before appending the new bytes.
      this.buf = new Uint8Array(0);
    }
    this.lastPushMs = nowMs;

    this.buf = concatBytes(this.buf, bytes);

    const complete: Uint8Array[] = [];
    for (;;) {
      if (this.buf.length < 2) break;
      const msgLength = this.buf[0] * 256 + this.buf[1];
      if (msgLength > MAX_BLE_MESSAGE_SIZE) {
        // Corrupt prefix — the whole buffer is untrustworthy (we can't
        // know where a real message boundary would be), so drop it
        // entirely and stop; the next fresh bytes start a clean parse.
        this.buf = new Uint8Array(0);
        break;
      }
      if (this.buf.length < 2 + msgLength) break; // message not fully arrived yet
      complete.push(this.buf.slice(2, 2 + msgLength));
      this.buf = this.buf.slice(2 + msgLength);
    }
    return complete;
  }

  // reset clears all accumulated state — call on reconnect.
  reset(): void {
    this.buf = new Uint8Array(0);
    this.lastPushMs = null;
  }
}
