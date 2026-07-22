// bridgedBleTransport.ts — BridgedBleTransport: a CarTransport that talks to the
// car's BLE GATT server through the NATIVE central (modules/expo-passive-entry)
// instead of a JS-owned react-native-ble-plx central.
//
// This is model (b) from RESPONSE-12: iOS forbids transferring a live CoreBluetooth
// connection between centrals, so ONE native central must own the car link full-time
// (foreground + background, via State Restoration) and the JS command path submits
// BLE *bytes* to it. Native is a dumb byte-pipe in the foreground (it forwards every
// raw 0213 notification here and writes what we hand it to 0212); ALL command crypto,
// framing, correlation, and the passive-entry responder stay in TS — this file reuses
// the SAME pure, unit-tested core as directBleTransport.ts (bleFraming / bleCorrelation)
// and the SAME inbox/waiter/exchangeInFlight router.
//
// Unlike directBleTransport.ts this imports NO react-native-ble-plx — it reaches BLE
// only through the native bridge, so it cannot construct a second phone central (the
// two-manager contention that wedges the car). closeSession() does NOT disconnect: the
// native central owns the link across command sessions and into the background.
//
// Concurrency: one in-flight exchange() at a time (the demux assumes it), same as
// DirectBleTransport.

import { logi } from '../services/logbus';
import { BleReassembler, frameMessage, MAX_BLE_MESSAGE_SIZE } from './bleFraming';
import { outgoingCorrelators, frameAnswersRequest, type Correlators } from './bleCorrelation';
import { buildAddKeyMessage } from './bleEnroll';
import { bytesToBase64, base64ToBytes } from './bytes';
import type { CarTransport } from './types';
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
// How long openSession waits for the native central to report a connected link
// (scan + connect + GATT discovery happen natively). Matches DirectBleTransport's
// scan budget so BLE-primary/Pi-fallback gives up on an out-of-range car promptly.
const CONNECT_TIMEOUT_MS = 20000;

export interface BridgedBleTransportDebugInfo {
  deviceName: string | null;
  blockLength: number;
}

export class BridgedBleTransport implements CarTransport {
  private readonly reassembler = new BleReassembler();
  private inbox: Uint8Array[] = [];
  // waiters: pending exchange() calls blocked on a matching reply — same
  // re-scan-the-inbox protocol as DirectBleTransport.
  private waiters: Array<() => void> = [];
  private blockLength = FALLBACK_MTU - 3;
  private connected = false;
  private sessionId: string | null = null;
  private frameSub: (() => void) | null = null;
  private connSub: (() => void) | null = null;
  // Resolvers for openSession's awaitConnected, fired by the connectionState stream.
  private connectedWaiters: Array<{ resolve: () => void; timer: ReturnType<typeof setTimeout> }> = [];

  private readonly onUnsolicited: ((frame: Uint8Array) => void) | null;
  private readonly authResponder: ((frame: Uint8Array) => Uint8Array | null) | null;
  private exchangeInFlight = false;

  constructor(opts?: {
    // Accepted for drop-in compatibility with DirectBleTransport, but IGNORED —
    // scanning is the native central's job (it filters on service 1122 and
    // matches by name), so there's no JS scan budget to bound here.
    scanTimeoutMs?: number;
    onUnsolicited?: (frame: Uint8Array) => void;
    authResponder?: (frame: Uint8Array) => Uint8Array | null;
  }) {
    this.authResponder = opts?.authResponder ?? null;
    this.onUnsolicited = opts?.onUnsolicited ?? null;
  }

  // openSession puts the native central into foreground pipe mode, arms it for
  // `vin`, and waits for it to report a connected link. The native side does the
  // scan/connect/GATT-discovery; TS drives the handshake afterwards via exchange().
  async openSession(vin: string): Promise<string> {
    // Foreground: TS owns crypto; native is a dumb pipe (won't self-handshake).
    setPassiveEntryForegroundActive(true);
    // Subscribe BEFORE start so no early notification is missed.
    this.attachStreams();
    this.reassembler.reset();
    this.inbox = [];
    this.waiters = [];
    startPassiveEntry(vin);
    await this.awaitConnected(CONNECT_TIMEOUT_MS);
    const snap = passiveEntryConnectionState();
    this.blockLength = Math.min(snap.mtu, MAX_BLE_MESSAGE_SIZE) - 3;
    logi('ble', 'bridged link up', { mtu: snap.mtu, blockLength: this.blockLength });
    this.connected = true;
    this.sessionId = vin; // native identifies the car by VIN
    return this.sessionId;
  }

  private attachStreams(): void {
    this.detachStreams();
    this.frameSub = onPassiveEntryFrame((dataB64) => this.onNativeFrame(base64ToBytes(dataB64)));
    this.connSub = onPassiveEntryConnectionState((e) => {
      if (e.state === 'connected') {
        this.blockLength = Math.min(e.mtu, MAX_BLE_MESSAGE_SIZE) - 3;
        this.resolveConnected();
      } else if (e.state === 'disconnected') {
        this.connected = false;
      }
    });
  }

  private detachStreams(): void {
    this.frameSub?.();
    this.frameSub = null;
    this.connSub?.();
    this.connSub = null;
  }

  private resolveConnected(): void {
    const pending = this.connectedWaiters;
    this.connectedWaiters = [];
    for (const w of pending) {
      clearTimeout(w.timer);
      w.resolve();
    }
  }

  private awaitConnected(timeoutMs: number): Promise<void> {
    if (passiveEntryConnectionState().state === 'connected') return Promise.resolve();
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

  // onNativeFrame: the RX path — byte-for-byte the same routing as
  // DirectBleTransport's monitorCharacteristic callback, fed from the native
  // pipe instead of a ble-plx notification.
  private onNativeFrame(bytes: Uint8Array): void {
    const frames = this.reassembler.push(bytes, Date.now());
    logi('ble', 'pipe rx', { bytes: bytes.length, msgs: frames.length, inFlight: this.exchangeInFlight });
    if (frames.length === 0) return;
    if (this.exchangeInFlight) {
      this.inbox.push(...frames);
      this.wake();
    } else {
      for (const f of frames) {
        // PASSIVE ENTRY: answer the car's AuthenticationRequest HERE, on the link
        // that received it, before any hop through app state (car retries ~1 Hz,
        // gives up in ~6-10 s). Returns null for non-challenges.
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

  // exchange: identical demux to DirectBleTransport — drain stale, write the
  // framed request, await the first inbox frame whose correlators answer it.
  async exchange(sessionId: string, payloadB64: string, timeoutMs: number): Promise<string> {
    if (!this.connected || this.sessionId !== sessionId) {
      throw new Error(`BLE connection closed — no active connection for session ${sessionId}`);
    }
    const req = base64ToBytes(payloadB64);
    const want = outgoingCorrelators(req);

    this.inbox = [];
    this.exchangeInFlight = true;
    try {
      await this.writeMessage(req);
      const clampedTimeout = Math.min(Math.max(timeoutMs, 0), MAX_EXCHANGE_TIMEOUT_MS);
      const matched = await this.awaitMatchingFrame(want, clampedTimeout);
      return bytesToBase64(matched);
    } finally {
      this.exchangeInFlight = false;
    }
  }

  // sendRaw writes a pre-built frame and does NOT wait for a reply (used by the
  // passive-entry responder). Safe to fire mid-exchange — the write lock keeps
  // its chunks from interleaving another writer's.
  async sendRaw(frame: Uint8Array): Promise<void> {
    if (!this.connected) return;
    await this.writeMessage(frame);
  }

  // sendAddKey writes the VCSEC add-key enrollment message (unauthenticated, no
  // reply) on the open connection — same extra as DirectBleTransport.sendAddKey.
  async sendAddKey(publicKeyB64: string): Promise<void> {
    if (!this.connected) {
      throw new Error('BLE connection closed — no active connection: call openSession(vin) first');
    }
    const payload = buildAddKeyMessage(base64ToBytes(publicKeyB64));
    await this.writeMessage(payload);
  }

  // closeSession drops the command-session view but LEAVES the native central
  // connected — it owns the car link full-time (model (b)) and tearing it down
  // would kill background passive entry. Never throws.
  async closeSession(_sessionId: string): Promise<void> {
    this.connected = false;
    this.sessionId = null;
    this.inbox = [];
    this.reassembler.reset();
    this.waiters = [];
    this.detachStreams();
  }

  getDebugInfo(): BridgedBleTransportDebugInfo {
    return {
      deviceName: passiveEntryConnectionState().state === 'connected' ? 'native-pipe' : null,
      blockLength: this.blockLength,
    };
  }

  // --- internals -----------------------------------------------------------

  // writeMessage builds the framed (2-byte BE length prefix + payload) buffer and
  // hands it to native, which splits it to the negotiated MTU and writes 0212
  // .withResponse. One writeFrame call per message → native enqueues all chunks
  // atomically, so the write lock only needs to order whole messages.
  private writeMessage(payload: Uint8Array): Promise<void> {
    return this.withWriteLock(async () => {
      const framed = frameMessage(payload);
      const ok = passiveEntryWriteFrame(bytesToBase64(framed));
      logi('ble', 'pipe tx', { bytes: framed.length, ok });
      if (!ok) throw new Error('BLE connection closed — native writeFrame failed');
    });
  }

  private writeChain: Promise<unknown> = Promise.resolve();
  private withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.writeChain.then(fn, fn);
    this.writeChain = run.catch(() => undefined);
    return run;
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
