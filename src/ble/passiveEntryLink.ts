// passiveEntryLink.ts — the DEDICATED BLE presence that passive entry needs.
//
// WHY A SEPARATE LINK (this is the Tesla model, confirmed by observation):
// the official Tesla app keeps its own BLE connection to the car for passive
// entry and answers challenges from it — WHILE unrelated traffic (in our case
// airgapp talking to the car through the Pi) is happening on another central.
// The car holds multiple centrals happily. So passive entry must NOT be coupled
// to whichever transport the command/telemetry path happens to have selected;
// switching transports to "make room" for it would be inventing a mechanism
// Tesla doesn't have.
//
// THE BUG THIS EXISTS TO AVOID: each handshake derives a FRESH session key from
// the car's ephemeral pubkey, so a Pi session and a direct-BLE session have
// DIFFERENT keys and counters. The responder previously read the shared
// per-domain session cache (peekLiveSession), which would hand it the Pi's
// session while signing for a direct-BLE link — signing with the wrong key,
// producing FAULT_AES_DECRYPT_AUTH forever. This link owns its own session via
// openDirectSession (which bypasses that cache) and hands it to the responder.
//
// SCOPE: only opens a link when the command path is NOT already on direct BLE.
// If it is, passive entry rides that existing link (as it does today) — two
// links from one phone to one car would be wasteful and invite contention.
//
// Foreground-only for now. Surviving suspension is M2 and needs the native
// signer (RE RESPONSE #2 Q2: Hermes is not guaranteed alive on a CoreBluetooth
// background wake).

import { DirectBleTransport } from './directBleTransport';
import { openDirectSession, DOMAIN_VEHICLE_SECURITY } from './session';
import { makeAuthResponder, type AuthResponder } from './passiveEntryResponder';
import { commandStatusAccepted } from './passiveEntryCapture';
import type { DeviceKeys, Session } from './types';

// How long to wait before retrying after a failed/dropped link. The car is
// either out of range (retry is cheap and pointless-but-harmless) or busy.
const RETRY_MS = 15_000;
// Short scan: if the car isn't advertising to us we want to fail fast and retry
// later, not hold the radio.
const SCAN_MS = 6_000;

export interface PassiveEntryLinkOptions {
  vin: string;
  deviceKeys: DeviceKeys;
  // True when the command path already holds a direct-BLE link — then we stand
  // down and let passive entry ride that one instead of opening a second.
  commandPathOnBle: () => boolean;
  enabled: () => boolean;
  log?: (lines: string[]) => void;
}

export interface PassiveEntryLink {
  stop: () => void;
  isUp: () => boolean;
}

export function startPassiveEntryLink(opts: PassiveEntryLinkOptions): PassiveEntryLink {
  const say = (lines: string[]) => opts.log?.(lines);
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let transport: DirectBleTransport | null = null;
  let session: Session | null = null;
  let responder: AuthResponder | null = null;

  const teardown = async () => {
    const t = transport;
    transport = null;
    session = null;
    responder = null;
    if (t) await t.closeSession('').catch(() => {});
  };

  const schedule = (ms: number) => {
    if (stopped || timer) return;
    timer = setTimeout(() => {
      timer = null;
      void tick();
    }, ms);
  };

  const tick = async () => {
    if (stopped) return;
    if (!opts.enabled()) {
      await teardown();
      schedule(RETRY_MS);
      return;
    }
    // Stand down if the command path already owns a direct-BLE link.
    if (opts.commandPathOnBle()) {
      if (transport) {
        say(['passive-entry link: standing down (command path is on BLE)']);
        await teardown();
      }
      schedule(RETRY_MS);
      return;
    }
    if (transport && session) {
      schedule(RETRY_MS); // healthy — just re-check later
      return;
    }

    try {
      // The responder closes over `session`, which is assigned just below; it is
      // only ever invoked from the notification handler, i.e. after openSession
      // and the handshake have completed.
      responder = makeAuthResponder({
        getSession: () => session,
        log: opts.log,
      });
      const t = new DirectBleTransport({
        scanTimeoutMs: SCAN_MS,
        authResponder: (frame) => responder?.(frame) ?? null,
        onUnsolicited: (frame) => {
          if (responder && commandStatusAccepted(frame)) responder.noteVerdict(true);
        },
      });
      await t.openSession(opts.vin);
      transport = t;
      // Our OWN session — openDirectSession bypasses the shared per-domain cache
      // precisely so this key/counter can't be confused with the Pi's.
      session = await openDirectSession({
        transport: t,
        vin: opts.vin,
        deviceKeys: opts.deviceKeys,
        domain: DOMAIN_VEHICLE_SECURITY,
      });
      say(['passive-entry link: UP (dedicated BLE, independent of the command transport)']);
    } catch (e) {
      await teardown();
      say([`passive-entry link: not up (${e instanceof Error ? e.message : String(e)})`]);
    }
    schedule(RETRY_MS);
  };

  void tick();

  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
      void teardown();
    },
    isUp: () => transport != null && session != null,
  };
}
