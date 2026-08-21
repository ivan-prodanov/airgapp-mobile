import * as Location from 'expo-location';

/**
 * Foreground location permission — ASK ONLY IF WE DO NOT ALREADY HAVE IT.
 *
 * `requestForegroundPermissionsAsync()` is not a cheap check. On Android it starts the system's
 * `GrantPermissionsActivity` over our own, even when the permission is already granted: the dialog
 * never becomes visible in that case, but the Activity transition still happens. Ours pauses for
 * ~100ms (measured: `onHostPause` at 02:04:23.306, `onHostResume` at .412), React Native stops
 * driving the surface for that window, and what shows instead is the bare window.
 *
 * On a screen push that lands mid-animation, so the screen you are LEAVING appears to lose all its
 * content — the car and the whole menu — and then slide away blank. It reproduced on exactly the
 * two screens that called request on mount (Location and Set Schedules) and on no others; Charging
 * and Security & Drivers never touch location and slide cleanly. That correlation is what
 * identified it, after the surface/compositing theories had been chased and disproved.
 *
 * `getForegroundPermissionsAsync()` is a pure query and starts nothing, which is why HomeScreen —
 * which has always used it — never caused this.
 *
 * Returns true when we may read the position.
 */
export async function ensureForegroundLocation(): Promise<boolean> {
  const current = await Location.getForegroundPermissionsAsync();
  if (current.status === 'granted') return true;
  // Already denied for good: asking again shows nothing and just pauses us for no reason.
  if (!current.canAskAgain) return false;
  const asked = await Location.requestForegroundPermissionsAsync();
  return asked.status === 'granted';
}
