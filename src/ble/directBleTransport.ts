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
const SCAN_TIMEOUT_MS = 20000;

// Spec §6: exchange() timeouts are caller-supplied (session.ts's
// SESSION_INFO_TIMEOUT_MS / COMMAND_TIMEOUT_MS); clamp to the spec's stated
// max regardless of what's passed in.
const MAX_EXCHANGE_TIMEOUT_MS = 30000;

function errMsg(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e) {
    const m = (e as { message?: unknown }).message;
    if (typeof m === 'string') return m;
  }
  return String(e);
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

    let dev = await scanned.connect();
    dev = await dev.discoverAllServicesAndCharacteristics();

    let mtu = FALLBACK_MTU;
    try {
      dev = await dev.requestMTU(REQUEST_MTU);
      mtu = dev.mtu ?? FALLBACK_MTU;
    } catch {
      // MTU negotiation failed — proceed on the un-negotiated default.
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
      if (frames.length > 0) {
        this.inbox.push(...frames);
        this.wake();
      }
    });

    this.device = dev;
    this.sessionId = dev.id;
    return this.sessionId;
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

    const chunks = frameForWrite(req, this.blockLength);
    try {
      for (const chunk of chunks) {
        // WITH response — the Go connector writes each chunk with noRsp=false
        // (ble.go:121), i.e. an ATT Write Request the car ACKs; the Tesla TX
        // characteristic ignores Write-Without-Response commands (they leave
        // the car silent → our exchange times out as a "stale frame").
        await device.writeCharacteristicWithResponseForService(SERVICE_UUID, TX_UUID, bytesToBase64(chunk));
      }
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
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.manager.stopDeviceScan().catch(() => {});
        reject(
          new Error(
            `car not found (asleep or out of BLE range?) — no advertisement matching ${targetName} within ${SCAN_TIMEOUT_MS}ms`,
          ),
        );
      }, SCAN_TIMEOUT_MS);

      this.manager
        .startDeviceScan(null, { allowDuplicates: false }, (error, device) => {
          if (settled) return;
          if (error) {
            settled = true;
            clearTimeout(timer);
            reject(new Error(`BLE scan failed: ${errMsg(error)}`));
            return;
          }
          if (!device || device.localName !== targetName) return;
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
