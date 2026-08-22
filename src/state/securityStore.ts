import type { SecretStore } from '@/ble/types';
import type { VehicleViewState } from '@/types/vehicleTypes';

// Persisted per-vehicle "PIN" security state: PIN-to-Drive on/off + the four per-feature PIN codes.
//
// Unlike everything in carLinkCache, these NEVER come from the car over BLE — the Security poll deliberately
// omits PIN-to-Drive and the raw PINs are not on the wire (see readSecurity's note / memory "PIN-to-Drive not on
// BLE wire"). And the fleet itself is not persisted. So without this store they reset to their initialVehicleState
// defaults on every launch (PIN-to-Drive off, no PIN set), and — unlike the telemetry fields — waking the car
// cannot restore them, because the car never reports them.
//
// They are SECRETS (a car-access credential), so they live in the OS Keychain via the SecretStore, NOT in the
// plaintext AsyncStorage telemetry cache (same rule as the device key / Pi bearer). Keyed by VIN so re-linking a
// different car cannot inherit the old car's PINs.
//
// One honest caveat: our copy is authoritative-but-can-drift. The car remembers the real PINs; we cannot read
// them back, so a PIN changed outside this app would go unnoticed here until it is re-set.
//
// Pure + SecretStore-injected so it stays node-testable (never transitively imports expo-secure-store).

export interface SecurityPersist {
  pinToDrive: boolean;
  valetPin: string | null;
  parentalPin: string | null;
  speedLimitPin: string | null;
  pinToDrivePin: string | null;
}

export function securityKey(vin: string): string {
  return `ble.security.${vin}`;
}

// A stored PIN: a non-empty string, else null. A blank or wrong-typed value is "no PIN", never an empty code.
const pin = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

// Pull the persist-able fields out of vehicle state (the enrolled car's).
export function securityFromState(s: VehicleViewState): SecurityPersist {
  return {
    pinToDrive: s.pinToDrive,
    valetPin: s.valetPin,
    parentalPin: s.parentalPin,
    speedLimitPin: s.speedLimitPin,
    pinToDrivePin: s.pinToDrivePin,
  };
}

// True iff the two snapshots differ — the save trigger only fires when a PIN field actually changed.
export function securityChanged(a: SecurityPersist, b: SecurityPersist): boolean {
  return (
    a.pinToDrive !== b.pinToDrive ||
    a.valetPin !== b.valetPin ||
    a.parentalPin !== b.parentalPin ||
    a.speedLimitPin !== b.speedLimitPin ||
    a.pinToDrivePin !== b.pinToDrivePin
  );
}

// Cold-start rehydrate patch — the mirror of carLinkCache.cacheToStatePatch, for the security store.
export function securityToStatePatch(s: SecurityPersist): Partial<VehicleViewState> {
  return {
    pinToDrive: s.pinToDrive === true,
    valetPin: pin(s.valetPin),
    parentalPin: pin(s.parentalPin),
    speedLimitPin: pin(s.speedLimitPin),
    pinToDrivePin: pin(s.pinToDrivePin),
  };
}

export async function saveSecurity(store: SecretStore, vin: string, s: SecurityPersist): Promise<void> {
  await store.setItem(securityKey(vin), JSON.stringify(s));
}

export async function loadSecurity(store: SecretStore, vin: string): Promise<SecurityPersist | null> {
  const raw = await store.getItem(securityKey(vin));
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Partial<SecurityPersist>;
    return {
      pinToDrive: p.pinToDrive === true,
      valetPin: pin(p.valetPin),
      parentalPin: pin(p.parentalPin),
      speedLimitPin: pin(p.speedLimitPin),
      pinToDrivePin: pin(p.pinToDrivePin),
    };
  } catch {
    return null; // corrupt payload → treat as no saved PINs rather than crash the boot
  }
}
