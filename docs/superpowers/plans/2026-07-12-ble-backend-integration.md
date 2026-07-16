# BLE Backend Integration — Architecture & Migration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Each Phase below is sized to be executed as its own plan by one agent; do not start a phase whose "Gate" prerequisite has not been signed off.**

**Goal:** Wire the currently UX-only airgapp mobile app to the real Tesla, using the RPi BLE byte-forwarder (`/api/ble/*`) as transport and a TypeScript port of the proven `rpi-webclient/client` protocol implementation as the command/telemetry engine.

**Architecture:** The Pi is a dumb, bearer-authed, opaque-byte BLE forwarder — it never sees plaintext or keys. The mobile app therefore owns the entire Tesla vehicle-command protocol (P-256 ECDH → SHA-1 KDF → AES-128-GCM sessions, protobuf `RoutableMessage` framing, per-domain counters, retry/fault policy), ported 1:1 from the working browser client at `/Users/ivan/Work/airgapp/rpi-webclient/client/`. A new `src/ble/` layer slots in *behind* the existing optimistic local-state mutation pipeline (`buildVehicleActions` / `CONTROL_ACTIONS`), so the UX keeps working exactly as today for demo cars and gains real command dispatch + telemetry reconciliation for the one enrolled (VIN-bearing) car.

**Tech Stack:** Expo SDK 56 / RN 0.85 / Hermes; `@noble/curves` + `@noble/ciphers` + `@noble/hashes` (pure-JS crypto — no native module, keeps the 30 s `deploy-js.sh` loop); `protobufjs` static-module codegen; `expo-secure-store` (device keypair) + `react-native-mmkv` or AsyncStorage (state cache); Go backend unchanged.

## Global Constraints

- **SAFETY (absolute): the app must NEVER reach Tesla's real servers.** Only the RPi base URL. Enforced by test in P1.T6 (grep + runtime guard). Repeated in `src/types/vehicleTypes.ts:210-221`.
- **Source of truth to port:** `/Users/ivan/Work/airgapp/rpi-webclient/client/` (`crypto.js`, `session.js`, `state.js`, `proto.js`, `keystore.js`, `app.js`, `proto/*.proto`, `ARCHITECTURE.md`). The path in `mobile/src/ble/README.md` (`/Users/ivan/Work/rpi-filter/...`) is **dead** — update that README in P1.T1. `client/ARCHITECTURE.md` is accurate to code; `client/README.md` is stale about key location (key is fully client-side).
- **Backend contract (do not change the Go server in v1):** `POST /api/ble/sessions {vin?}` → `{session_id}`; `POST /api/ble/sessions/{id}/exchange {payload_b64, timeout_ms}` → `{response_b64}` (404 session gone / 504 timeout / 502 BLE, body `{"error":"…"}`); `DELETE /api/ble/sessions/{id}`; plus `GET /pair`, `PUT /vin`, `POST /pair/external-pubkey`, `GET/DELETE /token`. Auth: `Authorization: Bearer <token>`. One BLE session per Pi (second opener blocks); 5-min idle reaper; outgoing frames MUST set `fromDestination.routingAddress` + `uuid` or the Pi's demux can't correlate responses.
- **Do not break demo mode.** Cars without a VIN stay fully local/optimistic exactly as today. All BLE behavior is per-vehicle, keyed on `vehicle.vin` being set.
- **Never run `expo prebuild`** (clobbers custom Godot `ios/`). Prefer JS-only changes deployable via `bash scripts/godot-ios/deploy-js.sh`. A native-module fallback (see D2) requires the full-rebuild path and the ExpoModulesCore version-pinning check (`nm` before rebuild).
- **Test runner (CORRECTION — repo does NOT use jest):** tests run under Node's built-in runner via tsx: `node --import tsx --test <file>`. Every occurrence of `npx jest <file>` in this document means `node --import tsx --test <file>`. Test files use `import { test } from 'node:test'` + `import assert from 'node:assert/strict'`. Package manager is **pnpm** (`pnpm add …`, never npm/yarn). The root `test` script is an explicit space-separated file list — **append each new `src/ble/**/*.test.ts` file to it** so `pnpm test` stays complete. Existing tests must stay green: `pnpm test` at repo root.
- **TS config is `strict: true`.** New code must pass `npx tsc --noEmit` with no new errors.

---

## Part 1 — System context (established by exploration, verified 2026-07-12)

### Mobile side (what exists)
- State: one `FleetState` in `useState` inside `useFleetState` ([useFleetState.ts:36](src/state/useFleetState.ts)); `VehicleViewState` (~40 fields) defined at [vehicleTypes.ts:49-102](src/types/vehicleTypes.ts). No persistence of vehicle state; seeds from `initialVehicleState`.
- **Every** user action funnels through `buildVehicleActions(apply)` ([useVehicleState.ts:35](src/state/useVehicleState.ts)) and the declarative `CONTROL_ACTIONS` registry ([controlActions.ts](src/state/controlActions.ts)). This is the interception point.
- Fleet: `Vehicle { id: 'veh_N'; name; state; mockLocationOffset }` — **not VIN-keyed**; VIN placeholder `'000Y'`.
- Fields currently trapped in screen-local `useState` (must be lifted before they can be commands): climate setpoint temp ([ClimateScreen.tsx:124](src/screens/ClimateScreen.tsx)), cabin-overheat mode + activation temp, camp/pet/bioweapon toggles, **charge limit % and charging amps** ([charging.tsx:58,97](src/app/charging.tsx)).
- Pure no-ops needing real commands: honk, light show, low power, remote start, summon, HomeLink, bioweapon, boombox/fart, media transport, **Send to Car** ([location.tsx:982](src/app/location.tsx)).
- No car networking exists. Only network code is chargers/geocoding. `src/ble/` contains only a README.

### Backend side (what exists — repo `/Users/ivan/Work/airgapp/rpi-webclient`, a git worktree of `airgapp/rpi`)
- Go `netfilterd` binary; Tesla surface = `internal/handlers/tesla*.go` + `internal/services/tesla*.go`; links `ivan-prodanov/vehicle-command` fork directly (no tesla-control shell-out); BLE adapter `hci0`.
- Reachability: LAN `https://192.168.4.1:8443` (self-signed; CA at `GET /netfilter-ca.crt`) on the Pi's own AP; remote via **Tailscale Funnel** exposing ONLY `/api/ble` at `https://<host>.ts.net` with a real Let's Encrypt cert.
- Reference client (`client/`): Alpine SPA holding all crypto. Key semantics to port verbatim:
  - Session key = first 16 bytes of `SHA1(ECDH_X)` → AES-128-GCM; per-command AAD = SHA-256 metadata block (signature type, domain, VIN personalization, epoch, expires-at, counter, flags); **separate session per domain** (VCSEC=2, Infotainment=3); SessionInfo HMAC verified with subkey `"session info"` (anti-MITM vs a malicious Pi).
  - Retry policy (`session.js:93 evaluateFault`, `app.js:754 _directDo`, max 10 attempts): session-stale faults (4,5,6,15,17) → in-place SessionInfo refetch, retry at 0 ms; transient (1,2,11) → retry after 100 ms; transport-dead → evict + cold re-handshake; anything else → surface to user.
  - State model (`state.js`): per-VIN persisted snapshot; VCSEC `GET_STATUS` poll every 20 s while visible (works asleep: lock, sleep, presence, per-closure status); Infotainment slices (charge/climate/drive/location) read on demand via `awakeSync` — 4 single-field reads on one warm session; optimistic writes with dirty marking; 30 s closure-intent grace window (Hall sensors lag minutes).
- Single VIN configured on the Pi (`settings.tesla_vin`); `POST /sessions` already accepts a `vin` body param, so multi-vehicle is a server-config gap, not a protocol gap. **v1 = one real car.**
- Enrollment of a new device: operator issues a bearer in the Pi admin UI → client stores base URL + bearer (deep link `airgap://enrol?api=…&token=…&nickname=…` already parsed by the web client at `app.js:261`) → client generates its own P-256 keypair → `POST /pair/external-pubkey` → operator taps NFC card on console. **Each phone gets its own key.**

---

## Part 2 — Architecture decisions

**D1. Command engine lives on the phone (port the JS client), not behind new REST endpoints on the Pi.**
Rationale: the Pi deliberately never sees plaintext (E2E crypto phone↔car survives a compromised Pi); the exchange contract is tiny and stable; the client was written to be ported (`client/ARCHITECTURE.md:20-26`); no Go work needed, and every command Tesla's firmware accepts becomes available without server deploys.

**D2. Crypto: pure-JS `@noble/curves` (p256), `@noble/ciphers` (aes-gcm), `@noble/hashes` (sha1, sha256, hmac) — NOT `react-native-quick-crypto`.**
Rationale: Hermes has no WebCrypto; quick-crypto is a native module → full 25-min xcodebuild + the documented ExpoModulesCore version-pinning dyld-crash gotcha, and kills the 30 s `deploy-js.sh` iteration loop for the whole integration. noble is audited, pure-JS, Node-testable, fast enough (a handful of GCM ops per command). Trade-off accepted: the private key is extractable JS material stored in the iOS Keychain via `expo-secure-store` instead of a non-extractable CryptoKey — acceptable for a personal-device ROLE_DRIVER key; Secure-Enclave upgrade is a future native task. **Fallback** if noble hits a Hermes issue: quick-crypto behind the same `src/ble/crypto.ts` interface (interface designed so only that file changes).

**D3. Transport & TLS: default to the Tailscale Funnel URL (`https://<host>.ts.net/api/ble`) for v1; LAN fast-path is a later optimization.**
Rationale: RN `fetch` rejects the Pi's self-signed LAN cert; Funnel has a real LE cert, works from anywhere (including at home), and requires zero client or server code. Options if Funnel latency hurts (measure in P0): (a) user installs `netfilter-ca.crt` as an iOS profile → LAN `https://192.168.4.1:8443` works natively; (b) add a plain-HTTP LAN listener for `/api/ble` on the Pi (payloads are E2E-encrypted anyway; only the bearer is exposed, on the Pi's own AP) — small Go change, explicitly out of v1 scope. The base URL is user-configurable either way.

**D4. Protobuf: vendor `client/proto/*.proto` into `mobile/proto/` and precompile with `pbjs -t static-module` at build time.**
Rationale: Metro can't bundle `.proto` text files and runtime reflection parsing is slow/fragile on Hermes; static-module output is plain JS (no eval), tree-shakeable, and gives `pbts`-generated TypeScript types for free. Regeneration is an npm script, checked-in output.

**D5. State integration: keep optimistic-first UX; add reconciliation, don't replace.**
Every action keeps mutating `VehicleViewState` immediately (the Godot car must animate instantly). For a live vehicle the same action *also* enqueues a command on a per-VIN FIFO; on fault, the optimistic patch is rolled back and a toast/haptic surfaces the error. Telemetry flows the other way through one function (`applyTelemetry`) that maps VCSEC/CarServer messages onto `VehicleViewState`, respecting the 30 s closure-intent grace window. Mirrors the proven `state.js` design.

**D6. Fleet: `vin?: string` on `Vehicle`; exactly one live car in v1.**
The enrolled car gets `vin` + the Pi config; all other cars stay demo. `veh_N` ids remain the UI identity; VIN is the protocol identity. Multi-VIN (per-car Pi/VIN mapping, server-side multi-vehicle) is future work — the interfaces below already take `vin` parameters so nothing needs redesign.

**D7. Feature flag / kill switch:** `EXPO_PUBLIC_CAR_LINK=1` gates the whole BLE layer (module no-ops when unset), independent of per-vehicle enrollment. `.env.local` is already sourced by `deploy-js.sh`; remember Metro doesn't cache-bust on env changes — bundle with `--reset-cache` and verify with `strings`.

---

## Part 3 — Target module layout

```
src/ble/
  README.md              # rewrite: point at rpi-webclient, this plan (P1.T1)
  config.ts              # PiConfig storage (baseUrl, bearer, vin) via expo-secure-store
  keystore.ts            # device P-256 keypair: generate/load/exportPublicRaw (secure-store)
  crypto.ts              # noble-backed: ecdhSessionKey, aesGcmEncrypt/Decrypt, hmacSubkey, metadata AAD hash
  proto/
    gen.js / gen.d.ts    # pbjs/pbts output (checked in), npm run build:teslaproto
  framing.ts             # port of proto.js: RoutableMessage build/parse, routingAddress+uuid
  session.ts             # port of session.js: per-domain session handshake, counters, evaluateFault, ALL command builders
  transport.ts           # PiTransport: fetch wrapper for /api/ble/* (bearer, timeouts, error mapping)
  queue.ts               # per-VIN FIFO SessionQueue (port from state.js:491)
  gateway.ts             # CarGateway: runCommand / readVcsecStatus / awakeSync / background poll; retry loop (_directDo port)
  telemetry.ts           # VCSEC + CarServer response → Partial<VehicleViewState> mapping, closure-intent grace
  commands.ts            # typed CarCommand union → session.ts builder dispatch
  index.ts               # public surface; no-ops when EXPO_PUBLIC_CAR_LINK unset
src/state/
  useCarLink.ts          # React glue: owns gateway lifecycle, foreground VCSEC poll, exposes dispatchCarCommand
  (fleet.ts, useFleetState.ts, useVehicleState.ts — modified, see P3)
src/app/
  carlink.tsx            # enrollment/settings screen (P2.T4)
proto/                   # vendored .proto sources from rpi-webclient/client/proto/
```

Everything under `src/ble/` except `index.ts`/`config.ts`/`keystore.ts` is **pure TS with zero React/Expo imports** → runs under Jest in Node with the Go-verified fixtures.

## Part 4 — Interface contracts (binding for all agents)

```ts
// src/ble/types.ts — exact, agents must not diverge without architect sign-off
// NOTE (2026-07-12): as IMPLEMENTED in Phase 1, Domain = 2 | 3 (the numeric wire values —
// VEHICLE_SECURITY=2, INFOTAINMENT=3), which is what session.ts/commands.ts/queue use. The
// string form below was the original sketch; use the numeric form the code already exports.
export type Domain = 2 | 3; // was: 'vcsec' | 'infotainment'

export interface PiConfig { baseUrl: string; token: string; vin: string; nickname?: string; vehicleId?: string /* fleet binding until P3.T1 */ }

export interface PiTransport {
  pairInfo(): Promise<{ vin: string; paired: boolean }>;
  enrollPublicKey(publicKeyB64: string): Promise<void>;
  openSession(vin: string): Promise<string>;                      // POST /sessions → session_id
  exchange(sessionId: string, payloadB64: string, timeoutMs: number): Promise<string>; // → response_b64
  closeSession(sessionId: string): Promise<void>;
}
// transport error mapping: 404→'session-gone', 504→'timeout', 502→'ble', 401/403→'auth', else 'http'
export class TransportError extends Error { kind: 'session-gone'|'timeout'|'ble'|'auth'|'http'|'network' }

export type CarCommand =
  | { type: 'lock' } | { type: 'unlock' } | { type: 'wake' }
  | { type: 'openFrunk' } | { type: 'openTrunk' } | { type: 'closeTrunk' }
  | { type: 'openChargePort' } | { type: 'closeChargePort' }
  | { type: 'chargeStart' } | { type: 'chargeStop' } | { type: 'setChargeLimit'; percent: number }
  | { type: 'setChargingAmps'; amps: number }
  | { type: 'climateOn' } | { type: 'climateOff' } | { type: 'setClimateTemp'; celsius: number }
  | { type: 'defrostOn' } | { type: 'defrostOff' }
  | { type: 'climateKeeper'; mode: 'off'|'on'|'dog'|'camp' }
  | { type: 'cabinOverheat'; on: boolean } | { type: 'setCopTemp'; level: 'low'|'medium'|'high' }
  | { type: 'seatHeater'; seat: 'FL'|'FR'|'RL'|'RC'|'RR'; level: 0|1|2|3 }
  | { type: 'seatCooler'; seat: 'FL'|'FR'; level: 0|1|2|3 }
  | { type: 'steeringWheelHeat'; on: boolean }
  | { type: 'ventWindows' } | { type: 'closeWindows' }
  | { type: 'honk' } | { type: 'flashLights' } | { type: 'remoteStart' }
  | { type: 'sentry'; on: boolean }
  | { type: 'valet'; on: boolean; pin?: string }
  | { type: 'speedLimit'; action: 'activate'|'deactivate'|'set'|'clearPin'; mph?: number; pin?: string }
  | { type: 'homelink'; lat: number; lon: number }
  | { type: 'boombox'; sound: number }
  | { type: 'bioweaponMode'; on: boolean }
  | { type: 'pinToDrive'; on: boolean; pin?: string }
  | { type: 'navigateTo'; lat: number; lon: number; label?: string }
  | { type: 'navigateWaypoints'; coords: {lat:number; lon:number}[]; order: 'REPLACE'|'PREPEND'|'APPEND' }
  | { type: 'media'; action: 'toggle'|'next'|'prev'|'volumeUp'|'volumeDown' };

export type CommandOutcome =
  | { ok: true }
  | { ok: false; kind: 'fault'; faultName: string; message: string }   // car said no (semantic)
  | { ok: false; kind: 'unreachable'|'timeout'|'auth'; message: string };

export interface VcsecStatus {
  lockState: 'locked'|'unlocked'|'internal_locked'|'selective_unlocked'|'unknown';
  sleepStatus: 'awake'|'asleep'|'unknown';
  userPresence: 'present'|'not_present'|'unknown';
  closures: Partial<Record<'frontDriverDoor'|'frontPassengerDoor'|'rearDriverDoor'|'rearPassengerDoor'|'rearTrunk'|'frontTrunk'|'chargePort'|'tonneau', 'open'|'closed'|'ajar'|'opening'|'closing'|'unknown'>>;
}

export interface InfotainmentSnapshot {
  charge?: { soc: number; rangeKm: number; chargingState: string; chargeLimitSoc: number };
  climate?: { insideTempC: number; outsideTempC: number; targetTempC: number; isOn: boolean };
  drive?: { speed: number|null; gear: string };
  location?: { lat: number; lon: number; heading: number };
  closures?: { sentryOn: boolean; windowsOpen: boolean };
}

export interface DeviceKeys {
  privateScalar: Uint8Array;      // P-256 private key (from keystore.ts)
  publicKeyRaw: Uint8Array;       // 65-byte SEC1 0x04‖X‖Y
}

export interface CarGateway {
  runCommand(cmd: CarCommand): Promise<CommandOutcome>;     // full retry loop inside
  readVcsecStatus(): Promise<VcsecStatus>;                   // works asleep, never wakes
  awakeSync(): Promise<InfotainmentSnapshot>;                // never wakes — caller calls wake() first if asleep
  wake(): Promise<CommandOutcome>;
  startForegroundPoll(onStatus: (s: VcsecStatus) => void): () => void;  // 20 s VCSEC loop, returns stop()
}
export function createCarGateway(cfg: PiConfig, keys: DeviceKeys, transport?: PiTransport): CarGateway;
```

React layer contract (Phase 3):

```ts
// src/state/useCarLink.ts
export interface CarLink {
  status: 'disabled'|'unenrolled'|'idle'|'connecting'|'online'|'error';
  dispatch(cmd: CarCommand, rollback?: () => void): void;   // fire-and-reconcile; rollback runs on failure
  refresh(): Promise<void>;                                  // pull-to-refresh → wake + awakeSync → applyTelemetry
}
export function useCarLink(vehicle: Vehicle, applyTelemetry: (p: Partial<VehicleViewState>) => void): CarLink;
```

## Part 5 — Action → command mapping (the wiring spec for Phase 4)

Builder status: ✅ = exists in `client/session.js` export block (port as-is); 🆕 = proto message exists in vendored `carserver.proto`, write a new builder (client-side only, zero server change); ❓ = needs research spike; 🚫 = not available over BLE, leave as no-op/hidden.

> **UPDATE 2026-07-12 (Phase 1 built + proto-verified — supersedes the ❓/🆕 guesses below):** The whole protocol core is now implemented and unit-tested in `src/ble/` (crypto, proto codec, session engine, ALL builders, `buildCommand(cmd: CarCommand)` dispatcher, per-VIN queue). Phase 4 wires the app to `buildCommand`; the concrete per-command facts:
> - **Available and built** (dispatcher handles them): lock, unlock, wake, frunk/trunk/chargePort open/close, honk, flashLights, climate on/off, defrost on/off, sentry on/off, ventWindows/closeWindows, charge start/stop/max/standard, setChargeLimit, **setChargingAmps** (`SetChargingAmpsAction=43`), **setClimateTemp** (uses `driver_temp_celsius`/`passenger_temp_celsius` — the browser client's `levels` field was dead, so its set-temp never actually worked), climateKeeper (off/on/dog/camp), setCabinOverheat (on/fan_only), **setCopTemp** (`SetCopTempAction=66`, level low/med/high — the earlier "no proto" claim was WRONG), **bioweaponMode** (reference's `setKeepAccPowerAction` was misnamed), steeringWheelHeat (**on/off only — no level proto**), seatHeater/seatCooler, homelink, remoteStart (**VCSEC `RKE_ACTION_REMOTE_DRIVE=20`, not an infotainment action**), valet/speedLimit/pinToDrive (PIN-gated), boombox, **media** play/next/prev/volume, navigateTo (single GPS), and the 5 state reads + full-vehicle-data (all carry `FLAG_ENCRYPT_RESPONSE_BIT`).
> - **NOT buildable → dispatcher throws; Phase 4 must hide/adapt for live cars:** `navigateWaypoints` (multi-stop proto takes a **Google Place-ID string, not lat/lon** — Send-to-Car multi-stop needs a Place-ID resolve step or must fall back to single-stop `navigateTo` on the final destination); steering-wheel-heat **level** (Low/High — only on/off exists); COP activation-temperature is the `setCopTemp` enum (low/med/high), there is no free-form 30/35/40 setter (map the UI's 30/35/40 → low/med/high). Light show, summon, parental controls remain 🚫.
> The authoritative per-variant mapping is `src/ble/commands.ts` (`buildCommand`) + `src/ble/builders.ts`; the table below is the original design intent, kept for traceability.

| # | Mobile action (file) | CarCommand | Builder | Notes |
|---|---|---|---|---|
| 1 | Lock/Unlock (`controlActions.ts:56`, `MarkerOverlay.tsx:79`) | lock / unlock | ✅ VCSEC | works asleep |
| 2 | Frunk (`controlActions.ts:85`) | openFrunk | ✅ VCSEC | no close-frunk (manual) — UI already models open-only? verify |
| 3 | Trunk (`controlActions.ts:92`) | openTrunk/closeTrunk | ✅ VCSEC | |
| 4 | Charge port (`controlActions.ts:75`, `charging.tsx:116`) | openChargePort/closeChargePort | ✅ VCSEC | open while charging = stop+unlatch: send chargeStop then closeChargePort? verify web `app.js` behavior |
| 5 | Vent/Close windows (`controlActions.ts:99`, `ClimateScreen.tsx:131`) | ventWindows/closeWindows | ✅ INFO | needs awake |
| 6 | Flash lights (`controlActions.ts:114`) | flashLights | ✅ INFO | keep the 1.2 s local animation |
| 7 | Honk (`controlActions.ts:124`, noop) | honk | ✅ INFO | |
| 8 | Sentry (`controlActions.ts:152`, `security.tsx:39`) | sentry on/off | ✅ INFO | |
| 9 | Remote start (`controlActions.ts:145`, noop) | remoteStart | ✅ INFO | web builder `remote-drive` |
| 10 | Climate on/off (`ClimateScreen.tsx:178`) | climateOn/Off | ✅ INFO | |
| 11 | Setpoint ± (`ClimateScreen.tsx:124`, local useState) | setClimateTemp | ✅ INFO | lift to VehicleViewState first (P3.T2); 15–28 °C matches web |
| 12 | Defrost (`ClimateScreen.tsx:143`) | defrostOn/Off | ✅ INFO | |
| 13 | Camp/Pet (`ClimateScreen.tsx:225/:234`, local) | climateKeeper dog/camp/off | ✅ INFO | lift state |
| 14 | Cabin overheat on/noac/off (`ClimateScreen.tsx:251`, local) | cabinOverheat | ✅ on/off; 'noac' variant ❓ | proto has fan-only option — spike |
| 15 | Overheat temp 30/35/40 (`ClimateScreen.tsx:266`, local) | setCopTemp | 🆕 `setCopTempAction` | low/med/high ↔ 30/35/40 |
| 16 | Seat heaters (`ClimateMarkerOverlay.tsx:99`) | seatHeater | ✅ INFO | mobile steps 3→2→1→0 map to HIGH/MED/LOW/OFF |
| 17 | Seat coolers (menu Cool) | seatCooler | ✅ INFO (FL/FR only) | gate by `climateCapabilitiesFor` |
| 18 | Steering wheel heat (`ClimateMarkerOverlay.tsx:102`) | steeringWheelHeat | ✅ on/off; level variant ❓ | mobile has 2 levels — spike `RemoteSteeringWheelHeatLevelAction`, else map 2/1→on |
| 19 | Charge limit slider (`charging.tsx:58`, local) | setChargeLimit | ✅ INFO | lift state; detents already match 50–100 |
| 20 | Charging amps ± (`charging.tsx:97`, local) | setChargingAmps | 🆕 `setChargingAmpsAction` | lift state |
| 21 | Start/stop charging (implicit in port button today) | chargeStart/chargeStop | ✅ INFO | give it explicit UI affordance in P4 |
| 22 | Valet (`security.tsx:46`) | valet | ✅ INFO (PIN) | PIN entry UI needed |
| 23 | Speed limit (`security.tsx:60`) | speedLimit | ✅ INFO (PIN) | |
| 24 | PIN to Drive (`security.tsx:67`) | pinToDrive | 🆕 ❓ verify proto has it | else 🚫 hide toggle for live car |
| 25 | Parental controls (`security.tsx:53`) | — | 🚫 not over BLE | keep local/demo-only |
| 26 | Bioweapon (registry noop + `ClimateScreen.tsx:210` local) | bioweaponMode | 🆕 `hvacBioweaponModeAction` | consolidate the two toggles |
| 27 | HomeLink (`controlActions.ts:180`, noop) | homelink | ✅ INFO | requires fresh car lat/lon from drive/location read |
| 28 | Boombox/Fart (`controlActions.ts:187`, noop) | boombox | ✅ INFO | |
| 29 | Light show (`controlActions.ts:131`, noop) | — | 🚫 (no BLE carserver message known) | leave noop; research ticket |
| 30 | Low power (`controlActions.ts:138`, noop) | — | ❓ web has keep-acc-power on/off | decide semantics or hide |
| 31 | Summon (`controlActions.ts:159`, disabled) | — | 🚫 v1 (experimental streamMessage probes exist) | explicitly out of scope |
| 32 | Unlatch door (`controlActions.ts:166`) | — | ❓ VCSEC closure-move spike | else hide for live car |
| 33 | Send to Car (`location.tsx:982`, noop) | navigateTo / navigateWaypoints | ✅ INFO | payload from `trip.trip.stops`; multi-stop → waypoints REPLACE |
| 34 | Media bar (`HomeScreen.tsx:155`, static) | media | 🆕 `mediaPlayAction` etc. | verify protos vendored; else defer |
| 35 | Schedules (`schedules.tsx`, local-only) | — | ❓ `chargeSchedule`/`preconditionSchedule` protos | Phase 5 spike; keep local persistence meanwhile |
| 36 | Wake / pull-to-refresh (`HomeScreen.tsx:93`) | wake + awakeSync | ✅ VCSEC wake | replaces the 1.4 s fake delay |

Telemetry reads → state fields (Phase 3): VCSEC status → `locked`, `awake`, per-closure booleans (`frunkOpen`, `trunkOpen`, doors, `chargePortOpen`); charge → `batteryLevel`, new `batteryRangeKm`, `charging`, new `chargeLimitPercent`; climate → `interiorTempC`, `exteriorTempC`, new `targetTempC`, `climateOn`; location → replaces `mockLocationOffset` math for live car; closures read → `sentryEnabled`, window booleans.

---

## Part 6 — Phases

### Phase 0 — Connectivity spike & fixtures (½ day, blocks everything)
**Owner: Agent A. Gate to pass: architect reviews spike notes.**

- [ ] **P0.T1** From a Mac/Node script (`scratch/`, not committed): hit the real Pi `GET /api/ble/pair` with a bearer via (a) the Funnel `https://<host>.ts.net` URL and (b) LAN `https://192.168.4.1:8443` — record which work and round-trip latency. Confirms D3 and gives the real base URL for `.env.local` (`EXPO_PUBLIC_PI_URL_DEFAULT` optional convenience).
- [ ] **P0.T2** Extract the Go-verified crypto fixtures from `rpi-webclient/client/crypto-test.html` (the 16 passing vectors: ECDH shared secret, SHA-1 KDF session key, AES-GCM round-trip + AAD-tamper rejection, ciphertext-matches-Go, HMAC subkey, protobuf encode/decode) into `mobile/src/ble/__fixtures__/goVectors.json`. These are the acceptance tests for the whole protocol port.
- [ ] **P0.T3** Verify jest runs pure-TS files in this repo (`npx jest src/state/fleet.test.ts` green) and that `@noble/hashes` sha1 is importable under the repo's TS config. `pnpm add @noble/curves @noble/ciphers @noble/hashes` (JS-only — no pod install).
- [ ] **P0.T4** Vendor `rpi-webclient/client/proto/*.proto` → `mobile/proto/`; add `"build:teslaproto": "pbjs -t static-module -w commonjs --no-service -o src/ble/proto/gen.js proto/*.proto && pbts -o src/ble/proto/gen.d.ts src/ble/proto/gen.js"`; commit generated output; smoke-test an encode/decode of `RoutableMessage` in a jest test.
- [ ] **P0.T5** Confirm which 🆕/❓ proto messages exist in the vendored protos (`setChargingAmpsAction`, `setCopTempAction`, `hvacBioweaponModeAction`, media actions, pin-to-drive, charge/precondition schedules, steering-wheel level). Update the Part 5 table's Builder column with findings. If a message is missing, check the fork `github.com/ivan-prodanov/vehicle-command` protos before declaring 🚫.

### Phase 1 — Protocol core port (pure TS, no app code) (2–3 days)
**Owner: Agent A. Gate: all ported tests green incl. Go fixtures; architect code-review focusing on counter/epoch/AAD handling.**

Port file-by-file, preserving function names and the retry/fault tables so future diffs against the web client stay reviewable:

- [ ] **P1.T1** Rewrite `src/ble/README.md`: correct source path (`/Users/ivan/Work/airgapp/rpi-webclient/client/`), link this plan, keep the transport/safety notes.
- [ ] **P1.T2** `crypto.ts` — port `crypto.js` onto noble. TDD against `goVectors.json`: session-key KDF, GCM encrypt/decrypt with AAD, tamper rejection, HMAC subkey `"session info"`. Test: `npx jest src/ble/crypto.test.ts`.
- [ ] **P1.T3** `framing.ts` — port `proto.js`: RoutableMessage build/parse, `fromDestination.routingAddress` (16 random bytes per client instance) + `uuid` set on every frame; fixture round-trips.
- [ ] **P1.T4** `session.ts` — port `session.js`: per-domain SessionInfo handshake (HMAC verify), counter/epoch/expiry AAD metadata, `evaluateFault` table (copy the fault-code→class mapping verbatim), and **all** ✅ command builders from the export block. Unit tests: fault classification table-driven test; one golden encrypted-frame test per domain using fixed keys/counters from fixtures.
- [ ] **P1.T5** `queue.ts` — port per-VIN FIFO `SessionQueue` (single in-flight command; Tesla's counter is monotonic — overlap corrupts the session). Test: interleaved enqueues resolve strictly in order, a rejected job doesn't wedge the queue.
- [ ] **P1.T6** Safety guard: `transport.ts` constructor throws unless the host matches the configured Pi host; jest test asserting a `tesla.com`/`owner-api` URL throws; add a CI-style test greping `src/ble` for `tesla.com|owners-api|akamai` literals.
- [ ] **P1.T7** New builders flagged 🆕 in Part 5 (amps, COP temp, bioweapon, media, pin-to-drive if proto confirmed) with encode-shape unit tests (decode own output, assert field numbers/values against the .proto).
- [ ] **P1.T8** Commit per file (`feat(ble): port crypto core`, etc.). Run full `npx jest src/ble` — all green including the Go vectors.

### Phase 2 — Transport, keystore, enrollment (1–2 days)
**Owner: Agent B. Gate: enrollment flow demoed against the real Pi (key enrolled, NFC tapped, `GET /pair` shows paired).**

> **STATUS: Phase 1 is DONE and merged-ready (protocol core in `src/ble/`, 168 tests). Phase 2 now builds ON it — the `PiTransport`/`DeviceKeys` interfaces are real and in `src/ble/types.ts`.**
>
> - [ ] **P2.T0 — HERMES POLYFILLS (BLOCKER — do this FIRST, before anything else in Phase 2).** Three JS globals the headless stack relies on that Hermes does NOT reliably ship (all invisible to Node tests, which have them):
>   1. **`crypto.getRandomValues`** — noble's `randomBytes` (every handshake/command nonce) throws without it. `pnpm add react-native-get-random-values` and `import 'react-native-get-random-values';` as the FIRST line of the app entry.
>   2. **`URL`** — `src/ble/teslaHostGuard.ts` uses `new URL()` + `url.hostname` as the *sole runtime enforcement* of the "never reach Tesla servers" safety constraint. The guard is now **fail-closed** (an empty/missing hostname is rejected), so a missing/partial Hermes `URL` fails safe — but it also means WITHOUT the polyfill every base URL is rejected and nothing connects. `pnpm add react-native-url-polyfill` and `import 'react-native-url-polyfill/auto';` at the app entry (next to the getRandomValues import).
>   3. **`TextEncoder`** — used in `crypto.ts`/`session.ts` (VIN/label encoding). Recent Hermes ships it; verify on-device, and if missing add a tiny ASCII encoder or `text-encoding` polyfill at entry.
>   These are JS-only (no rebuild) but a hard on-device prerequisite. Verify by deploying a screen that calls `randomBytes(12)` and `new PiClient({baseUrl:'https://192.168.4.1:8443', token:'x'})` (should construct) and `…owner-api.tesla.com…` (should throw) and confirming behavior on the device.
> - **P2 transport must EXTEND, not redefine, the core interface:** `src/ble/types.ts` already exports `PiTransport = { openSession, exchange, closeSession }`. The concrete fetch client should implement a superset (`interface PiClient extends PiTransport { pairInfo(); enrollPublicKey(); tokenInfo(); revokeToken(); }`) — one name, no collision. Keep the plan's P1.T6-style runtime host-allowlist guard IN `transport.ts` (the grep guard alone won't catch a `baseUrl` from config).

- [ ] **P2.T1** `transport.ts` — `PiTransport` over `fetch`: bearer header, per-call timeouts via `AbortController` (sessions open 45 s, exchange = `timeout_ms`+5 s, others 15 s — mirror `app.js:52`), error mapping per Part 4. Jest tests with mocked fetch for each error code.
- [ ] **P2.T2** `keystore.ts` — generate P-256 keypair with noble, persist private scalar in `expo-secure-store` (`ble.deviceKey.v1`), export 65-byte SEC1 pubkey b64. Regeneration = re-enrollment warning.
- [ ] **P2.T3** `config.ts` — `PiConfig` persistence (secure-store), plus parsing of the existing `airgap://enrol?api=…&token=…&nickname=…` deep-link format (register scheme in app config; test the parser).
- [ ] **P2.T4** `src/app/carlink.tsx` enrollment/settings screen (match app styling): paste-or-deeplink base URL + bearer → `pairInfo()` fetch shows VIN → "Enroll this phone" → `enrollPublicKey` → instruction card "tap your key card on the console" → poll `pairInfo` until `paired`; also shows connection status, token self-revoke (`DELETE /token`), and binds the VIN to a chosen fleet vehicle. Until P3.T1 adds `vehicle.vin`, store the binding as `PiConfig.vehicleId` in `config.ts`; P3.T1 migrates it onto the `Vehicle` object.
- [ ] **P2.T5** Hardware verification: run enrollment end-to-end on the device via `deploy-js.sh` (JS-only stack — confirm no native module crept in).

### Phase 3 — State integration (after P1+P2 gates) (2 days)
**Owner: Agent B (Agent A reviews). Gate: on real car — lock/unlock from Home works, Godot animates, VCSEC poll updates lock state changed from the physical key; demo cars unaffected; all state tests green.**

- [ ] **P3.T1** Fleet: add `vin?: string` to `Vehicle` (`fleet.ts:17`); active live vehicle = the one whose `vin` matches the Pi config. Update fleet tests.
- [ ] **P3.T2** Lift screen-local state into `VehicleViewState` (with defaults in `initialVehicleState` and Godot-adapter no-op check in `vehicleStateAdapter.ts`): `targetTempC`, `chargeLimitPercent`, `chargingAmps`, `cabinOverheatMode: 'off'|'noac'|'on'`, `cabinOverheatTemp: 30|35|40`, `climateKeeper: 'off'|'dog'|'camp'`, `bioweaponOn`, `batteryRangeKm`. Add matching `VehicleActions` setters via `buildVehicleActions`. Refactor `ClimateScreen`/`charging.tsx` to consume them (pure refactor first — behavior identical, existing tests + manual pass).
- [ ] **P3.T3** `telemetry.ts` — map `VcsecStatus`/`InfotainmentSnapshot` → `Partial<VehicleViewState>`, with the 30 s closure-intent grace (suppress telemetry that contradicts a <30 s-old optimistic closure change). Table-driven jest tests (esp. enum→boolean edges: `ajar`, `selective_unlocked`, `unknown` = no-patch).
- [ ] **P3.T4** `gateway.ts` — port `_directDo` retry loop (max 10 attempts, fault classes → refetch/delay/evict per Phase-1 table) over `transport`+`session`+`queue`; tests with a scripted fake transport (reuse the `FakeCar` harness from `src/ble/session.test.ts`): stale-session→`refreshCachedSession` then success; transport-dead→cold re-handshake; semantic fault surfaces once. **Three carry-forward requirements from the Phase-1 final review:** (1) the decrypt-fail-as-"stale frame" path (`session.ts` ~line 605) MUST classify as **retryable**, not semantic — otherwise transient response races become user-facing errors; add a test. (2) Assert `session.domain === built.domain` before `sendCommand` (a cheap guard turns a car signature-fault into a clear local error). (3) Close the Phase-1 coverage gaps here: add live tests for `refetchSessionInfo`/`refreshCachedSession`, the counter-rollover throw, and a `FLAG_ENCRYPT_RESPONSE` round-trip (`vcsecGetStatus`/a state read through `sendCommand`).
- [ ] **P3.T4b — RESPONSE ORACLE (gate before trusting any on-car read).** The response-side AAD path (`buildAesGcmResponseMetadata`, `makeRequestHash`, the decrypt branch) is currently proven only self-consistently by `FakeCar` — no independent oracle. All telemetry depends on it. Capture a **Go-emitted** `RoutableMessage` carrying `AES_GCM_ResponseData` (e.g. from the `rpi-webclient` Go SDK / a real exchange logged on the Pi) and add it to `goVectors.json`; write a test that decrypts it with the real session key and asserts the plaintext `CarServer.Response`. Until this passes, treat on-car reads as unverified.
- [ ] **P3.T5** `useCarLink.ts` — owns gateway per active live vehicle: foreground-only 20 s VCSEC poll (AppState-aware; stop on background — the Pi's 5-min reaper cleans up), `dispatch(cmd, rollback)` (optimistic patch already applied by caller; on `!ok` run rollback + error haptic/toast), `refresh()` = wake→awakeSync→applyTelemetry (replaces `HomeScreen.tsx:93` fake delay). Wire into `VehicleProvider`. **Build the gateway once via `createCarGateway`** from `src/ble` (`index.ts` façade — includes `vcsecStatusToPatch`/`infotainmentToPatch`/`CLOSURE_INTENT_GRACE_MS` for the read path; you own the `closureIntent` map threaded across polls + calling `applyTelemetry`). **CRITICAL single-gateway invariant:** `session.ts`'s `_domainCache` is a module-global keyed on domain only (no VIN check on cache *hits* — safe for v1's one live car, but two VINs would silently share sessions). So: exactly ONE active live gateway at a time, and **call `closeAllCachedSessions()` whenever the active vehicle changes or on re-enrollment**; never construct a gateway per render. `startForegroundPoll` was intentionally NOT put on `CarGateway` (Part 4 sketch listed it) — the 20 s AppState-aware loop + `DELETE`-session-on-background live HERE in the React layer. Asleep handling: if `readVcsecStatus()` shows `asleep`, call `wake()` before `awakeSync()`; treat a partial snapshot as "some slices stale," and note `awakeSync` rejects only if ALL four reads fault.
- [ ] **P3.T6** First end-to-end wiring: `CONTROL_ACTIONS.lock` dispatches `{type:'lock'|'unlock'}` for live vehicles. Hardware gate test happens here.

### Phase 4 — Action wiring sweep (parallelizable per screen) (2–3 days)
**Owners: Agent A (Climate + seats + charging screens) and Agent B (Controls registry, security, location/Send-to-Car, Home) in parallel — the shared surface (`useCarLink`, `commands.ts`) is frozen after P3. Gate per screen: on-car verification checklist row signed off.**

- [ ] **P4.T1** Wire every ✅/🆕 row of the Part 5 table: pattern is always — optimistic local mutation (existing code, unchanged) + `carLink.dispatch(cmd, rollbackPatch)`. Commit per screen.
- [ ] **P4.T2** Send-to-Car (`location.tsx:982`): single stop → `navigateTo` with label; multi-stop trip → `navigateWaypoints REPLACE`. Success toast; requires awake (wake first, mirroring web `_directDo` piggyback).
- [ ] **P4.T3** Asleep-car UX: infotainment commands on an asleep car auto-`wake` first (one retry), VCSEC commands never wake. Battery/charging UI shows staleness ("Last updated …" from real telemetry timestamps instead of `getMockLastUpdated()`).
- [ ] **P4.T4** Live-car location on the map: use last telemetry `location` for the VIN'd car instead of `mockLocationOffset` (`location.tsx:168`); mock stays for demo cars.
- [ ] **P4.T5** ❓ spikes resolved or rows demoted to 🚫-hidden for live cars (unlatch door, steering-wheel level, COP no-A/C, low-power).

### Phase 5 — Hardening & stretch (after v1 works)
- [ ] **P5.T1** Telemetry persistence per VIN (AsyncStorage snapshot like web `localStorage`, instant last-known state on cold launch).
- [ ] **P5.T2** Schedules → car (`chargeSchedule`/`preconditionSchedule` builders) if P0.T5 confirmed protos; else keep local and file a backend/fork ticket.
- [ ] **P5.T3** Media controls wiring (needs `mediaPlaying` from real state — verify what infotainment exposes over BLE).
- [ ] **P5.T4** LAN fast-path per D3 if Funnel latency measured >1.5 s per command round-trip.
- [ ] **P5.T5** Multi-vehicle server support (per-VIN Pi config; `POST /sessions {vin}` already exists) — separate plan. **Client prerequisite:** `session.ts`'s `_domainCache` currently keys on `domain` only (correct for one live car); multi-VIN MUST re-key it to `(vin, domain)` or a second VIN opening the same domain will silently evict the first VIN's session. (Per-VIN queue is already correct.)

---

## Part 7 — Orchestration strategy (for the supervising session)

**Two executor agents + architect (this role):**

- **Agent A — "Protocol"**: P0, P1, then P4 climate/charging half. Deep, sequential, test-fixture-driven work; owns `src/ble/{crypto,framing,session,queue}.ts` exclusively.
- **Agent B — "App integration"**: P2 (parallel with P1), P3, then P4 controls/security/location half. Owns `src/ble/{transport,keystore,config,gateway,telemetry}.ts`, `useCarLink`, screens.
- **File-ownership boundary** is the Part 3 layout — no agent edits the other's files; the Part 4 interfaces are the contract. Interface changes go through the architect.
- **Gates are mandatory review checkpoints** (end of P0, P1, P2, P3, each P4 screen): run the phase's test command, then the hardware check where listed. Use superpowers:requesting-code-review at each gate. Never mark a phase done on simulator-only evidence when a hardware gate is specified.
- **Branching:** work on `feat/ble-carlink` off `phase4/engine-embed`; one commit per task; agents rebase, architect merges at gates.
- **Deployment loop:** JS-only stack means `bash scripts/godot-ios/deploy-js.sh` (~30 s) for every on-device check. If any task believes it needs a native module, STOP and escalate to the architect (that's a D2-fallback decision, triggers full-rebuild workflow + ExpoModulesCore pinning check).
- **Hardware etiquette:** one BLE session per Pi — close the web client tab before on-device testing, or commands will serialize/block behind its background poll.

## Part 8 — Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| Hermes incompat in noble/protobufjs static output | Low | P0.T3/T4 smoke it on-device first; D2 fallback = quick-crypto behind `crypto.ts` |
| Funnel latency makes commands feel sluggish | Medium | P0.T1 measures; P5.T4 LAN path; VCSEC poll keeps session warm so exchange is 1 RTT |
| Session-counter corruption from concurrent senders (phone + web client, or double-dispatch) | Medium | per-VIN FIFO queue (P1.T5), single `useCarLink` instance, hardware etiquette note |
| Closure telemetry lag fights Godot animations (doors flip-flop) | High without mitigation | 30 s intent-grace in `telemetry.ts` (P3.T3), port of the proven web behavior |
| Optimistic UI diverges on command fault | Medium | mandatory `rollback` param in `dispatch`; error toast+haptic |
| iOS backgrounding kills poll mid-session, Pi radio stays locked | Low | Pi's 5-min idle reaper; also `DELETE /sessions/{id}` on AppState→background |
| Bearer/keys leakage | Low | secure-store only; never in AsyncStorage or logs; token self-revoke UI in P2.T4 |
| Proto messages missing for 🆕 rows | Medium | P0.T5 verifies up-front; rows demote to 🚫 rather than blocking phases |
| Accidental Tesla-server contact | Must be zero | P1.T6 runtime guard + grep test (hard project constraint) |

## Part 9 — Definition of done (v1)

1. Enrollment flow works on-device against the real Pi (own key, NFC-approved).
2. Every ✅ row in Part 5 verified **on the real car** (checklist in the PR description, one row per action).
3. Home shows real battery %, temps, lock state, awake/asleep; pull-to-refresh does wake+awakeSync; map shows the car's real position.
4. Demo cars are pixel-identical to today; `EXPO_PUBLIC_CAR_LINK` unset ⇒ zero behavior change anywhere.
5. `npx jest` fully green, including Go-fixture crypto vectors and the no-Tesla-servers guard.
6. Web client and mobile can coexist against one Pi (serialized, no corruption) — tested once explicitly.

---

## Part 10 — Cross-cutting infrastructure (added 2026-07-16, after direct-BLE + useCarLink landed)

The original plan focused on the protocol/transport/command path. Real on-car use surfaced a layer of cross-cutting *infra* (not features, not the enrollment UX) that the app needs to feel trustworthy. Direct-BLE (BLE-1/2/3), the transport selector, and `useCarLink`+reconciler (real Home lock) are DONE and hardware-validated; these buckets are what's left on the infra side.

### A — Action-feedback loop (the "failed operation" toast + pending state)
Today `useCarLink.dispatch` only rolls the optimistic state back + fires a heavy haptic on `{ok:false}` — no message, no in-flight indication (the control *looks* instantly done, then reverts). The official Tesla app shows a pending state, then a bottom "failed operation" message on timeout (~30s). Build:
- **A1. Error→message taxonomy** (pure, testable): map `CommandOutcome` (`unreachable`/`timeout`/`auth`/`fault`+faultName/`exhausted`) → human text ("Car out of range", "Car asleep", "Not paired — re-enrol", "Car declined the request").
- **A2. Toast/snackbar host** (global, one instance): a bottom transient message surface. Wire `useCarLink` failures to it via A1.
- **A3. Per-command status**: `pending → confirmed → failed` on each dispatched control (spinner/dim while in-flight, not just optimistic-then-maybe-rollback). Success confirmation (a light selection haptic) when the car ACKs.
- **Prereq for the Phase-4 command sweep** — wire A before sweeping controls so each inherits trustworthy feedback.

### B — Connection & liveness (build alongside telemetry #1)
- **B1. Telemetry write path**: `useCarLink.applyTelemetry(patch)` patches the active linked car via the PLAIN `applyActive` (NOT the reconciler — no command loop), honoring the closure-intent grace (thread a `closureIntent` map: a dispatched lock/closure records `field→now+30s`, and `vcsecStatusToPatch` suppresses contradicting telemetry within the window).
- **B2. Foreground VCSEC poll**: AppState-aware ~20 s loop calling `readVcsecStatus` → `parseVcsecStatus` → `vcsecStatusToPatch` → `applyTelemetry` (lock/awake/closures — works asleep, keeps Home live). Stop on background (Pi reaper cleans up).
- **B3. Connection status**: `useCarLink` exposes `status` (offline / connecting / online-BLE / online-Pi / asleep) + which transport, derived from poll + command success and the selector's choice. Surface a small indicator on Home.
- **B4. Data freshness**: track `lastUpdatedAt` per read; expose "updated Xs ago" / stale badge (replaces the mock `getMockLastUpdated`).

### C — Resilience
- **C1. Unpaired/token-revoked detection**: an `auth` or `UNKNOWN_KEY_ID`(fault 3) outcome → surface "this phone isn't paired — re-enrol" + route to enrollment, instead of a generic failure.
- **C2. Rapid-input coalescing**: debounce/coalesce double-taps on a control so the two commands + rollbacks don't race (reviewer-flagged double-tap edge).
- **C3. In-flight cancellation**: allow aborting a command that's retrying (AbortController through the transport).
- **C4. Proactive BLE switch-back**: a BLE-state listener that re-selects BLE when it returns while pinned to Pi (deferred from M3a — the selector only re-selects on failure today).
- **C5. Per-transport session lifecycle across background** (added 2026-07-16, deferred by the user to keep the roadmap in order). Today `teardown()` is indiscriminate: on AppState→background it calls `closeAllCachedSessions()` (evicts EVERY domain session regardless of transport) + `sel.closeSession('')`, dropping the direct-BLE GATT link as well as the Pi session. Because `TransportCandidate.make()` builds a FRESH DirectBleTransport per openSession attempt, every foreground then pays a **new scan (6s budget before it falls back to Pi) + connect + handshake** — a likely contributor to the app feeling like it reloads, and a silent path to landing on the Pi when the car simply didn't advertise in time.
  - **Why not just copy the official app:** RE (tesla-status-polish-FINDINGS §3) shows they keep BLE alive across background and only pause the poll loop — but they own the radio directly. Our Pi is a **shared resource with ONE session slot + a 5-min reaper**, so holding its session across a background orphans it and strands the user behind their own session (already hit once; see `piSessionOrphan.ts`). The policy must therefore be **per-transport**, not global.
  - **Do:** keep the direct-BLE session across background; keep closing the Pi's; make eviction transport-aware (the global `closeAllCachedSessions()` is what makes this impossible today). Already done in A: pausing the poll + cancelling in-flight wakes on background (their `cancelAllDataRequests()`).
  - **Risk to design for:** a BLE link can survive iOS suspension **half-dead** — the peripheral handle persists while the car has moved on, so the first exchange after resume fails and reads as a car fault rather than a stale link. Needs a resume liveness check with evict-and-reconnect, which is why this pairs naturally with C4. Hardware test required.

### D — Observability
- **D1. Field logging / activity history**: a persistent ring-buffer log of commands + outcomes (Hermes Release `console.log` doesn't reach device syslog — memory), viewable in a debug screen. Mirrors the Pi's activity-log.

### E — Delivery
- **E1. CI**: run the `node --import tsx --test` suite on push.
- **E2. Merge `feat/ble-carlink` → main** once the v1 surface (telemetry + core commands + A/B infra) is in.

**Recommended order:** A (feedback) → B (liveness/telemetry) alongside feature #1/#2, then C/D as hardening, E to land. (User chose to build B first — 2026-07-16.)
