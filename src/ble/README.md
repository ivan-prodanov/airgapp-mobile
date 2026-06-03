# src/ble

BLE protocol layer ported from the worktree client at:
`/Users/ivan/Work/rpi-filter/rpi-network-filter/.claude/worktrees/admiring-bhaskara-a1dada/client/`

That code is a working browser TS implementation of the Tesla BLE protocol — ECDH session, AES-GCM, retry policy mirrored from `nb0/C24292a.java`, per-VIN queue, IDB persistence, fault evaluator, 46 passing tests. Its ARCHITECTURE.md explicitly designed the layering for a RN port with these swaps:

- WebCrypto → `react-native-quick-crypto` (Node-crypto-compatible)
- IndexedDB → `react-native-mmkv` (session metadata) + `expo-secure-store` (device private key, OS-keystore-backed)
- `fetch` is native to RN

Transport: HTTPS to `https://192.168.4.1/api/ble/*` after phone joins the RPi's WiFi AP. No mDNS needed — fixed IP.

Files to port (rename .js → .ts):
- `session.js` → session lifecycle, openDirectSession, withCachedSession, sendDirectCommandWithApi
- `state.js` → VehicleState store, per-VIN slices, in-session piggyback
- `crypto.js` → AES-GCM, ECDH→SHA-1 KDF, AAD metadata block
- `proto.js` → protobufjs setup
- `keystore.js` → swap IDB schema for MMKV+SecureStore
- `activity-log.js` → ring buffer
- `app.js` (Alpine model logic) → reshape as Zustand store + hooks

Honor the safety constraint in user memory: this app must never reach Tesla's real servers, only the RPi.
