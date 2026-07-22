// hedgeProbe.ts — on-car probe that closes RE #10's most important inferred
// fact: does a DUPLICATE-counter reject over BLE attach a fresh SignedSessionInfo
// (the thing the hedge's landed-guard keys off)? And what's the fault
// code+namespace?
//
// Method (RE #10 probe b, single-transport variant): open a dedicated VCSEC
// session, seal TWO GET_STATUS frames at the SAME counter N but with DISTINCT
// request uuids (so replies correlate cleanly, unlike byte-identical resends).
// Deliver leg-1 (fresh N → expect ACCEPT, top→N), then leg-2 (duplicate N →
// expect REJECT). Log both raw + decoded replies so we can READ where/whether
// the car attaches SessionInfo, rather than guessing.
//
// SAFE: GET_STATUS is idempotent (a read, no physical actuation) — even if a leg
// somehow lands twice, nothing moves. Uses its own throwaway session so it never
// perturbs the poll's counter.

import {
  openDirectSession,
  buildRoutableCommandFrame,
  vcsecGetStatusAction,
  DOMAIN_VEHICLE_SECURITY,
} from './session';
import { decodeMessage, RoutableMessage } from './proto';
import { bytesToBase64, base64ToBytes, bytesToHex } from './bytes';
import type { DeviceKeys, PiTransport } from './types';

function describeReply(label: string, bytes: Uint8Array): string[] {
  const out = [`${label}: ${bytes.length}B raw=${bytesToHex(bytes)}`];
  try {
    const rm = decodeMessage(RoutableMessage, bytes) as unknown as Record<string, unknown>;
    // Full decoded dump (Uint8Array → hex) so EVERY field is visible — we're
    // hunting for wherever a SignedSessionInfo lands and the exact fault shape.
    out.push(
      '  decoded=' +
        JSON.stringify(rm, (_k, v) =>
          v instanceof Uint8Array ? `hex:${bytesToHex(v)}` : v,
        ),
    );
  } catch (e) {
    out.push(`  (decode failed: ${e instanceof Error ? e.message : String(e)})`);
  }
  return out;
}

export async function runDuplicateRejectProbe(opts: {
  transport: PiTransport;
  vin: string;
  deviceKeys: DeviceKeys;
}): Promise<string[]> {
  const lines: string[] = ['=== HEDGE PROBE: duplicate-counter reject (RE #10 b) ==='];
  const t0 = Date.now();

  let session;
  try {
    session = await openDirectSession({
      transport: opts.transport,
      vin: opts.vin,
      deviceKeys: opts.deviceKeys,
      domain: DOMAIN_VEHICLE_SECURITY,
      // Our OWN link — do NOT reuse the main app's cached (Pi) session for this
      // VIN, or exchange() runs against a session this transport never opened.
      dedicated: true,
    });
  } catch (e) {
    lines.push(`openDirectSession FAILED: ${e instanceof Error ? e.message : String(e)}`);
    return lines;
  }
  lines.push(
    `session up in ${Date.now() - t0}ms: counter=${session.counter} epoch=${bytesToHex(
      session.epoch,
    ).slice(0, 8)}…`,
  );

  const action = vcsecGetStatusAction();
  const N = session.counter + 1;
  // Same counter N, distinct uuids — the car should ACCEPT leg-1 and REJECT
  // leg-2 as a duplicate counter; the reject is what we're dissecting.
  const f1 = buildRoutableCommandFrame(session, action.bytes, {
    counter: N,
    uuid: Uint8Array.from([0x11]),
  });
  const f2 = buildRoutableCommandFrame(session, action.bytes, {
    counter: N,
    uuid: Uint8Array.from([0x22]),
  });

  try {
    const r1 = await opts.transport.exchange(session.sessionId, bytesToBase64(f1.bytes), 6000);
    lines.push(...describeReply(`LEG1 fresh N=${N} (expect ACCEPT)`, base64ToBytes(r1)));
  } catch (e) {
    lines.push(`LEG1 exchange threw: ${e instanceof Error ? e.message : String(e)}`);
  }

  try {
    const r2 = await opts.transport.exchange(session.sessionId, bytesToBase64(f2.bytes), 6000);
    lines.push(
      ...describeReply(`LEG2 DUPLICATE N=${N} (expect REJECT — SessionInfo? fault?)`, base64ToBytes(r2)),
    );
  } catch (e) {
    // A throw is itself a data point (timeout = car silently dropped the dup;
    // a stale-frame error = correlation issue). Record it verbatim.
    lines.push(`LEG2 exchange threw: ${e instanceof Error ? e.message : String(e)}`);
  }

  await session.close().catch(() => {});
  lines.push(`=== probe done (${Date.now() - t0}ms total) ===`);
  return lines;
}
