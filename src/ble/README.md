# src/ble

BLE protocol layer ported from the working browser client at:
`/Users/ivan/Work/airgapp/rpi-webclient/client/`

That code is a working browser TS/JS implementation of the Tesla BLE protocol — ECDH session, AES-GCM, retry policy mirrored from `nb0/C24292a.java`, per-VIN queue, IDB persistence, fault evaluator. Its layering is what this port follows, with these swaps:

- WebCrypto (`crypto.subtle`) → pure-JS `@noble/curves` + `@noble/ciphers` + `@noble/hashes` (**not** `react-native-quick-crypto` — no native module needed, keeps the 30s `deploy-js.sh` JS-only redeploy loop working). `crypto.ts` is synchronous: noble has no opaque `CryptoKey` concept, so every function returns/consumes raw `Uint8Array`s directly instead of awaiting `crypto.subtle`.
- IndexedDB → `react-native-mmkv` (session metadata) + `expo-secure-store` (device private key, OS-keystore-backed)
- `fetch` is native to RN

Transport: HTTPS to the RPi's `/api/ble/*` byte-forwarder only (LAN AP or Tailscale Funnel — see the plan doc for exact URLs). The Pi is a dumb, bearer-authed, opaque-byte forwarder; it never sees plaintext or keys. The phone owns the entire Tesla vehicle-command protocol.

Full architecture, phased task breakdown, and backend contract:
`docs/superpowers/plans/2026-07-12-ble-backend-integration.md`

Files to port (rename `.js` → `.ts`):
- `crypto.js` → `crypto.ts` — AES-GCM, ECDH→SHA-1 KDF, AAD metadata block (**this file, P1a**)
- `session.js` → session lifecycle, openDirectSession, withCachedSession, sendDirectCommandWithApi
- `state.js` → VehicleState store, per-VIN slices, in-session piggyback
- `proto.js` → protobufjs setup (already generated into `src/ble/proto/gen.js` from the vendored `.proto` files)
- `keystore.js` → swap IDB schema for MMKV+SecureStore
- `activity-log.js` → ring buffer
- `app.js` (Alpine model logic) → reshape as Zustand store + hooks

## Safety constraint (absolute)

This app must **never** reach Tesla's real servers — only the RPi. No `tesla.com`, no `owner-api`/`owners-api`, no Akamai edge. Enforced by `src/ble/no-tesla-servers.test.ts`, which greps every file under `src/ble/` for those literals (case-insensitive) and fails the build if any appear. Also documented in `src/types/vehicleTypes.ts:210-221` and in user-level memory.
