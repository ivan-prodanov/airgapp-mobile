// bridgedBleTransport.ts — BridgedBleTransport: a CarTransport for the car's BLE
// GATT server, reached through the NATIVE central (modules/expo-passive-entry).
//
// Model (b) from RESPONSE-12: ONE native central owns the car link full-time and
// the JS command path submits BLE *bytes* to it (no ble-plx, so no second phone
// central). This class is now a THIN adapter over `foregroundBleLink` — the single
// persistent consumer of the native frame stream that also runs the always-on
// passive-entry responder + CPD (matching the official app's single always-on
// receive handler, q1.java y()/B0). The selector mints a fresh BridgedBleTransport
// per openSession, but they all borrow the ONE link, so there is exactly one
// reassembler / write lock / session-signer.
//
// closeSession() does NOT tear the link down: the native central owns it across
// command sessions and into the background, and the foreground responder rides it.

import { buildAddKeyMessage } from './bleEnroll';
import { base64ToBytes } from './bytes';
import type { CarTransport } from './types';
import { foregroundBleLink } from './foregroundBleLink';

const CONNECT_TIMEOUT_MS = 20000;

export interface BridgedBleTransportDebugInfo {
  deviceName: string | null;
  blockLength: number;
}

export class BridgedBleTransport implements CarTransport {
  private sessionId: string | null = null;
  // How long openSession waits for a connected native link before failing to the
  // Pi fallback (the selector passes its short AUTO budget).
  private readonly connectBudgetMs: number;

  constructor(opts?: {
    // Accepted for drop-in compatibility with the selector's make(); the connect
    // budget for openSession. onUnsolicited/authResponder are now owned by
    // foregroundBleLink (set by useCarLink), not per-transport.
    scanTimeoutMs?: number;
  }) {
    this.connectBudgetMs = opts?.scanTimeoutMs ?? CONNECT_TIMEOUT_MS;
  }

  // openSession ensures the persistent link is armed for `vin` and waits for the
  // native central to report connected. (useCarLink's foreground lifecycle also
  // arms it for always-on passive; start() is idempotent.)
  async openSession(vin: string): Promise<string> {
    foregroundBleLink.start(vin);
    await foregroundBleLink.awaitConnected(this.connectBudgetMs);
    this.sessionId = vin;
    return vin;
  }

  async exchange(sessionId: string, payloadB64: string, timeoutMs: number): Promise<string> {
    if (this.sessionId !== sessionId) {
      throw new Error(`BLE connection closed — no active connection for session ${sessionId}`);
    }
    return foregroundBleLink.exchange(payloadB64, timeoutMs);
  }

  // sendRaw writes a pre-built frame, no reply (passive answers). Rides the link's
  // write lock so its chunks never interleave a command's.
  async sendRaw(frame: Uint8Array): Promise<void> {
    await foregroundBleLink.sendRaw(frame);
  }

  // sendAddKey writes the VCSEC add-key enrollment message (unauthenticated, no reply).
  async sendAddKey(publicKeyB64: string): Promise<void> {
    await foregroundBleLink.sendRaw(buildAddKeyMessage(base64ToBytes(publicKeyB64)));
  }

  // closeSession drops only this transport's session view — the link persists (it
  // owns the car connection + the always-on foreground responder). Never throws.
  async closeSession(_sessionId: string): Promise<void> {
    this.sessionId = null;
  }

  getDebugInfo(): BridgedBleTransportDebugInfo {
    return {
      deviceName: foregroundBleLink.isConnected() ? 'native-pipe' : null,
      blockLength: foregroundBleLink.getBlockLength(),
    };
  }
}
