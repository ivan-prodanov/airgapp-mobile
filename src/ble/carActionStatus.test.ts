import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseCarActionStatus } from './carActionStatus.ts';
import { Response as CarServerResponse, encodeMessage } from './proto.ts';

const encode = (actionStatus: unknown) => encodeMessage(CarServerResponse, { actionStatus });

describe('parseCarActionStatus', () => {
  it('reads OK with no reason', () => {
    assert.deepEqual(parseCarActionStatus(encode({ result: 0 })), { ok: true, reason: null });
  });

  it('reads ERROR and carries the car’s own reason text', () => {
    // This is the field that would have said "no results found" on the sends we
    // logged as "ACK ok".
    const bytes = encode({ result: 1, resultReason: { plainText: 'no results found' } });
    assert.deepEqual(parseCarActionStatus(bytes), { ok: false, reason: 'no results found' });
  });

  it('reads ERROR with no reason text', () => {
    assert.deepEqual(parseCarActionStatus(encode({ result: 1 })), { ok: false, reason: null });
  });

  it('treats an absent actionStatus as no information, not as success', () => {
    assert.equal(parseCarActionStatus(encodeMessage(CarServerResponse, {})), null);
  });

  it('returns null for a missing payload rather than throwing', () => {
    assert.equal(parseCarActionStatus(null), null);
    assert.equal(parseCarActionStatus(undefined), null);
  });

  it('returns null for undecodable bytes rather than throwing', () => {
    // A decode failure must never take down a command that otherwise succeeded.
    assert.equal(parseCarActionStatus(new Uint8Array([0xff, 0xff, 0xff, 0xff])), null);
  });
});
