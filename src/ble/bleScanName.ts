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

// isDerivedScanName — true for Tesla's VIN-derived ADVERTISED local name, the
// `S<16 hex>C` discovery token (see vehicleLocalName above).
//
// Why this guard exists (RE RESPONSE #5 Q3). There are four distinct "names",
// and only ONE of them is the string iOS Settings > Bluetooth renders:
//   (a) advertised local name  — `S<hex>C`, discovery only
//   (b) GAP 0x2A00            — read by the OS on connect
//   (c) OS-cached name         — CBPeripheral.name, == what Settings shows ✅
//   (d) cloud vehicle_name     — can go stale, and airgapp can't reach it anyway
//
// The trap: CBPeripheral.name (and so ble-plx's Device.name) STARTS OUT as (a)
// and only becomes (c) once CoreBluetooth has read 0x2A00 and fired
// peripheralDidUpdateName. So a name captured too early is the scan token, and
// telling the user to remove "S1a2b…C" from Settings is as useless as telling
// them to remove our app-local nickname. Reject the shape and wait for a later
// capture instead.
export function isDerivedScanName(name: string | null | undefined): boolean {
  return !!name && /^S[0-9A-Fa-f]{16}C$/.test(name);
}
