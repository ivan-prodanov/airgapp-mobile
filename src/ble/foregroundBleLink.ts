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
import { parseAuthenticationRequest } from './passiveEntryAuth';
import { noteChallengeArrived, noteAnswerWritten, noteChallengeDropped } from './passiveEntryLatency';
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
  private writePending = false;
  // Challenges that arrived inside the seal→write hazard. Answered the moment it
  // clears — see the drain in exchange().
  private deferredChallenges: Uint8Array[] = [];
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
    // writePending is the ONLY interval in which the responder must stay quiet.
    // The command is sealed UPSTREAM (session.ts) before it gets here, so its
    // counter is already allocated; a responder seal that reaches the car first
    // would arrive out of order and be hard-rejected. Once these bytes are
    // written that hazard is gone — any later seal is strictly later — so the
    // reply wait below, which is the multi-second part, needs no protection at
    // all. Deafness that lasted a whole exchange was protecting ~1ms with ~6s.
    this.writePending = true;
    try {
      await this.writeMessage(req);
      this.writePending = false;
      // The hazard is over: our bytes are out, so any seal from here is strictly
      // later. Answer anything that arrived during it. The delay is one BLE
      // write — tens of milliseconds against the car's ~6s challenge window — so
      // deferring costs nothing and drops nothing.
      this.drainDeferredChallenges();
      const clamped = Math.min(Math.max(timeoutMs, 0), MAX_EXCHANGE_TIMEOUT_MS);
      const matched = await this.awaitMatchingFrame(want, clamped);
      return bytesToBase64(matched);
    } finally {
      this.writePending = false;
      // A throw before the write leaves the frame unanswerable in order, and the
      // car will have re-challenged by the next one. Drop rather than answer a
      // dead nonce with a fresh counter.
      this.deferredChallenges = [];
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
      // A command reply is expected — buffer for the correlator, AND answer any
      // challenge unless we are inside the tiny seal→write hazard (writePending).
      //
      // This used to skip the responder for the whole exchange. Nothing ever
      // picked those frames back up — drainInbox hands non-matching frames to
      // onUnsolicited, which does not answer challenges — so a challenge landing
      // here was not deferred, it was LOST. PE-1 measured it: 15 challenges
      // during 20s of continuous reads, 0 answered, versus 1-for-1 at 2ms when
      // the link was idle.
      this.inbox.push(...frames);
      this.wake();
      for (const f of frames) {
        if (this.writePending) {
          // DEFER, do not drop. Sealing now could overtake the command's seal,
          // but the constraint is ORDERING, not immediacy — so hold the frame
          // and answer it as soon as the write lands.
          if (parseAuthenticationRequest(f)) this.deferredChallenges.push(f);
          continue;
        }
        this.answerIfChallenge(f);
      }
    } else {
      // ALWAYS-ON: answer challenges + run CPD/status pushes on every idle frame.
      for (const f of frames) {
        this.answerIfChallenge(f);
        this.onUnsolicited?.(f);
      }
    }
  }

  // drainDeferredChallenges — answer whatever arrived during the hazard window.
  //
  // Bounded and freshest-first: if several piled up, the car has re-challenged
  // and only the newest nonce is still live, so answering stale ones would just
  // spend counters on requests the car has already given up on.
  private drainDeferredChallenges(): void {
    if (this.deferredChallenges.length === 0) return;
    const pending = this.deferredChallenges;
    this.deferredChallenges = [];
    const newest = pending[pending.length - 1];
    this.answerIfChallenge(newest);
  }

  // answerIfChallenge — the one passive-entry answer path, shared by the idle
  // branch and the mid-exchange one so they can never drift apart.
  //
  // RESPONSE-14 refinement #2: SIGN INSIDE THE LOCK. The seal consumes the
  // shared VS counter, so signing outside it could interleave with a command's
  // write and reach the car out of order. Holding the lock across sign→write
  // makes it atomic with respect to the command path, which is exactly what
  // makes answering during a command's REPLY WAIT safe.
  private answerIfChallenge(f: Uint8Array): void {
    const isChallenge = parseAuthenticationRequest(f) !== null;
    if (isChallenge) noteChallengeArrived(Date.now(), false);
    void this.withWriteLock(async () => {
      let reply: Uint8Array | null = null;
      try {
        reply = this.authResponder?.(f) ?? null;
      } catch {
        if (isChallenge) noteChallengeDropped();
        return; // a responder fault must never take down the notify path
      }
      if (!reply || !this.isConnected()) {
        // Consulted and declined: circuit breaker, rate limit, bad token.
        // Recorded apart from the deaf window — those are choices, that was a
        // defect, and merging them would hide one behind the other.
        if (isChallenge) noteChallengeDropped();
        return;
      }
      const framed = frameMessage(reply);
      if (!passiveEntryWriteFrame(bytesToBase64(framed))) {
        logi('ble', 'passive answer write failed (link dropped)');
        if (isChallenge) noteChallengeDropped();
        return;
      }
      // Stamped at the WRITE, not the decision — the queueing is the part worth
      // measuring.
      if (isChallenge) noteAnswerWritten(Date.now());
    });
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
        // Attach the reassembler's state to the ONE message a wedge always
        // produces. The wedge (docs/BLE-WEDGE-2026-07-26.md) has two candidate
        // causes that are indistinguishable from outside: frames that are
        // well-formed but answer an older request, versus frames that are not
        // well-formed at all because the byte stream desynced. These four
        // numbers separate them, and they appear exactly where anyone
        // investigating will already be looking.
        const st = this.reassembler.stats();
        reject(
          new Error(
            `stale frame: no matching response within ${timeoutMs}ms ` +
              `(timeout — car sent no reply, or only unrelated/unsolicited frames) ` +
              `[rx: implausible=${st.implausibleFrames} consecutive=${st.consecutiveImplausible} ` +
              `residual=${st.residualBytes}B staleFlushes=${st.staleFlushes}]`,
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
