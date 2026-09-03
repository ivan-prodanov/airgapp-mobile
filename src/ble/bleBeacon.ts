// bleBeacon.ts — VIN → Tesla iBeacon (primary-advertisement) identity.
//
// WHY THIS EXISTS. The car's BLE identity is split across two packets. Its
// PRIMARY advertisement is an Apple iBeacon; its local name (see bleScanName.ts)
// and 16-bit service 1122 ride in the SCAN RESPONSE. iOS CoreBluetooth and
// Linux/BlueZ (go-ble, as used by teslamotors/vehicle-command) do active
// scanning and MERGE the scan response, so they identify the car by name/1122.
// Android does NOT reliably deliver the scan response to the app, so on Android
// the ONLY reliable identifier is the primary-packet iBeacon. This module is the
// canonical spec + the derivation the native Android matcher mirrors
// (PassiveEntryCentral.kt: expectedBeaconMinor / BEACON_UUID_BYTES).
//
// Ground truth — captured 2026-09-03 from VIN XP7YGCELXTB844019 via the laptop's
// CoreBluetooth, primary-PDU manufacturer data (after Apple company id 0x004C):
//   0215 74278bdab64445208f0c720eaf059935 0000 f3ab c5
//   type=iBeacon  UUID=74278BDA-…-059935  major=0  minor=0xF3AB(62379)  tx=0xc5

/** Tesla's fixed phone-key iBeacon proximity UUID (also what iOS CarRegionMonitor ranges). */
export const TESLA_BEACON_UUID = '74278BDA-B644-4520-8F0C-720EAF059935';

/** Apple's Bluetooth SIG company identifier — the manufacturer-data key an iBeacon lives under. */
export const APPLE_COMPANY_ID = 0x004c;

/**
 * The iBeacon minor a given VIN advertises.
 *
 * Mirrors iOS CarRegionMonitor.expectedMajorMinor and the Kotlin
 * expectedBeaconMinor: take the last 5 VIN chars, read the leading digits
 * (NSString.integerValue semantics — stop at the first non-digit, 0 if none),
 * then BYTE-SWAP the low 16 bits. Confirmed against the live advertisement:
 * VIN …844019 → 62379 (0xF3AB), and major is the byte-swapped high 16 bits (0).
 */
export function expectedBeaconMinor(vin: string): number | null {
  if (vin.length < 5) return null;
  const leadingDigits = (vin.slice(-5).match(/^\d*/) ?? [''])[0];
  const v = leadingDigits.length ? Number(leadingDigits) : 0;
  const lower = v & 0xffff;
  return ((lower & 0xff) << 8) | ((lower >> 8) & 0xff);
}

export interface IBeacon {
  uuid: string;
  major: number;
  minor: number;
}

/**
 * Parse an Apple iBeacon out of the manufacturer-specific data that follows the
 * company id (i.e. what Android's ScanRecord.getManufacturerSpecificData(0x004C)
 * returns). Returns null if `mfg` is not an iBeacon (type 0x02, len 0x15).
 */
export function parseIBeacon(mfg: Uint8Array): IBeacon | null {
  if (mfg.length < 22 || mfg[0] !== 0x02 || mfg[1] !== 0x15) return null;
  const hex = Array.from(mfg.slice(2, 18), (b) => b.toString(16).padStart(2, '0')).join('');
  const uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
  const major = (mfg[18] << 8) | mfg[19];
  const minor = (mfg[20] << 8) | mfg[21];
  return { uuid: uuid.toUpperCase(), major, minor };
}

/** True when this iBeacon is THIS car: our UUID and the VIN-derived minor. */
export function beaconIsVehicle(beacon: IBeacon, vin: string): boolean {
  return beacon.uuid === TESLA_BEACON_UUID && beacon.minor === expectedBeaconMinor(vin);
}
