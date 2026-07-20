// directBleTransport.ts — DirectBleTransport: a CarTransport that talks to
// the car's BLE GATT server directly via react-native-ble-plx, in place of
// the RPi HTTP forwarder, when the phone is physically near the car. This
// file is ONLY the hardware byte pipe — scan, connect, chunked write,
// notification reassembly, request/response demux — composed entirely from
// the pure, unit-tested BLE-1 core (bleScanName/bleFraming/bleCorrelation).
// All crypto/protobuf/session/retry policy lives in session.ts/gateway.ts
// and is transport-agnostic; neither of those modules knows or cares
// whether the opaque bytes crossed the Pi or this direct link.
//
// See docs/superpowers/plans/tesla-ble-transport-spec.md:
//   §1 GATT UUIDs, §3 write framing/chunking, §4 notification reassembly,
//   §5 connect sequence, §6 frame demux, §8 react-native-ble-plx mapping.
//
// RN-only (imports react-native-ble-plx) — same isolation rule as
// secureStoreSecretStore.ts: no node-tested module may import this file,
// and it must never be added to package.json's `test` script (ble-plx
// can't load under node/tsx). Only src/app/carlink.tsx (the hardware
// bring-up harness) imports it, and it imports it directly — NOT
// re-exported from src/ble/index.ts, same as the secure-store adapter.
//
// Concurrency: the session engine (queue.ts's SessionQueue) serialises
// exchanges per VIN and both BLE domains (VCSEC/Infotainment) share ONE
// link, so this class holds exactly one connected Device and supports
// exactly one in-flight exchange() at a time. Do NOT add parallel-exchange
// support on one connection — the demux logic assumes it.

import { BleManager, BleErrorCode, State } from 'react-native-ble-plx';
import type { Device, Subscription } from 'react-native-ble-plx';

import { vehicleLocalName } from './bleScanName';
import { BleReassembler, frameForWrite, MAX_BLE_MESSAGE_SIZE } from './bleFraming';
import { outgoingCorrelators, frameAnswersRequest, type Correlators } from './bleCorrelation';
import { buildAddKeyMessage } from './bleEnroll';
import { bytesToBase64, base64ToBytes } from './bytes';
import type { CarTransport } from './types';

// GATT UUIDs — spec §1.
const SERVICE_UUID = '00000211-b2d1-43f0-9b88-960cebf8b91e';
const TX_UUID = '00000212-b2d1-43f0-9b88-960cebf8b91e'; // phone -> car, WRITE (with response)
const RX_UUID = '00000213-b2d1-43f0-9b88-960cebf8b91e'; // car -> phone, NOTIFY

// MTU negotiation — spec §3/§8. ble-plx's documented un-negotiated default
// is 23; requestMTU(515) is the SDK's maxBLEMTUSize.
const REQUEST_MTU = 515;
const FALLBACK_MTU = 23;

// How long we wait for the BLE stack to report PoweredOn before surfacing
// the current (bad) state to the caller — long enough to ride out a
// PoweredOn event that's already in flight, short enough not to hang the
// harness on a phone with Bluetooth off / permission denied.
const BLUETOOTH_GRACE_MS = 3000;

// How long to scan for the vehicle's advertisement before giving up —
// spec §5 step 1. The car only advertises while its BLE radio is awake
// (VCSEC domain never sleeps, so this should find an in-range car quickly).
// Default for the constructor's scanTimeoutMs option (see the class).
const SCAN_TIMEOUT_MS = 20000;

// Spec §6: exchange() timeouts are caller-supplied (session.ts's
// SESSION_INFO_TIMEOUT_MS / COMMAND_TIMEOUT_MS); clamp to the spec's stated
// max regardless of what's passed in.
const MAX_EXCHANGE_TIMEOUT_MS = 30000;

// How long each individual ble-plx connect step may take before we declare
// the link wedged (spec §5). ble-plx's connect/discover/requestMTU carry NO
// timeout of their own, and a wedged CoreBluetooth call can hang FOREVER —
// which used to strand the gateway's whole retry loop (and the UI spinner
// behind it) on one attempt that never returned. Each is bounded here so a
// hung step surfaces as a dead link the gateway can evict + retry.
const CONNECT_STEP_TIMEOUT_MS = 10000;

function errMsg(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e) {
    const m = (e as { message?: unknown }).message;
    if (typeof m === 'string') return m;
  }
  return String(e);
}

// withTimeout bounds a ble-plx promise that has no timeout of its own. The
// rejection message deliberately leads with "BLE connection closed" so
// session.ts's isTransportDeadError matches it by substring — a wedged step
// is treated exactly like a dropped link (evict + re-handshake), consistent
// with how exchange()'s write failures are surfaced.
//
// NOTE: this does not cancel the underlying native call — nothing can. It
// only stops US from waiting on it; the orphaned call settles into the void
// and the next attempt cold-handshakes a fresh connection.
function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`BLE connection closed — ${what} timed out after ${ms}ms (link wedged)`)),
      ms,
    );
  });
  return Promise.race([p, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  }) as Promise<T>;
}

// isConnectionLostError recognizes ble-plx failure signatures meaning "the
// link to the car is gone" — checked by errorCode (native BleError, the
// common case) and by message substring (fallback for any other thrown
// shape). Used to decide whether a write failure should be surfaced as a
// dead link (see exchange()'s write catch).
function isConnectionLostError(e: unknown): boolean {
  const code = (e as { errorCode?: unknown } | null)?.errorCode;
  if (
    code === BleErrorCode.DeviceDisconnected ||
    code === BleErrorCode.DeviceNotConnected ||
    code === BleErrorCode.OperationCancelled
  ) {
    return true;
  }
  const msg = errMsg(e).toLowerCase();
  return (
    msg.includes('not connected') ||
    msg.includes('disconnected') ||
    msg.includes('cancelled') ||
    msg.includes('canceled')
  );
}

// DirectBleTransportDebugInfo is harness-only introspection (the "BLE scan
// test" button in carlink.tsx) — not part of the CarTransport contract.
export interface DirectBleTransportDebugInfo {
  deviceName: string | null;
  blockLength: number;
}

export class DirectBleTransport implements CarTransport {
  private readonly manager: BleManager = new BleManager();
  private device: Device | null = null;
  private sessionId: string | null = null;
  private readonly reassembler = new BleReassembler();
  private inbox: Uint8Array[] = [];
  private sub: Subscription | null = null;
  private blockLength = FALLBACK_MTU - 3;
  // waiters: pending exchange() calls blocked on a matching reply. The RX
  // monitor callback calls wake() whenever a complete frame arrives; each
  // waiter re-scans the inbox (see awaitMatchingFrame) rather than assuming
  // the frame that woke it is the one it wants (multiple exchanges never
  // overlap per the concurrency note above, but a waiter can still wake on a
  // frame meant to be discarded as a stale broadcast).
  private waiters: Array<() => void> = [];
  // How long scanForVehicle waits before giving up — defaults to
  // SCAN_TIMEOUT_MS (today's behavior). The selector (transportSelector.ts)
  // overrides this to a short budget so BLE-primary/Pi-fallback gives up on
  // an out-of-range car quickly instead of holding up the fallback for the
  // full 20s.
  private readonly scanTimeoutMs: number;
  // Sink for UNSOLICITED frames — the car-initiated VCSEC VehicleStatus pushes
  // that arrive while idle, or that don't answer an in-flight exchange. null =
  // dropped (today's behavior). The consumer decodes them (vcsecPush.ts) and
  // applies closure/lock changes instantly instead of waiting for the poll.
  private readonly onUnsolicited: ((frame: Uint8Array) => void) | null;
  // Passive-entry challenge responder. Given a raw unsolicited frame it returns
  // the bytes to write back, or null. Injected so this file stays the pure
  // hardware byte pipe — no crypto, no session lookup here.
  private readonly authResponder: ((frame: Uint8Array) => Uint8Array | null) | null;
  // True only while exchange() is awaiting its reply — gates whether an inbound
  // frame is a candidate reply (buffered in the inbox for correlator matching)
  // or an unsolicited push (forwarded straight to onUnsolicited).
  private exchangeInFlight = false;

  constructor(opts?: {
    scanTimeoutMs?: number;
    onUnsolicited?: (frame: Uint8Array) => void;
    authResponder?: (frame: Uint8Array) => Uint8Array | null;
  }) {
    this.scanTimeoutMs = opts?.scanTimeoutMs ?? SCAN_TIMEOUT_MS;
    this.authResponder = opts?.authResponder ?? null;
    this.onUnsolicited = opts?.onUnsolicited ?? null;
  }

  // openSession scans for, connects to, and subscribes on the car's BLE
  // GATT server (spec §5). Returns the connected device's id as the
  // sessionId — exchange()/closeSession() use it only to confirm they're
  // being called against the connection they think is live.
  async openSession(vin: string): Promise<string> {
    // Best-effort teardown of any previous connection this instance was
    // holding (e.g. a stale/disconnected link from a prior handshake that
    // the gateway is now re-opening after evictSession).
    await this.cleanupDevice();
    await this.ensurePoweredOn();
    const scanned = await this.scanForVehicle(vin);

    let dev = await withTimeout(scanned.connect(), CONNECT_STEP_TIMEOUT_MS, 'connect');
    dev = await withTimeout(
      dev.discoverAllServicesAndCharacteristics(),
      CONNECT_STEP_TIMEOUT_MS,
      'service discovery',
    );

    let mtu = FALLBACK_MTU;
    try {
      dev = await withTimeout(dev.requestMTU(REQUEST_MTU), CONNECT_STEP_TIMEOUT_MS, 'MTU negotiation');
      mtu = dev.mtu ?? FALLBACK_MTU;
    } catch {
      // MTU negotiation failed OR wedged past its timeout — either way proceed
      // on the un-negotiated default rather than failing openSession. (A hung
      // requestMTU keeps its existing fallback behavior: the catch swallows the
      // withTimeout rejection, so a timed-out MTU is just FALLBACK_MTU.)
      mtu = FALLBACK_MTU;
    }
    this.blockLength = Math.min(mtu, MAX_BLE_MESSAGE_SIZE) - 3;

    this.reassembler.reset();
    this.inbox = [];
    this.waiters = [];

    this.sub = dev.monitorCharacteristicForService(SERVICE_UUID, RX_UUID, (error, char) => {
      if (error || !char?.value) return;
      const bytes = base64ToBytes(char.value);
      const frames = this.reassembler.push(bytes, Date.now());
      if (frames.length === 0) return;
      if (this.exchangeInFlight) {
        // An exchange is awaiting its reply — buffer for correlator matching.
        this.inbox.push(...frames);
        this.wake();
      } else {
        // Idle link: nothing is waiting on a reply, so every complete frame is
        // an unsolicited car push. Surface it (the consumer filters to VCSEC
        // status frames) instead of letting it rot in the inbox to be wiped by
        // the next exchange's stale-drain.
        for (const f of frames) {
          // PASSIVE ENTRY (M1): answer the car's AuthenticationRequest HERE,
          // on the link that received it, before any hop through app state.
          // The car retries at ~1 Hz and gives up in ~6-10 s, so latency to
          // the reply is the whole game. Returns null for anything that is
          // not a challenge, so routine pushes fall straight through.
          try {
            const reply = this.authResponder?.(f) ?? null;
            if (reply) void this.sendRaw(reply);
          } catch {
            // A responder fault must never take down the notification path
            // that instant-closures also ride on.
          }
          this.onUnsolicited?.(f);
        }
      }
    });

    this.device = dev;
    this.sessionId = dev.id;
    return this.sessionId;
  }

  // sendRaw writes a pre-built frame and does NOT wait for a reply. Used by the
  // passive-entry responder: an AuthenticationResponse is answered by the car
  // acting (or not), not by a correlated reply, so waiting would just occupy the
  // link. Deliberately does not touch exchangeInFlight — it must be safe to fire
  // while an exchange is in progress.
  async sendRaw(frame: Uint8Array): Promise<void> {
    const dev = this.device;
    if (!dev) return;
    // MUST hold the write lock. A frame is written as SEVERAL chunks, and this
    // module's contract is one writer at a time — interleaving another writer's
    // chunks corrupts both frames on the wire. Learned the hard way: an
    // un-awaited sendRaw from the notification handler raced exchange()'s chunk
    // loop and broke the session handshake, so the link stayed up (unsolicited
    // frames kept arriving) while every poll failed and the UI never went live.
    await this.withWriteLock(async () => {
      for (const chunk of frameForWrite(frame, this.blockLength)) {
        await dev.writeCharacteristicWithResponseForService(
          SERVICE_UUID,
          TX_UUID,
          bytesToBase64(chunk),
        );
      }
    });
  }

  // withWriteLock serialises every multi-chunk write on this link. Cheap: the
  // only contenders are exchange() and sendRaw().
  private writeChain: Promise<unknown> = Promise.resolve();
  private withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.writeChain.then(fn, fn);
    this.writeChain = run.catch(() => undefined);
    return run;
  }

  // exchange sends one RoutableMessage and returns the demuxed matching
  // reply (spec §6): drain stale buffered frames, write the chunked
  // request sequentially, then wait for the first inbox frame whose
  // correlators answer it — discarding non-matching frames (unsolicited
  // broadcasts / late replies to earlier commands) as they're inspected.
  async exchange(sessionId: string, payloadB64: string, timeoutMs: number): Promise<string> {
    if (!this.device || this.sessionId !== sessionId) {
      throw new Error(`BLE connection closed — no active connection for session ${sessionId}`);
    }
    const device = this.device;

    const req = base64ToBytes(payloadB64);
    const want = outgoingCorrelators(req);

    // Drain stale: anything buffered before we send can't be our reply.
    this.inbox = [];
    // From here until we get our reply, inbound frames are candidate replies
    // (buffered), not pushes. Reset in the finally so the idle link resumes
    // routing frames straight to onUnsolicited.
    this.exchangeInFlight = true;
    try {
      const chunks = frameForWrite(req, this.blockLength);
      try {
        // Same write lock sendRaw() takes. A one-sided lock is no lock: the
        // passive-entry responder can fire between our chunks otherwise, and
        // both frames land corrupted.
        await this.withWriteLock(async () => {
          for (const chunk of chunks) {
            // WITH response — the Go connector writes each chunk with noRsp=false
            // (ble.go:121), i.e. an ATT Write Request the car ACKs; the Tesla TX
            // characteristic ignores Write-Without-Response commands (they leave
            // the car silent → our exchange times out as a "stale frame").
            await device.writeCharacteristicWithResponseForService(
              SERVICE_UUID,
              TX_UUID,
              bytesToBase64(chunk),
            );
          }
        });
    } catch (e) {
      // Any write failure on a connection we believed was live almost
      // always means the link just dropped. Surface uniformly as "BLE
      // connection closed" so session.ts's isTransportDeadError recognizes
      // it and the gateway evicts + re-handshakes on a fresh connection
      // instead of retrying writes against a dead peripheral.
      const detail = isConnectionLostError(e) ? errMsg(e) : `unexpected write error: ${errMsg(e)}`;
      throw new Error(`BLE connection closed — write failed: ${detail}`);
    }

      const clampedTimeout = Math.min(Math.max(timeoutMs, 0), MAX_EXCHANGE_TIMEOUT_MS);
      const matched = await this.awaitMatchingFrame(want, clampedTimeout);
      return bytesToBase64(matched);
    } finally {
      this.exchangeInFlight = false;
    }
  }

  // sendAddKey writes the VCSEC add-key enrollment message (spec §7) on the
  // already-open connection — NOT part of the CarTransport contract, an
  // enrollment extra parallel to PiClient.enrollPublicKey. Unlike
  // exchange(), this is unauthenticated, has no session/correlator, and is
  // NOT a RoutableMessage — but it rides the exact same TX characteristic
  // and 2-byte-length write framing/chunking as every other write. It does
  // NOT await a reply: the car doesn't confirm over BLE, the operator taps
  // an existing NFC key card on the console to approve, and success is
  // detected afterward by running a normal command (a working lock/read
  // means the key is on the car).
  async sendAddKey(publicKeyB64: string): Promise<void> {
    if (!this.device) {
      throw new Error('BLE connection closed — no active connection: call openSession(vin) first');
    }
    const device = this.device;

    const pub = base64ToBytes(publicKeyB64);
    const payload = buildAddKeyMessage(pub);
    const chunks = frameForWrite(payload, this.blockLength);
    try {
      for (const chunk of chunks) {
        // Same write path as exchange() — with response (see exchange()'s
        // comment: the Tesla TX characteristic ignores
        // Write-Without-Response commands).
        await device.writeCharacteristicWithResponseForService(SERVICE_UUID, TX_UUID, bytesToBase64(chunk));
      }
    } catch (e) {
      const detail = isConnectionLostError(e) ? errMsg(e) : `unexpected write error: ${errMsg(e)}`;
      throw new Error(`BLE connection closed — write failed: ${detail}`);
    }
  }

  // closeSession disconnects and clears all per-connection state. Never
  // throws — cancelConnection failures (already disconnected, destroyed
  // manager, etc.) are best-effort; the caller only needs the link gone.
  async closeSession(_sessionId: string): Promise<void> {
    await this.cleanupDevice();
  }

  // getDebugInfo is harness-only introspection for the "BLE scan test"
  // button (carlink.tsx) — NOT part of the CarTransport contract.
  getDebugInfo(): DirectBleTransportDebugInfo {
    return {
      deviceName: this.device?.name ?? this.device?.localName ?? null,
      blockLength: this.blockLength,
    };
  }

  // --- internals -----------------------------------------------------------

  private async cleanupDevice(): Promise<void> {
    this.sub?.remove();
    this.sub = null;
    const dev = this.device;
    this.device = null;
    this.sessionId = null;
    this.inbox = [];
    this.reassembler.reset();
    this.waiters = [];
    if (dev) {
      await dev.cancelConnection().catch(() => {});
    }
  }

  private wake(): void {
    const pending = this.waiters;
    this.waiters = [];
    for (const resolveWaiter of pending) resolveWaiter();
  }

  // drainInbox pops frames off the inbox in arrival order until it finds
  // one that answers `want`, discarding every non-matching frame along the
  // way — they're stale broadcasts / replies to an earlier request and can
  // never become our answer later (spec §6.d).
  private drainInbox(want: Correlators): Uint8Array | null {
    while (this.inbox.length > 0) {
      const frame = this.inbox.shift()!;
      if (frameAnswersRequest(frame, want)) return frame;
      // Non-matching frame that arrived during the exchange: a stale broadcast
      // or an unsolicited VCSEC push. Surface it rather than only discarding —
      // the consumer decodes/filters (vcsecPush ignores anything non-VCSEC).
      this.onUnsolicited?.(frame);
    }
    return null;
  }

  private awaitMatchingFrame(want: Correlators, timeoutMs: number): Promise<Uint8Array> {
    // Re-check synchronously first — a matching frame may already have
    // arrived (e.g. buffered mid-write, before we started waiting).
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
        // No match yet — wake() drains the waiter list before invoking each
        // callback, so we must re-register to be woken by the next frame.
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

  private ensurePoweredOn(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      let lastState: State = State.Unknown;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        sub.remove();
        reject(
          new Error(
            `Bluetooth is not available (state=${lastState}) — enable Bluetooth / grant Bluetooth permission in Settings and try again`,
          ),
        );
      }, BLUETOOTH_GRACE_MS);
      const sub = this.manager.onStateChange((state) => {
        lastState = state;
        if (state === State.PoweredOn) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          sub.remove();
          resolve();
        }
      }, true);
    });
  }

  private scanForVehicle(vin: string): Promise<Device> {
    const targetName = vehicleLocalName(vin);
    return new Promise<Device>((resolve, reject) => {
      let settled = false;
      // Diagnostic: every distinct named device we saw this scan. Surfaced in
      // the timeout error so a pulled log tells us whether the car was
      // seen-but-unmatched (name-field issue) vs genuinely not advertising
      // (asleep / already at max BLE clients / Pi holding the link).
      const seenNames = new Set<string>();
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.manager.stopDeviceScan().catch(() => {});
        const names = [...seenNames];
        const teslaLike = names.filter((n) => /^S[0-9a-f]{16}C$/i.test(n));
        reject(
          new Error(
            `car not found (asleep or out of BLE range?) — no advertisement matching ${targetName} within ${this.scanTimeoutMs}ms` +
              ` · saw ${names.length} named devices${teslaLike.length ? `, tesla-like: ${teslaLike.join(',')}` : ''}`,
          ),
        );
      }, this.scanTimeoutMs);

      this.manager
        .startDeviceScan(null, { allowDuplicates: false }, (error, device) => {
          if (settled) return;
          if (error) {
            settled = true;
            clearTimeout(timer);
            reject(new Error(`BLE scan failed: ${errMsg(error)}`));
            return;
          }
          if (!device) return;
          // iOS often omits the advertisement's localName on a re-scan of a
          // previously-seen peripheral, delivering the name only on `.name`
          // (the cached GAP name). Match on EITHER so we don't miss the car
          // when the advert-side name is null. Both are exact-equality against
          // the VIN-derived S…C string, so there's no false-positive risk.
          const advName = device.localName ?? device.name;
          if (advName) seenNames.add(advName);
          if (device.localName !== targetName && device.name !== targetName) return;
          settled = true;
          clearTimeout(timer);
          this.manager.stopDeviceScan().catch(() => {});
          if (device.isConnectable === false) {
            reject(
              new Error(
                `found ${targetName} but it is advertising as not-connectable — car is likely already at its max BLE client count`,
              ),
            );
            return;
          }
          resolve(device);
        })
        .catch((e: unknown) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(e instanceof Error ? e : new Error(errMsg(e)));
        });
    });
  }
}
