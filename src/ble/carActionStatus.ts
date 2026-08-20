// carActionStatus — the CAR's verdict on a command, as opposed to the transport's.
//
// runAction reports ok:true when the routable-layer signedMessageStatus says the
// frame was delivered and accepted for processing. That is not the same claim as
// "the car did what you asked". CarServer answers with
// Response.actionStatus { result: OK|ERROR, result_reason.plain_text }, and until
// now nothing in this codebase read it — which is why an on-car navigation send
// that the car REJECTED and one that worked produced byte-identical logs.
//
// Returns null when there is nothing to report (no payload, no actionStatus,
// undecodable bytes). Null means "no information", NOT "success" — the caller
// must not treat it as a pass.

import { Response as CarServerResponse, FromVCSECMessage, decodeMessage } from './proto';

// parseVcsecNominalError — the car's REJECTION reason for a VCSEC command (lock,
// unlock, frunk, trunk, chargePort). The car answers a refused VCSEC command with
// a plaintext `FromVCSECMessage.nominalError` carried in the reply's
// `RoutableMessage.protobufMessageAsBytes` — NOT the encrypted payload and NOT the
// routable `signedMessageStatus`. Captured on-car 2026-08-08: a lock with a door
// open replies `{ nominalError: { genericError: GENERICERROR_CLOSURES_OPEN } }`.
// Our old reads looked only at signedMessageStatus (null here) and the decrypted
// payload (empty), logged "bytes:0", and wrongly called the lock a success.
//
// Returns the GenericError enum NAME (e.g. 'GENERICERROR_CLOSURES_OPEN') or null
// when the reply carries no nominalError (a success, or a non-VCSEC reply).
export function parseVcsecNominalError(protobufMessageAsBytes: Uint8Array | null | undefined): string | null {
  if (!protobufMessageAsBytes || protobufMessageAsBytes.length === 0) return null;
  try {
    const msg = FromVCSECMessage.decode(protobufMessageAsBytes);
    const obj = FromVCSECMessage.toObject(msg, { enums: String }) as {
      nominalError?: { genericError?: string } | null;
    };
    return obj.nominalError?.genericError ?? null;
  } catch {
    return null;
  }
}

export interface CarActionStatus {
  ok: boolean;
  reason: string | null;
}

// OperationStatus_E: 0 = OK, 1 = ERROR (car_server.proto:315).
export function parseCarActionStatus(payload: Uint8Array | null | undefined): CarActionStatus | null {
  if (!payload || payload.length === 0) return null;
  try {
    const resp = decodeMessage(CarServerResponse, payload) as {
      actionStatus?: { result?: number; resultReason?: { plainText?: string } };
    };
    const st = resp.actionStatus;
    if (!st || st.result === undefined) return null;
    return { ok: st.result === 0, reason: st.resultReason?.plainText ?? null };
  } catch {
    // A decode problem is our failure to understand the reply, not the car
    // failing the command. Never let it turn a good command into a bad one.
    return null;
  }
}
