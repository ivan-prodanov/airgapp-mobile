import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildAddKeyMessage } from './bleEnroll';
import { decodeMessage } from './proto';
import * as pb from './proto/gen';

// fakePublicKeyRaw returns a 65-byte SEC1-shaped point (0x04 prefix, distinct
// non-zero bytes so a byte-equality assertion against the decoded output is
// non-tautological — it would fail if the builder ever, say, zeroed or
// truncated the key).
function fakePublicKeyRaw(): Uint8Array {
  const bytes = new Uint8Array(65);
  bytes[0] = 0x04;
  for (let i = 1; i < 65; i++) bytes[i] = (i * 7 + 3) & 0xff;
  return bytes;
}

test('buildAddKeyMessage round-trips PublicKeyRaw, ROLE_DRIVER, IOS_DEVICE, PRESENT_KEY through decode', () => {
  const pub = fakePublicKeyRaw();
  const encoded = buildAddKeyMessage(pub);

  const outer = decodeMessage(pb.VCSEC.ToVCSECMessage, encoded);
  assert.ok(outer.signedMessage, 'ToVCSECMessage.signedMessage must be set');
  assert.equal(
    outer.signedMessage.signatureType,
    pb.VCSEC.SignatureType.SIGNATURE_TYPE_PRESENT_KEY,
    'signatureType must be SIGNATURE_TYPE_PRESENT_KEY',
  );
  assert.equal(outer.signedMessage.signatureType, 2);

  const inner = decodeMessage(pb.VCSEC.UnsignedMessage, outer.signedMessage.protobufMessageAsBytes);
  assert.equal(inner.subMessage, 'WhitelistOperation');
  const op = inner.WhitelistOperation;
  assert.ok(op, 'UnsignedMessage.WhitelistOperation must be set');

  const change = op.addKeyToWhitelistAndAddPermissions;
  assert.ok(change, 'WhitelistOperation.addKeyToWhitelistAndAddPermissions must be set');
  assert.ok(change.key, 'PermissionChange.key must be set');
  assert.deepEqual(
    new Uint8Array(change.key.PublicKeyRaw),
    pub,
    'PublicKey.PublicKeyRaw must byte-equal the input pubkey',
  );
  assert.equal(change.keyRole, pb.Keys.Role.ROLE_DRIVER);
  assert.equal(change.keyRole, 3);

  const metadata = op.metadataForKey;
  assert.ok(metadata, 'WhitelistOperation.metadataForKey must be set');
  assert.equal(metadata.keyFormFactor, pb.VCSEC.KeyFormFactor.KEY_FORM_FACTOR_IOS_DEVICE);
  assert.equal(metadata.keyFormFactor, 6);
});

test('buildAddKeyMessage throws on a wrong-length pubkey', () => {
  assert.throws(() => buildAddKeyMessage(new Uint8Array(64)), /65-byte/);
  assert.throws(() => buildAddKeyMessage(new Uint8Array(0)), /65-byte/);
});

test('buildAddKeyMessage throws on a pubkey missing the 0x04 SEC1 prefix', () => {
  const bad = fakePublicKeyRaw();
  bad[0] = 0x02; // compressed-point marker — not accepted, we need the raw point
  assert.throws(() => buildAddKeyMessage(bad), /65-byte/);
});
