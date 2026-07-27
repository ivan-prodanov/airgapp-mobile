// config.ts — Pi connection config persistence + enrolment deep-link parser.
//
// PiConfig (base URL + bearer token + optional VIN/nickname/vehicleId) is
// the thing an "enrol this phone with a Pi" flow produces and every
// subsequent BLE call needs. The bearer token is secret material (it's what
// proves this device is allowed to talk to the Pi), so — same as
// keystore.ts's private scalar — it goes through the injected SecretStore,
// NEVER AsyncStorage. See keystore.ts's header comment for the storage seam
// and the expo-secure-store Phase-2 hardware task; the same adapter this
// module's caller wires up for the device key covers the bearer token too
// (one Keychain-backed SecretStore, two keys).
//
// Reference (READ ONLY): /Users/ivan/Work/airgapp/rpi-webclient/client/app.js
// `_autoParseEnrolUrl` (~line 261) parses `airgap://enrol?api=…&token=…` with
// the global `URL` (available in the browser); `saveVin` (~285) validates
// VINs. Hermes may lack `URL` without a polyfill, so parseEnrolUrl below is a
// hand-rolled, dependency-free query parser instead — also makes it trivially
// node-testable with no DOM shim.

import type { PiConfig, SecretStore } from './types';

const PI_CONFIG_STORAGE_KEY = 'ble.piConfig.v1';
// The VIN, stored independently of the Pi credentials. See loadPiConfig.
const VIN_STORAGE_KEY = 'ble.vin.v1';

// loadPiConfig returns the persisted PiConfig, or null if nothing has been
// saved yet (fresh install / not yet enrolled).
export async function loadPiConfig(store: SecretStore): Promise<PiConfig | null> {
  const raw = await store.getItem(PI_CONFIG_STORAGE_KEY);
  if (raw) return JSON.parse(raw) as PiConfig;

  // No Pi config — but the VIN is vehicle IDENTITY, not a Pi credential, and it
  // is persisted separately for exactly this case. Direct BLE needs only the VIN
  // (to derive the car's advertised name) and the device key; baseUrl and token
  // are the Pi arm's business alone.
  //
  // 2026-07-27: losing the Pi config took the VIN with it, which flipped
  // useCarLink's `setLinked(!!cfg?.vin)` to false and made a perfectly working
  // BLE setup behave like a demo vehicle — every command silently no-opping.
  // Recovering the VIN here keeps direct BLE alive through the loss of Pi
  // credentials, which is what the transport split already implied.
  const vin = await store.getItem(VIN_STORAGE_KEY);
  if (!vin) return null;
  return { baseUrl: '', token: '', vin };
}

// savePiConfig persists the whole config as JSON (overwrites any previous
// value — this is a single-Pi-at-a-time store, matching the reference's
// single `this.cfg`).
export async function savePiConfig(store: SecretStore, cfg: PiConfig): Promise<void> {
  await store.setItem(PI_CONFIG_STORAGE_KEY, JSON.stringify(cfg));
  // Mirror the VIN to its own key so "forget this Pi" — or losing the config any
  // other way — cannot take the car's identity with it.
  if (cfg.vin) await store.setItem(VIN_STORAGE_KEY, cfg.vin);
}

// clearPiConfig wipes the saved config — "forget this Pi".
export async function clearPiConfig(store: SecretStore): Promise<void> {
  // Deliberately leaves the VIN. "Forget this Pi" means forget the Pi, not forget
  // the car — direct BLE keeps working. Use clearVehicleIdentity for the latter.
  await store.removeItem(PI_CONFIG_STORAGE_KEY);
}

// clearVehicleIdentity forgets the CAR: the VIN, and with it the ability to find
// the car over BLE at all. Separate from clearPiConfig on purpose.
export async function clearVehicleIdentity(store: SecretStore): Promise<void> {
  await store.removeItem(VIN_STORAGE_KEY);
}

const ENROL_PREFIX = 'airgap://enrol?';

// parseEnrolUrl parses `airgap://enrol?api=<url>&token=<tok>&nickname=<name>`
// deep links produced by the Pi's QR/share-sheet enrolment flow. `api` is a
// full https:// URL, itself percent-encoded inside the deep link's query
// string.
//
// Deliberately hand-rolled instead of using the global `URL`: Hermes (RN's
// JS engine) doesn't reliably ship a `URL` implementation without a
// polyfill, and this parser has no dependency, so it works identically in
// the app and under `node --test`. It matches the reference's semantics
// (require `api` + `token`; `nickname` optional) without needing the
// `http://airgap-internal/` rewrite trick the browser code used to satisfy
// WebCrypto's `URL` constructor.
export function parseEnrolUrl(url: string): { baseUrl: string; token: string; nickname?: string } | null {
  if (!url.startsWith(ENROL_PREFIX)) return null;
  const query = url.slice(ENROL_PREFIX.length);
  if (!query) return null;

  const params = new Map<string, string>();
  for (const pair of query.split('&')) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    if (eq === -1) continue; // no '=' — not a valid key=value pair, skip it
    const rawKey = pair.slice(0, eq);
    const rawValue = pair.slice(eq + 1);
    if (!rawKey) continue; // e.g. "=foo" or "==="
    try {
      params.set(decodeURIComponent(rawKey), decodeURIComponent(rawValue));
    } catch {
      // Malformed percent-encoding in this pair — skip it rather than
      // throwing, matching parseEnrolUrl's "return null on malformed input,
      // don't crash the caller" contract for the overall required-field
      // check below (if it's `api`/`token` that's malformed, the
      // required-field check catches it).
      continue;
    }
  }

  const baseUrl = params.get('api');
  const token = params.get('token');
  if (!baseUrl || !token) return null;

  const nickname = params.get('nickname');
  return nickname !== undefined ? { baseUrl, token, nickname } : { baseUrl, token };
}

// isValidVin matches the reference's saveVin validation: exactly 17
// characters, drawn from the VIN alphabet (A-Z minus I/O/Q, plus 0-9).
// Case-insensitive — the reference uppercases before saving, but validation
// itself accepts either case.
const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/i;

export function isValidVin(vin: string): boolean {
  return VIN_RE.test(vin);
}
