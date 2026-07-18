# Pi Push Streaming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **This plan spans TWO repos** (`airgapp-rpi` Go server + `airgapp/mobile` RN app) and two languages; Phase 0/1 are Go, Phase 2/3 are TypeScript, Phase 4 is on-car. Do not start a phase whose Gate is unmet.

**Goal:** Deliver instant closure/lock updates over the Pi (the everyday, car-far connection) by streaming the car's unsolicited VCSEC `VehicleStatus` pushes from the Pi to the phone over a WebSocket, feeding them into the phone's existing push-apply pipeline.

**Architecture:** The Pi already holds the car's BLE link and already *receives* the car's unsolicited notify frames — it just discards them in `Exchange` (the non-matching `continue`). We (a) refactor the Pi's per-session frame handling into a single **pump** that routes matched frames to the waiting `Exchange` and **fans unsolicited frames out to subscribers**, (b) expose those unsolicited frames over a **WebSocket** endpoint (`/api/ble/sessions/{id}/events`), and (c) on the phone, a small `PiEventStream` WebSocket client pipes each received frame straight into the **already-built** `onUnsolicited → decodeUnsolicitedVcsecStatus → applyTelemetry` pipeline. Commands keep flowing over the existing `/exchange` POST. This is airgap-safe: the Pi is the user's own box, never Tesla's cloud.

**Tech Stack:** Go (`net/http`, `github.com/go-chi/chi/v5`, `github.com/coder/websocket` or `gorilla/websocket` — confirm which is vendored in P0.T0), React Native built-in `WebSocket`, existing `src/ble/vcsecPush.ts` + `src/state/useCarLink.ts` pipeline.

## Global Constraints

- **Airgap (safety, non-negotiable):** nothing in this feature may reach Tesla's servers. The stream is phone ↔ Pi ↔ car BLE only. No new outbound hosts.
- **Reachability:** the phone reaches the Pi via Tailscale (MagicDNS on-tailnet, or Funnel `https://<host>.ts.net`). The WebSocket must upgrade cleanly through Funnel — use `wss://` and the same host/bearer as the REST client (`PiConfig.baseUrl`, `PiConfig.token`).
- **Bearer auth:** the WS handshake authenticates with the SAME bearer token as REST. RN `WebSocket` cannot set arbitrary headers reliably on iOS → pass the token as a `?token=<bearer>` query param and validate it server-side (see P1.T1). Never log the token.
- **One session per Pi:** the existing single-BLE-session invariant (`bleMu`, 5-min idle reaper) is unchanged. The event stream is scoped to the one live session id.
- **Frame opacity:** the Pi forwards RoutableMessage bytes verbatim (base64). It must NOT parse/inspect Tesla payloads beyond the correlator scan it already does — the "genuinely a forwarder" property stays.
- **Pure/node-testable mobile modules:** `src/ble/*` stays free of react-native imports (the WS client that touches RN's `WebSocket` global lives in `src/state/` or is dependency-injected, mirroring `transport.ts`'s injectable `fetch`).

---

## Part 1 — System context (verified 2026-07-18)

### Mobile side (what already exists — the payoff of the BLE-push foundation)
- `src/ble/vcsecPush.ts` — `decodeUnsolicitedVcsecStatus(frame: Uint8Array): VcsecStatus | null`. Pure, 7 tests. Decodes a plaintext push frame; rejects non-VCSEC / solicited / encrypted / non-status frames.
- `src/state/useCarLink.ts` — `handleVcsecPush(frame: Uint8Array)`: decode → `vcsecStatusToPatch` → `filterPatchUnderIntent(…, getActiveState())` (confirm-and-release) → `applyTelemetry`. Currently fed ONLY by `DirectBleTransport.onUnsolicited` (BLE). **This is the exact entry point the Pi stream reuses.**
- `src/ble/transport.ts` — `PiClient` (fetch-backed). `API_PREFIX = '/api/ble'`. Session id returned by `openSession`. Injectable `fetch` for node tests.
- `src/state/useCarLink.ts` — the selector reports `transport: 'ble' | 'pi'` via `onSelect`; `selectedTransportRef` holds the live choice; the gateway/session is cached and long-lived.

### Pi side (what exists — repo `/Users/ivan/Work/airgapp/rpi-webclient`, Go)
- `internal/handlers/tesla_session.go` — HTTP surface: `POST /api/ble/sessions`, `POST /api/ble/sessions/{id}/exchange`, `DELETE /api/ble/sessions/{id}`. Base64 RoutableMessage bytes; no payload parsing.
- `internal/services/tesla_session.go` — `BLESessionService`. `Exchange(ctx, id, payload, timeout)`:
  - extracts correlators (`extractRoutableFromRoutingAddress`, `extractRoutableUUID`) from the outgoing payload;
  - **drains** buffered frames from `sess.conn.Receive()` before sending (logs "drained stale frame … VCSEC unsolicited broadcasts");
  - after send, reads `sess.conn.Receive()`, matches `extractRoutableToRoutingAddress` / `extractRoutableRequestUUID`, returns the match, and **SKIPS non-matching frames** (the `continue` — "unsolicited broadcast or the response to a previous request"). **← these skipped frames are the pushes.**
  - `sess.conn` is the raw BLE connection; `sess.conn.Receive() <-chan []byte` yields reassembled frames; `sess.conn.Send(ctx, payload)` writes. (Confirm exact types in P0.T0.)
- The correlator extractors + `bytesEqual` are already implemented and unit-tested (`tesla_session_test.go`).

**The problem to solve:** unsolicited frames are discarded on the Pi (skip/drain) exactly as they were on the phone. We need to fan them out to a WS stream instead of dropping them.

---

## Part 2 — Architecture decisions

**A1. A single per-session frame PUMP owns `conn.Receive()`.** Today `Exchange` reads `conn.Receive()` directly, which is why unsolicited frames can only be observed (and dropped) inside an `Exchange` call — a frame arriving while idle just sits in the channel until the next exchange drains it. We introduce one goroutine per session that is the SOLE reader of `conn.Receive()` and routes each frame:
- to the in-flight `Exchange`'s waiter if its correlators match, else
- to the session's **unsolicited fan-out** (0..N WebSocket subscribers).

This makes idle-arrival pushes flow immediately, removes the "drain stale" hack, and keeps `Exchange`'s correlator logic (now it registers a waiter instead of reading the channel).

**A2. WebSocket, not SSE/long-poll.** RN has a **native `WebSocket`** (no library, unlike SSE which needs `react-native-sse`); it upgrades through Tailscale Funnel over `wss://`; one persistent connection per live session maps cleanly to the one-session invariant. Server side, use whatever WS lib is already vendored (confirm in P0.T0; `nhooyr/coder websocket` is idiomatic with chi).

**A3. The stream carries opaque base64 frames — the phone decodes.** The Pi does NOT parse VehicleStatus; it forwards the same bytes `Exchange` would have returned. The phone runs `decodeUnsolicitedVcsecStatus` on them (already handles the plaintext-FromVCSECMessage format). This preserves the forwarder property and reuses the phone pipeline verbatim.

**A4. Stream is best-effort telemetry, never commands.** Commands stay on the authenticated `/exchange` POST (with its crypto). The stream is one-directional (Pi→phone) status pushes only. Losing/reconnecting the stream degrades to the 20s poll (the backstop already in place), never to a broken command path.

---

## Part 3 — Interface contract (binding for both repos)

**WebSocket endpoint:** `GET wss://<pi-host>/api/ble/sessions/{id}/events?token=<bearer>`
- **Auth:** `token` query param must equal the configured bearer (same check as REST middleware). On mismatch → HTTP 401 before upgrade. On unknown/closed session id → HTTP 404 before upgrade.
- **Server→client messages:** each unsolicited frame is sent as ONE text message: `{"frame_b64":"<base64 RoutableMessage bytes>"}`. (Text, not binary, so RN's `WebSocket.onmessage` yields a string uniformly across iOS/Android.)
- **Keepalive:** server sends a WS ping every 30s; if the session closes/reaps, the server closes the socket with code 1000 and reason `"session closed"`.
- **No client→server messages** are required; the server ignores any it receives.

**Mobile consumer:** `handleVcsecPush(frame: Uint8Array)` — already exists. The stream client base64-decodes `frame_b64` → `Uint8Array` → `handleVcsecPush`.

---

## Part 4 — Phases

### Phase 0 — Pi frame-pump refactor (Go) — the seam (Gate: none)

Goal: make one goroutine the sole reader of `conn.Receive()`, routing matched frames to `Exchange` waiters and unsolicited frames to a fan-out, with NO behavior change yet (no subscribers → unsolicited frames are dropped exactly as today). This is a pure internal refactor proven by the existing exchange tests still passing.

**Files:**
- Read first: `internal/services/tesla_session.go` (the `session` struct, `conn` interface, `Exchange`), `internal/services/tesla_session_test.go`.
- Modify: `internal/services/tesla_session.go`
- Test: `internal/services/tesla_session_test.go`

- [ ] **P0.T0 — Confirm the primitives (exploration, no code).** Read `tesla_session.go`. Write down verbatim: the `session` struct fields; the type of `sess.conn` and the exact signatures of `Receive()` and `Send()`; which WS library (if any) is in `go.mod`. Confirm `Exchange`'s correlator match is `addrMatch || uuidMatch`. These are the facts every step below assumes.

- [ ] **P0.T1 — Add a waiter registry + pump, keep Exchange behavior.**
  - Add to `session`: `pump` state — a mutex-guarded slice/map of active waiters and a slice of unsolicited subscribers (each an `chan []byte` with a small buffer). Define:
    ```go
    type frameWaiter struct { wantAddr, wantUUID []byte; deliver chan []byte }
    // on session: waiters []*frameWaiter ; subs map[int]chan []byte ; subSeq int ; mu sync.Mutex
    ```
  - Add `func (s *session) runPump()` (started when the session opens): the SOLE reader of `s.conn.Receive()`. For each frame: under `mu`, find the first waiter whose correlators match (`extractRoutableToRoutingAddress`/`extractRoutableRequestUUID` vs `wantAddr`/`wantUUID`) → non-blocking send to its `deliver`, remove it; if no waiter matches → non-blocking send to every subscriber chan (drop on full buffer, log). On `Receive()` close → close all deliver + sub chans and return.
  - Rewrite `Exchange` to: extract correlators, register a `frameWaiter`, `Send`, then `select { case resp := <-waiter.deliver: return resp; case <-deadline: unregister; return ErrBLESessionTimeout; case <-ctx.Done(): unregister; return ctx.Err() }`. **Delete the manual drain-stale loop and the read-and-skip loop** — the pump owns routing now.
  - Add `func (s *session) subscribe() (int, <-chan []byte)` and `func (s *session) unsubscribe(id int)` for Phase 1.

- [ ] **P0.T2 — Test: an in-flight Exchange still gets its correlated reply while unsolicited frames are fanned out.** In `tesla_session_test.go`, drive a fake `conn` whose `Receive()` emits: one unsolicited frame (no matching correlator), then the correlated reply. Register a subscriber. Assert `Exchange` returns the reply, and the subscriber received the unsolicited frame. Run `go test ./internal/services/ -run BLESession -v` → PASS. Existing exchange tests must still pass unchanged.

- [ ] **P0.T3 — Commit.** `git commit -m "refactor(ble): per-session frame pump routes matched replies + fans out unsolicited frames"`

**Gate:** all `internal/services` tests green; no HTTP/behavior change observable yet.

---

### Phase 1 — Pi WebSocket events endpoint (Go) (Gate: P0 signed off)

**Files:**
- Read first: `internal/handlers/tesla_session.go` (handler struct, how routes mount, the bearer middleware), the router registration (grep `sessions/{id}/exchange`).
- Modify: `internal/handlers/tesla_session.go` (+ route registration file), `internal/services/tesla_session.go` (expose `Subscribe`/`Unsubscribe` by session id).
- Test: `internal/handlers/tesla_session_test.go` (or a new `_test.go` beside it).

- [ ] **P1.T1 — Add `GET /api/ble/sessions/{id}/events` (WS upgrade).**
  - Service: `func (s *BLESessionService) Subscribe(id string) (int, <-chan []byte, error)` (404 → error if unknown id) and `Unsubscribe(id string, subID int)` delegating to the session from P0.T1.
  - Handler `EventsBLE(w, r)`:
    1. Validate `token` query param equals the configured bearer (reuse the same comparison the REST middleware uses; if the middleware already guards this route, still re-check because RN can't send the header). On mismatch → `401` (no upgrade).
    2. `subID, ch, err := h.bleSess.Subscribe(id)`; on err → `404`.
    3. Upgrade to WS. Loop: `select { case frame := <-ch: write text {"frame_b64": base64(frame)}; case <-ping ticker (30s): ws.Ping; case <-ctx.Done()/read error: close }`. On exit → `Unsubscribe`.
  - Register the route next to the exchange route (same chi group/middleware).

- [ ] **P1.T2 — Test the auth + framing (httptest + WS client).** Table test: (a) bad token → 401, no upgrade; (b) unknown session → 404; (c) good token + open session: publish a known frame via the service, assert the WS client receives `{"frame_b64": "<expected base64>"}`. Run `go test ./internal/handlers/ -run Events -v` → PASS.

- [ ] **P1.T3 — Commit.** `git commit -m "feat(ble): WebSocket /events streams unsolicited VCSEC frames per session"`

**Gate:** manual smoke — open a session via REST, `websocat "wss://<pi>/api/ble/sessions/<id>/events?token=<t>"`, physically open the car frunk, see a `frame_b64` message.

---

### Phase 2 — Mobile PiEventStream (TS) (Gate: none — parallel to P0/P1; uses the contract only)

**Files:**
- Create: `src/state/piEventStream.ts` (RN `WebSocket` client — lives in `state/`, not `ble/`, because it touches the RN `WebSocket` global; the frame handler is injected so the module is node-testable with a fake socket).
- Test: `src/state/piEventStream.test.ts`
- Modify: `package.json` (add the test file to the `test` script — the runner is an explicit file list, NOT a glob).

**Interfaces:**
- Produces: `startPiEventStream(opts: { baseUrl: string; token: string; sessionId: string; onFrame: (frame: Uint8Array) => void; socketFactory?: (url: string) => MinimalSocket; onStatus?: (s: 'open'|'closed') => void }): () => void` — returns a stop function. `MinimalSocket` = the subset of RN `WebSocket` we use (`onopen/onmessage/onclose/onerror/close`), so tests inject a fake.

- [ ] **P2.T1 — Write the failing test: a `{frame_b64}` message decodes to bytes and calls onFrame.**
  ```ts
  test('a frame_b64 message is base64-decoded and handed to onFrame', () => {
    let sock: FakeSocket;
    const frames: Uint8Array[] = [];
    const stop = startPiEventStream({
      baseUrl: 'https://pi.example', token: 't', sessionId: 'S1',
      onFrame: (f) => frames.push(f),
      socketFactory: (url) => (sock = new FakeSocket(url)),
    });
    // URL is the wss events endpoint with the token query param
    assert.match(sock!.url, /^wss:\/\/pi\.example\/api\/ble\/sessions\/S1\/events\?token=t$/);
    sock!.emitOpen();
    sock!.emitMessage(JSON.stringify({ frame_b64: bytesToBase64(new Uint8Array([1, 2, 3])) }));
    assert.deepEqual(Array.from(frames[0]), [1, 2, 3]);
    stop();
    assert.equal(sock!.closed, true);
  });
  ```
- [ ] **P2.T2 — Run it, verify it fails** (`node --import tsx --test src/state/piEventStream.test.ts` → module/function missing).
- [ ] **P2.T3 — Implement `piEventStream.ts`:** build the `wss://` URL from `baseUrl` (swap `https`→`wss`, `http`→`ws`) + `/api/ble/sessions/{id}/events?token={token}`; open the socket (`socketFactory ?? ((u) => new WebSocket(u))`); `onmessage`: JSON.parse, if `frame_b64` present → `base64ToBytes` → `onFrame`; ignore malformed; `onopen/onclose` → `onStatus`. Return a stop fn that closes the socket and nulls handlers. Use the existing `bytesToBase64`/`base64ToBytes` from `src/ble/bytes.ts`.
- [ ] **P2.T4 — Add malformed-message + non-frame-message tests** (a `{}` message and a non-JSON message must NOT throw and must NOT call onFrame). Run all → PASS.
- [ ] **P2.T5 — Commit.** `git commit -m "feat(carlink): PiEventStream — WebSocket client for streamed VCSEC push frames"`

---

### Phase 3 — Wire the stream into useCarLink (TS) (Gate: P2 done; P1 contract available for on-car)

**Files:**
- Modify: `src/state/useCarLink.ts` (start/stop the stream tied to the Pi session lifecycle; feed frames into the existing `handleVcsecPush`).

**Interfaces:**
- Consumes: `startPiEventStream` (P2), `handleVcsecPushRef.current` (exists), `cfgRef` (baseUrl/token), the live session id, `selectedTransportRef` (only stream when transport === 'pi').

- [ ] **P3.T1 — Start the stream when a Pi session is live; stop on teardown/transport-change.**
  - After a successful poll tick establishes the session over Pi (`selectedTransportRef.current === 'pi'` and we have a session id — surface the session id from the gateway/selector; add a `getSessionId()` if not already exposed), start `startPiEventStream({ baseUrl, token, sessionId, onFrame: (f) => handleVcsecPushRef.current(f), onStatus })` and keep the stop fn in a ref.
  - Stop + null it in `teardown()` and whenever the transport flips to `'ble'` (BLE gives pushes directly) or the session id changes. Never start for a demo/unlinked car.
  - Reconnect: on `onStatus('closed')` while still linked + Pi + foreground, restart after a short backoff (e.g. 2s), capped; the 20s poll is the backstop meanwhile.
- [ ] **P3.T2 — Log stream lifecycle** via the existing `logi`/`logw` (category `stream`: `open`/`closed`/`frame`) so `pull-logs.sh` shows it, mirroring the `push` cat.
- [ ] **P3.T3 — tsc + full suite** (`npx tsc --noEmit && npm test`) → green. (No new node test asserts the RN wiring; P2 covers the stream unit, P4 covers it on-car.)
- [ ] **P3.T4 — Commit.** `git commit -m "feat(carlink): stream VCSEC pushes over Pi into the live apply path"`

---

### Phase 4 — On-car verification (Gate: P1 deployed to the Pi + P3 deployed to the phone)

- [ ] **P4.T1 — Deploy:** Pi (`airgapp-rpi` build/deploy per its Makefile) + phone (`bash scripts/godot-ios/deploy-js.sh`).
- [ ] **P4.T2 — Prove instant-over-Pi, car far from phone (Pi path):** with the phone NOT in BLE range (amber dot), physically open the frunk/trunk/a door. Assert the app reflects it in ~1s (not on the next 20s poll). Pull logs: `stream open`, `stream frame`, `push`/apply entries; the transport dot stays amber (Pi). Close it → reflects instantly (empty-closures rule already handles the close).
- [ ] **P4.T3 — Prove graceful degrade:** kill the Pi / drop Tailscale mid-session → stream `closed`, app falls back to the 20s poll, no crash; restore → stream reconnects.
- [ ] **P4.T4 — Confirm no command regression:** lock/unlock/frunk still work over `/exchange` while the stream runs (the pump refactor must not have broken correlated replies — P0.T2 covers it in unit, this confirms on-car).

---

## Self-review notes
- **Spec coverage:** pump refactor (P0) → WS endpoint (P1) → RN client (P2) → wiring+reconnect (P3) → on-car (P4). The "how do they stream" question is answered by A1–A4 + Part 3.
- **Reuse:** the phone decode/apply pipeline (`decodeUnsolicitedVcsecStatus`, `handleVcsecPush`, confirm-and-release grace, empty-closures rule) is untouched and reused verbatim — Phase 2/3 only add a second *source* of frames.
- **Risk / open confirmations:** P0.T0 must confirm the exact `conn.Receive()`/`Send()` types and the vendored WS library before P0.T1/P1.T1 (their code assumes them). RN `WebSocket` header limitation is why auth is a query param (Part 3) — validated server-side in P1.T1.
- **Not in scope (future):** streaming infotainment (charge/climate) — Tesla polls those and so do we; the stream is VCSEC only. Multi-session/multi-Pi. BLE-direct auto-switch (separate roadmap item; only an optimization once this lands).
