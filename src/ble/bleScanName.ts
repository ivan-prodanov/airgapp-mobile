// bleScanName.ts — VIN → BLE advertisement local-name derivation.
//
// Ported from the vehicle-command Go SDK (ble.go:133-137): the car
// advertises under a local name derived deterministically from its VIN so
// the phone can find it without a prior pairing handshake. See
// docs/superpowers/plans/tesla-ble-transport-spec.md §2.
//
// localName = "S" + lower_hex(sha1(utf8(VIN))[0:8]) + "C"  → 18 chars
// ("S" + 16 hex chars + "C"). Must be matched by EXACT string equality
// against the scanned advertisement's Local Name.

import { sha1 } from '@noble/hashes/sha1';
import { bytesToHex } from './crypto';

export function vehicleLocalName(vin: string): string {
  const digest = sha1(new TextEncoder().encode(vin));
  const first8 = digest.slice(0, 8);
  return `S${bytesToHex(first8)}C`;
}
