// proto.ts — typed protobuf codec facade over the precompiled static module
// (src/ble/proto/gen.js / gen.d.ts, generated in Phase 0 from the vendored
// .proto files).
//
// Ported from the browser client's proto.js, which used a runtime
// protobuf.load() loader (protobuf.js parsing .proto text on page init).
// That's unnecessary here: gen.js/gen.d.ts are already-generated static
// message classes (protobufjs pbjs/pbts output), so this file just exposes
// the same named accessors + thin encode/decode wrappers directly against
// them — no root, no lookupType/lookupEnum, no async load.
//
// Message paths and enum-object paths below are confirmed against gen.d.ts
// (see /private/tmp/.../scratchpad/p1b-proto-report.md for the full trace).

import * as pb from './proto/gen';

// --- Message-type handles (protobufjs generated static message classes) --------------------

export const RoutableMessage = pb.UniversalMessage.RoutableMessage;
export const SessionInfo = pb.Signatures.SessionInfo;
export const SignatureData = pb.Signatures.SignatureData;
export const Action = pb.CarServer.Action;
export const Response = pb.CarServer.Response;
export const VCSECUnsignedMessage = pb.VCSEC.UnsignedMessage;
export const InformationRequest = pb.VCSEC.InformationRequest;
export const FromVCSECMessage = pb.VCSEC.FromVCSECMessage;
export const VehicleStatus = pb.VCSEC.VehicleStatus;

// --- Enum value-maps -------------------------------------------------------------------------
//
// protobufjs static enums are plain TS `enum`s (number-keyed objects) on the generated
// namespace, so `pb.<Namespace>.<Enum>` IS the value-map the reference's
// `lookupEnum(...).values` produced — no `.values` indirection needed here.

export const types = {
  Domain: pb.UniversalMessage.Domain,
  Tag: pb.Signatures.Tag,
  SignatureType: pb.Signatures.SignatureType,
  SessionInfoStatus: pb.Signatures.Session_Info_Status,
  MessageFault: pb.UniversalMessage.MessageFault_E,
  OperationStatus: pb.UniversalMessage.OperationStatus_E,
} as const;

// --- encode/decode wrappers ------------------------------------------------------------------
//
// Structural interfaces over the generated static message classes rather than the concrete
// generated types: the real `create`/`decode` overloads return narrowed `X & X.$Shape`
// intersections that are awkward to name generically here, and TS structurally accepts a
// generated class against these narrower (method-shorthand, so bivariant) signatures — see the
// report for why this doesn't leak `any` to callers (encodeMessage still returns Uint8Array,
// decodeMessage still returns the concrete decoded type inferred from `type`).

interface EncodableType {
  verify(fields: object): string | null;
  create(fields: object): unknown;
  encode(message: unknown): { finish(): Uint8Array };
}

interface DecodableType<T> {
  decode(bytes: Uint8Array): T;
}

export function encodeMessage<T extends EncodableType>(type: T, fields: object): Uint8Array {
  const errMsg = type.verify(fields);
  if (errMsg) throw new Error(`encode: ${errMsg}`);
  return type.encode(type.create(fields)).finish();
}

export function decodeMessage<T>(type: DecodableType<T>, bytes: Uint8Array): T {
  return type.decode(bytes);
}
