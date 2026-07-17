# RESEARCH BRIEF #13 — Seat Auto, Camp/Pet (climate keeper), and multi-stop Send-to-Car

**You are the research agent.** Context: we're wiring the real BLE command path to Tesla. Three controls behave wrong on the car, and the fix for each turns on a **UI-model / semantics** question the proto alone can't answer. We already have the proto shapes in hand (`proto/car_server.proto`) — **do not re-derive them**; answer the behaviour questions.

Method note that has paid off every round: **read the decompiled iOS app unfiltered, dump verbatim, tag `[iOS-verified]` / `[both-match]`.** iOS bundle: `/Users/ivan/Downloads/tesla-haptics-work/main.decompiled.js`. Reanimated/JS worklets retain readable source.

**Deliverable:** `docs/superpowers/research/tesla-climate-nav-actions-FINDINGS.md`

---

## What we already know from OUR proto (given — don't re-establish)

- **Seat Auto** = `AutoSeatClimateAction { repeated CarSeat carseat }`, `CarSeat { bool on; AutoSeatPosition_E seat_position }`, positions **FrontLeft / FrontRight only**. So auto is a per-front-seat on/off. Builder is MISSING on our side.
- **Climate keeper** = `HvacClimateKeeperAction { ClimateKeeperAction_E }`, enum **`{Off=0, On=1, Dog=2, Camp=3}`** — ONE mutually-exclusive setting. Builder EXISTS. Our bug is that our UI models Camp and Pet as two independent booleans that fight over this one enum.
- **Multi-stop nav** = `NavigationWaypointsRequest { string waypoints; TripPlanOptions }`. Builder EXISTS. The `waypoints` field is a **string** — our reference notes say a comma-separated list of Google **Place IDs** prefixed `refId:`. Our app's trip carries **lat/lon coords**, so we currently throw "unsupported over BLE".

---

## §1. Seat Auto — how does the official app present and send it?

1. In the official app's Climate UI, is **Auto a seat mode alongside Off/Heat/Cool**, or a separate control? What does the seat glyph/label look like in auto?
2. When the user turns a seat to **Auto**, what exactly does the app send — `AutoSeatClimateAction{on:true, seat}` **only**, or does it ALSO clear the manual `HvacSeatHeaterAction`/cooler level first? i.e. are auto and manual mutually exclusive, and does turning auto OFF restore a manual level or go to off?
3. Auto is **front-only** in the proto — does the app HIDE auto for rear seats, or show it disabled? What about the auto STATE readback (does `ClimateState` report per-seat auto, so we could read it)?
4. Is there any coupling to `climateOn` (does enabling seat-auto force climate on)?

## §2. Camp / Pet / Keep — the single climate-keeper selector

Our proto confirms ONE enum `{Off, On, Dog, Camp}`. We need the app's UI model to collapse our two booleans correctly.

1. How does the official app present climate keeper — a **single selector** with options (Keep / Dog / Camp / Off)? Give the exact labels, layout, and which is default.
2. Confirm they are **mutually exclusive** (selecting Camp turns off Dog, etc.) — i.e. our two-independent-toggles model is simply wrong.
3. What is **"On"** (`ClimateKeeperAction_On=1`) in the UI — is that the plain "Keep Climate On" option, distinct from Dog and Camp? So the real UI is a 4-way {Off, Keep, Dog, Camp}?
4. Any preconditions (does Camp/Dog require climate on, a min battery, the car in park)? Does the app read the current keeper state back from `ClimateState` so we can reflect the car's truth?

## §3. Multi-stop Send-to-Car — the `waypoints` string `[the real blocker]`

Single-stop `navigateTo` (lat/lon via `NavigationGpsRequest`) works. Multi-stop needs the `waypoints` STRING, and we have coordinates, not Place IDs.

1. **How does the official app build `NavigationWaypointsRequest.waypoints`?** Dump the exact string construction: is it `refId:<PlaceID>` comma-joined? Something else (lat,lon pairs, a URL, an encoded polyline)?
2. Where does the app get the **Place ID** for each stop — from its search/autocomplete results (which carry a Google/Apple place id), or does it **geocode a raw lat/lon → place id** before sending? If a user drops a raw pin with no place id, can it even be a waypoint over this path?
3. Is there an **alternative multi-stop proto** the app uses that takes **lat/lon** (so we could avoid Place IDs entirely)? Check every Navigation* message the app actually sends.
4. `TripPlanOptions { destination_start_soe, destination_arrival_soe }` — does the app populate these, and with what? (Battery SoE at start/arrival — likely optional.)
5. Does multi-stop require the car **awake / on a route already**, and does the app send a single-stop `navigationGpsRequest` first then append?

## §4. The "other stuff" — audit our builders against what the app actually sends

The user's hint: the proto has more than we've wired. Cross-check.

1. Enumerate the **CarServer.Action oneof** cases the official app actually emits (from the decompiled action-builders), and flag any that our `src/ble/builders.ts` does **not** implement, or implements with the wrong shape.
2. Specifically confirm/deny our current mappings are what the app sends:
   - Cabin overheat: `SetCabinOverheatProtectionAction` (on + the `noac`/fan-only variant?) — what are its fields, and does the app send a separate action for the **no-A/C** mode our UI has?
   - COP temp: `SetCopTempAction { CopActivationTemp }` — confirm the enum values map to our 30/35/40 (Low/Medium/High).
3. Any action where the app sends **extra required fields** we omit (a manual override flag, a level enum) that would make the car silently ignore our command?

---

## Output format
1. **Seat Auto** — UI model + exact send (auto vs manual), front-only handling, readback.
2. **Climate keeper** — the single 4-way selector, labels, mutual exclusion, preconditions, readback.
3. **Waypoints string** — verbatim construction + where Place IDs come from + any lat/lon alternative.
4. **Builder audit** — missing/mismapped actions, with the correct shape.
5. **Citations**; iOS-verified vs Android-only. **Gaps**, plainly.
