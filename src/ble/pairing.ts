// pairing.ts — thin BLE glue for the onboarding pair wizard: enrol this phone's
// device key over direct BLE, then check the car accepted it.
//
// Both calls lift the proven bodies from the bring-up harness (src/app/carlink.tsx):
//   enroll  = handleEnrolOverBle  (loadOrCreateDeviceKeys → openSession → sendAddKey)
//   verify  = handleAssertDrive's handshake (openDirectSession on VCSEC, dedicated)
// No Pi, no UI, no state machine — sequencing and retries live in the pair reducer
// and the screen. NOT node-importable (pulls in the native BLE bridge), so there is
// deliberately no unit test; it is proven on-device.

import { BridgedBleTransport } from './bridgedBleTransport';
import { loadOrCreateDeviceKeys, publicKeyBase64 } from './keystore';
import { DOMAIN_VEHICLE_SECURITY, openDirectSession } from './session';
import type { SecretStore } from './types';

// enrollDeviceKeyOverBle writes the add-key message to the car. The car does NOT
// confirm in-band: the user must then tap an NFC key card on the console, which the
// UI prompts for. Success here only means "the add-key frame was written".
export async function enrollDeviceKeyOverBle(opts: { vin: string; store: SecretStore }): Promise<void> {
  const keys = await loadOrCreateDeviceKeys(opts.store);
  const transport = new BridgedBleTransport();
  await transport.openSession(opts.vin);
  await transport.sendAddKey(publicKeyBase64(keys));
}

// verifyPaired makes ONE authenticated VCSEC handshake and reports whether the car
// accepted our key. The handshake is the lightest operation that only succeeds once
// the key is whitelisted: the car answers our SessionInfoRequest with
// status=KEY_NOT_ON_WHITELIST (-> KeyNotOnWhitelistError) when it does not know the
// key, and openDirectSession additionally checks the car's HMAC over SessionInfo,
// which is keyed by the ECDH secret and so proves our pubkey is in its keychain.
// No command is sent, so nothing on the car changes.
//
// Never throws: "not paired yet" (or any failed attempt) is `false`, so the caller
// can simply poll. `dedicated: true` bypasses the shared per-VIN session cache so a
// stale cached session from before the enrolment can't answer for us.
export async function verifyPaired(opts: { vin: string; store: SecretStore }): Promise<boolean> {
  try {
    const keys = await loadOrCreateDeviceKeys(opts.store);
    const session = await openDirectSession({
      transport: new BridgedBleTransport(),
      vin: opts.vin,
      deviceKeys: keys,
      domain: DOMAIN_VEHICLE_SECURITY,
      dedicated: true,
    });
    // The handshake already succeeded; a close hiccup must not flip the verdict.
    await session.close().catch(() => {});
    return true;
  } catch {
    return false;
  }
}
