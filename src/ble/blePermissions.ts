// Which runtime permissions a BLE central needs, per platform and API level.
//
// Android 12 (API 31) split the old install-time BLUETOOTH / BLUETOOTH_ADMIN pair into the
// runtime permissions BLUETOOTH_SCAN and BLUETOOTH_CONNECT. Below 31 there is no such split
// and a BLE scan is gated on ACCESS_FINE_LOCATION instead — historically because a scan result
// leaks position.
//
// THE SILENT-FAILURE TRAP: on 31+, a scan started without BLUETOOTH_SCAN does not throw and
// does not warn. It returns ZERO results, forever, and looks exactly like "the car isn't
// nearby". The manifest additionally declares `neverForLocation` on BLUETOOTH_SCAN — without
// that flag the platform ALSO requires ACCESS_FINE_LOCATION to be granted before any result is
// delivered, reintroducing the same silent emptiness on a permission the user has no reason to
// grant for unlocking a car. We never derive location from a scan result, so the flag is both
// honest and load-bearing.
//
// iOS asks for Bluetooth at first CBCentralManager use and needs nothing enumerated here.

export const ANDROID_S = 31; // Android 12

export function requiredBlePermissions(os: string, apiLevel: number): string[] {
  if (os !== 'android') return [];
  if (apiLevel >= ANDROID_S) {
    return ['android.permission.BLUETOOTH_SCAN', 'android.permission.BLUETOOTH_CONNECT'];
  }
  return ['android.permission.ACCESS_FINE_LOCATION'];
}
