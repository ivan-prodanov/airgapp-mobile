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

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// createSelectingTransport returns a CarTransport that, on openSession,
// tries each candidate in order until one connects, then routes
// exchange/closeSession to that chosen transport for the session's lifetime.
// Order encodes preference (put BLE first for BLE-primary). Re-selects on
// the next openSession — closeSession always clears the active transport,
// even if the underlying close rejects, so a later re-open starts a fresh
// selection rather than being stuck on whatever won last time.
export function createSelectingTransport(
  candidates: TransportCandidate[],
  onSelect?: (name: string) => void,
): CarTransport {
  let active: CarTransport | null = null;

  return {
    async openSession(vin: string): Promise<string> {
      if (candidates.length === 0) {
        throw new Error('no transports configured');
      }

      const failures: string[] = [];
      for (const candidate of candidates) {
        const transport = candidate.make();
        try {
          const sessionId = await transport.openSession(vin);
          active = transport;
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
