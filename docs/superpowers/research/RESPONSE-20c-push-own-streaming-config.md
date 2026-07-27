# RESPONSE #20c — can we push our own WebRTC streaming/ICE config to the car?

**Follow-up to:** RESPONSE-20b (WebRTC route blocked on cloud-anchored session setup).
**Question:** is there a workaround around the streaming config — any way we push our own?
**Method:** focused 4-finder + 2-verifier workflow, with the two load-bearing disassembly claims
re-verified by hand afterward. Firmware image MCU2-Intel 2026.14.3; car HW4 2026.20.6.6.

## Headline: not with your current capabilities. **DNS-only: NO. Car-root: YES** — and, surprisingly, root needs no Tesla cert.

With what you have today — DNS control + Pi + local WiFi + an enrolled key, **no MCU filesystem
write** — there is no path to inject or replace the car's streaming/ICE config. Every
externally-reachable surface is a non-existent field, the wrong subsystem, cert-gated, or a
D-Bus name restricted to a system user. **If** you can escalate to car-root, the picture flips
completely: root can feed the car any ICE config with no Tesla-signed material at all, because the
config is accepted as unverified trusted IPC.

## The injection surface, enumerated

| surface | verdict | requires |
|---|---|---|
| A. `createStreamSession` carries a caller-supplied config | impossible (no such field) | — |
| B. a `SetStreamingConfig`-style D-Bus setter | impossible (none exists) | — |
| C. local config file / `create_stream_from_config_file` | wrong subsystem + write-gated | car-root |
| D. `/home/remote_configs` warm cache / offline fallback | transient, not DNS-controllable | one cloud touch |
| E. DNS-redirect the config WSS + skip-verify | impossible — the client verifies its server | — |
| F. `is-dev`/`is-ebuck`/`is-china` skip-fleet-key gate | unreachable on a production car | Tesla-signed cert |
| G. phone→car `iceConfig` push | impossible (direction is car→phone only) | — |
| **H. impersonate the `com.tesla.HermesService` provider** | **works** | **car-root** |

## Why it's closed for a DNS-only actor (the decisive finding — verified)

The one config source the car acts on is the D-Bus call `com.tesla.HermesService.GetStreamingConfig`,
**owned by uid `hermes-client`** (`etc/dbus-1/system.d/hermes.conf`) — i.e. served by
`opt/hermes/hermes_client`, which fetches it over the pinned WSS. That client **genuinely verifies
its server certificate**:

- In `hermes_client`, the only TLS skip-verify site is *conditional* —
  `cmp byte [rcx+0x78], 0x0 ; je …` at `0x89a1db` — and nothing in the binary ever sets that field,
  so `InsecureSkipVerify` stays `false` and the server cert is checked against the pinned CA pool
  (`getTLSConfig` sets `RootCAs`; `RunHermes.vars:73` passes `--ca/--products-ca`, no `--insecure`).
  *(I re-confirmed the gate instruction and the x509/RootCAs verification code by hand.)*
- So a DNS redirect of `hermes-stream-api.<env>.…` to your LAN box **fails at the TLS handshake** —
  you can't present a cert chaining to `TeslaProdFleetManagementCA.pem`, and the car won't take a
  config from an unauthenticated server.

Everything else is a dead end for a DNS-only actor: `createStreamSession` decodes only
`sessionId` (tag 1) and skips all other tags (`fc0/s.java`), so there's no field to smuggle a config
in; there is no setter in `hermes.conf` (only getters/senders); the phone-side `iceConfig`
(`gb0/b.java:63-91`) is *received and applied to the phone's own stack* ("sending ice config over
JsBridge"), never sent to the car; the `create_stream_from_config_file` path in the Go daemon is
**Fleet telemetry, not WebRTC** (`hermes_fleet_streaming` has zero `webrtc/sdp/ice/stun/turn`
references and zero `GetStreamingConfig`), and its config folder is bound read-only as uid `tesla`;
and the `skip-fleet-key-check` escape only disables a config-*signature* check (never TLS) and is
gated behind `has-engineering-cert` (Tesla-signed), `country==CN`, or `/var/etc/isebuck` — none
reachable without Tesla materials or root.

## What car-root unlocks — and it doesn't need the TPM cert (verified)

Root gives you a fully-local WebRTC session **without forging any Tesla-signed material**, because
the config is trusted at the D-Bus boundary, not cryptographically:

1. **The config gate is unverified trusted IPC (verified).** `ReceivedStreamingConfig@0x9ae010`'s
   entire call set is `QDBusError::{isValid,name,message}` → `QByteArray::fromHex` →
   `TJson::Parser::parse` → `toMap` → `RemoteAutopilotManager::handleRemoteMessage(MessageSource=0)`
   — **zero** `verify/rsa/ecdsa/hmac/sign/sha/cert/aes/gcm` calls (I grepped the whole function body;
   empty). Whoever answers `GetStreamingConfig` fully controls `ice_servers` with no signature check.
2. **The provider name is uid-keyed, so root can impersonate it.** `com.tesla.HermesService` is owned
   by uid `hermes-client`. Root can stop the real `hermes_client` and run a stub *as that uid* that
   owns the name and returns hex-encoded JSON with an empty or LAN-STUN `ice_servers`. No rootfs
   write, no cert. Both consumers (`QtCarServer` refreshIceConfig, `webrtc-comms`) hit the same owner.
3. **Signaling has a non-cloud path — and this piece needs no root.** SDP/candidate exchange can be
   delivered as a *signed `streamMessage` VehicleAction over BLE using your own enrolled
   vehicle-command key* (`stream_message_received → Process@0x9b1a00 → refreshIceConfig(false)`;
   command-auth is role-based on the enrolled key, not Tesla-backend-signed — proven in the Summon
   RE), **or** as uid `tesla` via `com.tesla.Webrtc.RemoteToLocalSignaling`. Media then rides LAN
   host ICE candidates over shared WiFi; stock libwebrtc accepts an empty server list for
   same-subnet P2P, so no TURN and no cloud.

**What root cannot do but doesn't need:** forge the TPM-sealed per-car client cert or Tesla's fleet
CA. Those authenticate `hermes_client` to Tesla's *cloud*; a purely-local session never dials the
cloud, so those gates are bypassed (by replacing the provider at the D-Bus boundary), not broken.

So the gating requirement is **car-root for the config injection** (surface H). The BLE/enrolled-key
signaling is a nice root-free component, but it sits downstream of the config, which still needs root.

## Crucial caveat — what a solved config does and does not get you

- It does **NOT** deliver the 4096-bit PII key. Wall 2 is independent: the WebRTC data channel is
  Summon/RemoteAutopilot-scoped (`dataFromControllerCallback → RemoteAutopilotManager`,
  never `handlePiiKeyRequest`), so no amount of ICE-config control reaches PII registration. Live
  location stays out of reach.
- It **WOULD** unlock your two *other* goals. A local WebRTC data channel established this way is
  exactly the transport Summon initiation and live-camera streaming need — both prior RE efforts
  (`tesla-summon/out/`, `tesla-cameras/out/tesla-live-camera-offline-plan.md`) named the
  cloud-supplied ICE config as the single decisive "cloud-only ICE" barrier, and impersonating the
  provider resolves it. If you ever pursue car-root for Summon/camera, this is the mechanism.

## The three tiers, ranked by what they cost

1. **DNS-only (your capability today): dead.** The config client verifies its server cert.
2. **One cloud touch, then offline (warm cache): fragile.** `QtCarServer` caches the last config
   (`SignedCarAPIServiceImpl+0xb0`, boottime stamp `+0xb8`, freshness-gated by
   `ConfigRefreshIntervalMs`/`ConfigTimeoutSeconds`). A car that fetched online then went offline
   inside the window *might* bring up a session from RAM — but TURN creds are time-limited, the
   window isn't DNS-controllable, and the ICE is still cloud-anchored. Not a stable capability, and
   not air-gapped.
3. **Car-root: full local WebRTC, no Tesla cert needed.** Impersonate `hermes-client` on D-Bus →
   return LAN/empty `ice_servers`; signal over BLE with your enrolled key or via the `tesla` uid.
   This is the only real unlock — and it's a separate escalation project, not a config trick.

## Exact next experiment (only if you pursue car-root)

Run a stub process **as uid `hermes-client`** that owns `com.tesla.HermesService` and answers
`GetStreamingConfig` with a hand-crafted hex-encoded JSON carrying an empty (or single LAN-STUN)
`ice_servers`. Then trigger `createStreamSession` and observe: does the car bring up a peer
connection using your injected config and offer LAN **host** candidates? If yes, drive signaling with
a BLE-signed `streamMessage` (enrolled key) and confirm a data channel opens over local WiFi. That
proves the local-WebRTC transport end-to-end for Summon/camera. (It will *not* get you the PII key —
don't expect field 900 on that channel.)

## Honesty

**Proven (hand-verified this pass):** `hermes_client` verifies its server cert (skip-verify gated
off); `ReceivedStreamingConfig` has no signature check; `createStreamSession` has no config field;
no D-Bus setter; the fleet_streaming file path is telemetry, not WebRTC.
**Strong (disassembled by the workflow, not all re-checked by me):** the `hermes-client` uid
ownership as the impersonation lever; the warm-cache fields/freshness gate; the BLE-signed
`streamMessage → refreshIceConfig` signaling path (leans on the prior Summon RE for role-based auth).
**Generation caveat:** image is MCU2-Intel 2026.14.3, car is HW4 2026.20.6.6. The D-Bus/uid trust
model and TLS pinning are unlikely to have loosened on newer firmware; if anything they tighten.

## Bottom line

There is no way to push our own streaming config with DNS control alone — the config client verifies
its server, and no phone-reachable surface accepts a config. It becomes trivial **only** with
car-root, which needs no Tesla certificate but is a separate escalation. And even fully solved, it
buys Summon and live-camera, not the PII key. For live location, the door stays closed.
