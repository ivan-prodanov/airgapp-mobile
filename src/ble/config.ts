// config.ts — persistence for WHICH CAR (CarConfig) and WHICH FORWARDER
// (PiConfig), plus the enrolment deep-link parser.
//
// TWO CONFIGS, DELIBERATELY SEPARATE (split 2026-07-27):
//
//   CarConfig { vin, … }        — the car's identity. Direct BLE needs this and
//                                 the device key, nothing else.
//   PiConfig  { baseUrl, token } — one forwarder's credentials. Secret: the token
//                                 is what proves this device may talk to the Pi.
//
// They used to be one object with the VIN inside PiConfig, and that coupling cost
// a working car: losing the Pi config took the VIN with it, useCarLink's
// `setLinked(!!vin)` went false, and every command silently no-opped while the
// device key sat there perfectly intact. Forgetting a forwarder must never mean
// forgetting the car — so clearPiConfig leaves CarConfig alone, and
// clearCarConfig is the separate, explicit way to forget the vehicle.
//
// Both go through the injected SecretStore (Keychain), NEVER AsyncStorage — the
// bearer token is secret material, same as keystore.ts's private scalar. See
// keystore.ts's header for the storage seam.
//
// Reference (READ ONLY): /Users/ivan/Work/airgapp/rpi-webclient/client/app.js
// `_autoParseEnrolUrl` (~line 261) parses `airgap://enrol?api=…&token=…` with
// the global `URL` (available in the browser); `saveVin` (~285) validates
// VINs. Hermes may lack `URL` without a polyfill, so parseEnrolUrl below is a
// hand-rolled, dependency-free query parser instead — also makes it trivially
// node-testable with no DOM shim.

import type { CarConfig, PiConfig, SecretStore } from './types';

const PI_CONFIG_STORAGE_KEY = 'ble.piConfig.v1';
const CAR_CONFIG_STORAGE_KEY = 'ble.carConfig.v1';

// ── Car identity ─────────────────────────────────────────────────────────────

// loadCarConfig returns the paired car, or null if none.
//
// Falls back to a legacy PiConfig that still carries a `vin`, so an install from
// before the split keeps working without a re-enrol. The fallback is read-only —
// the next saveCarConfig writes the new key properly.
export async function loadCarConfig(store: SecretStore): Promise<CarConfig | null> {
  const raw = await store.getItem(CAR_CONFIG_STORAGE_KEY);
  if (raw) return JSON.parse(raw) as CarConfig;

  const legacy = await store.getItem(PI_CONFIG_STORAGE_KEY);
  if (!legacy) return null;
  const parsed = JSON.parse(legacy) as { vin?: string; nickname?: string; vehicleId?: string };
  if (!parsed.vin) return null;
  return { vin: parsed.vin, nickname: parsed.nickname, vehicleId: parsed.vehicleId };
}

export async function saveCarConfig(store: SecretStore, cfg: CarConfig): Promise<void> {
  await store.setItem(CAR_CONFIG_STORAGE_KEY, JSON.stringify(cfg));
}

// clearCarConfig forgets the CAR — after this the app cannot find it over BLE at
// all. Separate from clearPiConfig on purpose; this is the destructive one.
export async function clearCarConfig(store: SecretStore): Promise<void> {
  await store.removeItem(CAR_CONFIG_STORAGE_KEY);
}

// ── Forwarder credentials ────────────────────────────────────────────────────

// loadPiConfig returns the persisted forwarder credentials, or null if none.
// A null here means "no Pi arm available", NOT "no car" — direct BLE is
// unaffected.
export async function loadPiConfig(store: SecretStore): Promise<PiConfig | null> {
  const raw = await store.getItem(PI_CONFIG_STORAGE_KEY);
  if (!raw) return null;
  const parsed = JSON.parse(raw) as Partial<PiConfig>;
  if (!parsed.baseUrl || !parsed.token) return null; // a legacy VIN-only blob is not credentials
  return { baseUrl: parsed.baseUrl, token: parsed.token };
}

export async function savePiConfig(store: SecretStore, cfg: PiConfig): Promise<void> {
  await store.setItem(PI_CONFIG_STORAGE_KEY, JSON.stringify(cfg));
}

// clearPiConfig forgets the FORWARDER only. The car stays paired and direct BLE
// keeps working — that is the whole point of the split.
export async function clearPiConfig(store: SecretStore): Promise<void> {
  await store.removeItem(PI_CONFIG_STORAGE_KEY);
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
