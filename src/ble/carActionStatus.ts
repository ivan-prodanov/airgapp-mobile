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

import { Response as CarServerResponse, decodeMessage } from './proto';

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
