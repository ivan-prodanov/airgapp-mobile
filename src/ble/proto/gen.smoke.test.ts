import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as pb from './gen';

// Fully-qualified message paths confirmed by inspecting gen.d.ts (Step 3):
//   - pb.UniversalMessage.RoutableMessage
//   - pb.VCSEC.UnsignedMessage
// The generated gen.d.ts has no default export (pbts emitted
// `export namespace CarServer/VCSEC/UniversalMessage/…` with no `export =`),
// so `import * as pb from './gen'` is the shape that type-checks and works
// at runtime against the CommonJS `module.exports = $root` in gen.js.

test('RoutableMessage round-trips a uuid byte-for-byte', () => {
  const uuid = new Uint8Array([0x01, 0x02, 0x03, 0x04, 0xaa, 0xbb, 0xcc, 0xdd]);
  const msg = pb.UniversalMessage.RoutableMessage.create({ uuid });
  const encoded = pb.UniversalMessage.RoutableMessage.encode(msg).finish();
  const decoded = pb.UniversalMessage.RoutableMessage.decode(encoded);
  assert.deepEqual(new Uint8Array(decoded.uuid ?? []), uuid);
});

test('VCSEC.UnsignedMessage decodes the known-good VCSEC_GET_STATUS_HEX fixture', () => {
  const VCSEC_GET_STATUS_HEX = '0a00';
  const bytes = Buffer.from(VCSEC_GET_STATUS_HEX, 'hex');
  assert.doesNotThrow(() => {
    const decoded = pb.VCSEC.UnsignedMessage.decode(bytes);
    // Sanity: the InformationRequest oneof case is present (default-valued
    // GET_STATUS enum, so its inner field is absent on the wire — expected).
    assert.ok(decoded.InformationRequest);
  });
});

test('AlertState round-trips a named charging alert and GetVehicleData.getAlertState is field 20', () => {
  const vd = pb.CarServer.VehicleData.create({
    alertState: { chargingAlerts: [{ alertName: 93, alertType: 1 }] },
  });
  const decoded = pb.CarServer.VehicleData.decode(pb.CarServer.VehicleData.encode(vd).finish());
  assert.equal(decoded.alertState?.chargingAlerts?.[0]?.alertName, 93);
  assert.equal(decoded.alertState?.chargingAlerts?.[0]?.alertType, 1);
  assert.equal(pb.CarServer.ChargingAlertName.PCS_A054_CHGINPUTVDROPTOOHIGH, 93);
  assert.equal(pb.CarServer.ChargingAlertType.WARNING, 1);
  // Field 20, length-delimited, empty marker: tag (20<<3)|2 = 162 = 0xa2 0x01, then len 0.
  const req = pb.CarServer.GetVehicleData.encode(pb.CarServer.GetVehicleData.create({ getAlertState: {} })).finish();
  assert.deepEqual([...req], [0xa2, 0x01, 0x00]);
});
