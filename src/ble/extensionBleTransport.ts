// extensionBleTransport — a CarTransport over the Share Extension's BLE byte pipe.
//
// The extension owns its own CBCentralManager (a different process from the app's
// native central), but Swift is deliberately kept DUMB: it scans, connects,
// subscribes, writes raw chunks, and hands every raw notification back. Framing,
// reassembly and request/response correlation all stay here.
//
// That split is the whole point. `bleCorrelation.ts` is a port of tesla_session.go's
// Exchange and was hardened by the BLE-wedge fix — correlation decides on the
// frame's own request_uuid, with the routing address as a fallback, because the
// once-per-session routing address demonstrably lost challenges under load. A
// Swift reimplementation of that would be the second protocol implementation the
// JSC engine exists to avoid, and it would be the subtlest possible one to get
// wrong: the failure mode is not a crash, it is returning SOMEONE ELSE'S frame as
// the answer to your command.
//
// ── The host contract for this arm ──
//
//   __bleConnect(vin, timeoutMs) -> Promise<number>   the negotiated block length
//   __bleWrite(chunkB64)         -> Promise<void>     one already-chunked write
//   __bleDisconnect()            -> Promise<void>
//   globalThis.__onBleFrame(b64)                      Swift calls this per raw notification
//
// Swift never parses a byte of any of it.

import { BleReassembler, frameForWrite, MAX_BLE_MESSAGE_SIZE } from './bleFraming';
import { outgoingCorrelators, frameAnswersRequest } from './bleCorrelation';
import { base64ToBytes, bytesToBase64 } from './bytes';
import type { CarTransport } from './types';

// A cold scan+connect. The app budgets 20s for the same thing; the extension is
// on a tighter leash because the share sheet is waiting, and the arbiter has
// another arm to try.
const CONNECT_TIMEOUT_MS = 12_000;
const POLL_MS = 20;

interface BleHost {
  __bleConnect?: (vin: string, timeoutMs: number) => Promise<number>;
  __bleWrite?: (chunkB64: string) => Promise<void>;
  __bleDisconnect?: () => Promise<void>;
  __onBleFrame?: (b64: string) => void;
}

const host = globalThis as unknown as BleHost;

export class ExtensionBleTransport implements CarTransport {
  private blockLength = 20;
  private inbox: Uint8Array[] = [];
  private readonly reassembler = new BleReassembler();
  private connected = false;

  constructor(private readonly connectTimeoutMs: number = CONNECT_TIMEOUT_MS) {}

  // Swift calls this for EVERY raw notification, solicited or not. Unsolicited
  // frames (passive-entry challenges, status pushes) land in the inbox and are
  // simply never matched by a correlator — they are not errors and must not
  // break an exchange, which is precisely why "return the next frame" is wrong.
  private install(): void {
    host.__onBleFrame = (b64: string) => {
      // The clock is injected so the reassembler can flush a stale partial
      // frame — a gap longer than RX_STALE_GAP_MS means the bytes still in the
      // buffer belong to a message that will never complete.
      for (const frame of this.reassembler.push(base64ToBytes(b64), Date.now())) {
        this.inbox.push(frame);
      }
    };
  }

  async openSession(vin: string): Promise<string> {
    const connect = host.__bleConnect;
    if (!connect) throw new Error('extensionBleTransport: host installed no __bleConnect');
    this.install();
    this.reassembler.reset();
    this.inbox = [];
    this.blockLength = await connect(vin, this.connectTimeoutMs);
    if (!Number.isFinite(this.blockLength) || this.blockLength < 20) this.blockLength = 20;
    this.connected = true;
    // The engine only uses this as an opaque handle; the link is the session.
    return `ble:${vin}`;
  }

  async exchange(_sessionId: string, payloadB64: string, timeoutMs: number): Promise<string> {
    if (!this.connected) throw new Error('BLE link is not up');
    const write = host.__bleWrite;
    if (!write) throw new Error('extensionBleTransport: host installed no __bleWrite');

    const request = base64ToBytes(payloadB64);
    if (request.length > MAX_BLE_MESSAGE_SIZE) {
      throw new Error(`BLE message too large: ${request.length} > ${MAX_BLE_MESSAGE_SIZE}`);
    }
    const want = outgoingCorrelators(request);
    // Drop anything that arrived BEFORE this request went out: it cannot be an
    // answer to a request that has not been written, and keeping it only creates
    // a chance of a false match.
    this.inbox = [];

    for (const chunk of frameForWrite(request, this.blockLength)) {
      await write(bytesToBase64(chunk));
    }

    const deadline = Date.now() + Math.max(0, timeoutMs);
    for (;;) {
      const hit = this.inbox.findIndex((f) => frameAnswersRequest(f, want));
      if (hit >= 0) {
        const [frame] = this.inbox.splice(hit, 1);
        return bytesToBase64(frame);
      }
      if (Date.now() >= deadline) {
        throw new Error(`BLE exchange timed out after ${timeoutMs}ms (${this.inbox.length} unrelated frame(s))`);
      }
      // Polling rather than an event wait: the host calls __onBleFrame from
      // Swift, and there is no shared event loop primitive to await on. setTimeout
      // is a host global the extension installs, so this yields properly.
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
  }

  async closeSession(_sessionId: string): Promise<void> {
    this.connected = false;
    host.__onBleFrame = undefined;
    // Unlike the app — where the native central owns the link across sessions and
    // the passive-entry responder rides it — the extension's link exists only for
    // this send, and the process is about to end. Leaving a central connected
    // would hold the radio against the app that actually needs it.
    await host.__bleDisconnect?.().catch(() => {});
  }
}
