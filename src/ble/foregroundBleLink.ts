// foregroundBleLink.ts — the ONE persistent foreground consumer of the native
// BLE frame stream.
//
// WHY A SINGLETON (matches the official app, confirmed in the decompile): Tesla's
// per-VIN central runs a single receive handler (q1.java `y()`→`B0()`) that
// processes EVERY 0213 notification — challenges (`z0` echo), vehicleStatus, CPD —
// continuously, independent of any command exchange. It is NOT tied to a command
// session. So the passive-entry responder + CPD detection must be ALWAYS-ON in the
// foreground, sharing ONE reassembler + ONE write lock + ONE session with the
// command path (two signers would race the shared VS counter).
//
// airgapp model (b): the native central owns the link; in the FOREGROUND it
// forwards raw 0213 bytes here (pipe mode) and writes what we hand it to 0212.
// This object subscribes to that stream once (driven by useCarLink's foreground
// lifecycle), and:
//   • answers passive-entry challenges (authResponder) and runs CPD/status pushes
//     (onUnsolicited) on every idle frame — always-on;
//   • lends its exchange()/write-lock to BridgedBleTransport for command demux.
// The command TRANSPORT instances are ephemeral (the selector mints a fresh one
// per openSession); the LINK is not — it persists while foreground + armed.
//
// Single-writer within the foreground: a challenge is answered only in the IDLE
// branch (never while a command exchange is in flight), so a passive answer and a
// command never sign concurrently. Background is native's job (this stays stopped).

import { logi } from '../services/logbus';
import { BleReassembler, frameMessage, MAX_BLE_MESSAGE_SIZE } from './bleFraming';
import { outgoingCorrelators, frameAnswersRequest, type Correlators } from './bleCorrelation';
import { bytesToBase64, base64ToBytes } from './bytes';
import {
  startPassiveEntry,
  setPassiveEntryForegroundActive,
  passiveEntryWriteFrame,
  passiveEntryConnectionState,
  onPassiveEntryFrame,
  onPassiveEntryConnectionState,
} from '../../modules/expo-passive-entry';

const FALLBACK_MTU = 23;
const MAX_EXCHANGE_TIMEOUT_MS = 30000;

export interface ForegroundBleHandlers {
  // Answer a passive-entry challenge frame → bytes to write back, or null.
  authResponder?: ((frame: Uint8Array) => Uint8Array | null) | null;
  // Every idle complete frame (status pushes, CPD, late replies) — decoded downstream.
  onUnsolicited?: ((frame: Uint8Array) => void) | null;
}

class ForegroundBleLink {
  private readonly reassembler = new BleReassembler();
  private inbox: Uint8Array[] = [];
  private waiters: Array<() => void> = [];
  private connectedWaiters: Array<{ resolve: () => void; timer: ReturnType<typeof setTimeout> }> = [];
  private blockLength = FALLBACK_MTU - 3;
  private started = false;
  private vin: string | null = null;
  private exchangeInFlight = false;
  private frameSub: (() => void) | null = null;
  private connSub: (() => void) | null = null;
  private writeChain: Promise<unknown> = Promise.resolve();

  // Always-on handlers (set by useCarLink's foreground lifecycle).
  private authResponder: ((frame: Uint8Array) => Uint8Array | null) | null = null;
  private onUnsolicited: ((frame: Uint8Array) => void) | null = null;

  setHandlers(h: ForegroundBleHandlers): void {
    this.authResponder = h.authResponder ?? null;
    this.onUnsolicited = h.onUnsolicited ?? null;
  }

  // Start (idempotent): subscribe to the native frame/state streams, put native in
  // foreground pipe mode, and arm it for `vin`. Called by the foreground lifecycle
  // (always-on) AND by a command openSession (whichever comes first).
  start(vin: string): void {
    this.vin = vin;
    setPassiveEntryForegroundActive(true);
    if (!this.frameSub) {
      this.frameSub = onPassiveEntryFrame((dataB64) => this.onNativeFrame(base64ToBytes(dataB64)));
    }
    if (!this.connSub) {
      this.connSub = onPassiveEntryConnectionState((e) => {
        if (e.state === 'connected') {
          this.blockLength = Math.min(e.mtu, MAX_BLE_MESSAGE_SIZE) - 3;
          this.resolveConnected();
        }
      });
    }
    startPassiveEntry(vin);
    const snap = passiveEntryConnectionState();
    if (snap.state === 'connected') this.blockLength = Math.min(snap.mtu, MAX_BLE_MESSAGE_SIZE) - 3;
    this.started = true;
  }

  // Stop: detach from the native stream (background hands passive to native; the
  // AppState gate flips setForegroundResponderActive(false) separately). Keeps the
  // native central itself alive.
  stop(): void {
    this.frameSub?.();
    this.frameSub = null;
    this.connSub?.();
    this.connSub = null;
    this.reassembler.reset();
    this.inbox = [];
    this.waiters = [];
    this.exchangeInFlight = false;
    this.started = false;
  }

  isConnected(): boolean {
    return passiveEntryConnectionState().state === 'connected';
  }

  getBlockLength(): number {
    return this.blockLength;
  }

  // awaitConnected — resolve once the native link reports connected (or reject on
  // timeout so the selector can fall through to Pi).
  awaitConnected(timeoutMs: number): Promise<void> {
    if (this.isConnected()) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.connectedWaiters = this.connectedWaiters.filter((w) => w.timer !== timer);
        reject(
          new Error(
            `BLE connection closed — native central did not connect within ${timeoutMs}ms (car asleep/out of range?)`,
          ),
        );
      }, timeoutMs);
      this.connectedWaiters.push({ resolve, timer });
    });
  }

  // exchange — write the framed request and await the first inbox frame whose
  // correlators answer it. One in-flight exchange at a time (the demux assumes it).
  async exchange(payloadB64: string, timeoutMs: number): Promise<string> {
    if (!this.isConnected()) {
      throw new Error('BLE connection closed — native central not connected');
    }
    const req = base64ToBytes(payloadB64);
    const want = outgoingCorrelators(req);
    this.inbox = [];
    this.exchangeInFlight = true;
    try {
      await this.writeMessage(req);
      const clamped = Math.min(Math.max(timeoutMs, 0), MAX_EXCHANGE_TIMEOUT_MS);
      const matched = await this.awaitMatchingFrame(want, clamped);
      return bytesToBase64(matched);
    } finally {
      this.exchangeInFlight = false;
    }
  }

  // sendRaw — write a pre-built frame, no reply (passive answers, add-key). Safe
  // mid-exchange: the write lock keeps its chunks from interleaving.
  async sendRaw(frame: Uint8Array): Promise<void> {
    if (!this.isConnected()) return;
    await this.writeMessage(frame);
  }

  // --- internals -----------------------------------------------------------

  private onNativeFrame(bytes: Uint8Array): void {
    const frames = this.reassembler.push(bytes, Date.now());
    if (frames.length === 0) return;
    if (this.exchangeInFlight) {
      // A command reply is expected — buffer for the correlator. (A challenge that
      // lands here is NOT answered until the exchange finishes, which keeps passive
      // and command signing from overlapping the shared counter.)
      this.inbox.push(...frames);
      this.wake();
    } else {
      // ALWAYS-ON: answer challenges + run CPD/status pushes on every idle frame.
      for (const f of frames) {
        try {
          const reply = this.authResponder?.(f) ?? null;
          if (reply) void this.sendRaw(reply);
        } catch {
          // A responder fault must never take down the notification path.
        }
        this.onUnsolicited?.(f);
      }
    }
  }

  private writeMessage(payload: Uint8Array): Promise<void> {
    return this.withWriteLock(async () => {
      const framed = frameMessage(payload);
      const ok = passiveEntryWriteFrame(bytesToBase64(framed));
      if (!ok) throw new Error('BLE connection closed — native writeFrame failed');
    });
  }

  private withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.writeChain.then(fn, fn);
    this.writeChain = run.catch(() => undefined);
    return run;
  }

  private resolveConnected(): void {
    const pending = this.connectedWaiters;
    this.connectedWaiters = [];
    for (const w of pending) {
      clearTimeout(w.timer);
      w.resolve();
    }
  }

  private wake(): void {
    const pending = this.waiters;
    this.waiters = [];
    for (const resolveWaiter of pending) resolveWaiter();
  }

  private drainInbox(want: Correlators): Uint8Array | null {
    while (this.inbox.length > 0) {
      const frame = this.inbox.shift()!;
      if (frameAnswersRequest(frame, want)) return frame;
      this.onUnsolicited?.(frame);
    }
    return null;
  }

  private awaitMatchingFrame(want: Correlators, timeoutMs: number): Promise<Uint8Array> {
    const already = this.drainInbox(want);
    if (already) return Promise.resolve(already);
    return new Promise<Uint8Array>((resolve, reject) => {
      let settled = false;
      const check = () => {
        if (settled) return;
        const frame = this.drainInbox(want);
        if (frame) {
          settled = true;
          clearTimeout(timer);
          resolve(frame);
          return;
        }
        this.waiters.push(check);
      };
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.waiters = this.waiters.filter((w) => w !== check);
        reject(
          new Error(
            `stale frame: no matching response within ${timeoutMs}ms (timeout — car sent no reply, or only unrelated/unsolicited frames)`,
          ),
        );
      }, timeoutMs);
      this.waiters.push(check);
    });
  }
}

// The one persistent foreground link. useCarLink owns its start/stop + handlers;
// BridgedBleTransport borrows its exchange()/sendRaw for command demux.
export const foregroundBleLink = new ForegroundBleLink();
