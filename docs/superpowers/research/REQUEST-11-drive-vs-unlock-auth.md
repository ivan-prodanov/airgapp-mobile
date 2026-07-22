# RE REQUEST #11 — what authorizes DRIVE (start the car), vs just UNLOCK?

**Requested:** 2026-07-22
**Context:** routable passive entry now UNLOCKS the car on-car (confirmed: our routable
`authenticationResponse` grants the door). But the user **cannot start/drive** — the car asks to
**place the key card OR set up the phone key.** So door-unlock and drive-authorization are different
signals, and we're only satisfying the first. We will build everything on **RoutableMessage** from here.

## What we know / have (ground truth)

- We answer the car's passive-entry challenge with a routable
  `RoutableMessage{ UnsignedMessage{ authenticationResponse{ authenticationLevel = requestedLevel,
  estimatedDistance=0, authenticationRejection=NONE } } }` (random-nonce AES_GCM_Personalized,
  DOMAIN_VEHICLE_SECURITY). This GRANTS the door.
- The handle-pull challenge we answered carried **`requestedLevel = 2 (DRIVE)`**, reason
  **`5 PASSIVE_UNLOCK_EXTERIOR_HANDLE_PULL`** — and the car still only unlocked, did not enable drive.
- Our auth vocabulary (verified from captures): `AUTH_LEVEL {NONE:0, UNLOCK:1, DRIVE:2}`; reasons
  incl. `1 IDENTIFICATION`, `5 EXTERIOR_HANDLE_PULL`, `6 INTERIOR_HANDLE_PULL`,
  `7 AUTOPRESENT_DOOR`, `8 ENTERED_HIGHER_AUTH_ZONE`, `9 WALK_UP_UNLOCK`.
- Our key is whitelisted (we've been unlocking); role/permission details unverified for drive.
- We deliberately do **NOT** create the OS LE bond (chars 0301/0302), which prior RE said exists
  **only for UWB ranging**. Our passive entry rides the VCSEC app session (0212/0213) only.

## The questions

### Q1 — what is the DRIVE grant, mechanically, and how does it differ from the door grant?
- When the user is **seated and presses the brake** (or shifts out of Park), what does the car do —
  issue a NEW challenge (which reason? which `requestedLevel`?), or check a standing
  presence/authorization state? Trace the drive-enable path in the app + firmware.
- Is `ENTERED_HIGHER_AUTH_ZONE(8)` / `INTERIOR_HANDLE_PULL(6)` the drive-relevant challenge — i.e. the
  car re-challenges once the key is **inside the cabin**, at a higher zone, and drive is granted only
  by answering THAT? If so, give the exact challenge/response and timing.

### Q2 — does DRIVE require INTERIOR LOCALIZATION the door does not?
- Door unlock only needs "key is near an exterior antenna." Drive presumably needs "key is **inside**
  the cabin." How does the car establish *inside*: interior BLE antennas + RSSI thresholding, or
  **UWB ranging**? Cite.
- **The crux:** does phone-key DRIVE on this car require **UWB** (and therefore the OS LE bond
  `0301/0302` we intentionally avoid)? If drive is UWB-gated, is BLE-only phone drive **impossible**
  on this hardware — i.e. is the "place the card" fallback exactly what the car shows when it can't
  UWB-localize a drive key? Please state plainly whether BLE-only drive is achievable here or not.
- If the car is a generation that supported **BLE-only drive** (interior RSSI, pre-UWB): what's the
  interior-presence signal/threshold and the challenge we must answer while seated?

### Q3 — key ROLE / permissions for drive
- Does drive require a specific whitelist **ROLE** or key permission (e.g. ROLE_DRIVER) distinct from
  what unlock needs? Could our enrolled key be authorized to unlock but **not** to drive, and if so
  how is that encoded / how would we tell (we can read the whitelist over the Pi)?

### Q4 — how does the OFFICIAL app enable drive-away?
- Trace the app's drive path: what does it send, WHEN (on approach, on entering, on brake?), how often,
  and does it depend on UWB (`NISession` / Nearby Interaction) or work BLE-only? Does the app do
  anything continuous (keep answering interior challenges while seated) vs one-shot?
- Does the "place card / set up phone key" prompt correspond to a specific app/firmware state we can
  map (the same `whitelistHasKey`/bond family from RE #3/#4, or a distinct "no drive-authorized key
  localized" state)?

### Q5 — the RoutableMessage specifics for drive (so we can build it)
Assuming drive is answerable over BLE: is the drive response the **same** routable
`authenticationResponse` shape at `authenticationLevel=DRIVE(2)` but triggered by the interior/zone
challenge — or a **different** message entirely? If different, give the exact envelope + inner proto +
seal, like RE #9 did for the unlock response.

## Deliverable
A clear verdict: **is BLE-only phone-key DRIVE achievable on this car, or is it UWB-gated (→ needs the
bond we avoid → not achievable our way)?** If achievable, the exact challenge we're missing and the
routable response to it. If UWB-gated, say so — then "unlock only, use the card to drive" is the
honest ceiling for our BLE-only approach and we stop chasing it.

## Constraints
Static RE (firmware VCSEC where reachable + `authd` + decompiled app), cite + confidence, mark
VCSEC-internal-inferred vs proven, and give the exact on-car probe for anything only measurable live
(we have the log pipeline + can sit in the car / press brake / capture interior challenges on demand).
