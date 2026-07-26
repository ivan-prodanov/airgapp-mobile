// protoUnknownFields.test.ts — a firmware bump must not break the parse.
//
// RESPONSE-15 Tier 1 item 4 asked us to make the decoder preserve/ignore unknown
// proto fields rather than reject. It turns out we ALREADY do (protobufjs skips
// unrecognised field numbers, and the generated code keeps them in $unknowns), so
// no change was needed — this test pins that behaviour so a future proto/codegen
// swap can't silently regress it into a hard failure on a car firmware update.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VehicleStatus, encodeMessage, decodeMessage } from './proto';
test('decoder tolerates an unknown proto field (firmware bump safety)', () => {
  const known = encodeMessage(VehicleStatus, { vehicleLockState: 1 });
  const extra = Uint8Array.from([0xf8, 0xb0, 0x04, 0x01]); // field 9999, varint 1
  const merged = new Uint8Array(known.length + extra.length);
  merged.set(known, 0);
  merged.set(extra, known.length);
  const d = decodeMessage(VehicleStatus, merged) as { vehicleLockState?: number };
  assert.equal(d.vehicleLockState, 1);
});
