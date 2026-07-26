# RESPONSE #20b — can the WebRTC / StreamMessage route register the 4096 PII key? No.

**Follow-up to:** RESPONSE-20 (BLE can't carry a 4096 subscriber key under the ~452 B cap).
**Question:** the WebRTC data channel isn't bound by the 452 B BLE cap — could the route you tried for
Summon (`StreamMessage`) carry the ~800 B 4096 key instead?
**Method:** 6-finder + 3-adversarial-verifier workflow across the app decompile, `QtCarServer` +
`webrtc-comms` firmware, and your Summon/live-camera RE, with the two load-bearing claims
re-verified by hand afterward.

## Verdict: NOT VIABLE. Two independent walls, either one fatal.

The data channel would *physically fit* the key — but you can't stand up the channel air-gapped, and
even if you could, its inbound path doesn't reach the PII handler. This is the *same* cloud wall the
WebRTC route was supposed to route around.

### The five conditions this route needs — and where it breaks

| # | condition | holds? |
|---|-----------|--------|
| a | peer connection establishable air-gapped (local signaling/ICE) | **NO — proven** |
| b | data channel carries a signed CarServer command to the PII handler | **NO — proven** |
| c | escapes the ~452 B cap | yes (proven) — but moot |
| d | 4096 mint executes over that ingress | untestable while a/b fail |
| e | response locally decryptable | yes (you already do this on BLE) |

## Wall 1 (condition a) — session setup is cloud-anchored and TLS/TPM-pinned

`createStreamSession` doesn't open a channel from local materials — it fetches the streaming/ICE
config from Tesla's cloud, and that link can't be spoofed with the levers you have (DNS control, local
WiFi, enrolled BLE key):

- The WebRTC daemon's own D-Bus policy calls out to the cloud for its config:
  `usr/share/dbus-1/system.d/com.tesla.Webrtc.conf:20` →
  `com.tesla.HermesService … GetStreamingConfig`. The ICE config is a cloud object, not a local one.
- Hermes (the transport that carries it) is **mutual-TLS pinned to a private root** —
  `etc/RunHermes.vars:142` `--fleet-ca-path=…/TeslaProdFleetManagementCA.pem` — with a **TPM-sealed
  per-car client cert/key**: `:43` `--engine=tpm2tss`, `:156`
  `--cert=$HERMES_CERT --key=$HERMES_KEY $HERMES_ENGINE`. A DNS redirect to your own broker dies at
  the TLS handshake: you can't present a cert chaining to Tesla's fleet CA, and the car's client cert
  is sealed in its TPM. (The `--skip-fleet-key-check` bypass exists but is gated to China/dev cars —
  gate binaries `usr/bin/is-china-car`, `usr/bin/is-development-car`.)
- The **BLE** carrier for `createStreamSession` was dynamically tested offline on the car during this
  investigation and **failed**: it routes to `SignedCarAPIServiceImpl::refreshIceConfig@0x9aecd0`,
  logs "Failed to get streaming configuration," and returns "Unknown command" — because the ICE
  config it needs is the cloud object above. `streamMessage` alone is dropped ("session id mismatch")
  since only `createStreamSession` opens a router session.
- The internal signaling injection point `com.tesla.Webrtc.RemoteToLocalSignaling` is restricted to a
  process running as system user `tesla` (`usr/share/dbus-1/system.d/com.tesla.Webrtc.conf`). A LAN
  phone with an enrolled BLE key is not that, and `webrtc-comms` exposes no TCP/HTTP/WS signaling
  listener you could drive.

**So you cannot establish the WebRTC session without a Tesla cloud touch and a cert you don't hold.**

## Wall 2 (condition b) — the data channel isn't a CarServer command carrier

Even granting a live channel, what rides it is not a signed `CarServer.Action`:

- `CarServer.StreamMessage` (`fc0/x4.java`) = `{ sessionId: string (tag 1), data: bytes (tag 2) }`.
  The `data` bytes are decoded as a **JSON object keyed by `msg_type`**
  (`com/tesla/messagedecoding/b.java:104-105`: `new JSONObject(message.getData()).optString("msg_type")`,
  default `control:pong`). It is a Summon/telemetry control blob — **not** a container that nests a
  `RoutableMessage`/`Action`.
- On the wire, `StreamMessage` (tag 4), `PiiKeyRequest` (tag 51) and `VehicleDataSubscription`
  (tag 37, which embeds `pii_key_request`) are **mutually-exclusive siblings** of `CarServer.Action`
  (`fc0/g5.java`) — you can't put a PII request "inside" a StreamMessage.
- Car-side, the sole inbound consumer of peer data-channel frames routes to
  `RemoteAutopilotManager::handleRemoteMessageImpl@0x90d6d0` (Summon/RemoteAutopilot) — it never
  reaches `SignedCarAPIServiceImpl::Process@0x9b1a00` or `handlePiiKeyRequest@0x9ac880`. The
  peer-data bridge is structurally Summon-scoped.

## What *does* hold (and why it doesn't help)

- **The 452 B cap is BLE-specific.** `webrtc-comms` links libwebrtc SCTP with 64 KB–256 KB max
  message size, and the car's routable ingress `Process@0x9b1a00` parses with no length gate — the
  ~452 B wall is a BLE GATT/chunking property, not a handler property. An ~800–900 B routable is not
  size-limited *at the handler*. This is the one premise that fully holds — and it's unreachable
  because walls 1 and 2 stand.
- **The 4096 mint gate is transport-agnostic** (`encryptPiiKey@0x978770` `cmp ebp,0x200`) — so if a
  signed routable ever reached `Process`, it would hit the same RSA-4096 requirement. Nothing delivers
  it there over WebRTC.

## The one crack — and why it's not air-gapped

There's a single non-air-gapped probe worth knowing about only to bound how cloud-dependent this is;
it does **not** restore the air-gap:

1. Let the car make exactly ONE cloud contact so `hermes-fleet-streaming` caches a streaming/ICE
   config (strings "Refreshing ice config (async prefetch)" / "New ice config retrieved" imply a TTL
   cache).
2. Cut all Tesla reachability, then over BLE send `createStreamSession` — does it now return OK
   (cached) or still "Unknown command"?
3. If OK, does the cached ICE offer **LAN host candidates** or force cloud TURN/STUN (which defeats
   P2P anyway)? Measure cache TTL across sleep/wake.

Even a best case needs that one cloud touch and yields cloud-anchored ICE — a "how cloud-bound"
result, not an "air-gapped" one. And wall 2 still stands behind it.

## Where the real leverage is (not WebRTC)

The honest redirect: the only thing between you and the 4096 key is a **larger-MTU *local*
transport** for the identical signed routable — i.e. whether the ~452 B wall on the BLE routable path
can be lifted, not whether WebRTC can be air-gapped. You already measured the cap is **car-enforced
(bilateral)** — the car silently drops > ~452 B — so this is probably also closed, but it's a
smaller, better-characterized question than reproducing Tesla's cloud signaling. If you ever revisit
it, the thing to establish is whether that 452 B reassembly limit on the **infotainment** routable
path is truly fixed or negotiable (L2CAP CoC / a different characteristic). I would not bet on it, but
it's the only lever left that stays local.

## Proven vs inferred

**Proven (verified by hand this pass):** cloud dependency + private-CA/TPM TLS pinning of the
streaming config (`RunHermes.vars`, `com.tesla.Webrtc.conf`); `StreamMessage` = JSON-by-`msg_type`,
not a nestable Action (`fc0/x4`, `messagedecoding/b.java:104`); `RemoteAutopilotManager` is the WebRTC
inbound consumer; the 452 B cap is BLE-specific and `Process` has no length gate.
**Inferred (strong, not re-disassembled this pass):** that `Process` is the single shared per-transport
ingress; that "no local signaling listener" rests on absence-of-evidence in `webrtc-comms`.
**Generation caveat:** firmware image is MCU2-Intel 2026.14.3; your car is HW4-Ryzen 2026.20.6.6.
Proto/crypto structure is generation-stable; the cloud-signaling architecture is very unlikely to have
loosened on newer firmware (if anything, tighter).

## Bottom line

The WebRTC route trades the 452 B size wall for a cloud-signaling wall plus a wrong-handler wall.
Net air-gapped viability: none. Registering the 4096 PII key offline is not possible over BLE, over
WebRTC, or over any local transport we've found. **Stay on the BLE `VehicleDataSubscription` field-13
path for cleartext states, and treat live location (and, on this HW4 car, live speed) as unavailable
offline** — unless you later prove the 452 B infotainment cap itself is negotiable.
