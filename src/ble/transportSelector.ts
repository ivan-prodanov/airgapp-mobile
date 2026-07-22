// transportSelector.ts — createSelectingTransport: a CarTransport that tries
// a list of injected CarTransports IN ORDER on openSession and routes every
// subsequent exchange()/closeSession() call for that session to whichever one
// connected first. This is the BLE-primary/Pi-fallback policy (matching the
// official Tesla app's BLE-first behavior): put a direct-BLE candidate ahead
// of a Pi-forwarder candidate and the car is used when in range, the Pi
// otherwise — without either caller (session.ts/gateway.ts) knowing there
// was ever a choice.
//
// PURE — imports ONLY ./types. No ble-plx, no fetch, so this file (and its
// test) run under plain node, same isolation rule as session.ts/gateway.ts.
// The RN-specific bit — actually constructing a DirectBleTransport / wrapped
// PiClient — is supplied by the caller via TransportCandidate.make(); see
// src/app/carlink.tsx's makeGateway() for the harness wiring.

import type { CarTransport } from './types';

// TransportCandidate is one entry in the preference-ordered candidate list.
// `make()` constructs a FRESH transport instance for each openSession
// attempt (never reused across attempts/sessions) — for DirectBleTransport
// this means a clean scan+connect every time, with no state left over from
// a previous failed/closed attempt.
export interface TransportCandidate {
  name: string; // 'ble' | 'pi' — for logging/telemetry (onSelect, error text)
  make: () => CarTransport;
}

export interface SelectingTransportOptions {
  // After this many consecutive opens served by the remembered last-good
  // transport, the NEXT open ignores that memory and tries the full declared
  // order again — so a higher-preference transport that has recovered (e.g. BLE
  // back in range) gets picked up. Higher = stickier (fewer wasted re-probes of
  // a down transport); lower = faster recovery. Default 6.
  reprobeEvery?: number;
  // Seed the "last-good" memory (e.g. from persistence) so the very FIRST open
  // after construction can skip a doomed higher-preference candidate. Without
  // this, every cold start / post-teardown rebuild re-pays the BLE timeout even
  // though Pi was the only thing that worked last session.
  initialLastGood?: string | null;
  // Dynamic preference consulted on EVERY open, tried FIRST when it returns a
  // known candidate name — overriding the sticky last-good memory. Use it to
  // steer selection off a live signal, e.g. "the native BLE link is connected
  // right now, so prefer 'ble' this instant" — which keeps the chosen transport
  // (and any UI derived from it) honest to what's actually reachable, without
  // waiting for the periodic re-probe. Returning null falls back to last-good.
  preferred?: () => string | null;
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// createSelectingTransport returns a CarTransport that, on openSession, tries
// candidates until one connects, then routes exchange/closeSession to it for the
// session's lifetime.
//
// STICKY selection: the declared order encodes preference (BLE first), but once
// a transport connects it is remembered and tried FIRST on subsequent opens — so
// a persistently-unreachable BLE (car out of range) is not re-probed on every
// open, which was costing a full ~10s connect timeout each time before the Pi
// fallback even got a turn. Every `reprobeEvery` opens the full declared order is
// retried so a recovered BLE is picked back up. closeSession clears the ACTIVE
// transport (so a re-open re-runs selection) but keeps the last-good memory.
export function createSelectingTransport(
  candidates: TransportCandidate[],
  onSelect?: (name: string) => void,
  opts?: SelectingTransportOptions,
): CarTransport {
  const reprobeEvery = opts?.reprobeEvery ?? 6;
  let active: CarTransport | null = null;
  let lastGood: string | null = opts?.initialLastGood ?? null;
  // Consecutive opens served WITHOUT a full-order re-probe. Hitting reprobeEvery
  // forces the next open back to the declared order.
  let opensSinceReprobe = 0;

  // The candidate order for THIS open: a live `preferred()` wins outright (tried
  // first, no re-probe accounting); else last-good first (if remembered and not
  // due for a re-probe); else the declared preference order.
  function orderFor(): { ordered: TransportCandidate[]; reprobing: boolean } {
    const want = opts?.preferred?.() ?? null;
    if (want !== null) {
      const head = candidates.find((c) => c.name === want);
      if (head) {
        // Preferred first, then the rest as fallbacks. `reprobing: true` so a
        // success doesn't get charged against the sticky counter — the live
        // signal, not the counter, is driving this open.
        return { ordered: [head, ...candidates.filter((c) => c.name !== want)], reprobing: true };
      }
    }
    if (lastGood === null || opensSinceReprobe >= reprobeEvery) {
      return { ordered: candidates, reprobing: true };
    }
    const preferred = candidates.find((c) => c.name === lastGood);
    if (!preferred) return { ordered: candidates, reprobing: true }; // lastGood no longer offered
    return { ordered: [preferred, ...candidates.filter((c) => c.name !== lastGood)], reprobing: false };
  }

  return {
    async openSession(vin: string): Promise<string> {
      if (candidates.length === 0) {
        throw new Error('no transports configured');
      }

      const { ordered, reprobing } = orderFor();
      const failures: string[] = [];
      for (const candidate of ordered) {
        const transport = candidate.make();
        try {
          const sessionId = await transport.openSession(vin);
          active = transport;
          lastGood = candidate.name;
          opensSinceReprobe = reprobing ? 0 : opensSinceReprobe + 1;
          onSelect?.(candidate.name);
          return sessionId;
        } catch (e) {
          failures.push(`${candidate.name}: ${errMsg(e)}`);
        }
      }

      throw new Error(`all transports failed — ${failures.join('; ')}`);
    },

    async exchange(sessionId: string, payloadB64: string, timeoutMs: number): Promise<string> {
      if (!active) {
        throw new Error('no active transport (openSession first)');
      }
      // Errors here are NOT caught — only openSession failures trigger
      // fallback; a mid-session exchange failure on the chosen transport
      // (e.g. a dropped BLE link) is the caller's (session.ts/gateway.ts's)
      // problem to retry/evict, not a reason to silently swap transports.
      return active.exchange(sessionId, payloadB64, timeoutMs);
    },

    async closeSession(sessionId: string): Promise<void> {
      const transport = active;
      // Clear BEFORE awaiting the delegate so the next openSession always
      // re-selects from scratch, whether or not this close succeeds.
      active = null;
      if (transport) {
        await transport.closeSession(sessionId);
      }
    },
  };
}
