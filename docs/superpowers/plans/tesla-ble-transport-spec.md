# Direct Phone→Tesla BLE Transport — Implementation Spec

Extracted verbatim from on-disk source (no guessed values) for building `src/ble/directBleTransport.ts` (react-native-ble-plx) — a `CarTransport` implementation that talks to the car's BLE GATT directly, replacing/complementing the RPi HTTP forwarder. The crypto/protobuf/gateway layers are DONE and transport-agnostic; this is purely the opaque-byte pipe.

Sources:
- `/Users/ivan/Work/airgapp/rpi/internal/services/tesla_session.go` (demux)
- `/Users/ivan/Work/airgapp/rpi/internal/services/tesla.go` (BLE acquire + add-key driver)
- `~/go/pkg/mod/github.com/ivan-prodanov/vehicle-command@v0.4.2-.../pkg/connector/ble/ble.go` (GATT + framing)
- `.../pkg/vehicle/{security.go,vcsec.go,vehicle.go}` (add-key, Connect)

## 1. GATT UUIDs (ble.go:32-36)
- Service: `00000211-b2d1-43f0-9b88-960cebf8b91e`
- TX (phone→car, WRITE) `toVehicleUUID`: `00000212-b2d1-43f0-9b88-960cebf8b91e`
- RX (car→phone, NOTIFY) `fromVehicleUUID`: `00000213-b2d1-43f0-9b88-960cebf8b91e`
Write RoutableMessage frames to `...0212`; subscribe to notifications on `...0213`.

## 2. VIN → BLE scan local-name (ble.go:133-137, exact-match at :222/:298)
`localName = fmt.Sprintf("S%02xC", sha1(utf8(VIN))[0:8])` → `"S" + lower_hex(sha1(VIN)[0:8]) + "C"` = 18 chars (`S` + 16 hex + `C`). Match the advertisement's Local Name by **exact string equality**. If the matching advert is not-connectable → car has max BLE clients (`ErrMaxConnectionsExceeded`) → surface to user.
(We have `sha1` in `@noble/hashes/sha1` and `bytesToHex` in crypto.ts.)

## 3. Write framing / chunking (ble.go:108-127)
Buffer = `[len_hi][len_lo][payload...]`: 2-byte **big-endian** length prefix = payload byte length (`uint8(len>>8), uint8(len)`), then payload. Split the whole buffer into `blockLength`-sized chunks, write each **sequentially** to TX with WriteWithoutResponse (Go `noRsp=false`).
- MTU: `requestMTU(515)` (maxBLEMTUSize=515). `blockLength = min(negotiatedMTU, 1024) - 3`. On MTU failure: `blockLength = 23 - 3 = 20`.

## 4. Notification reassembly (ble.go:67-106)
Accumulate inbound RX notification bytes into a rolling buffer, parse with the SAME 2-byte BE prefix:
- If `>1s` since last notification (`rxTimeout=1s`) → discard partial buffer first (inter-chunk gap = stale), then append.
- `flush()`: need ≥2 bytes; `msgLength = 256*buf[0] + buf[1]`; if `msgLength > 1024` → drop whole buffer (corrupt); once `len(buf) >= 2+msgLength`, slice `buf[2:2+msgLength]` as one complete message, advance, loop (multiple messages per buffer). Deliver to a queue (Go cap 5).

## 5. Connect sequence (ble.go:280-360; vehicle.go:116-118)
1. Scan for beacon with the derived local name (§2).
2. Connect to the advert.
3. Discover service `...0211`, chars `...0212`(TX)/`...0213`(RX).
4. Subscribe to RX notifications.
5. requestMTU(515) → compute blockLength.
**No BLE-level app handshake** — the first bytes on the wire are the first RoutableMessage (the SessionInfo request our crypto layer already builds). MTU is the only negotiation.

## 6. Frame demux — port from tesla_session.go Exchange (:189-269)
Per `exchange(requestBytes)`:
- **a.** From the OUTGOING RoutableMessage extract correlators: `wantAddr = from_destination.routing_address` (field 7 → field 2); `wantUUID = uuid` (field 51).
- **b.** Drain stale frames: synchronously flush the accumulated inbound queue BEFORE writing (anything buffered pre-send can't be our reply).
- **c.** Send (§3).
- **d.** For each inbound frame: `gotAddr = to_destination.routing_address` (field 6 → field 2); `gotUUID = request_uuid` (field 50). **Accept iff** `(wantAddr && gotAddr==wantAddr) || (wantUUID && gotUUID==wantUUID)` (raw byte equality); else skip (unsolicited VCSEC broadcast / late prior reply) and keep reading. Fallback: if request had neither correlator, return first frame.
- **routing_address is PRIMARY** — VCSEC GET_STATUS replies (every lock/closure read) carry `to_destination.routing_address` but EMPTY `request_uuid`; a uuid-only filter drops them forever. Must implement the routing_address matcher.

Protobuf tags for the hand-rolled top-level scanner (all wire-type 2 / LEN):
| Field | Num | Tag bytes |
|---|---|---|
| to_destination | 6 | `0x32` |
| from_destination | 7 | `0x3A` |
| Destination.routing_address (inside 6/7) | 2 | `0x12` |
| request_uuid | 50 | `0x92 0x03` |
| uuid | 51 | `0x9A 0x03` |
Port `scanProtoField` (tesla_session.go:326-373): top-level-only walker, find first `(fieldNumber, wire=2)`, return its LEN bytes, skip others by wire type, no recursion. For routing_address call twice (outer 6 or 7, then field 2 on the sub-buffer). Reuse a varint decoder.

Timeouts: default per-exchange 5s, max 30s (clamp); typical RTT 300-800ms; idle-link teardown ~5min; inter-chunk reassembly gap 1s.

## 7. Add-key (enrollment) over BLE (tesla.go:150-259; security.go:338-360; vcsec.go:151-169)
- **Unauthenticated, no session.** Connect (transport listener only, no ECDH StartSession), send ONE message, done. No private key consulted.
- **NOT a RoutableMessage** and does NOT go through the session dispatcher — but rides the SAME TX char + 2-byte framing/chunking (§3).
- Payload build:
  1. `vcsec.UnsignedMessage`: `WhitelistOperation.addKeyToWhitelistAndAddPermissions = PermissionChange{ key.publicKeyRaw = <65-byte SEC1 0x04||X||Y>, keyRole = ROLE_DRIVER }` + `WhitelistOperation.metadataForKey = KeyMetadata{ keyFormFactor = KEY_FORM_FACTOR_CLOUD_KEY }`.
  2. Wrap: `vcsec.ToVCSECMessage{ signedMessage: { protobufMessageAsBytes: <marshaled UnsignedMessage>, signatureType: SIGNATURE_TYPE_PRESENT_KEY } }`.
  3. Marshal ToVCSECMessage → opaque payload → `Send` (2-byte prefix + chunk).
- Params: Role `ROLE_DRIVER`, form factor `KEY_FORM_FACTOR_CLOUD_KEY`, pubkey = our 65-byte uncompressed SEC1 (deviceKeys.publicKeyRaw).
- Returns as soon as transmitted; does NOT confirm. User taps existing NFC card on console. Detect success later via a SessionInfo request for INFOTAINMENT.
- Proto messages needed (all in vendored vcsec.proto): ToVCSECMessage, SignedMessage, UnsignedMessage, WhitelistOperation, PermissionChange, PublicKey, KeyMetadata. Confirm these are exposed via proto.ts / gen (they should be — vcsec.proto is vendored).

## 8. react-native-ble-plx mapping
| Step | ble-plx |
|---|---|
| Scan | `manager.startDeviceScan([serviceUUID], null, cb)`; match `device.localName === VehicleLocalName(vin)` |
| Connect | `device.connect()` |
| Discover | `device.discoverAllServicesAndCharacteristics()` |
| MTU | `device.requestMTU(515)` → blockLength = min(mtu,1024)-3 |
| Subscribe RX | `device.monitorCharacteristicForService(service, fromVehicleUUID, cb)` → base64→bytes → reassembler (§4) |
| Write TX | `device.writeCharacteristicWithoutResponseForService(service, toVehicleUUID, base64chunk)`; fallback to WithResponse if writes drop |
| Close | `device.cancelConnection()` |

## Transport interface fit
`DirectBleTransport` implements `CarTransport` (= PiTransport): `openSession(vin)` = scan+connect+discover+subscribe+MTU (returns a local session handle/id); `exchange(id, payloadB64, timeoutMs)` = the §6 demux (drain→write→correlate); `closeSession(id)` = cancelConnection. Plus enrollment methods: `pairInfo()` (BLE has no Pi /pair — derive `{vin, paired}` by attempting a SessionInfo/known-key check, or return a BLE-specific shape), `enrollPublicKey(pubB64)` = §7 add-key over BLE. NOTE: the gateway/session already handle SessionInfo, counters, AAD — DirectBleTransport is ONLY the byte pipe + demux + add-key.
