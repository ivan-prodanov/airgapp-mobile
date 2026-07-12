# Tesla Vehicle Visual-Config Spec

**Audience:** an engineer/agent building the mobile UI that decodes a VIN, asks the user a small set of visual questions, and emits the JSON that drives the 3D renderer. This document is self-contained: you do **not** need access to the renderer source. Everything you need to build the VIN-decode + question flow and emit a correct `vehicle_config` is here.

**Scope:** Model S, Model 3, Model X, Model Y, across their renderer generations. Cybertruck and Semi are out of scope and intentionally omitted.

---

## 1. Purpose & how to use this spec

The renderer is **air-gapped**. It never contacts Tesla's cloud, so it cannot look up a car's build sheet from the VIN. The only way it knows what to draw is the JSON payload the mobile app sends it. Your job is to gather enough information (from the VIN plus a short question flow) to build that payload.

### The pipeline

```
 VIN string
    │
    ▼
[1] Decode VIN  ──────────────►  model letter (char 4)         → car model line
                                 model-year char (char 10)      → generation *candidate*
                                 WMI (chars 1-3)                → region *hint* only
    │
    ▼
[2] Resolve model + generation  → car_type + fascia_type + chassis_type   (Section 3b)
    │
    ▼
[3] Ask the visual questions for that (model, generation)   (Section 5)
    every appearance attribute the VIN cannot give: paint, wheels,
    interior, spoiler, brakes, plate/region, options, badging…
    │
    ▼
[4] Assemble `vehicle_config` object  (Section 2 field table)
    │
    ▼
[5] Send SHOW_PRODUCT   (first render of this car)
    Send UPDATE_PRODUCT  (any later edit — identical payload shape)
```

- **SHOW_PRODUCT** is sent once to place/replace the car in the scene.
- **UPDATE_PRODUCT** is sent for every subsequent change (user picks a different color, wheel, etc.). Its payload is **byte-for-byte the same shape** as SHOW_PRODUCT — just resend the whole `data` object with the changed fields.
- You may keep local UI state and re-emit the full config each time; the renderer rebuilds the visual from the fields it receives.

---

## 2. The message contract

### 2.1 Envelope

Every message is sent as `JSON.stringify({ type, data })`. `type` is a **string**. For the visual-config flow you only ever emit two types:

| Wire `type` string | When |
|---|---|
| `SHOW_PRODUCT`   | First time you render/replace this vehicle |
| `UPDATE_PRODUCT` | Any later edit to the same vehicle (identical `data` shape) |

(Other message types exist — `APP_CONFIG`, `MOVE_CAMERA`, `SET_VEHICLE_LIGHTS`, `FADE_ROOF`, etc. — but they are unrelated to visual configuration and out of scope here.)

### 2.2 `data` object

`data` is the spread of the static vehicle config plus dynamic runtime state:

```jsonc
{
  "type": "SHOW_PRODUCT",
  "data": {
    "type": "VEHICLE",                         // constant
    "id":   "local-modely-performanceBayberry-model_y",  // any stable unique id string
    "vin":  "000Y",                            // 4th char used only as a model fallback (see §3)
    "vehicle_config": { /* the visual rebuild object — see field table */ },
    "climate_capabilities": { /* mobile-side UI table; renderer ignores it — optional */ },

    // ---- dynamic runtime state: send these defaults on first render ----
    "vehicle_state":    { "df":false,"dr":false,"pf":false,"pr":false,"ft":false,"rt":false,"tn":0 },
    "drive_state":      { "speed":0, "shift_state":"P" },
    "climate_state":    { "is_climate_on":false,"is_preconditioning":false,"is_front_defroster_on":false,"is_rear_defroster_on":false },
    "charge_state":     { "charge_port_door_open":false, "charge_port_flow_state":0 },
    "mobile_app_state": { "is_loading":false,"show_terrain":false,"wheel_turn_deg":0,
                          "window_animation_state":{ "LFWindowAnimation":false,"RFWindowAnimation":false,"LRWindowAnimation":false,"RRWindowAnimation":false } },
    "car_wrap_state":   { "skin":"" }
  }
}
```

- `id` — any stable, unique string you choose for this car (convention: `local-<car_type>-<fascia_type>-<chassis_type>`).
- `vin` — the renderer only reads the **4th character**, and only as a fallback (see §3). You can pass the real VIN.
- `vehicle_config` — the object that actually drives the visual. This is where all your question answers land.
- `climate_capabilities` — optional; a mobile-side UI hint table. The renderer ignores it. Omit if unused.
- The dynamic-state blocks are required by the renderer's runtime but are not part of visual configuration. Send the defaults shown above on first render.

### 2.3 `vehicle_config` field table

Every field below drives the 3D look (all are appearance fields).

| Field | Type | Allowed values | Default | Notes |
|---|---|---|---|---|
| `car_type` | string | `models`, `models2`, `lychee`, `model3`, `modelx`, `tamarind`, `modely` (in-scope keys) | `unknown` → VIN fallback → `modely` | Picks the model line + generation scene. See §3b. |
| `fascia_type` | string | model-specific: `original`, `basePoppyseed`, `performancePoppyseed`, `d50Poppyseed`, `baseBayberry`, `performanceBayberry`, `e41Bayberry`, `p3s`, `p3splaid`, `p3x` | `original` | Selects sub-body/body-kit; also picks the scene for Model 3 / Model Y. See §3b. |
| `chassis_type` | string | `model_s`, `model_3`, `model_x`, `model_y`, `model_y_long_wheel_base` | `model_y` | Only load-bearing for Model Y (LWB → 6-seat scene). Cosmetic/ignored elsewhere. |
| `exterior_color` | string | any key in the color catalog (§4.1) | `PearlWhite` | Unknown key → silver fallback. |
| `paint_color_override` | string | `""` or a custom color string | `""` | When non-empty, overrides `exterior_color`. |
| `wheel_type` | string | any mobile wheel key (§4.2) | `Unknown` | `Unknown` → the model's platform default wheel. |
| `spoiler_type` | string | `None`, or any other string (e.g. `Carbon`, `CarbonFiber`) | `None` | Any value ≠ `None` → spoiler shown. |
| `charge_port_type` | string | `US`, `EU`, `GB`, `GB_AC`, `GB_DC`, `CCS` | `US` | Picks charge-cable model (only visible while charging). |
| `interior_trim_type` | string | interior key (§4.3) | `Black` | See interior key → trim map. |
| `third_row_seats` | string | `None`, `FuturisFoldFlat`, `FuturisNoFoldFlat`, `FlatFold` (also an `<invalid>` sentinel) | `None` (NONE) | Any value ≠ `None` enables the 3rd row. Model X / Model Y only. |
| `rear_seat_type` | number (optional) | `0`=BASE, `1`=RECARO, `2`=EXECUTIVE, `3`=TWO_SEAT, `4`=FOLD_FLAT | `0` (BASE) | Omit unless needed. Model X 6/7-seat and Model S Executive use it. |
| `headlamp_type` | string | `Original`, `Premium`, `Global` | `Premium` | Only `Global` changes geometry (global-market lamps). Others → original lamps. |
| `aux_park_lamps` | string | `NaPremium`, `None`, `Standard`, … | `NaPremium` | Any value ≠ `None` → fog lamps shown. |
| `eu_vehicle` | boolean | `true` / `false` | `false` | `true` → EU license plate. |
| `red_brake_calipers` | boolean | `true` / `false` | `false` | `true` → red performance calipers. |
| `window_tint_color` | string | `"R,G,B,A"` 0-255, e.g. `"0,0,0,153"` | `"0,0,0,153"` | Free string, not an enum. `"0,0,0,0"` = no tint. |
| `has_tesla_badge` | boolean | `true` / `false` | `true` | `false` → hide the trunk "T" badge. |
| `has_tesla_word_mark` | boolean | `true` / `false` | `true` | `false` → hide the "TESLA" wordmark. |
| `rhd` | boolean | `true` / `false` | `false` | Right-hand drive: swaps interior/dash/screen/steering side. |
| `badging_material_type` | number | `0`=chrome silver, `1`=black matte, `-1`=derive from `badge_version` | `-1` | `-1` → chrome if `badge_version` ≤ V1 else matte black. |
| `exterior_trim` / `exterior_trim_override` | string | `Chrome`, `Black` (free string; no enum) | `Black` / `""` | Window/beltline trim finish (chrome vs chrome-delete). |
| `steering_wheel_type` | number | `0`=round, `1`=yoke (no formal enum) | `0` | Palladium S/X only (yoke option). |
| `special_badging_type` | number (sent as `car_special_type`) | `0`=NONE, `1`=FOUNDATION_SERIES, `2`=LAUNCH_SERIES, `3`=SIGNATURE_SERIES | `0` | Signature Series adds signature badges/brakes/handles. |
| `rearlight_type` | number | `0`=Original, `2`=Global (value 1 skipped) | `0` | Global tail-lamp signature. Gates tesla badge/wordmark visibility on Palladium. |
| `drivetrain_type` | number | `1`=dual, `2`+ (value has +1 applied internally) | `0` → effective `1` | Controls Plaid trunk badge (see caveat in §5.1). |
| `badge_version` | number | integer | `0` | Feeds `badging_material_type` when that is `-1`. |
| `interior_upper_trim_materials` | number | `0`=GREY, `1`=BLACK | `0` | Highland dash/door upper-trim color. |
| `has_stalk` | boolean | `true` / `false` | `true` | Highland: stalk vs stalkless column. |
| `has_front_fascia_camera` | boolean | `true` / `false` | `false` | Highland: front-bumper camera. |

### 2.4 Worked example (full envelope)

Model Y Juniper Performance, Ultra Red, Arachnid V2 21", white interior, EU:

```json
{
  "type": "SHOW_PRODUCT",
  "data": {
    "type": "VEHICLE",
    "id": "local-modely-performanceBayberry-model_y",
    "vin": "000Y",
    "vehicle_config": {
      "car_type": "modely",
      "fascia_type": "performanceBayberry",
      "chassis_type": "model_y",
      "exterior_color": "UltraRed",
      "paint_color_override": "",
      "wheel_type": "ArachnidV221",
      "spoiler_type": "CarbonFiber",
      "charge_port_type": "EU",
      "interior_trim_type": "White",
      "third_row_seats": "None",
      "headlamp_type": "Premium",
      "aux_park_lamps": "NaPremium",
      "eu_vehicle": true,
      "red_brake_calipers": true,
      "window_tint_color": "0,0,0,153",
      "has_tesla_badge": false,
      "has_tesla_word_mark": false
    },
    "vehicle_state":    { "df":false,"dr":false,"pf":false,"pr":false,"ft":false,"rt":false,"tn":0 },
    "drive_state":      { "speed":0, "shift_state":"P" },
    "climate_state":    { "is_climate_on":false,"is_preconditioning":false,"is_front_defroster_on":false,"is_rear_defroster_on":false },
    "charge_state":     { "charge_port_door_open":false, "charge_port_flow_state":0 },
    "mobile_app_state": { "is_loading":false,"show_terrain":false,"wheel_turn_deg":0,
                          "window_animation_state":{ "LFWindowAnimation":false,"RFWindowAnimation":false,"LRWindowAnimation":false,"RRWindowAnimation":false } },
    "car_wrap_state":   { "skin":"" }
  }
}
```

---

## 3. VIN decode rules

### 3.1 What the renderer actually decodes

The renderer's built-in VIN handling is a **fallback only** and inspects **exactly one character**: `vin[3]` (the 4th character, 0-indexed 3). It is used **only** when `car_type` in the payload is absent/`"unknown"`, to pick a model line. Nothing else in the VIN is parsed by the renderer — no year, plant, trim, drivetrain, or generation.

| `vin[3]` char | resolved `car_type` |
|---|---|
| `S` | `models2` |
| `3` | `model3` |
| `X` | `modelx` |
| `Y` | `modely` |
| any other | `modely` (default) |

The default VIN is `"0003"`, so with no VIN and no `car_type`, `vin[3] == '3'` → `model3`.

**Consequence for you:** send an explicit `car_type` (and `fascia_type`/`chassis_type`) in every payload. Do not rely on the renderer's VIN fallback — it can only ever pick the *default* generation of a line (classic S facelift, pre-Highland 3, classic X, legacy Y), never a refresh.

### 3.2 What YOU should decode from the VIN (to seed the question flow)

You should parse more of the VIN than the renderer does, to pre-fill sensible defaults. Standard Tesla VIN structure:

| VIN chars | Field | Use |
|---|---|---|
| 1–3 (WMI) | Region of manufacture | **Hint only** for `eu_vehicle` / `charge_port_type` / `rhd` defaults. |
| 4 | Model line | `S`/`3`/`X`/`Y` → model. Same mapping as §3.1. |
| 10 | Model-year code | Generation **candidate** (pre-refresh vs refresh). |

**WMI → region hint** (common Tesla WMIs):

| WMI | Plant | Region hint |
|---|---|---|
| `5YJ`, `7SA` | Fremont / US | North America → `eu_vehicle:false`, `charge_port_type:"US"` |
| `LRW` | Shanghai (China) | Asia; RHD-market varies → confirm plate/port |
| `XP7`, `SFZ` | Berlin (Germany) | Europe → `eu_vehicle:true`, `charge_port_type:"EU"` |

**Model-year char (position 10):**

| Char | Year | Char | Year | Char | Year |
|---|---|---|---|---|---|
| G | 2016 | M | 2021 | S | 2025 |
| H | 2017 | N | 2022 | T | 2026 |
| J | 2018 | P | 2023 | | |
| K | 2019 | R | 2024 | | |
| L | 2020 | | | | |

### 3.3 What the VIN and BLE do NOT give you — and why you must ask

The VIN encodes model, year, plant, and a check digit. It does **not** encode any *visual configuration*: paint color, wheels, interior color/material, spoiler, brake calipers, badging, plate region, headlamp market, options like Executive seats or 6-vs-7 seat layouts. Neither does BLE — the local vehicle link exposes live state (doors, climate, charge), not the factory build sheet.

Because the system is **air-gapped**, there is no Tesla cloud lookup to fill these in. Therefore **every appearance attribute must be asked** (or defaulted). That is the entire reason for the per-model question flow in §5.

### 3.4 Refresh-year boundary ambiguities

The model-year char narrows the generation but does not resolve it at refresh boundaries (a refresh usually overlaps a model year). At each boundary, ask **one** disambiguating question:

| Model | Boundary (approx.) | If year is ambiguous, ask… | Answer → generation |
|---|---|---|---|
| Model S | ~2016 (nosecone → facelift) | "Does the front have a body-color **nose cone** (older) or a smooth blank fascia?" | nose cone → `models`; smooth → `models2` |
| Model S | 2021 (facelift → refresh/Plaid) | "Does it have the **landscape center screen** and an **optional yoke** (2021 refresh)?" | yes → `lychee`; no → `models2` |
| Model 3 | 2023/2024 (→ Highland) | "Is the steering column **stalkless** (no indicator/gear stalks) with a **rear touchscreen**?" | yes → Highland (Poppyseed); no → legacy |
| Model X | 2021 (→ refresh/Palladium) | "Does it have the **landscape screen** and **optional yoke** (2021 refresh)?" | yes → `tamarind`; no → `modelx` |
| Model Y | 2024/2025 (→ Juniper) | "Does it have a **full-width light bar** front and rear (Juniper)?" | yes → Bayberry; no → legacy (`Y_High`) |

---

## 3b. Model + generation resolution table

After you know the model line and the generation answer, map to the exact routing keys to send. `chassis_type` is only load-bearing for Model Y; elsewhere send the conventional value shown.

| VIN model | Generation answer | `car_type` | `fascia_type` | `chassis_type` | Renders as |
|---|---|---|---|---|---|
| S | Classic — nosecone (pre-2016) | `models` | `original` | `model_s` | Model S classic, nosecone front |
| S | Classic — facelift (2016–2021) | `models2` | `original` | `model_s` | Model S classic, smooth front |
| S | Refresh / Plaid (2021+) | `lychee` | `original` \| `p3s` \| `p3splaid` | `model_s` | Model S Palladium |
| 3 | Legacy / pre-Highland | `model3` | `original` | `model_3` | Model 3 pre-Highland |
| 3 | Highland (base) | `model3` | `basePoppyseed` | `model_3` | Model 3 Highland |
| 3 | Highland (Performance) | `model3` | `performancePoppyseed` | `model_3` | Model 3 Highland Performance |
| 3 | Highland (D50) | `model3` | `d50Poppyseed` | `model_3` | Model 3 Highland (D50) |
| X | Classic (pre-2021) | `modelx` | `original` | `model_x` | Model X classic |
| X | Refresh / Palladium (2021+) | `tamarind` | `original` \| `p3x` | `model_x` | Model X Palladium |
| Y | Legacy / pre-Juniper | `modely` | `original` | `model_y` | Model Y pre-Juniper |
| Y | Juniper (base) | `modely` | `baseBayberry` | `model_y` | Model Y Juniper |
| Y | Juniper (Performance) | `modely` | `performanceBayberry` | `model_y` | Model Y Juniper Performance |
| Y | Juniper E41 variant | `modely` | `e41Bayberry` | `model_y` | Model Y Juniper (E41) |
| Y | Juniper 6-seat / long-wheelbase | `modely` | (any) | `model_y_long_wheel_base` | Model Y LWB 6-seat (chassis wins over fascia) |

**Routing notes:**
- **Model S / Model X:** the scene is chosen by `car_type` alone. `fascia_type` and `chassis_type` do **not** change the scene (fascia is used *inside* the Palladium body for the P3 body kit; chassis is ignored).
- **Model 3:** the scene is chosen by `car_type` + `fascia_type`. `fascia_type == "original"` (or any unrecognized value) → legacy; the three `*Poppyseed` values → Highland. `chassis_type` is ignored.
- **Model Y:** `chassis_type == "model_y_long_wheel_base"` is checked **first** and wins over fascia (→ 6-seat LWB scene). Otherwise `fascia_type` selects: `e41Bayberry` → E41 scene, `baseBayberry`/`performanceBayberry` → Juniper, anything else (incl. `original`) → legacy.
- **Unknown / unmatched `car_type`:** falls back to the Model Y legacy scene.

---


## 4. The decision tree

This is the centerpiece. You walk it top-down: the VIN gives the **model** (and a generation *candidate*); one disambiguation question resolves the **generation**; then each generation exposes an **ordered question set** whose answers narrow the valid option space and populate `vehicle_config`.

**Provenance tag on every option** (because the renderer itself enforces no per-model restriction — see §1):
- **SOURCE** — the narrowing is grounded in the renderer: the wheel mesh lives in this model's `Ego/Wheels_*` asset group, a scene node exists/absent, or a per-model script branch gates it.
- **REALWORLD** — the renderer would accept more, but this is what the real Tesla generation shipped (product curation, *not* renderer-enforced).
- **GLOBAL** — unrestricted; applies identically to every car.

### 4.0 Tree overview

```
VIN[3] ─┬─ 'S' ─▶ Model S ─┬─ nosecone?  ───────▶ models   (§4.1)
        │                  ├─ facelift? ────────▶ models2  (§4.2)
        │                  └─ 2021+ landscape/yoke? ▶ lychee (§4.3)
        │
        ├─ '3' ─▶ Model 3 ─┬─ stalkless + rear screen? ─▶ Highland ─┬─ base ▶ basePoppyseed (§4.5)
        │                  │                                        ├─ perf ▶ performancePoppyseed (§4.6)
        │                  │                                        └─ D50  ▶ d50Poppyseed (§4.7)
        │                  └─ else ─────────────────────▶ model3 legacy (§4.4)
        │
        ├─ 'X' ─▶ Model X ─┬─ 2021+ landscape/yoke? ──▶ tamarind (§4.9)
        │                  └─ else ──────────────────▶ modelx classic (§4.8)
        │
        └─ 'Y' ─▶ Model Y ─┬─ 6-seat long-wheelbase? ─▶ chassis=model_y_long_wheel_base (§4.14)
                           ├─ full-width light bar (Juniper)? ─┬─ base ▶ baseBayberry (§4.11)
                           │                                   ├─ perf ▶ performanceBayberry (§4.12)
                           │                                   └─ E41  ▶ e41Bayberry (§4.13)
                           └─ else ──────────────────▶ modely legacy (§4.10)
```

> After the generation is fixed, the **common GLOBAL questions** (paint, wheels, interior, spoiler, red calipers, license-plate region `eu_vehicle`, charge-port region, window tint) always apply, plus the generation-specific questions listed in each node.

### 4.0a Corrections from adversarial verification

The **mechanical** fixes below are **already applied to the §4.x tables** (no-op questions dropped; `eu_vehicle` and `red_brake_calipers` added to every generation; `has_eu_plate`→`eu_vehicle`). The **nuanced** fixes (provenance upgrades, default semantics) are **authoritative overrides**: where a table cell conflicts, this wins. Full log in §8.

| Fix | Detail |
|---|---|
| **`eu_vehicle` is the plate field** | License-plate region uses `eu_vehicle` (bool; `false`=US default, `true`=EU) — **not** `has_eu_plate`. It is a valid GLOBAL question on **every** S3XY generation (`Plate_US`/`Plate_EU` nodes exist). |
| **`red_brake_calipers` is renderable** | GLOBAL/SOURCE bool, default `false`. `set_brakes(true)` swaps in red performance calipers. Present on every generation; ask it everywhere. |
| **`badging_material_type` is a NO-OP** on classic S (`models`,`models2`), classic X (`modelx`), and X-refresh (`tamarind`) | Those scenes define no badging-material surface. Do **not** present it as a live question there. Wire default is `-1` (auto-derive), not `0`. |
| **Wheel "default" = `Unknown`** | The renderer's absent-field wheel default is `Unknown` → the platform default (`Pinwheel` for 3, `Gemini` for Y, `TempestSilver` for S, `SlipstreamSilver`/`Cyberstream` for X). The wheel shown as "default" in a node is a *recommended pre-selection* — always send an explicit key. |
| **`headlamp_type` wire default = `Premium`** | Resolves to the Original lamp render; only `Global` changes geometry (`hasGlobalHeadlamp()` checks `== "Global"`). |
| **`has_tesla_badge` is the FRONT hood badge** | Not "rear". It is a **NO-OP on `tamarind`** (no `tesla_badge_global` node); on `lychee` it renders only when `rearlight_type == Global`. |
| **Provenance upgrades → SOURCE** | `Cardenio19` (S-refresh, asset-group tie); the colors `StealthGrey, DiamondBlack, GlacierBlue, Quicksilver, UltraRed, DeepBlue` (distinct `ExteriorColorValue` entries); `PearlWhite` = source field default (distinct from the grey `FALLBACK_EXTERIOR_COLOR`). |
| **Model 3 D50** adds `interior_upper_trim_materials` | int enum `GREY=0`/`BLACK=1`, default `0`, always shown. |
| **Model 3 Highland Perf** `Black` exterior trim is a no-op | `Exterior_Hydroxide.material` is absent from `Ego/v2023/Poppyseed/`. |

---

### 4.1 Model S — Classic (nosecone, S1)

**Routing keys:** `car_type=models` · `fascia_type=(ignored — get_vehicle_node_path routes Model S by car_type alone; fascia_type never read)` · `chassis_type=(ignored — never read for Model S)`


> SCENE/SCRIPT: car_type "models" routes by car_type ALONE (fascia_type + chassis_type never read for Model S) to res://Ego/S/Model_S.tscn, script Model_S.gd (extends base Vehicle; NOT Palladium). SOURCE (Model_S.gd:134-137): car_type=="models" -> Version.S1, which shows the nosecone body/bumperS1/hood/lightsS1 and rebinds DRL/Headlights/Turn-signal NodePaths to the *_Original nodes. The sibling key "models2" (and the VIN vin[3]=='S' decode) selects the SAME scene but Version.S2 (refreshed fascia). So this node = the S1 nosecone specifically; the ONLY thing that distinguishes it from models2 is the car_type string, not any user question. RENDERER-vs-REALWORLD: The renderer does NOT gate exterior_color, wheel, or interior per model — every global key renders on any car (ExteriorColorValue, MobileWheelTypeEnumMap, InteriorMap are single global dicts with no Model_S branch). So color options below are REALWORLD narrowing (renderer accepts all 32); the classic-S palette is Tesla product knowledge, not renderer-enforced. Wheels ARE SOURCE-narrowed because the mesh lives in the Ego/Wheels_X_S asset group (the S/X classic group) and TempestSilver is the per-model default (DefaultWheelForVehicleType models/models2/lychee=TempestSilver). Interior/rear-seat/trim narrowing is SOURCE (base set_interior_config arms + scene meshes + Model_S.gd branches). CLASSIC-nosecone caveat on wheels: the Ego/Wheels_X_S group is shared by S1 AND S2 (both use the Ego/S scene), so the renderer does not distinguish nosecone-era vs facelift wheels — all Ego/Wheels_X_S wheels are SOURCE-available on this scene. Tempest/Arachnid/TwinTurbine are post-nosecone REALWORLD but still SOURCE-reachable here. Note Wheel_Cyclone_Silver.tscn exists on disk but NO mobile wireKey targets it (only Cyclone19Dark -> CycloneCarbon is reachable), so it is not offered. EXCLUDED questions (do NOT appear on this node, each renderer-grounded): steering_wheel_type/Yoke (Palladium-only setter, no-op on Model_S); car_special_type/Signature Series (Palladium-only); drivetrain_type/Plaid badge (no visible effect off Palladium); rearlight_type Global + has_tesla_badge + has_tesla_word_mark (Palladium-only); headlamp_type (Model_S.gd has NO headlamp handling -> total no-op); aux_park_lamps/fog cover (Model_3/Model_Y only); third_row_seats (S never reads it -> no 3rd-row question); carbon-fiber/wood-decor interior (Palladium-only; on S CarbonBlack/White/Cream collapse to plain Black/White/Cream via base fallback); Black2/White2 refresh-console (base groups them with Black/White -> plain, no is_new_interior branch on S); TacticalGrey (no set_interior_config arm anywhere -> no-op). has_stalk and has_front_fascia_camera are parsed but have zero consumers (no-op globally). fascia_type/chassis_type are ignored by routing for Model S. INTERIOR EXEC INTERACTION: rear_seat_type EXECUTIVE swaps the whole interior mesh to Interior_Executive(_RHD); the scene ships matching Interior_Executive_Black/White/Cream materials, so interior_trim_type color still applies on top of the executive mesh.


| # | Question | Field | Options (label → value · provenance) | Default | Show-if |
|---|---|---|---|---|---|
| 1 | Exterior paint color | `exterior_color` | Pearl White Multi-Coat (default; absent-field default) → `PearlWhite` · REALWORLD<br>Solid Black (aliases Black, MetallicBlack/Obsidian) → `SolidBlack` · REALWORLD<br>Midnight Silver Metallic (aliases Grey, SteelGrey) → `MidnightSilver` · REALWORLD<br>Silver Metallic — legacy (alias Silver; byte-identical to fallback) → `SilverMetallic` · REALWORLD<br>Titanium Metallic — legacy warm grey/copper (alias Titanium) → `TitaniumCopper` · REALWORLD<br>Deep Blue Metallic → `DeepBlue` · REALWORLD<br>Ocean/Metallic Blue — legacy → `Blue` · REALWORLD<br>Signature Blue (2012 Signature series) → `SignatureBlue` · REALWORLD<br>Red Multi-Coat (alias Red) → `RedMulticoat` · REALWORLD<br>Signature Red → `SigRed` · REALWORLD<br>Solid White — legacy non-pearl → `White` · REALWORLD<br>Pearl — low-metallic white variant → `Pearl` · REALWORLD<br>Green — legacy special-order (Sequoia/British Racing) → `Green` · REALWORLD<br>Brown — legacy special-order metallic → `Brown` · REALWORLD | `PearlWhite` | always |
| 2 | Wheels | `wheel_type` | Tempest Sonic Silver 19" (DEFAULT; WheelType.TempestSilver) → `Tempest19SonicSilver` · SOURCE<br>Aero 19" (classic base aero; WheelType.Aero) → `Aero19` · SOURCE<br>Base Silver 19" (WheelType.BaseSilver) → `Base19` · SOURCE<br>Turbine Silver (WheelType.TurbineSilver; aliases Silver21/Silver21Euro/Super21Silver/Turbine19/Turbine22) → `Turbine19` · SOURCE<br>Turbine Onyx Black (WheelType.TurbineBlack; aliases Charcoal21/Charcoal21Euro/Super21Gray/Turbine19Dark/Turbine22Dark) → `Turbine19Dark` · SOURCE<br>Slipstream Silver (WheelType.SlipstreamSilver; alias AeroTurbine19/AeroTurbine20) → `AeroTurbine19` · SOURCE<br>Slipstream Sonic Carbon (WheelType.SlipstreamCarbon; aliases AeroTurbine19Black/Slipstream19Carbon/Slipstream20Carbon) → `Slipstream19Carbon` · SOURCE<br>Slipstream Two-Tone/Dark (WheelType.SlipstreamDark; aliases AeroTurbine20Dark/Slipstream20Dark) → `AeroTurbine20Dark` · SOURCE<br>Cyclone Sonic Carbon 19" (WheelType.CycloneCarbon; wireKey Cyclone19Dark) → `Cyclone19Dark` · SOURCE<br>Helix Silver 20" (WheelType.Helix) → `Helix20` · SOURCE<br>Arachnid Silver 21" (WheelType.ArachnidSilver) → `Arachnid21Silver` · SOURCE<br>Arachnid Armor Black 21" (WheelType.ArachnidBlack) → `Arachnid21Black` · SOURCE<br>Arachnid Sonic Carbon 21" (WheelType.ArachnidCarbon; wireKey Arachnid21Grey) → `Arachnid21Grey` · SOURCE<br>Twin Turbine Silver 21" (WheelType.TwinTurbineSilver) → `TwinTurbine21Silver` · SOURCE<br>Twin Turbine Sonic Carbon 21" (WheelType.TwinTurbineCarbon) → `TwinTurbine21Carbon` · SOURCE | `Tempest19SonicSilver` | always |
| 3 | Interior color/trim | `interior_trim_type` | All Black (default; aliases AllBlack, EbonyBlack) → `Black` · SOURCE<br>Black & White (aliases BlackAndWhite, WalnutWhite) → `White` · SOURCE<br>Cream (alias WalnutCream) → `Cream` · SOURCE | `Black` | always |
| 4 | Rear seat configuration (Standard vs Executive) | `rear_seat_type` | Standard rear (default; BASE=0; also RECARO/FOLD_FLAT render identically) → `0` · SOURCE<br>Executive rear seats (EXECUTIVE=2 -> Interior_Executive mesh) → `2` · SOURCE | `0` | always |
| 5 | Window/pillar trim finish | `exterior_trim_override` | Chrome / bright trim (ExteriorTrim.Original) → `Chrome` · SOURCE<br>Black trim (ExteriorTrim.Black) → `Black` · SOURCE<br>Unset — keep scene default trim (empty string, early-return) → `` · SOURCE | `` | always |
| 6 | Rear spoiler | `spoiler_type` | None (default) → `None` · GLOBAL<br>Carbon Fiber spoiler → `CarbonFiber` · GLOBAL | `None` | always |
| 7 | Steering side (left/right-hand drive) | `rhd` | Left-hand drive (default) → `false` · GLOBAL<br>Right-hand drive → `true` · GLOBAL | `false` | always |
| 8 | Window tint | `window_tint_color` | Standard factory tint (default 0,0,0,153) → `0,0,0,153` · GLOBAL<br>Custom RGBA CSV (e.g. 0,0,0,190) → `0,0,0,190` · GLOBAL | `0,0,0,153` | always |
| 9 | Custom paint override (advanced — replaces named color) | `paint_color_override` | None — use named color from Q1 (default empty) → `` · GLOBAL<br>Custom 5-float CSV (R,G,B,metallic,roughness) → `255,0,0,0.8,0.05` · GLOBAL | `` | always |
| 10 | Charge port / region cable | `charge_port_type` | US (default; Charging_Cable) → `US` · GLOBAL<br>EU (IEC) → `EU` · GLOBAL<br>GB / GB_AC / GB_DC (IEC) → `GB` · GLOBAL<br>CCS (CCS2_V3) → `CCS` · GLOBAL | `US` | always |
| 11 | License-plate region | `eu_vehicle` | US plate (default) → `false` · GLOBAL<br>EU plate → `true` · GLOBAL | `false` | always |
| 12 | Brake calipers | `red_brake_calipers` | Standard (default) → `false` · SOURCE<br>Red performance calipers → `true` · SOURCE | `false` | always |

### 4.2 Model S — Classic (facelift, S2)

**Routing keys:** `car_type=models2` · `fascia_type=ignored — not read for Model S (ProductManager.gd match on car_type returns Ego/S/Model_S.tscn regardless of fascia_type)` · `chassis_type=ignored — not read for Model S`


> SCENE/SCRIPT/VERSION: car_type 'models2' routes to res://Ego/S/Model_S.tscn (Model_S.gd) by car_type ALONE — fascia_type and chassis_type are never read for Model S (ProductManager.gd:121-122). Model_S.update() sets version=Version.S2 because car_type != 'models' (Model_S.gd:134-137). S2 is the classic 'facelift' front end: set_version toggles bodyS2/bumperS2/hoodS2/lightsS2/lights_glassS2 geometry ON (vs S1 body/bumper/hood/lights for car_type 'models') and rebinds DRL/Headlights/Left\|Right_Turn_Signal node paths to the non-Original nodes (Model_S.gd:51-73). Same .tscn as 'models'(S1) but the S2 geometry set. NOTE: lychee = the separate Palladium/Plaid refresh (Ego/S_Palladium) — NOT this node. PROVENANCE RULE: the renderer does NOT gate exterior_color/wheel_type/interior_trim_type per car — every global-map key renders on models2. Exterior_color options are renderer-GLOBAL; restriction to the Model S classic palette is REALWORLD product knowledge (labeled REALWORLD). Wheel options are labeled SOURCE only because their mesh lives in the Ego/Wheels_X_S asset group (the S/X-classic group) and TempestSilver is the models2 per-car default (VehicleOptions.gd:177); the S-vs-X split within that group is REALWORLD. Interior Black/White/Cream are SOURCE (base Vehicle.set_interior_config branches on exactly these three color families and the Model S scene ships Interior_Black/White/Cream.material + Interior_Executive_Black/White/Cream). rear_seat_type and exterior_trim are SOURCE (Model_S.gd branches + scene nodes). rhd/spoiler_type/red_brake_calipers/plates/badging_material_type are renderer-GLOBAL base-Vehicle fields that models2 honors (scene has the meshes). COLLAPSE FACTS on models2: interior Black2/White2 collapse to plain Black/White (is_new_interior console branch exists only in Model_3/Model_Y, not Model S); CarbonBlack/White/Cream collapse to plain Black/White/Cream (carbon+wood decor branch exists only in Palladium.gd); TacticalGrey is an unhandled no-op. Color aliases collapse: Red==RedMulticoat, Black==SolidBlack==MetallicBlack, Silver==SilverMetallic, Grey==SteelGrey==MidnightSilver, Titanium==TitaniumCopper. EXCLUDED (renderer would still render them, but NOT this generation): Palladium-era paints MidnightCherryRed/Quicksilver/UltraRed/GarnetRed (2021+ Plaid/Palladium S), and Model 3/Y paints StealthGrey/LunarSilver/GlacierBlue/DiamondBlack/FrostBlue/SilkroadSilver/MarineBlue. NO-OP FIELDS on models2 (parsed but zero visible effect — no question emitted): headlamp_type (Model_S.gd has no headlamp handler), rearlight_type/steering_wheel_type[yoke]/special_badging_type[signature]/drivetrain_type[plaid badge]/has_tesla_badge/has_tesla_word_mark (all Palladium-only), aux_park_lamps/fog cover (Model_3/Model_Y-only), third_row_seats (Model S never reads it — no seat-count concept, only Base-vs-Executive rear interior), has_stalk, has_front_fascia_camera. No dev sample exercises models2 (LocalDevMessageInjector Model S sample uses car_type 'lychee'), so all defaults are the wire/config defaults.


| # | Question | Field | Options (label → value · provenance) | Default | Show-if |
|---|---|---|---|---|---|
| 1 | Exterior paint color | `exterior_color` | Pearl White Multi-Coat (default) → `PearlWhite` · REALWORLD<br>Solid Black → `SolidBlack` · REALWORLD<br>Midnight Silver Metallic → `MidnightSilver` · REALWORLD<br>Deep Blue Metallic → `DeepBlue` · REALWORLD<br>Red Multi-Coat → `RedMulticoat` · REALWORLD<br>Silver Metallic (early facelift, discontinued ~2019; bytes == FALLBACK) → `SilverMetallic` · REALWORLD<br>Obsidian/Metallic Black (legacy classic; == SolidBlack bytes) → `MetallicBlack` · REALWORLD<br>Titanium Metallic (legacy classic warm grey/copper) → `TitaniumCopper` · REALWORLD<br>Steel Grey (legacy classic; == MidnightSilver bytes) → `SteelGrey` · REALWORLD<br>Ocean/Metallic Blue (legacy classic) → `Blue` · REALWORLD<br>Signature Red (early Signature-series classic) → `SigRed` · REALWORLD<br>Signature Blue (2012 Signature-series classic) → `SignatureBlue` · REALWORLD<br>Green (early classic special-order) → `Green` · REALWORLD<br>Brown (early classic special-order) → `Brown` · REALWORLD<br>Solid White (early classic non-pearl) → `White` · REALWORLD | `PearlWhite (wire/config default when field absent, VehicleData.gd; unrecognized key silently renders FALLBACK medium silver == SilverMetallic)` | always |
| 2 | Wheels | `wheel_type` | Tempest Sonic Silver 19" (default) → `Tempest19SonicSilver` · SOURCE<br>Aero 19" (classic base aero) → `Aero19` · SOURCE<br>Base Silver 19" → `Base19` · SOURCE<br>Slipstream Silver (aero-turbine) → `AeroTurbine19` · SOURCE<br>Slipstream Sonic Carbon → `Slipstream19Carbon` · SOURCE<br>Slipstream Two-Tone / Dark → `AeroTurbine20Dark` · SOURCE<br>Cyclone Sonic Carbon 19" → `Cyclone19Dark` · SOURCE<br>Helix Silver 20" → `Helix20` · SOURCE<br>Turbine Silver 21" → `Silver21` · SOURCE<br>Turbine Onyx Black 21" → `Charcoal21` · SOURCE<br>Twin Turbine Silver 21" → `TwinTurbine21Silver` · SOURCE<br>Twin Turbine Sonic Carbon 21" → `TwinTurbine21Carbon` · SOURCE<br>Arachnid Silver 21" (classic Arachnid) → `Arachnid21Silver` · SOURCE<br>Arachnid Armor Black 21" → `Arachnid21Black` · SOURCE<br>Arachnid Sonic Carbon 21" → `Arachnid21Grey` · SOURCE | `Tempest19SonicSilver (resolves WheelType.TempestSilver; the models2 per-car default)` | always |
| 3 | Interior color | `interior_trim_type` | All Black (default) → `Black` · SOURCE<br>Black & White → `White` · SOURCE<br>Cream (S/X-only offering; Model S ships Interior_Cream) → `Cream` · SOURCE | `Black (VehicleData default 'Black'; unknown key -> InteriorConfig.Black)` | always |
| 4 | Exterior trim (chrome delete) | `exterior_trim_override` | Chrome (Original bright trim) → `Chrome` · SOURCE<br>Black (blacked-out trim) → `Black` · SOURCE | `"" (empty = no override; scene's exported exterior_trim default retained)` | always |
| 5 | Rear seats (Executive) | `rear_seat_type` | Standard rear seats (default) → `0` · SOURCE<br>Executive rear seats → `2` · SOURCE | `0 (BASE — standard rear interior; raw int, no string map, VehicleData.gd:63)` | always |
| 6 | Spoiler | `spoiler_type` | None (default) → `None` · GLOBAL<br>Carbon Fiber spoiler → `CarbonFiber` · GLOBAL | `None (no spoiler)` | always |
| 7 | Brake calipers | `red_brake_calipers` | Standard (default) → `false` · GLOBAL<br>Red performance calipers → `true` · GLOBAL | `false (standard calipers)` | always |
| 8 | Steering side (RHD/LHD) | `rhd` | Left-hand drive (default) → `false` · GLOBAL<br>Right-hand drive → `true` · GLOBAL | `false (left-hand drive)` | always |
| 9 | License plate region | `eu_vehicle` | US plate (default) → `false` · GLOBAL<br>EU plate → `true` · GLOBAL | `US plate (has_us_plate true / has_eu_plate false)` | always |

### 4.3 Model S — Refresh / Plaid (Palladium)

**Routing keys:** `car_type=lychee` · `fascia_type=ignored-for-scene (routes by car_type alone); but Palladium.gd DOES read vehicle_config.fascia_type at runtime to swap the P3/Plaid fascia group — values 'p3s'→P3ModelSBase, 'p3splaid'→P3ModelSPlaid, 'p3x'→no-op(early return), anything else incl 'original'→Original. Dev sample sends 'original'.` · `chassis_type=ignored (never read for Model S; dev sample sends 'model_s')`


> car_type key 'lychee' → res://Ego/S_Palladium/S_Palladium.tscn, driven by Palladium.gd (ProductManager.get_vehicle_node_path, verified lines 119-124). Scene routes by car_type ALONE — fascia_type and chassis_type are NEVER read for scene selection on S (the 'lychee' match returns unconditionally). NOTE: a VIN-only Model S (vin[3]='S') decodes to 'models2' (legacy Model_S.tscn), NOT 'lychee' — the Palladium S is only reachable when the server explicitly sends car_type='lychee'. WHAT THIS SCENE EXPOSES THAT THE LEGACY S DOES NOT (all SOURCE, Palladium.gd + confirmed scene nodes): yoke vs round steering wheel (Steering_Wheel_Yoke/_RHD vs Steering_Wheel_Standard/_RHD); Signature Series node group + signature brakes/seat badges/door handles (Seat_Sport_Badge_*_Signature, Door_*_Signature, PlaidBadge_Signature); Plaid badge driven by drivetrain (PlaidBadge/PlaidBadge_Signature); P3 (Plaid) front/rear fascia group swap (Fascia_Front_p3 / Fascia_Rear_p3 vs original, groups 'p3_fascia'/'original_fascia'); Global headlamp geometry (Lights_Front_Global); Global rearlight geometry that also relocates the charge port and gates the Tesla badge + wordmark meshes (Lights_Rear_Global, Trunk_Emblem_Global, ChargePort_Global); and carbon-fiber / wood (Ebony/Walnut) interior decor with Sport_Seats materials. WHAT IS INERT ON lychee (deliberately NOT surfaced as questions): seating (third_row_seats + rear_seat_type incl. EXECUTIVE) — Palladium.gd never reads them and the S_Palladium scene has NO Interior_5/6/7_seater or Interior_Executive nodes (only SeatRow markers + Sport seats), so seating is a no-op; that Executive/seat-count logic lives only in Model_X_Palladium.gd (tamarind). exterior_trim / exterior_trim_override — no Palladium consumer (Model_S.gd/Model_X/Model_3 only). aux_park_lamps / fog cover — Model_3/Model_Y only. has_stalk, has_front_fascia_camera — parsed but zero consumers anywhere. interior_config Black2/White2 (refresh center-console) — Palladium groups them with plain Black/White (the is_new_interior console branch exists only in Model_3.gd/Model_Y.gd), so they render identical to Black/White. TacticalGrey interior — no set_interior_config arm → no-op. PROVENANCE DISCIPLINE: the renderer does NOT gate colors, wheels, or most options per car — every key in ExteriorColorValue / MobileWheelTypeEnumMap / InteriorMap renders on any car_type. So color options and the classic-wheel superset are GLOBAL at the renderer and only REALWORLD-narrowed to what the Palladium S shipped; I mark the field/per-model DEFAULT and any Palladium-only script branch or asset-group tie as SOURCE. Do not read the color/wheel narrowing as renderer-enforced. DEFAULTS grounded in source: exterior_color absent → 'PearlWhite' (VehicleData default; dev fixture LocalDevMessageInjector assigns lychee→GarnetRed, a fixture only, not gating). Unknown wheel → DefaultWheelForVehicleType['lychee'] = WheelType.TempestSilver (mesh res://Ego/Wheels_X_S/Wheel_Tempest_Sonic_Silver.tscn). interior_trim_type absent → 'Black'. steering_wheel_type/drivetrain/rearlight default to 0; headlamp default 'Premium'; special_badging default 0 (NONE).


| # | Question | Field | Options (label → value · provenance) | Default | Show-if |
|---|---|---|---|---|---|
| 1 | Exterior paint color | `exterior_color` | Pearl White Multi-Coat (default; field default when absent) → `PearlWhite` · SOURCE<br>Solid Black → `SolidBlack` · REALWORLD<br>Midnight Silver Metallic → `MidnightSilver` · REALWORLD<br>Deep Blue Metallic → `DeepBlue` · REALWORLD<br>Red Multi-Coat → `RedMulticoat` · REALWORLD<br>Quicksilver (2023+ Palladium) → `Quicksilver` · REALWORLD<br>Ultra Red (2023+ Palladium) → `UltraRed` · REALWORLD<br>Midnight Cherry Red (Plaid era 2023+) → `MidnightCherryRed` · REALWORLD<br>Garnet Red (dev fixture assigns this to lychee) → `GarnetRed` · REALWORLD | `PearlWhite` | always |
| 2 | Custom paint override (advanced — replaces the named color) | `paint_color_override` | None — use named color → `` · SOURCE<br>Custom 5-float CSV e.g. '200,0,0,0.8,0.05' → `<R,G,B,metallic,roughness>` · GLOBAL | `` | always (optional; empty string = use named color from Q1) |
| 3 | Wheels | `wheel_type` | Tempest 19" Sonic Silver (default → WheelType.TempestSilver) → `Tempest19SonicSilver` · SOURCE<br>Arachnid 21" (Plaid signature → WheelType.Arachnid, Wheels_Palladium) → `Arachnid21` · SOURCE<br>New Turbine 22" Black (WheelType.NewTurbine22Black, Wheels_Palladium) → `NewTurbine22Black` · SOURCE<br>Cardenio 19" (refresh S base → WheelType.Cardenio, Wheels_Palladium) → `Cardenio19` · REALWORLD | `Tempest19SonicSilver` | always |
| 4 | Interior color & decor | `interior_trim_type` | Black (default) — Sport seats + Wood Ebony → `Black` · SOURCE<br>Black & White — Sport seats + Wood Walnut → `White` · SOURCE<br>Cream — Sport seats + Wood Walnut → `Cream` · SOURCE<br>Black + Carbon Fiber decor → `CarbonBlack` · SOURCE<br>White + Carbon Fiber decor → `CarbonWhite` · SOURCE<br>Cream + Carbon Fiber decor → `CarbonCream` · SOURCE | `Black` | always |
| 5 | Steering wheel | `steering_wheel_type` | Round wheel (Standard, default) → `0` · SOURCE<br>Yoke → `1` · SOURCE | `0` | always |
| 6 | Front/rear fascia styling (Plaid vs standard) | `fascia_type` | Standard / Original fascia (default) → `original` · SOURCE<br>Plaid fascia (P3ModelSPlaid — p3 fascia group + P3SPlaid skins) → `p3splaid` · SOURCE<br>P3 S Base (P3ModelSBase — enum only, no group swap) → `p3s` · SOURCE | `original` | always |
| 7 | Drivetrain (drives the Plaid badge) | `drivetrain_type` | RWD (wire 0, default) → `0` · SOURCE<br>AWD Dual Motor (wire 1) → `1` · SOURCE<br>Plaid — AWD Tri-Motor (wire 2 → shows Plaid badge) → `2` · SOURCE | `0` | always |
| 8 | Special badging series | `car_special_type` | None (default) → `0` · SOURCE<br>Foundation Series (renders same as None) → `1` · REALWORLD<br>Launch Series (renders same as None) → `2` · REALWORLD<br>Signature Series (signature group + brakes + Plaid badge variant) → `3` · SOURCE | `0` | always |
| 9 | Red performance brake calipers | `red_brake_calipers` | Standard calipers (default) → `false` · GLOBAL<br>Red performance calipers → `true` · GLOBAL | `false` | always |
| 10 | Headlamp style | `headlamp_type` | Premium (default; renders Original geometry) → `Premium` · SOURCE<br>Original (same geometry as Premium) → `Original` · SOURCE<br>Global (global front headlamp geometry) → `Global` · SOURCE | `Premium` | always |
| 11 | Rear light style | `rearlight_type` | Original (default) → `0` · SOURCE<br>Global (global rear + relocated charge port; enables badge/wordmark) → `2` · SOURCE | `0` | always |
| 12 | Show rear Tesla T badge | `has_tesla_badge` | Show T badge (default) → `true` · SOURCE<br>Hide T badge → `false` · SOURCE | `true` | rearlight_type == Global (2) |
| 13 | Show rear 'TESLA' wordmark | `has_tesla_word_mark` | Show wordmark (default) → `true` · SOURCE<br>Hide wordmark → `false` · SOURCE | `true` | rearlight_type == Global (2) |
| 14 | Rear spoiler | `spoiler_type` | None (default) → `None` · GLOBAL<br>Carbon Fiber spoiler → `CarbonFiber` · GLOBAL | `None` | always |
| 15 | Window tint | `window_tint_color` | Default tint (0,0,0,153) → `0,0,0,153` · GLOBAL<br>Lighter (0,0,0,128) → `0,0,0,128` · GLOBAL<br>Darker (0,0,0,190) → `0,0,0,190` · GLOBAL | `0,0,0,153` | always |
| 16 | Badging material finish | `badging_material_type` | Auto from badge_version (default, -1) → `-1` · GLOBAL<br>Chrome / Silver → `0` · GLOBAL<br>Black Matte → `1` · GLOBAL | `-1` | always |
| 17 | Charge port / cable region | `charge_port_type` | US (default) → `US` · GLOBAL<br>EU → `EU` · GLOBAL<br>GB → `GB` · GLOBAL<br>CCS → `CCS` · GLOBAL | `US` | always |
| 18 | Right-hand drive | `rhd` | LHD (default) → `false` · GLOBAL<br>RHD → `true` · GLOBAL | `false` | always |
| 19 | License-plate region | `eu_vehicle` | US plate (default) → `false` · GLOBAL<br>EU plate → `true` · GLOBAL | `false` | always |

### 4.4 Model 3 — Legacy (pre-Highland)

**Routing keys:** `car_type=model3` · `fascia_type=original` · `chassis_type=(ignored for Model 3 — any value; default 'model_3'). Only car_type+fascia_type route Model 3; fascia_type must be NOT in {basePoppyseed,performancePoppyseed,d50Poppyseed} to land on 3_High.`


> Scene res://Ego/3_High/Model3_High.tscn, script Model_3.gd (extends Vehicle). Reached when car_type=model3 AND fascia_type is NOT one of {basePoppyseed, performancePoppyseed, d50Poppyseed} — i.e. 'original', missing, or any other string falls through to the 3_High (pre-Highland) scene; chassis_type is never read for Model 3 (ProductManager.get_vehicle_node_path). The three Poppyseed fascias route to a different scene/script (Highland) and are OUT OF SCOPE for this node. SOURCE facts grounding this node: (1) DefaultWheelForVehicleType['model3']=WheelType.Pinwheel (VehicleOptions.gd:179) — unknown/absent wheel_type resolves to Pinwheel. (2) 3_High scene contains Center_Console + Center_Console_2_0, so interior Black2/White2 (is_new_interior, the 2021 refresh console) toggles real geometry (Model_3.gd:104-114); NOTE the door_card1/2 and door_decor NodePaths that Model_3.gd references have NO matching nodes in Model3_High.tscn -> get_node_or_null returns null -> those toggles are silent no-ops (only the center-console geometry actually swaps). (3) Steering only has Steering_Wheel_Standard + Steering_Wheel_RHD_Standard — NO yoke node, so no steering_wheel_type/yoke question (Palladium-only). (4) No Cream seat/decor material exists in the 3_High dir; Model_3.set_interior_config only branches White/White2/Black/Black2, so Cream falls through to base -> generic (REALWORLD: Model 3 never shipped cream). (5) Model_3 reads the base exterior_trim field (Chrome->Exterior.material, Black->Exterior_Hydroxide.material) with exterior_trim_override taking precedence (Model_3.gd:247-250). (6) headlamp_type is binary Global-vs-Original (Premium renders as Original); Global swaps Headlights/Lights_Trunk/Charge_Cap to their _GLOBAL variants and re-routes every lamp sub-node (Model_3.gd:155-243). (7) aux_park_lamps toggles Foglights_Cover (Model_3.gd:252). (8) spoiler_type is honored via base set_has_spoiler (Spoiler1 node) — Model 3 does NOT force the spoiler on (unlike Model X). EXCLUDED (parsed globally but no visible effect on this scene/script, so no question): steering_wheel_type/yoke, rearlight_type, has_tesla_badge, has_tesla_word_mark, car_special_type/special_badging (Signature), drivetrain_type/Plaid badge — all Palladium-only. third_row_seats + rear_seat_type — Model_3.gd reads NEITHER field (both inert). has_stalk (global no-op) and has_front_fascia_camera (consumed only by Poppyseed, not 3_High). PROVENANCE: the renderer gates NOTHING per-model for colors/wheels/interiors — every global-map key renders on any car. SOURCE labels below mean a Model_3/base script branch, a scene node, or a per-model default grounds the value; REALWORLD means the renderer accepts it but the narrowing is Tesla product knowledge (which legacy pre-Highland Model 3 actually shipped). Highland-era wheels (Glider18, Helix19, Wishbone19/20, D5018) and Highland-era colors (StealthGrey, Quicksilver, UltraRed, etc.) render fine (GLOBAL) but belong to the Poppyseed node and are excluded from this generation's shipped sets.


| # | Question | Field | Options (label → value · provenance) | Default | Show-if |
|---|---|---|---|---|---|
| 1 | Exterior paint color | `exterior_color` | Pearl White Multi-Coat (renderer default when field absent) → `PearlWhite` · SOURCE<br>Solid Black (alias: Black) → `SolidBlack` · REALWORLD<br>Midnight Silver Metallic (aliases: Grey, SteelGrey) → `MidnightSilver` · REALWORLD<br>Deep Blue Metallic → `DeepBlue` · REALWORLD<br>Red Multi-Coat (alias: Red) → `RedMulticoat` · REALWORLD<br>Custom paint override (5-float CSV R,G,B,metallic,roughness — arbitrary color, wins over named) → `<paint_color_override>` · GLOBAL | `PearlWhite` | always |
| 2 | Wheel | `wheel_type` | Pinwheel 18" aero (Model 3 base, with cover) — model3 default wheel → `Pinwheel18` · SOURCE<br>Pinwheel Refresh 18" aero → `PinwheelRefresh18` · REALWORLD<br>Pinwheel 18" cap removed (bare face) → `Pinwheel18CapKit` · REALWORLD<br>Stiletto 19" silver → `Stiletto19` · REALWORLD<br>Stiletto 20" silver → `Stiletto20` · REALWORLD<br>Stiletto 20" dark → `Stiletto20DarkSquare` · REALWORLD<br>Stiletto Refresh 19" → `StilettoRefresh19` · REALWORLD<br>Uberturbine 20" gunpowder (Model 3 Performance) → `UberTurbine20Gunpowder` · REALWORLD<br>Zero-G 19" gunpowder → `ZeroG19Gunpowder` · REALWORLD<br>Zero-G 20" gunpowder → `ZeroG20Gunpowder` · REALWORLD<br>Apollo 19" (aero-cap kit) → `Apollo19CapKit` · REALWORLD<br>Apollo 19" Metallic Shadow → `Apollo19MetallicShadow` · REALWORLD | `Pinwheel18` | always |
| 3 | Interior trim | `interior_trim_type` | All Black — original console (Interior_Seats_Black + Wood_Walnut decor) → `Black` · SOURCE<br>Black & White — original console (Interior_Seats_White + Decor_White) → `White` · SOURCE<br>All Black — 2021 refresh console (Center_Console_2_0) → `Black2` · SOURCE<br>Black & White — 2021 refresh console (Center_Console_2_0) → `White2` · SOURCE<br>Cream — accepted but renders generic (no bespoke cream material in 3_High; Model_3 has no Cream branch) → `Cream` · REALWORLD | `Black` | always |
| 4 | Exterior trim finish | `exterior_trim` | Black (blackout trim — Exterior_Hydroxide.material) → `Black` · SOURCE<br>Chrome (Exterior.material) → `Chrome` · SOURCE | `Black` | always |
| 5 | Headlamp / front-end + charge-cap geometry | `headlamp_type` | Original front-end (also the render for 'Premium' and any non-Global value) → `Original` · SOURCE<br>Global (swaps Headlights/Lights_Trunk/Charge_Cap to _GLOBAL nodes) → `Global` · SOURCE | `Original` | always |
| 6 | Rear spoiler | `spoiler_type` | None (no spoiler) → `None` · GLOBAL<br>Carbon Fiber spoiler (Spoiler1 shown) → `CarbonFiber` · GLOBAL | `None` | always |
| 7 | Fog / aux park lamps | `aux_park_lamps` | Fog lamps present — cover hidden (any non-'None' value, e.g. default 'NaPremium') → `NaPremium` · SOURCE<br>None — Foglights_Cover shown (no fog lamps) → `None` · SOURCE | `NaPremium` | always |
| 8 | Steering side (RHD/LHD) | `rhd` | LHD (left-hand drive) → `false` · SOURCE<br>RHD (right-hand drive) → `true` · SOURCE | `false` | always |
| 9 | Window tint | `window_tint_color` | Default tint (0,0,0,153) → `0,0,0,153` · GLOBAL<br>Lighter (0,0,0,128) → `0,0,0,128` · GLOBAL<br>Darker (0,0,0,190) → `0,0,0,190` · GLOBAL | `0,0,0,153` | always |
| 10 | Charge port / cable region (only visible while charging) | `charge_port_type` | US (NACS/Charging_Cable) → `US` · GLOBAL<br>EU (IEC/Type 2) → `EU` · GLOBAL<br>GB / GB_AC / GB_DC (IEC) → `GB` · GLOBAL<br>CCS (CCS2_V3) → `CCS` · GLOBAL | `US` | charger connected (Vehicle.update_charge_state adds cable only when isChargerConnected) |
| 11 | License-plate region | `eu_vehicle` | US plate (default) → `false` · GLOBAL<br>EU plate → `true` · GLOBAL | `false` | always |
| 12 | Brake calipers | `red_brake_calipers` | Standard (default) → `false` · SOURCE<br>Red performance calipers → `true` · SOURCE | `false` | always |

### 4.5 Model 3 — Highland Base (Poppyseed)

**Routing keys:** `car_type=model3` · `fascia_type=basePoppyseed` · `chassis_type=<ignored for Model 3 — not read by get_vehicle_node_path; any value routes the same>`


> ROUTING (SOURCE, ProductManager.get_vehicle_node_path, mobile/scripts/data/ProductManager.gd:119-160): car_type='model3' + fascia_type='basePoppyseed' -> res://Ego/v2023/Poppyseed/Poppyseed.tscn, script Ego/v2023/Poppyseed/script/Poppyseed.gd (extends mobile/scripts/Vehicles/Model_3.gd, which extends Vehicle.gd). chassis_type is NEVER read for Model 3. Any Model 3 fascia not in {basePoppyseed, performancePoppyseed, d50Poppyseed} (incl. 'original'/missing) routes instead to Ego/3_High/Model3_High.tscn (Model_3.gd) — a DIFFERENT generation node, out of scope here. fascia string->enum in Vehicle.update (Vehicle.gd:708-709): 'basePoppyseed' -> VehicleOptions.FasciaType.POPPYSEED_BASE(=1). FASCIA-DERIVED STATE for BASE (Poppyseed.gd set_fascia_type): is_perf=(type==POPPYSEED_PERF)=FALSE, is_d50=(type==POPPYSEED_D50)=FALSE. Consequences that PRUNE this node's questions vs the Perf/D50 siblings: (a) set_is_performance(false) shows base bumpers + base seats, hides perf bumpers/seats, and FORCES set_has_spoiler(false); (b) set_has_rear_display(type!=D50)=TRUE keeps the rear-screen center console; base keeps seat_buttom_lf/rf, tweeter_lf/rf, sill_plate visible (D50 hides them); (c) interior uses base (non-perf, non-textile) seat/decor materials. INTERIOR (Poppyseed.gd set_interior_config, FULL override — no super()): only branches White/White2 -> Decor_White + Interior_Seats_White, and Black/Black2 -> Decor_Black + Interior_Seats_Black. It does NOT call Model_3.gd's center_console1/2 / door_card1/2 refresh-console toggle (that override is bypassed), so Black vs Black2 (and White vs White2) render IDENTICALLY on Highland — the '2' refresh-console distinction is inert here. Cream / TacticalGrey / all *CarbonFiber values are UNHANDLED by Poppyseed (no branch) => seats_mat/decor_mat stay null => no material applied (effective no-op; keeps scene default). So this scene exposes exactly two real interior looks: Black and White. Confirmed scene materials present: Interior_Seats_Black/White/Textile, Decor_Black/White/Textile. EXTERIOR_TRIM GOTCHA (SOURCE): Poppyseed.gd set_exterior_trim maps Original->Exterior.material, Black->Exterior_Hydroxide.material. Exterior_Hydroxide.material does NOT exist in Ego/v2023/Poppyseed/, so the Black branch load() returns null and the function early-returns (no change). Net: only 'Chrome'(=ExteriorTrim.Original) actually re-skins the trim; 'Black' (also the wire DEFAULT) is a no-op that leaves the scene's authored trim. exterior_trim_override (if non-empty) takes precedence over exterior_trim (Poppyseed.update via Model_3.update path). HEADLAMP GOTCHA (SOURCE): Poppyseed.gd set_headlamp_type only STORES the value; set_turn_signal_l/r, set_drl_on, set_headlights_on, set_brake_lights_on are overridden to toggle their nodes UNCONDITIONALLY. Only set_fog_lights_on / set_reverse_lights_on branch on is_global (headlamp_type==Global) to pick fog_lights/fog_lights_global(+fog_rear_lights_global) and reverse_lights/reverse_lights_global. update() sets headlamp_type = Global if data.hasGlobalHeadlamp() else Original (Premium never selected at runtime). So headlamp_type's only visible effect on Highland base is the fog/reverse lamp geometry variant. WHEELS: SOURCE Highland asset group = Ego/v2023/Wheels/ (confirmed .tscn on disk: Glider.tscn, Helix_19.tscn, Wishbone_19.tscn, Wishbone_20.tscn, ZeroG_19.tscn). Mobile wire keys tied to that group by mesh path: Glider18->Glider.tscn, Helix19->Helix_19.tscn, Wishbone19Staggered->Wishbone_19.tscn, Wishbone20Staggered->Wishbone_20.tscn (Wishbone_20 is the Perf 20"). D5018 (Photon) is a Highland base wheel but its mesh path is res://Ego/Wheels/Wheel_D50.tscn (SHARED Ego/Wheels dir, not v2023) => REALWORLD narrowing, not asset-group SOURCE. Wheel resolution (Vehicle.gd:1278) is fully GLOBAL: any mobile wireKey renders on model3. When the wheel key is absent/unknown, DefaultWheelForVehicleType['model3']=WheelType.Pinwheel (SOURCE) — a legacy pre-Highland aero mesh (Ego/Wheels/Wheel_Pinwheel.tscn), NOT a v2023 wheel; that is the true renderer default for this car_type. EXCLUDED (no consumer on model3/Poppyseed): third_row_seats & rear_seat_type (Model_3 reads NEITHER -> no seating question); steering_wheel_type/Yoke, rearlight_type Global, has_tesla_badge/has_tesla_word_mark, car_special_type/Signature, drivetrain_type plaid-badge (all Palladium-only, i.e. lychee/tamarind). has_stalk and has_front_fascia_camera, which are global no-ops on most models, ARE live on Poppyseed (it overrides set_has_stalk/set_has_fascia_cam to toggle stalk/stalk_rhd and Fascia_Cam_D50 meshes) — so they appear here. COLORS: exterior_color is a single GLOBAL dict (VehicleOptions.ExteriorColorValue) with NO per-model gating; the renderer paints ANY of the 32 keys on model3. All per-color narrowing to the Highland palette below is REALWORLD (Tesla product knowledge), NOT renderer-enforced. SOURCE facts: default exterior_color string is 'PearlWhite' (VehicleData.gd) and FALLBACK_EXTERIOR_COLOR == SilverMetallic bytes for any unrecognized key. paint_color_override (5-float CSV 'r,g,b,metallic,roughness') replaces the named color when it has exactly 5 fields (Vehicle.gd:1387). Dev sample for Model 3 assigns GlacierBlue (LocalDevMessageInjector.gd:368) but its fascia is performancePoppyseed, not base.


| # | Question | Field | Options (label → value · provenance) | Default | Show-if |
|---|---|---|---|---|---|
| 1 | Exterior paint color | `exterior_color` | Pearl White Multi-Coat (SOURCE default value) → `PearlWhite` · REALWORLD<br>Stealth Grey (Highland signature grey) → `StealthGrey` · REALWORLD<br>Deep Blue Metallic → `DeepBlue` · REALWORLD<br>Solid Black → `SolidBlack` · REALWORLD<br>Ultra Red → `UltraRed` · REALWORLD<br>Quicksilver → `Quicksilver` · REALWORLD<br>Diamond Black (later Highland/refresh) → `DiamondBlack` · REALWORLD<br>Glacier Blue (dev-sample color for Model 3) → `GlacierBlue` · REALWORLD<br>Lunar Silver (region/newer, low-confidence) → `LunarSilver` · REALWORLD<br>Frost Blue (region/newer, low-confidence) → `FrostBlue` · REALWORLD<br>Silk Road Silver (China-market) → `SilkroadSilver` · REALWORLD<br>Marine Blue (region/newer, low-confidence) → `MarineBlue` · REALWORLD<br>Custom paint override (r,g,b,metallic,roughness — replaces named color; renderer accepts arbitrary color) → `paint_color_override:<5-float CSV>` · GLOBAL<br>Any other ExteriorColorValue key (renderer paints it; not a Highland real-world color) → `<any of the 32 global keys>` · GLOBAL | `PearlWhite` | always |
| 2 | Wheels | `wheel` | Glider 18" aero (Highland base aero — Ego/v2023/Wheels/Glider.tscn) → `Glider18` · SOURCE<br>Helix 19" (Highland — Ego/v2023/Wheels/Helix_19.tscn; distinct from S/X Helix) → `Helix19` · SOURCE<br>Wishbone 19" (Highland — Ego/v2023/Wheels/Wishbone_19.tscn) → `Wishbone19Staggered` · SOURCE<br>Wishbone 20" (Highland Performance wheel — Ego/v2023/Wheels/Wishbone_20.tscn) → `Wishbone20Staggered` · SOURCE<br>D50 / Photon 18" (Highland base wheel; MESH ANOMALY — lives in shared Ego/Wheels/Wheel_D50.tscn, not v2023) → `D5018` · REALWORLD<br>Pinwheel 18" (renderer default for car_type=model3; legacy pre-Highland aero) → `Pinwheel18` · SOURCE<br>Any other MobileWheelTypeEnumMap key (renders on model3; not Highland fitment) → `<any global wheel key>` · GLOBAL | `Pinwheel18` | always |
| 3 | Interior color | `interior_trim_type` | All Black (Decor_Black + Interior_Seats_Black) → `Black` · SOURCE<br>Black & White (Decor_White + Interior_Seats_White) → `White` · SOURCE<br>Black2 alias — renders identically to Black (refresh-console toggle inert on Poppyseed) → `Black2` · SOURCE<br>White2 alias — renders identically to White → `White2` · SOURCE<br>AllBlack / EbonyBlack aliases -> Black; BlackAndWhite / WalnutWhite aliases -> White → `AllBlack\|EbonyBlack\|BlackAndWhite\|WalnutWhite` · GLOBAL<br>Cream / *CarbonFiber / TacticalGrey (accepted by map but UNHANDLED on Poppyseed -> no-op) → `Cream\|CarbonBlack\|CarbonWhite\|CarbonCream\|TacticalGrey` · REALWORLD | `Black` | always |
| 4 | Body-trim finish (window surrounds / brightwork) | `exterior_trim (or exterior_trim_override, which takes precedence when non-empty)` | Chrome / bright (applies Exterior.material) → `Chrome` · SOURCE<br>Black (maps to Exterior_Hydroxide.material which does not exist -> no-op, keeps authored trim) → `Black` · SOURCE | `Black` | always |
| 5 | Fog / auxiliary park lamps | `aux_park_lamps` | Has fog lamps (any value != 'None'; cover hidden) → `NaPremium` · SOURCE<br>No fog lamps (blanking cover shown) → `None` · SOURCE | `NaPremium` | always |
| 6 | Rear spoiler | `spoiler_type` | None (base fascia has no spoiler) → `None` · SOURCE<br>CarbonFiber (base Vehicle would show it, but POPPYSEED_BASE forces spoiler off via set_is_performance(false)) → `CarbonFiber` · SOURCE | `None` | always |
| 7 | Turn-signal stalk (vs stalkless) | `has_stalk` | Stalkless (Highland default) → `false` · SOURCE<br>With turn stalk (shows Stalk or Stalk_RHD per handedness) → `true` · SOURCE | `false` | always |
| 8 | Front fascia camera | `has_front_fascia_camera` | No front fascia camera → `false` · SOURCE<br>Front fascia camera present (shows Fascia_Cam_D50) → `true` · SOURCE | `false` | always |
| 9 | Steering side (LHD / RHD) | `rhd` | Left-hand drive → `false` · GLOBAL<br>Right-hand drive → `true` · GLOBAL | `false` | always |
| 10 | Headlamp / market lighting variant | `headlamp_type` | Original / domestic (default; hasGlobalHeadlamp false) → `Original` · SOURCE<br>Global market (switches fog/reverse lamps to *_global nodes) → `Global` · SOURCE | `Original` | always |
| 11 | Badge finish | `badging_material_type` | Chrome / silver badges (Poppyseed default) → `0` · SOURCE<br>Black matte badges → `1` · GLOBAL | `CHROME_SILVER` | always |
| 12 | Brake calipers | `red_brake_calipers` | Standard calipers → `false` · GLOBAL<br>Red performance calipers → `true` · GLOBAL | `false` | always |
| 13 | Window tint | `window_tint_color` | Default tint (0,0,0,153) → `0,0,0,153` · GLOBAL<br>Custom 'r,g,b,a' (must be exactly 4 values) → `<r,g,b,a>` · GLOBAL | `0,0,0,153` | always |
| 14 | Charge port / cable standard | `charge_port_type` | US (Charging_Cable) → `US` · GLOBAL<br>EU (IEC) → `EU` · GLOBAL<br>GB / GB_AC / GB_DC (IEC) → `GB` · GLOBAL<br>CCS (CCS2_V3) → `CCS` · GLOBAL | `US` | always |
| 15 | License-plate region | `eu_vehicle` | US plate (default) → `false` · GLOBAL<br>EU plate → `true` · GLOBAL | `false` | always |

### 4.6 Model 3 — Highland Performance

**Routing keys:** `car_type=model3` · `fascia_type=performancePoppyseed` · `chassis_type=IGNORED for Model 3 routing (get_vehicle_node_path sub-branches Model 3 on fascia_type only); dev sample sends 'model_3'. Resolves to res://Ego/v2023/Poppyseed/Poppyseed.tscn (Poppyseed.gd)`


> SCENE/SCRIPT CONFIRMED ON DISK. car_type 'model3' + fascia_type 'performancePoppyseed' routes (ProductManager.get_vehicle_node_path) to res://Ego/v2023/Poppyseed/Poppyseed.tscn, script Ego/v2023/Poppyseed/script/Poppyseed.gd (extends mobile/scripts/Vehicles/Model_3.gd extends Vehicle). chassis_type is NOT read for Model 3 (dev sample sends 'model_3'). The Poppyseed.tscn scene is SHARED by all three Model 3 Highland fascias (basePoppyseed / performancePoppyseed / d50Poppyseed); the Performance identity comes purely from fascia_type -> FasciaType.POPPYSEED_PERF (=2, VehicleOptions.gd:9), which Poppyseed.set_fascia_type (Poppyseed.gd:140-155) turns into set_is_performance(true). PERFORMANCE FASCIA AUTO-DRIVES (not user questions): set_is_performance(true) (Poppyseed.gd:99-117) hides bumper_base_paths / shows bumper_perf_paths, hides seat_base_paths / shows seat_perf_paths, FORCES set_has_spoiler(true), and re-applies interior_config with the Perf seat/decor materials (Interior_Seats_Perf_Black/White.material confirmed present in scene dir). Because the spoiler is force-on for Performance, spoiler_type is NOT a question here. get_skin_file_path also switches to the Textures/Skins/Performance/ folder (Poppyseed.gd:284-288). WHEELS TIED TO THIS GENERATION BY ASSET GROUP (Ego/v2023/Wheels/, confirmed on disk: Glider.tscn, Helix_19.tscn, Wishbone_19.tscn, Wishbone_20.tscn): Glider18->WheelType.Glider, Helix19->WheelType.Helix19, Wishbone19Staggered->Wishbone_19, Wishbone20Staggered->Wishbone_20 — all SOURCE. D5018 (WheelType.D50_18) is the Highland base wheel by product naming but its mesh is the shared res://Ego/Wheels/Wheel_D50.tscn (NOT v2023) so it is REALWORLD, not asset-group-SOURCE. Wishbone20 (20in) is the real Performance wheel (REALWORLD). Renderer FALLBACK for an unknown/absent wheel on car_type model3 = DefaultWheelForVehicleType.model3 = WheelType.Pinwheel (legacy Ego/Wheels mesh), which is SOURCE-grounded but off-generation. NOTE the wheel map is fully GLOBAL — any of the 62 in-scope wireKeys renders on this car; only the asset-group tie and the model3 default are SOURCE. INTERIORS THIS SCENE ACTUALLY EXPOSES: Poppyseed.set_interior_config (Poppyseed.gd:157-188) FULLY OVERRIDES Model_3.set_interior_config with NO super() call, so the Model_3 is_new_interior center_console2 / door_card2 geometry NEVER runs on Poppyseed. Only two colors have material branches: White/White2 -> Decor_White + Interior_Seats_White(/_Perf_White); Black/Black2 -> Decor_Black + Interior_Seats_Black(/_Perf_Black). So Black2/White2 render identically to Black/White (SOURCE collapse). Cream (and every other InteriorConfig incl. TacticalGrey/Carbon*) has NO branch -> seats_mat/decor_mat stay null -> nothing applied (keeps default) -> Cream is a no-op on this scene. Exposed interiors = Black, White only. Under POPPYSEED_PERF the branch applies the Perf seat material to the fronts and the standard seat material to rear_seats (Poppyseed.gd:182-185). COLORS: exterior_color is a single GLOBAL dict (32 keys) applied to ANY car — the renderer does NOT restrict paint per model. The Highland palette below is REALWORLD narrowing (Tesla product knowledge), NOT renderer-enforced. Renderer default when field absent = literal 'PearlWhite'; dev sample (LocalDevMessageInjector) sends the Model 3 as GlacierBlue but that is a fixture, not a default. paint_color_override (5-float 'R,G,B,metallic,roughness' CSV) still overrides the named color on this car; two-tone is dead (has_two_toned_color()==false). EXCLUDED (do not apply to this node): seating_config — Model_3.gd reads NEITHER third_row_seats NOR rear_seat_type (both inert for Model 3; no 6/7-seat or Executive concept). steering_wheel_type/Yoke, rearlight_type(Global), has_tesla_badge, has_tesla_word_mark, car_special_type/SIGNATURE_SERIES, and the Plaid-badge behavior of drivetrain_type are ALL Palladium-only (lychee/tamarind) — no consumer on Model 3. spoiler_type — force-on by Performance, so not a user choice. has_stalk and has_front_fascia_camera, which are parse-only no-ops on most models, ARE live on Poppyseed (Poppyseed.gd:119-134,280-281) so they DO appear below. headlamp_type is consumed but on Poppyseed only re-gates fog/reverse global nodes (Poppyseed.gd:227-242); the front/charge-cap geometry swap that Model_3/3_High does is overridden away.


| # | Question | Field | Options (label → value · provenance) | Default | Show-if |
|---|---|---|---|---|---|
| 1 | Exterior paint color | `exterior_color` | Pearl White Multi-Coat (renderer default when field absent) → `PearlWhite` · SOURCE<br>Stealth Grey (signature Highland grey) → `StealthGrey` · REALWORLD<br>Solid Black → `SolidBlack` · REALWORLD<br>Deep Blue Metallic → `DeepBlue` · REALWORLD<br>Ultra Red → `UltraRed` · REALWORLD<br>Quicksilver → `Quicksilver` · REALWORLD<br>Diamond Black (later/refresh + regional) → `DiamondBlack` · REALWORLD<br>Glacier Blue (later/regional; dev fixture color for Model 3) → `GlacierBlue` · REALWORLD<br>Lunar Silver (low-confidence / regional) → `LunarSilver` · REALWORLD<br>Frost Blue (low-confidence / regional) → `FrostBlue` · REALWORLD<br>Silk Road Silver (China-market) → `SilkroadSilver` · REALWORLD<br>Marine Blue (low-confidence / China-market) → `MarineBlue` · REALWORLD<br>Custom paint (5-float 'R,G,B,metallic,roughness' via paint_color_override) → `<paint_color_override CSV>` · GLOBAL | `PearlWhite` | always |
| 2 | Wheel | `wheel (mobile wireKey -> VehicleOptions.MobileWheelTypeEnumMap)` | Wishbone 20" (Performance wheel; Ego/v2023/Wheels/Wishbone_20) → `Wishbone20Staggered` · SOURCE<br>Wishbone 19" (Ego/v2023/Wheels/Wishbone_19) → `Wishbone19Staggered` · SOURCE<br>Helix 19" (Ego/v2023/Wheels/Helix_19) → `Helix19` · SOURCE<br>Glider 18" aero (Highland base; Ego/v2023/Wheels/Glider) → `Glider18` · SOURCE<br>D50 18" (Highland base wheel; mesh in shared Ego/Wheels/Wheel_D50, not v2023) → `D5018` · REALWORLD<br>Pinwheel 18" (legacy Model 3 default / renderer fallback for model3) → `Pinwheel18` · SOURCE | `Wishbone20Staggered` | always |
| 3 | Interior color | `interior_trim_type` | All Black (Perf black seats + Decor_Black) → `Black` · SOURCE<br>Black & White (Perf white seats + Decor_White) → `White` · SOURCE<br>Black2 (alias -> renders identical to Black; no refresh-console geometry on Poppyseed) → `Black2` · SOURCE<br>White2 (alias -> renders identical to White) → `White2` · SOURCE | `Black` | always |
| 4 | Exterior trim finish | `exterior_trim (or exterior_trim_override, which takes precedence when non-empty)` | Black / Hydroxide trim (Highland spec) → `Black` · SOURCE<br>Chrome / body trim (Exterior.material; off-spec for Highland) → `Chrome` · SOURCE | `Black` | always |
| 5 | Front fog / auxiliary park lamps | `aux_park_lamps` | Has fog lamps (cover hidden) — any value != 'None', e.g. NaPremium → `NaPremium` · SOURCE<br>No fog lamps (blanking cover shown) → `None` · SOURCE | `NaPremium` | always |
| 6 | Turn-signal stalk fitted | `has_stalk` | Stalk fitted → `true` · SOURCE<br>No stalk (stalkless Highland) → `false` · SOURCE | `false` | always |
| 7 | Front fascia camera | `has_front_fascia_camera` | Front fascia camera present → `true` · SOURCE<br>No front fascia camera → `false` · SOURCE | `false` | always |
| 8 | Headlamp / lighting market variant | `headlamp_type` | Original / US-spec (default) → `Original` · SOURCE<br>Global / non-US lighting → `Global` · SOURCE | `Premium (coerced to Original at runtime)` | always |
| 9 | Steering side (LHD / RHD) | `rhd` | Left-hand drive → `false` · GLOBAL<br>Right-hand drive → `true` · GLOBAL | `false` | always |
| 10 | Badge finish | `badging_material_type` | Chrome / silver badging → `0` · GLOBAL<br>Black matte badging → `1` · GLOBAL | `CHROME_SILVER (0) — seeded in Poppyseed._enter_tree; if field <0 it is auto-derived from badge_version (<=V1 -> chrome, else black matte)` | always |
| 11 | Window tint | `window_tint_color` | Default tint → `0,0,0,153` · GLOBAL<br>Custom RGBA tint (4 values 0-255) → `<r,g,b,a>` · GLOBAL | `0,0,0,153` | always |
| 12 | Charge port / cable region | `charge_port_type` | US (NACS / Charging_Cable) → `US` · GLOBAL<br>EU (IEC / CCS2) → `EU` · GLOBAL<br>GB → `GB` · GLOBAL<br>CCS → `CCS` · GLOBAL | `US` | always (cable mesh only spawns while a charger is connected) |
| 13 | License-plate region | `eu_vehicle` | US plate (default) → `false` · GLOBAL<br>EU plate → `true` · GLOBAL | `false` | always |
| 14 | Brake calipers | `red_brake_calipers` | Standard (default) → `false` · SOURCE<br>Red performance calipers → `true` · SOURCE | `false` | always |

### 4.7 Model 3 — Highland D50

**Routing keys:** `car_type=model3` · `fascia_type=d50Poppyseed` · `chassis_type=model_3 (parsed but IGNORED for Model 3 routing; only Model Y reads chassis_type)`


> ROUTING (SOURCE, ProductManager.gd:119-134): match on car_type "model3" then match fascia_type; "d50Poppyseed" is inside the {basePoppyseed, performancePoppyseed, d50Poppyseed} arm -> res://Ego/v2023/Poppyseed/Poppyseed.tscn. chassis_type is NEVER read for Model 3 (only Model Y reads chassis). Vehicle.gd:712-713 maps the string "d50Poppyseed" -> VehicleOptions.FasciaType.POPPYSEED_D50 (=9), consumed by Poppyseed.set_fascia_type. D50 FASCIA AUTO-DRIVES (SOURCE, Poppyseed.gd:140-155, set_fascia_type(POPPYSEED_D50)): (a) set_is_performance(false) -> base bumpers/base seats shown, perf hidden, and set_has_spoiler(FALSE) is forced -> on D50 the spoiler is ALWAYS OFF regardless of spoiler_type wire value (that is why spoiler_type is not a question below). (b) set_has_rear_display(false) -> center_console (rear-passenger display) hidden, center_console_no_display shown. (c) is_d50 -> seat_buttom_lf/rf hidden, seat_buttom_d50_lf/rf shown, tweeter_lf/rf hidden, sill_plate hidden. All target nodes confirmed present in Poppyseed.tscn (center_console_no_display_path, seat_buttom_d50_lf/rf_path, tweeter_lf/rf_path, sill_plate_path lines 448-456). INTERIOR COLLAPSE ON D50 (SOURCE, Poppyseed.gd:157-188): Poppyseed OVERRIDES set_interior_config and does NOT call the Model_3 super, so the Model_3 is_new_interior / center_console2 refresh-console geometry (the usual Black2/White2 behavior) DOES NOT run on any Poppyseed scene. Further, the is_d50 branch (165-168) forces Decor_Textile.material + Interior_Seats_Textile.material for EVERY interior_config value. Net effect: on D50, interior_trim_type Black / White / Cream / Black2 / White2 all render the SAME textile interior — the interior question is cosmetically inert here. It is still parsed and still routes through the InteriorMap, so it is retained below with a hard note. WHEELS (VehicleOptions.gd MobileWheelTypeEnumMap + WheelTypeToPathMap): the Highland asset group is Ego/v2023/Wheels (SOURCE tie): Glider18->Glider, Helix19->Helix19, Wishbone19Staggered->Wishbone_19, Wishbone20Staggered->Wishbone_20. D5018->D50_18 is the D50 namesake wheel but its mesh is the shared res://Ego/Wheels/Wheel_D50.tscn (NOT v2023) -> narrowing is REALWORLD, not asset-group SOURCE. The renderer does NOT gate wheels per model — any wireKey renders on any car; legacy Model-3 wheels (Pinwheel18, PinwheelRefresh18, Apollo19CapKit, Stiletto*, ZeroG*) still render but are pre-Highland (REALWORLD, not this generation) so are omitted from the primary set. FALLBACK: if wheel_type is absent/unknown, set_wheel_type_by_name_with_vehicle_default falls back to DefaultWheelForVehicleType["model3"] = WheelType.Pinwheel (SOURCE) — a legacy aero, NOT a Highland wheel. Because that renderer default is off-generation, the recommended question default is D5018 (the D50 variant's matching wheel); an app that omits wheel_type will actually get Pinwheel. COLORS: renderer applies ANY of the 32 ExteriorColorValue keys to ANY car with no per-model gating (GLOBAL); the list below is REALWORLD-narrowed to the Model 3 Highland palette. Field-absent default is the literal string "PearlWhite" (SOURCE, VehicleData default + VehicleOptions FALLBACK). paint_color_override (5-float CSV r,g,b,metallic,roughness) replaces the named color when it splits to exactly 5 values (Vehicle.gd:1387). Two-tone is dead on all S/3/X/Y (has_two_toned_color()==false). EXCLUDED (do not apply to this generation): steering_wheel_type/Yoke, special_badging_type/Signature, rearlight_type Global, has_tesla_badge, has_tesla_word_mark, drivetrain_type Plaid-badge — ALL are Palladium-only (lychee/tamarind); Poppyseed has no setter for any of them. third_row_seats + rear_seat_type — Model 3 reads NEITHER field (no seat-count concept). spoiler_type — inert on D50 (forced off). chassis_type — ignored by Model 3 routing. LIVE-ONLY-HERE (SOURCE, Poppyseed-specific): has_stalk (Poppyseed.gd:119-125,280) and has_front_fascia_camera (Poppyseed.gd:127-129,281) are global no-op fields on every OTHER model but are actually consumed by Poppyseed, so they ARE real questions here. headlamp_type on Poppyseed only stores the value and swaps fog/reverse global-vs-original geometry (Poppyseed.gd:223-242); it does NOT swap the whole front end the way 3_High/Model_3 does — most lamp setters were overridden to show both nodes unconditionally (244-270).


| # | Question | Field | Options (label → value · provenance) | Default | Show-if |
|---|---|---|---|---|---|
| 1 | Exterior paint color | `exterior_color` | Pearl White Multi-Coat (renderer default) → `PearlWhite` · REALWORLD<br>Stealth Grey (Highland standard) → `StealthGrey` · REALWORLD<br>Deep Blue Metallic → `DeepBlue` · REALWORLD<br>Solid Black → `SolidBlack` · REALWORLD<br>Ultra Red → `UltraRed` · REALWORLD<br>Quicksilver → `Quicksilver` · REALWORLD<br>Midnight Silver Metallic (early/carryover) → `MidnightSilver` · REALWORLD<br>Diamond Black (refresh, low-confidence) → `DiamondBlack` · REALWORLD<br>Glacier Blue (low-confidence; Model 3 dev-sample color) → `GlacierBlue` · REALWORLD | `PearlWhite` | always |
| 2 | Custom paint override (advanced) — replaces the named color | `paint_color_override` | None — use named exterior_color → `` · GLOBAL<br>Custom 5-float CSV e.g. 20,20,20,0.6,0.1 → `R,G,B,metallic,roughness` · GLOBAL | `` | always (optional; leave empty to keep the named exterior_color) |
| 3 | Wheels | `wheel_type` | D50 / Photon 18" (D50 namesake base wheel; mesh in shared Ego/Wheels) → `D5018` · REALWORLD<br>Glider 18" aero (Highland base, Ego/v2023/Wheels) → `Glider18` · SOURCE<br>Helix 19" (Highland, Ego/v2023/Wheels) → `Helix19` · SOURCE<br>Wishbone 19" (Highland, Ego/v2023/Wheels) → `Wishbone19Staggered` · SOURCE<br>Wishbone 20" (Highland Performance wheel, Ego/v2023/Wheels) → `Wishbone20Staggered` · SOURCE | `D5018` | always |
| 4 | Interior trim | `interior_trim_type` | Black (renders textile on D50) → `Black` · SOURCE<br>White (renders textile on D50) → `White` · SOURCE<br>Black2 (refresh-console value; NO console swap on Poppyseed, renders textile) → `Black2` · SOURCE<br>White2 (refresh-console value; NO console swap on Poppyseed, renders textile) → `White2` · SOURCE | `Black` | always |
| 5 | Exterior trim finish | `exterior_trim` | Black trim (Highland default) → `Black` · SOURCE<br>Chrome trim → `Chrome` · SOURCE | `Black` | always (overridden by exterior_trim_override when that is non-empty) |
| 6 | Right-hand drive? | `rhd` | LHD (left-hand drive) → `false` · GLOBAL<br>RHD (right-hand drive) → `true` · GLOBAL | `false` | always |
| 7 | Show turn-signal stalk? | `has_stalk` | No stalk (Highland stalkless) → `false` · SOURCE<br>Show stalk → `true` · SOURCE | `false` | always |
| 8 | Show front fascia camera? | `has_front_fascia_camera` | No fascia camera → `false` · SOURCE<br>Show fascia camera → `true` · SOURCE | `false` | always |
| 9 | Fog / auxiliary park lamps | `aux_park_lamps` | Fog lamps present (cover hidden) → `NaPremium` · SOURCE<br>None — show fog-lamp cover (no fog lamps) → `None` · SOURCE | `NaPremium` | always |
| 10 | Headlamp type | `headlamp_type` | Premium (renders Original geometry) → `Premium` · SOURCE<br>Original → `Original` · SOURCE<br>Global (swaps only fog/reverse lamps to global nodes) → `Global` · SOURCE | `Premium` | always |
| 11 | Badging material | `badging_material_type` | Chrome / Silver → `0` · GLOBAL<br>Black matte → `1` · GLOBAL | `0 (CHROME_SILVER; Poppyseed._enter_tree seeds CHROME_SILVER)` | always |
| 12 | Window tint | `window_tint_color` | Default tint 0,0,0,153 → `0,0,0,153` · GLOBAL<br>Lighter 0,0,0,128 → `0,0,0,128` · GLOBAL<br>Darker 0,0,0,190 → `0,0,0,190` · GLOBAL | `0,0,0,153` | always |
| 13 | Red / performance brake calipers? | `red_brake_calipers` | Standard brakes → `false` · GLOBAL<br>Performance / red calipers → `true` · GLOBAL | `false` | always |
| 14 | Charge port / cable type | `charge_port_type` | US (NACS/Charging_Cable) → `US` · GLOBAL<br>EU (IEC/Type 2) → `EU` · GLOBAL<br>GB → `GB` · GLOBAL<br>CCS → `CCS` · GLOBAL | `US` | always (cable mesh only instanced while a charger is connected) |
| 15 | License-plate region | `eu_vehicle` | US plate (default) → `false` · GLOBAL<br>EU plate → `true` · GLOBAL | `false` | always |

### 4.8 Model X — Classic

**Routing keys:** `car_type=modelx` · `fascia_type=n/a (not read for Model X)` · `chassis_type=n/a (not read for Model X)`


> ROUTING (SOURCE, ProductManager.get_vehicle_node_path): car_type='modelx' selects the scene by car_type ALONE — fascia_type and chassis_type are never read for any Model X. Scene res://Ego/X/Model_X.tscn, script Model_X.gd. The Palladium/refresh Model X is a SEPARATE node (car_type='tamarind' → X_Palladium); do NOT confuse. VIN[3]='X' decodes to 'modelx' (this classic scene), never to tamarind. NOTE the dev sample _vehicle_config_model_x in LocalDevMessageInjector.gd actually sends car_type='tamarind' (Palladium), so there is NO dev fixture exercising the legacy modelx scene. MODEL_X.gd IS BASE-ONLY. It extends Vehicle (not Palladium). Confirmed absent from Model_X.gd: any headlamp_type handler (headlamp_type is a renderer NO-OP on classic X — Original/Premium/Global all render identical), any rearlight_type handler, steering_wheel_type/yoke, special_badging (car_special_type), drivetrain/plaid badge, tesla badge/wordmark, aux_park_lamps (fog cover is Model_3/Model_Y only), and any carbon-fiber/wood interior decor (Palladium-only). Those questions are therefore EXCLUDED from this node. PROVENANCE FRAME. The renderer gates almost nothing per-model: exterior_color (all 32 keys in one global dict), most wheels, interior aliases, window tint, charge port, paint override all render on ANY car. So: exterior_color options are labeled REALWORLD (narrowed to what classic Model X actually shipped — renderer accepts any of the 32). Wheels are SOURCE because the classic-X mesh set lives in the Ego/Wheels_X_S asset group (Model S/X classic) and modelx's default is set in DefaultWheelForVehicleType. Interior Black/White/Cream are SOURCE (base set_interior_config arms + Interior_Black/White/Cream.material files confirmed present in Ego/X/). Seating and exterior_trim_override are SOURCE (Model_X.gd script branches + confirmed scene nodes). EXTERIOR_COLOR detail: renderer applies ANY of the 32 keys (single global ExteriorColorValue map, no per-car filter; unknown string → FALLBACK medium silver #161616). Default when field absent = literal 'PearlWhite'. Classic-X REALWORLD palette below is the legacy pre-2021 S/X set. Palladium-era colors that the renderer still accepts on this scene but that belong to the tamarind refresh generation (MidnightCherryRed, Quicksilver, UltraRed, GarnetRed) are intentionally excluded from the curated list. paint_color_override (5-float 'R,G,B,metallic,roughness' CSV) replaces the named color when it splits to exactly 5 values (wrong-size CSV ignored). Two-tone is dead on S/3/X/Y (has_two_toned_color hard-false) — override is a full single-color replacement, not a second tone. WHEELS detail: classic-X wheels are the Ego/Wheels_X_S group (SOURCE). Confirmed .tscn files present: Wheel_Aero, Wheel_Slipstream_Silver, Wheel_Slipstream_Sonic_Carbon, Wheel_Slipstream_Two_Tone, Wheel_Arachnid_Silver, Wheel_Arachnid_Armor_Black, Wheel_Arachnid_Sonic_Carbon, Wheel_Base_Silver, Wheel_Turbine_Onyx_Black, Wheel_Turbine_Silver, Wheel_Cyclone_Sonic_Carbon, Wheel_Helix_Silver, Wheel_Tempest_Sonic_Silver, Wheel_Twin_Turbine_Silver, Wheel_Twin_Turbine_Sonic_Carbon. Default (unknown/absent wireKey) → DefaultWheelForVehicleType['modelx'] = WheelType.SlipstreamSilver (VehicleOptions.gd:180); the explicit wireKeys that resolve to it are AeroTurbine19 / AeroTurbine20. Many wireKeys collapse to one mesh (size labels are cosmetic and discarded): Silver21/Silver21Euro/Super21Silver/Turbine19/Turbine22 → TurbineSilver; Charcoal21/Charcoal21Euro/Super21Gray/Turbine19Dark/Turbine22Dark → TurbineBlack; Slipstream19Carbon/Slipstream20Carbon/AeroTurbine19Black → SlipstreamCarbon; AeroTurbine20Dark/Slipstream20Dark → SlipstreamDark. EXCLUDED as Palladium-refresh (Ego/Wheels_Palladium, belong to tamarind): Arachnid21, Cyberstream20, Cardenio19, NewTurbine22Black. Any wireKey renders on any car (GLOBAL), but only the Wheels_X_S group is SOURCE-tied to classic S/X. INTERIOR detail: base Vehicle.set_interior_config handles 3 seat colors — Black→Interior_Black, White→Interior_White, Cream→Interior_Cream (all three .material files confirmed in Ego/X/). Aliases (GLOBAL, resolve identically): AllBlack/EbonyBlack→Black; BlackAndWhite/WalnutWhite→White; WalnutCream→Cream. Black2/White2 render as PLAIN Black/White on classic X (the is_new_interior refresh-console branch exists only in Model_3/Model_Y — no center_console2 node here). CarbonBlack/CarbonWhite/CarbonCream render as plain Black/White/Cream (carbon+wood decor is Palladium-only). TacticalGrey = no-op (no arm anywhere) — Cybertruck interior. REALWORLD: classic Model X shipped Black / Black-and-White / Cream; the renderer accepts the rest. SEATING detail (Model_X.gd:92-101, SOURCE, scene nodes Interior_5_seater(+_RHD), Interior_6_Seater(+_RHD), Interior_7_Seater(+_RHD) all confirmed): has_3_rows = third_row_seats != NONE. No 3rd row → 5-seat (rear_seat_type IGNORED). With a 3rd row → rear_seat_type is the tiebreaker: TWO_SEAT(3) → 6-seat; everything else (BASE/RECARO/EXECUTIVE/FOLD_FLAT) → 7-seat. CRITICAL divergence from X-Palladium: on classic X, EXECUTIVE(2) is NOT special-cased — it does NOT force a 3rd row and yields a 7-seat when a 3rd row is otherwise present (there is no executive interior on classic X — that is a Model S feature). GOTCHA: third_row_seats='<invalid>' maps to INVALID(0) which is != NONE, so it PRODUCES a 3rd row (renders 6/7-seat), whereas only 'None' (or an unrecognized string hitting the map default) yields 5-seat. rear_seat_type has NO string→enum map — the app must send the raw int; out-of-range ints behave like BASE → 7-seat. set_rhd on classic X re-runs set_seat_count so RHD swaps to the *_RHD interior mesh. FORCED/AUTO behaviors on classic X: spoiler is ALWAYS on — Model_X.set_default_state and update() both call set_has_spoiler(true) unconditionally, overriding the spoiler_type wire field (spoiler_type is effectively inert here). Turn signals are simple on/off (Model_X overrides set_turn_signal_l/r_state) — NOT headlamp-gated and NOT brake-coupled (unlike Model 3/Y). Rear doors use the falcon-wing top animations (LRDoorAnimationTop/RRDoorAnimationTop). exterior_trim_override IS consumed by Model_X.update (Exterior.material vs Exterior_Black_Trim_Colorizer.material); the base exterior_trim field is not read by X (override is the only path; empty string early-returns/ignored). GLOBAL fields still available (base Vehicle, apply to classic X, not per-model gated): window_tint_color ('r,g,b,a' 0-255, exactly 4 values or ignored, default '0,0,0,153'), charge_port_type (US/EU/GB/GB_AC/GB_DC/CCS → cable, only spawns while charger connected; default US), badging_material_type (CHROME_SILVER/BLACK_MATTE; <0 auto-derives from badge_version; visible only if scene defines badging materials), rhd, paint_color_override, colorizer_color_remap_enabled. NO-OP parsed-but-unused fields: has_stalk, has_front_fascia_camera.


| # | Question | Field | Options (label → value · provenance) | Default | Show-if |
|---|---|---|---|---|---|
| 1 | Exterior paint color | `exterior_color` | Pearl White Multi-Coat (default) → `PearlWhite` · REALWORLD<br>Solid Black (aliases: Black, MetallicBlack/Obsidian) → `SolidBlack` · REALWORLD<br>Midnight Silver Metallic (aliases: Grey, SteelGrey) → `MidnightSilver` · REALWORLD<br>Silver Metallic — legacy (alias: Silver; = fallback color) → `SilverMetallic` · REALWORLD<br>Deep Blue Metallic → `DeepBlue` · REALWORLD<br>Red Multi-Coat (alias: Red) → `RedMulticoat` · REALWORLD<br>Titanium Metallic — legacy warm grey (alias: Titanium) → `TitaniumCopper` · REALWORLD<br>Ocean/Metallic Blue — legacy → `Blue` · REALWORLD<br>Solid White — legacy non-pearl → `White` · REALWORLD<br>Pearl — low-metallic white variant → `Pearl` · REALWORLD<br>Green — legacy special-order → `Green` · REALWORLD<br>Brown — legacy special-order → `Brown` · REALWORLD<br>Signature Red → `SigRed` · REALWORLD<br>Signature Blue → `SignatureBlue` · REALWORLD | `PearlWhite` | always |
| 2 | Wheels | `wheel_type` | Slipstream Silver — 19/20in (classic X default; wireKey AeroTurbine20 also) → `AeroTurbine19` · SOURCE<br>Slipstream Sonic Carbon (dark) → `Slipstream19Carbon` · SOURCE<br>Slipstream Two-Tone / Dark → `AeroTurbine20Dark` · SOURCE<br>Aero — classic base aero → `Aero19` · SOURCE<br>Base Silver → `Base19` · SOURCE<br>Helix Silver (S/X classic Helix mesh) → `Helix20` · SOURCE<br>Cyclone Sonic Carbon → `Cyclone19Dark` · SOURCE<br>Tempest Sonic Silver → `Tempest19SonicSilver` · SOURCE<br>Turbine Silver — 21/22in (aliases Silver21/Turbine19/Turbine22) → `Silver21` · SOURCE<br>Turbine Onyx Black — 21/22in (aliases Charcoal21/Turbine22Dark) → `Charcoal21` · SOURCE<br>Twin Turbine Silver — 21in → `TwinTurbine21Silver` · SOURCE<br>Twin Turbine Sonic Carbon — 21in → `TwinTurbine21Carbon` · SOURCE<br>Arachnid Silver — 21in (classic Arachnid mesh) → `Arachnid21Silver` · SOURCE<br>Arachnid Armor Black — 21in → `Arachnid21Black` · SOURCE<br>Arachnid Sonic Carbon (grey) — 21in → `Arachnid21Grey` · SOURCE | `AeroTurbine19` | always |
| 3 | Interior color | `interior_trim_type` | All Black (default; aliases AllBlack, EbonyBlack) → `Black` · SOURCE<br>Black & White (aliases BlackAndWhite, WalnutWhite) → `White` · SOURCE<br>Cream (alias WalnutCream) → `Cream` · SOURCE | `Black` | always |
| 4 | Third-row seats (does the car have a 3rd row?) | `third_row_seats` | None — 5-seat (default) → `None` · SOURCE<br>Futuris Fold-Flat 3rd row → `FuturisFoldFlat` · SOURCE<br>Futuris (no fold-flat) 3rd row → `FuturisNoFoldFlat` · SOURCE<br>Flat-Fold 3rd row → `FlatFold` · SOURCE<br>'<invalid>' — GOTCHA: still yields a 3rd row (INVALID != NONE) → `<invalid>` · SOURCE | `None` | always |
| 5 | Rear-seat layout (6- vs 7-seat) | `rear_seat_type` | Base → 7-seat (default) → `0` · SOURCE<br>Two-Seat (captain's chairs) → 6-seat → `3` · SOURCE<br>Recaro → 7-seat (not special-cased) → `1` · SOURCE<br>Executive → 7-seat on classic X (NOT special here) → `2` · SOURCE<br>Fold-Flat → 7-seat (not special-cased) → `4` · SOURCE | `0` | third_row_seats != 'None' (and != any value mapping to NONE) |
| 6 | Exterior trim finish | `exterior_trim_override` | Default (unset — leave scene default trim) → `` · SOURCE<br>Chrome (bright trim) → `Chrome` · SOURCE<br>Black (blacked-out trim) → `Black` · SOURCE | `` | always |
| 7 | Right-hand drive? | `rhd` | LHD (left-hand drive, default) → `false` · GLOBAL<br>RHD (right-hand drive) → `true` · GLOBAL | `false` | always |
| 8 | Window tint | `window_tint_color` | Default (~60% alpha) → `0,0,0,153` · GLOBAL<br>Light tint → `0,0,0,128` · GLOBAL<br>Medium tint → `0,0,0,170` · GLOBAL<br>Dark tint → `0,0,0,190` · GLOBAL | `0,0,0,153` | always |
| 9 | Charge-port / cable region | `charge_port_type` | US (NACS/Charging_Cable, default) → `US` · GLOBAL<br>EU (Type 2 / IEC) → `EU` · GLOBAL<br>GB → `GB` · GLOBAL<br>CCS (CCS2) → `CCS` · GLOBAL | `US` | always |
| 10 | License-plate region | `eu_vehicle` | US plate (default) → `false` · GLOBAL<br>EU plate → `true` · GLOBAL | `false` | always |
| 11 | Brake calipers | `red_brake_calipers` | Standard (default) → `false` · SOURCE<br>Red performance calipers → `true` · SOURCE | `false` | always |

### 4.9 Model X — Refresh / Palladium (tamarind)

**Routing keys:** `car_type=tamarind` · `fascia_type=(ignored for X — get_vehicle_node_path routes by car_type alone; wire default 'original', dev sample sends 'original')` · `chassis_type=(ignored for X — never read; wire default 'model_y', dev sample sends 'model_x')`


> SCENE/SCRIPT (SOURCE): car_type 'tamarind' routes by car_type ALONE (fascia_type and chassis_type are never read for X) to res://Ego/X_Palladium/X_Palladium.tscn, driven by Model_X_Palladium.gd (extends Palladium.gd extends Vehicle.gd). Confirmed in mobile/scripts/data/ProductManager.gd:135 and on disk. Default wheel for tamarind = WheelType.Cyberstream (VehicleOptions.gd:181). Renderer scale ProductManager.gd:22 tamarind=0.93. PALLADIUM-ONLY LOOK LEVERS present on this node (SOURCE, exist only because Palladium.gd/Model_X_Palladium.gd implement them): yoke steering wheel, Global rear-light body/trunk/chargeport swap + Tesla badge/wordmark gating, Global headlamp front-light swap, Signature-Series node group + signature brakes + plaid-badge-signature, drivetrain Plaid badge, and carbon-fiber + wood (Ebony/Walnut) interior decor with sport seats. Verified materials in Ego/X_Palladium: Interior_Seats_{Black,White,Cream}.material, Wood_Ebony.material, Wood_Walnut.material, Carbon_Fiber.material; steering_wheel_standard(+rhd)/steering_wheel_yoke(+rhd) nodes; PlaidBadge / PlaidBadge_Signature materials; 5/6(L,C,R)/7-seater interior nodes. CROSS-DIM GATING (SOURCE): (a) rearlight_type=Global(2) is the gate for has_tesla_badge and has_tesla_word_mark — both meshes render ONLY when has_global_rearlight() is true AND the flag is true (Palladium.gd:378-398); Global also relocates the charge port to chargeport_locator_global and uses chargeport_global_animation. (b) Seat count: setup_seat_config (Model_X_Palladium.gd:69-78) has_3_rows = third_row_seats!=NONE OR rear_seat_type==EXECUTIVE; then rear_seat_type in {TWO_SEAT, EXECUTIVE, null} -> 6-seat, else -> 7-seat; no 3rd row -> 5-seat. EXECUTIVE ALONE forces 3 rows + 6-seat even with third_row_seats='None' (this is the one X-Palladium-specific twist vs legacy Model_X, which never special-cases EXECUTIVE). (c) Signature brakes load only when car_special_type=SIGNATURE_SERIES AND red_brake_calipers=true (Palladium.gd:290-311). (d) drivetrain plaid badge only when Plaid AND not Signature (Palladium.gd:186-192); drivetrain_type parsed with +1 offset (wire 2 -> AWDTriMotor/Plaid, VehicleData.gd:75). EXCLUDED / NO-OP on tamarind (deliberately NOT asked): spoiler_type — Model_X_Palladium.update forces set_has_spoiler(true) unconditionally (:47,:51), so spoiler is always on regardless of wire. exterior_trim / exterior_trim_override — no consumer in Palladium (no-op on tamarind). aux_park_lamps/fog cover — only Model_3/Model_Y read it. has_stalk, has_front_fascia_camera — parsed but zero consumers anywhere (no-op). fascia_type string — for X the P3 mapping only fires on 'p3x' which hits FasciaType.P3ModelX and returns early with no group toggle (Palladium.gd:200), and the X_Palladium scene has no p3_fascia/original_fascia groups, so fascia is inert for the X look. Interior Black2/White2 — collapse to plain Black/White on Palladium (the is_new_interior refresh console exists only in Model_3.gd/Model_Y.gd). Interior TacticalGrey — no set_interior_config arm -> no-op. Rear-door open uses falcon-wing LRDoorAnimationTop/RRDoorAnimationTop (Model_X_Palladium.gd:80-88). PROVENANCE: exterior_color and window_tint/charge_port/badging_material/red_brake_calipers/rhd are GLOBAL maps the renderer applies to ANY car — no per-model gating. The color option list below is REALWORLD narrowing (which paints the 2021+ Model X refresh actually shipped); ALL 32 ExteriorColor keys render on tamarind, and a 5-float 'R,G,B,metallic,roughness' paint_color_override (exactly 5 CSV fields) overrides the named color entirely (GLOBAL). Wheels/interior/steering/lights/seats narrowing IS SOURCE-grounded (Wheels_Palladium asset group, per-model script branches, scene nodes, and DefaultWheelForVehicleType.tamarind).


| # | Question | Field | Options (label → value · provenance) | Default | Show-if |
|---|---|---|---|---|---|
| 1 | Exterior paint color | `exterior_color` | Pearl White Multi-Coat (default; also the renderer parse default) → `PearlWhite` · REALWORLD<br>Solid Black → `SolidBlack` · REALWORLD<br>Midnight Silver Metallic → `MidnightSilver` · REALWORLD<br>Deep Blue Metallic → `DeepBlue` · REALWORLD<br>Red Multi-Coat → `RedMulticoat` · REALWORLD<br>Quicksilver (2023+ refresh premium) → `Quicksilver` · REALWORLD<br>Ultra Red (2023+) → `UltraRed` · REALWORLD<br>Midnight Cherry Red (2023+ Plaid-era) → `MidnightCherryRed` · REALWORLD<br>Any of the 32 ExteriorColor keys / custom 5-float paint_color_override — renderer applies any to tamarind (not gated) → `<any ExteriorColor key or R,G,B,metallic,roughness>` · GLOBAL | `PearlWhite` | always |
| 2 | Wheels | `wheel_type` | 20" Cyberstream — X refresh base (Wheels_Palladium; tamarind default) → `Cyberstream20` · SOURCE<br>22" New Turbine Black (Wheels_Palladium; S/X refresh) → `NewTurbine22Black` · SOURCE<br>21" Arachnid (Wheels_Palladium/Arachnid21.tscn; S/X refresh — realworld chiefly S Plaid) → `Arachnid21` · SOURCE<br>Any other mobile wheel wireKey also renders (e.g. Cardenio19 is the same Wheels_Palladium group but a Model S base wheel; classic Wheels_X_S / 3/Y / Juniper keys render too, not asset-tied to this generation) → `<any MobileWheelTypeEnumMap key>` · GLOBAL | `Cyberstream20` | always |
| 3 | Interior trim (seat color + decor) | `interior_trim_type` | Black — seats + Ebony wood decor → `Black` · SOURCE<br>Black & White — seats + Walnut wood decor → `White` · SOURCE<br>Cream — seats + Walnut wood decor → `Cream` · SOURCE<br>Black + Carbon Fiber decor → `CarbonBlack` · SOURCE<br>White + Carbon Fiber decor → `CarbonWhite` · SOURCE<br>Cream + Carbon Fiber decor → `CarbonCream` · SOURCE | `Black` | always |
| 4 | Steering wheel | `steering_wheel_type` | Standard round wheel → `0` · SOURCE<br>Yoke → `1` · SOURCE | `0` | always |
| 5 | Headlamp / front-light market variant | `headlamp_type` | Standard front lights (Premium — default; identical render to 'Original') → `Premium` · SOURCE<br>Global-market front lights → `Global` · SOURCE | `Premium` | always |
| 6 | Rear-light / tail body variant | `rearlight_type` | Original tail/rear end → `0` · SOURCE<br>Global-market rear end (enables badge & wordmark, moves charge port) → `2` · SOURCE | `0` | always |
| 7 | Rear TESLA wordmark | `has_tesla_word_mark` | Show wordmark → `true` · SOURCE<br>Delete (no wordmark) → `false` · SOURCE | `true` | rearlight_type == 2 (Global) |
| 8 | Special badging series | `car_special_type` | None → `0` · SOURCE<br>Foundation Series (renders as None) → `1` · SOURCE<br>Launch Series (renders as None) → `2` · SOURCE<br>Signature Series (signature node group + signature plaid badge; signature brakes if red calipers on) → `3` · SOURCE | `0` | always |
| 9 | Drivetrain (Plaid badge) | `drivetrain_type` | RWD / no plaid badge → `0` · SOURCE<br>AWD (Dual Motor) / no plaid badge → `1` · SOURCE<br>Plaid (Tri-Motor) — plaid badge → `2` · SOURCE | `0` | always |
| 10 | Brake calipers | `red_brake_calipers` | Standard (silver) calipers → `false` · GLOBAL<br>Red performance calipers → `true` · GLOBAL | `false` | always |
| 11 | Window tint | `window_tint_color` | Light tint → `0,0,0,128` · GLOBAL<br>Default tint → `0,0,0,153` · GLOBAL<br>Medium tint → `0,0,0,170` · GLOBAL<br>Dark tint → `0,0,0,190` · GLOBAL | `0,0,0,153` | always |
| 12 | Charge port / cable standard | `charge_port_type` | US (NACS/Charging_Cable) → `US` · GLOBAL<br>EU (IEC/CCS2) → `EU` · GLOBAL<br>GB → `GB` · GLOBAL<br>GB AC → `GB_AC` · GLOBAL<br>GB DC → `GB_DC` · GLOBAL<br>CCS (CCS2 V3) → `CCS` · GLOBAL | `US` | always |
| 13 | Third-row seats | `third_row_seats` | None (5-seat) → `None` · SOURCE<br>Futuris fold-flat → `FuturisFoldFlat` · SOURCE<br>Futuris no-fold-flat → `FuturisNoFoldFlat` · SOURCE<br>Flat fold → `FlatFold` · SOURCE | `None` | always |
| 14 | Rear seat configuration (seat count) | `rear_seat_type` | Base (7-seat when 3rd row present; 5-seat otherwise) → `0` · SOURCE<br>Recaro (behaves like Base -> 7-seat) → `1` · SOURCE<br>Executive (forces 3 rows + 6-seat captain's chairs) → `2` · SOURCE<br>Two-seat / captain's chairs (6-seat when 3rd row present) → `3` · SOURCE<br>Fold-flat (behaves like Base -> 7-seat) → `4` · SOURCE | `0` | always (EXECUTIVE forces 3 rows even when third_row_seats='None'; otherwise this only disambiguates 6 vs 7 once a 3rd row is present) |
| 15 | Steering side (RHD) | `rhd` | Left-hand drive → `false` · GLOBAL<br>Right-hand drive → `true` · GLOBAL | `false` | always |
| 16 | License-plate region | `eu_vehicle` | US plate (default) → `false` · GLOBAL<br>EU plate → `true` · GLOBAL | `false` | always |

### 4.10 Model Y — Legacy (pre-Juniper)

**Routing keys:** `car_type=modely` · `fascia_type=original` · `chassis_type=model_y`


> Scene res://Ego/Y_High/ModelY_High.tscn, script Model_Y.gd (extends Vehicle). Reached when car_type=modely AND chassis_type != model_y_long_wheel_base AND fascia_type not in {e41Bayberry, baseBayberry, performanceBayberry} (i.e. 'original' or default). Also the global unknown-model fallback scene. SOURCE-verified traits of this generation: (1) SEATING is 5 or 7 ONLY — the scene contains Interior_5_seater(+_Color) and Interior_7_seater(+_Color), no 6-seat node; setup_seat_config sets 7 iff third_row_seats != NONE else 5, and rear_seat_type is NEVER read by Model_Y.gd. (2) INTERIOR: set_interior_config on Y_High (is_high_res_version, local_dir=='Ego/Y_High') runs the is_new_interior branch — Black2/White2 toggle Center_Console_2_0 + door_card2/decor geometry vs Center_Console; the material match only handles White/White2 (Interior_Seats_White + Decor_White) and Black/Black2 (Interior_Seats_Black + Wood_Walnut). Cream/Carbon*/TacticalGrey are NOT matched → no seat/decor material applied (effective no-op, keeps default) so they are omitted from this node; Cream/Carbon never shipped on Y anyway. (3) HEADLAMP is binary: set_headlamp_type swaps headlights_object/lights_trunk/charge_cap original vs global and re-gates every lamp; update() picks Global iff hasGlobalHeadlamp()==(headlamp_type_string=='Global'), else Original — 'Premium'/'Original'/absent all render Original geometry. (4) aux_park_lamps drives Foglights_Cover (shown when aux_park_lamps=='None'). (5) spoiler_type toggles Spoiler1 via base set_has_spoiler (NOT force-on like Model X). (6) NO Palladium features exist on this script: no yoke/steering_wheel_type, no rearlight_type, no has_tesla_badge/word_mark, no car_special_type/special_badging, no drivetrain_type plaid badge, no carbon-fiber/wood-decor interior. (7) exterior_trim / exterior_trim_override have NO consumer in Model_Y.gd → omitted. (8) Default wheel for modely is WheelType.Gemini (DefaultWheelForVehicleType). Renderer applies ANY global exterior_color/wheel/interior key to this car regardless of the narrowed sets below — per-model narrowing on colors and on Induction/Uberturbine wheels is REALWORLD product knowledge, not renderer-enforced.


| # | Question | Field | Options (label → value · provenance) | Default | Show-if |
|---|---|---|---|---|---|
| 1 | Exterior paint color | `exterior_color` | Pearl White Multi-Coat (default) → `PearlWhite` · SOURCE<br>Solid Black → `SolidBlack` · REALWORLD<br>Midnight Silver Metallic → `MidnightSilver` · REALWORLD<br>Deep Blue Metallic → `DeepBlue` · REALWORLD<br>Red Multi-Coat → `RedMulticoat` · REALWORLD<br>Stealth Grey (2023+ Y) → `StealthGrey` · REALWORLD<br>Ultra Red (2023+ Y; dev-sample default for Model Y) → `UltraRed` · REALWORLD | `PearlWhite` | always |
| 2 | Wheels | `wheel_type` | Gemini 19" (base aero, default) → Gemini mesh → `Gemini19Square` · SOURCE<br>Gemini 19" staggered (same Gemini mesh) → `Gemini19Staggered` · SOURCE<br>Apollo 19" (renders Gemini mesh) → `Apollo19` · SOURCE<br>Induction 20" black (LR/Perf) → `Induction20Black` · REALWORLD<br>Überturbine 21" (Performance) → `UberTurbine21Black` · REALWORLD | `Gemini19Square` | always |
| 3 | Interior (seat color + console generation) | `interior_trim_type` | All Black — original console (default) → `Black` · SOURCE<br>Black & White — original console → `White` · SOURCE<br>All Black — refresh console → `Black2` · SOURCE<br>Black & White — refresh console → `White2` · SOURCE | `Black` | always |
| 4 | Third row / seat count | `third_row_seats` | 5-seat (no third row, default) → `None` · SOURCE<br>7-seat — Futuris fold-flat → `FuturisFoldFlat` · SOURCE<br>7-seat — Futuris no-fold-flat → `FuturisNoFoldFlat` · SOURCE<br>7-seat — flat fold → `FlatFold` · SOURCE | `None` | always |
| 5 | Headlamp / market lighting | `headlamp_type` | Premium / North America (renders Original geometry, default) → `Premium` · SOURCE<br>Original (same as Premium) → `Original` · SOURCE<br>Global (global front + rear-trunk + charge-cap geometry) → `Global` · SOURCE | `Premium` | always |
| 6 | Spoiler | `spoiler_type` | No spoiler (default) → `None` · GLOBAL<br>Carbon fiber spoiler → `CarbonFiber` · GLOBAL | `None` | always |
| 7 | Fog lamps | `aux_park_lamps` | Fog lamps present (cover hidden, default) → `NaPremium` · SOURCE<br>No fog lamps (blanking cover shown) → `None` · SOURCE | `NaPremium` | always |
| 8 | Brake calipers | `red_brake_calipers` | Standard calipers (default) → `false` · GLOBAL<br>Red performance calipers → `true` · GLOBAL | `false` | always |
| 9 | Badging material | `badging_material_type` | Chrome / silver (default) → `0` · GLOBAL<br>Black matte → `1` · GLOBAL | `0` | always |
| 10 | Window tint | `window_tint_color` | Default tint → `0,0,0,153` · GLOBAL<br>Light → `0,0,0,128` · GLOBAL<br>Medium → `0,0,0,170` · GLOBAL<br>Dark → `0,0,0,190` · GLOBAL | `0,0,0,153` | always |
| 11 | Steering side (LHD/RHD) | `rhd` | Left-hand drive (default) → `false` · SOURCE<br>Right-hand drive → `true` · SOURCE | `false` | always |
| 12 | License-plate region | `eu_vehicle` | US plate (default) → `false` · GLOBAL<br>EU plate → `true` · GLOBAL | `false` | always |

### 4.11 Model Y — Juniper Base (Bayberry)

**Routing keys:** `car_type=modely` · `fascia_type=baseBayberry` · `chassis_type=model_y (any value that is NOT 'model_y_long_wheel_base'; default 'model_y'. LWB would short-circuit to BayberryE80.tscn before fascia is evaluated)`


> SCENE/SCRIPT: car_type=modely routes chassis-first (ProductManager.get_vehicle_node_path, ProductManager.gd:139-149). chassis_type=='model_y_long_wheel_base' short-circuits to BayberryE80 BEFORE fascia is read; otherwise fascia_type=='baseBayberry' (or 'performanceBayberry') -> res://Ego/Bayberry/Bayberry.tscn, script Ego/Bayberry/Script/Bayberry.gd (extends mobile/scripts/Vehicles/Model_Y.gd). local_dir='Ego/Bayberry' (tscn:201). baseBayberry and performanceBayberry share this ONE scene; the difference is is_performance := (fascia_type=='performanceBayberry') in Bayberry.update (Bayberry.gd:64) which on the BASE fascia is false -> standard fascia/seats/mirrors shown and set_has_spoiler(false) FORCED (Bayberry.gd:70-82). So on baseBayberry the spoiler is always OFF and spoiler_type is inert. SEATING (SOURCE): Model_Y.setup_seat_config (Model_Y.gd:137-139) sets has_3_rows = third_row_seats != NONE -> Seats_7 else Seats_5; set_seat_count toggles interior_5_seater=NodePath('Seats') and interior_7_seater=NodePath('Seats_7S') (Bayberry.tscn:221-222). BOTH nodes exist in the base Bayberry scene. rear_seat_type is NEVER read by Model_Y/Bayberry (no 6-seat concept on Y) -> emit NO rear_seat_type question. All four non-None third_row values (FuturisFoldFlat/FuturisNoFoldFlat/FlatFold, plus the '<invalid>'->INVALID gotcha) are equivalent on Y: any != NONE -> 7-seat. REALWORLD caveat: the real 3-row Juniper is the long-wheel-base E80 (chassis model_y_long_wheel_base -> BayberryE80.tscn), a different scene; the base Bayberry scene nonetheless contains a Seats_7S node. INTERIOR (SOURCE): Because is_high_res_version() (local_dir=='Ego/Y_High') is FALSE here, Model_Y.set_interior_config (Model_Y.gd:149-152) defers to base Vehicle.set_interior_config (Vehicle.gd:983-999): White/White2/WhiteCarbonFiber->Interior_White, Black/Black2/BlackCarbonFiber->Interior_Black, Cream/CreamCarbonFiber->Interior_Cream. Then Bayberry.set_interior_config (Bayberry.gd:84-98) additionally loads Black_Seats/Black_Seats_7S or White_Seats/White_Seats_7S (only .tres present in Ego/Bayberry). NET on baseBayberry: only Black and White are distinct. Black2/White2 collapse to Black/White (no center_console2/door_card2 toggle runs — that branch is gated on is_high_res_version). Carbon* collapse to plain (carbon+wood decor exists ONLY on Palladium). Cream falls to base Interior_Cream but Ego/Bayberry ships NO Interior_Cream / cream seat .tres -> effectively broken, and REALWORLD Model Y never shipped cream -> Cream excluded. WHEELS (SOURCE): the wheels whose asset group ties them to this generation live in Ego/Wheels_Bayberry (confirmed on disk): E4118->BayberryE41/Wheel_E41.tscn (18in base aero), Crossflow19->GeminiDark/GeminiDark.tscn (19in), MachinaV219->Machina2/Machina2.tscn (19in), HelixV220->Helix2/Helix2.tscn (20in), HelixV220Dark->Helix2_Dark/Helix2_Dark.tscn (20in), ArachnidV221->Arachnid_V2/Arachnid_V2_21.tscn (21in, the Performance-trim wheel). RENDERER FALLBACK: wheel resolution is fully GLOBAL (any MobileWheelTypeEnumMap key renders on any car); if the wheel_type key is absent/unknown, set_wheel_type_by_name_with_vehicle_default falls back to DefaultWheelForVehicleType['modely'] = WheelType.Gemini (res://Ego/Wheels/Wheel_Gemini.tscn, a legacy Ego/Wheels mesh, NOT a Bayberry-asset wheel) (VehicleOptions.gd:182, Vehicle.gd:1278-1284). EXTERIOR COLOR: fully GLOBAL — all 32 ExteriorColorValue keys render on any car with no per-model gating (default 'PearlWhite' when field absent, Vehicle.gd set_paint_color_by_name; FALLBACK color == SilverMetallic bytes). paint_color_override ('R,G,B,metallic,roughness' 5-float CSV) replaces the named color entirely when it splits to exactly 5 values. The 6 options emitted are REALWORLD-narrowed to the Juniper (2025) palette; PearlWhite is also the SOURCE code default. NO-OP / EXCLUDED on baseBayberry (do NOT emit questions): headlamp_type (Bayberry.set_headlamp_type only stores the value, no geometry swap — Bayberry.gd:130-131; differs from Y_High); rearlight_type / has_tesla_word_mark / steering_wheel_type(yoke) / car_special_type(SIGNATURE) / drivetrain_type-plaid-badge (Palladium-only, no setter on Model_Y/Bayberry); aux_park_lamps (Model_Y.update toggles fog_lights_cover but the Bayberry scene has NO fog_lights_cover node -> get_node_or_null null -> no-op); exterior_trim / exterior_trim_override (read only by Model_3/S/X, not Model_Y); spoiler_type (forced OFF by set_is_performance(false)); rear_seat_type (never read by Y); has_stalk / has_front_fascia_camera (zero renderer consumers anywhere). EMITTED SOURCE effects unique to Bayberry: has_tesla_badge toggles Hood_Spatial/Tesla_Badge (Bayberry.gd:66-68) and is NOT rearlight-gated (unlike Palladium); rhd swaps doorcard_lf/rf (Bayberry.gd:157-163) plus base interior_lhd/rhd + steering marker. GLOBAL always-applies: window_tint_color, badging_material_type (Model_Y._enter_tree defaults CHROME_SILVER), charge_port_type (cable only while charger connected).


| # | Question | Field | Options (label → value · provenance) | Default | Show-if |
|---|---|---|---|---|---|
| 1 | Exterior paint color | `exterior_color` | Pearl White Multi-Coat (renderer default) → `PearlWhite` · SOURCE<br>Stealth Grey → `StealthGrey` · REALWORLD<br>Diamond Black → `DiamondBlack` · REALWORLD<br>Glacier Blue (new for Juniper) → `GlacierBlue` · REALWORLD<br>Quicksilver → `Quicksilver` · REALWORLD<br>Ultra Red → `UltraRed` · REALWORLD | `PearlWhite` | always |
| 2 | Wheels | `wheel_type` | E41 18" aero (Juniper base) → `E4118` · SOURCE<br>Crossflow 19" (Gemini Dark mesh) → `Crossflow19` · SOURCE<br>Machina 19" → `MachinaV219` · SOURCE<br>Helix V2 20" → `HelixV220` · SOURCE<br>Helix V2 20" Dark → `HelixV220Dark` · SOURCE<br>Arachnid V2 21" (Performance-trim wheel) → `ArachnidV221` · SOURCE | `E4118` | always |
| 3 | Interior color | `interior_trim_type` | All Black → `Black` · SOURCE<br>Black and White → `White` · SOURCE | `Black` | always |
| 4 | Seating (rows) | `third_row_seats` | 5-seat (no third row) → `None` · SOURCE<br>7-seat (third row) → `FlatFold` · SOURCE | `None` | always |
| 5 | Rear Tesla badge | `has_tesla_badge` | Show badge → `true` · SOURCE<br>Hide badge (debadged) → `false` · SOURCE | `true` | always |
| 6 | Steering side (handedness) | `rhd` | Left-hand drive → `false` · SOURCE<br>Right-hand drive → `true` · SOURCE | `false` | always |
| 7 | Window tint | `window_tint_color` | Default tint (alpha 153) → `0,0,0,153` · GLOBAL<br>Light tint (alpha 128) → `0,0,0,128` · GLOBAL<br>Dark tint (alpha 190) → `0,0,0,190` · GLOBAL | `0,0,0,153` | always |
| 8 | Badging material | `badging_material_type` | Chrome / Silver → `0` · GLOBAL<br>Black Matte → `1` · GLOBAL | `0` | always (visible only if the scene defines a 'badging' material set) |
| 9 | Charge port / cable type | `charge_port_type` | US (NACS/Charging_Cable) → `US` · GLOBAL<br>EU (IEC) → `EU` · GLOBAL<br>GB → `GB` · GLOBAL<br>CCS (CCS2) → `CCS` · GLOBAL | `US` | always (cable mesh only spawns while a charger is connected) |
| 10 | License-plate region | `eu_vehicle` | US plate (default) → `false` · GLOBAL<br>EU plate → `true` · GLOBAL | `false` | always |
| 11 | Brake calipers | `red_brake_calipers` | Standard (default) → `false` · SOURCE<br>Red performance calipers → `true` · SOURCE | `false` | always |

### 4.12 Model Y — Juniper Performance

**Routing keys:** `car_type=modely` · `fascia_type=performanceBayberry` · `chassis_type=model_y (any value EXCEPT model_y_long_wheel_base; LWB would reroute to BayberryE80.tscn)`


> SCENE ROUTING (SOURCE, ProductManager.gd get_vehicle_node_path): for car_type 'modely', chassis_type is evaluated FIRST — 'model_y_long_wheel_base' short-circuits to BayberryE80.tscn. Only when chassis is NOT LWB does fascia_type decide: 'e41Bayberry'->BayberryE41.tscn; {'baseBayberry','performanceBayberry'}->Ego/Bayberry/Bayberry.tscn; else->Y_High. So THIS node requires chassis_type != model_y_long_wheel_base (dev sample uses 'model_y'). baseBayberry and performanceBayberry load the SAME scene; the ONLY differentiator is Bayberry.gd:64 set_is_performance(fascia_type=='performanceBayberry'). PERFORMANCE IS FIXED, NOT A QUESTION: because the routing key is performanceBayberry, Bayberry.gd forces is_performance=true every update (Bayberry.gd:70-82). That unconditionally (a) shows Fascia_Perf / hides Fascia_Standard, (b) shows Seats_Perf / hides Seats_Standard, (c) shows Skullcap_LF_Perf & Skullcap_RF_Perf mirror caps / hides the standard paint caps, and (d) FORCES set_has_spoiler(true) -> Trunk_Spatial/Spoiler_Perf always visible. spoiler_type wire is therefore inert on this node. get_skin_file_path also returns the .../Skins/Performance/ folder (fascia_type_enum==BAYBERRY_PERF, Bayberry.gd:165-169). WHEELS: the six SOURCE Bayberry-asset-group wheels (Ego/Wheels_Bayberry) all exist on disk and are the ones tied to this Juniper generation: E4118 (BayberryE41/Wheel_E41.tscn), Crossflow19 (GeminiDark/GeminiDark.tscn), HelixV220 (Helix2/Helix2.tscn), HelixV220Dark (Helix2_Dark/Helix2_Dark.tscn), ArachnidV221 (Arachnid_V2/Arachnid_V2_21.tscn), MachinaV219 (Machina2/Machina2.tscn). NOTE: the renderer does NOT gate wheels per model (MobileWheelTypeEnumMap is global — any wireKey renders on any car); the SOURCE tie is only the asset-group directory. If wheel_type is absent/unknown, fallback is DefaultWheelForVehicleType[modely]=WheelType.Gemini (the legacy Ego/Wheels/Wheel_Gemini.tscn mesh, NOT a Bayberry mesh). REALWORLD: Juniper Performance ships the 21in Arachnid V2 (ArachnidV221), so that is the sensible default for THIS trim even though the source fallback is Gemini. INTERIOR: Bayberry.gd:84-98 set_interior_config calls base then applies its OWN seat materials, but ONLY branches White/White2->White_Seats(+_7S) and Black/Black2->Black_Seats(+_7S). There is NO Cream branch and NO Cream .tres on disk (dir has only Black_/White_ Seats + Interior_Black/White.material), so Cream is not a real Bayberry interior. Black2/White2 collapse to Black/White here: Model_Y.set_interior_config only does the refresh-console (center_console2 / door_card2) toggling when is_high_res_version() (local_dir=='Ego/Y_High'); Bayberry's local_dir is 'Ego/Bayberry' so it defers to base and the new-console geometry is inert. Net: two real interiors, Black and White. interior_upper_trim defaults BLACK and badging default CHROME_SILVER are seeded in Model_Y._enter_tree. SEATING: Bayberry inherits Model_Y.setup_seat_config — seat_count = 7 if third_row_seats != NONE else 5; set_seat_count toggles interior_5_seater (NodePath 'Seats') vs interior_7_seater (NodePath 'Seats_7S'), both present in Bayberry.tscn (:744, :805). rear_seat_type is NEVER read on Y/Bayberry (no 6-seat concept). REALWORLD: the 3-row/7-seat Model Y is the long-wheel-base car (BayberryE80); the Performance trim in reality is 5-seat only — so although the renderer will build a 7-seat Bayberry if third_row_seats!=NONE, that is not a real Juniper Performance config. BADGE: Bayberry.gd:66-68 set_hide_tesla_badge toggles the Hood_Spatial/Tesla_Badge node directly from has_tesla_badge — with NO rearlight_type gating (unlike Palladium). SOURCE and always live on this node. EXCLUDED / INERT on this node (do NOT surface as questions): headlamp_type — Bayberry.gd:130-131 overrides set_headlamp_type to ONLY store the int (no Global geometry swap), so headlamp_type is inert (differs from Y_High/Model_Y). aux_park_lamps -> fog_lights_cover — Model_Y.update sets it, but Bayberry.tscn defines no fog_lights_cover_path, so the node is null and it is a no-op. exterior_trim / exterior_trim_override — only Model_3/S/X read these; Model_Y/Bayberry never do. steering_wheel_type (Yoke), rearlight_type, car_special_type/SIGNATURE_SERIES, drivetrain_type plaid badge — all Palladium-only (lychee/tamarind), no consumer on Bayberry. rear_seat_type — not read by Y. spoiler_type — overridden true by Performance. has_stalk / has_front_fascia_camera — parsed but zero renderer consumers anywhere. drivetrain_type has no visible effect on Y. GLOBAL (renderer-accepted on any car, base Vehicle.gd) still valid here: exterior_color / paint_color_override (+ colorizer remap), window_tint_color, badging_material_type, rhd (base + Bayberry.gd:157-163 door-card/steering/dash/screen swap is SOURCE per-model geometry), charge_port_type (cable only spawns while charger connected).


| # | Question | Field | Options (label → value · provenance) | Default | Show-if |
|---|---|---|---|---|---|
| 1 | Exterior paint color | `exterior_color` | Pearl White Multi-Coat (field-absent default) → `PearlWhite` · REALWORLD<br>Stealth Grey (Juniper standard) → `StealthGrey` · REALWORLD<br>Diamond Black (Juniper; replaced Solid Black) → `DiamondBlack` · REALWORLD<br>Glacier Blue (new Juniper color) → `GlacierBlue` · REALWORLD<br>Quicksilver → `Quicksilver` · REALWORLD<br>Ultra Red (dev sample assigns this to Model Y) → `UltraRed` · REALWORLD<br>Custom paint override (R,G,B,metallic,roughness — sent via paint_color_override, wins over named color) → `<paint_color_override CSV>` · GLOBAL | `PearlWhite` | always |
| 2 | Wheels | `wheel_type` | Arachnid V2 21in (Juniper Performance wheel; realworld default for this trim) → `ArachnidV221` · SOURCE<br>Helix V2 20in → `HelixV220` · SOURCE<br>Helix V2 20in Dark → `HelixV220Dark` · SOURCE<br>Crossflow 19in (GeminiDark mesh) → `Crossflow19` · SOURCE<br>Machina V2 19in → `MachinaV219` · SOURCE<br>E41 18in aero (Juniper base aero) → `E4118` · SOURCE<br>Source fallback if wheel key absent/unknown: Gemini (legacy mesh) → `Gemini19Square` · SOURCE | `ArachnidV221` | always |
| 3 | Interior color | `interior_trim_type` | All Black (field-absent default; Black2 renders identically here) → `Black` · SOURCE<br>Black and White (White2 renders identically here) → `White` · SOURCE | `Black` | always |
| 4 | Seating layout (3rd row) | `third_row_seats` | 5-seat (no 3rd row) — realworld Performance config → `None` · SOURCE<br>7-seat, fold-flat 3rd row (renderer builds it; not a real Performance config) → `FuturisFoldFlat` · SOURCE<br>7-seat, no-fold-flat 3rd row (same 7-seat mesh) → `FuturisNoFoldFlat` · SOURCE<br>7-seat, flat-fold 3rd row (same 7-seat mesh) → `FlatFold` · SOURCE | `None` | always |
| 5 | Show rear Tesla badge / wordmark | `has_tesla_badge` | Show Tesla badge (default) → `true` · SOURCE<br>Hide Tesla badge → `false` · SOURCE | `true` | always |
| 6 | Steering side (RHD/LHD) | `rhd` | Left-hand drive (default) → `false` · GLOBAL<br>Right-hand drive → `true` · GLOBAL | `false` | always |
| 7 | Window tint | `window_tint_color` | Standard tint (default 0,0,0,153) → `0,0,0,153` · GLOBAL<br>Lighter tint → `0,0,0,128` · GLOBAL<br>Darker tint → `0,0,0,190` · GLOBAL | `0,0,0,153` | always (optional) |
| 8 | Badging material finish | `badging_material_type` | Chrome / silver (Model Y default) → `0` · GLOBAL<br>Black matte → `1` · GLOBAL | `0` | always (optional) |
| 9 | License-plate region | `eu_vehicle` | US plate (default) → `false` · GLOBAL<br>EU plate → `true` · GLOBAL | `false` | always |
| 10 | Brake calipers | `red_brake_calipers` | Standard (default) → `false` · SOURCE<br>Red performance calipers → `true` · SOURCE | `false` | always |

### 4.13 Model Y — Juniper E41

**Routing keys:** `car_type=modely` · `fascia_type=e41Bayberry` · `chassis_type=model_y`


> Scene: res://Ego/BayberryE41/BayberryE41.tscn, script Ego/BayberryE41/Script/BayberryE41.gd (extends mobile/scripts/Vehicles/Model_Y.gd). ROUTING (ProductManager.get_vehicle_node_path): car_type='modely' -> chassis_type is checked FIRST; only because chassis_type != 'model_y_long_wheel_base' does the fascia sub-switch run, and fascia_type='e41Bayberry' selects BayberryE41.tscn. If chassis were 'model_y_long_wheel_base' it would short-circuit to BayberryE80.tscn regardless of fascia. Confirmed keys: car_type=modely, fascia_type=e41Bayberry, chassis_type=model_y (any non-LWB). WHAT ACTUALLY VARIES ON E41 (verified against the .tscn node bindings + BayberryE41.gd overrides): - exterior_color: paint via base Vehicle.set_paint_color_with_override -> renders. GLOBAL map (no per-car gating in renderer); the Juniper LIST below is REALWORLD narrowing (Tesla product knowledge), NOT renderer-enforced. paint_color_override (5-float CSV 'r,g,b,metallic,roughness') replaces the named color when it splits to exactly 5 values. Renderer absent-field default = literal 'PearlWhite'. - wheel: base set_wheel_type_by_name_with_vehicle_default. Juniper wheels are SOURCE-tied by living in Ego/Wheels_Bayberry/*. Unknown/absent wireKey -> DefaultWheelForVehicleType['modely'] = WheelType.Gemini (Ego/Wheels/Wheel_Gemini.tscn) — so the renderer's own absent-key fallback is the legacy Gemini, NOT the E41 aero. - headlamp_type: BayberryE41.set_headlamp_type does NOT swap front lamp geometry (headlights_object/charge_cap paths are not bound on this scene). It DOES recolor the global/EU rear turn-signal material orange (Global) vs white (non-Global) and re-gate rear-signal visibility. Model_Y.update forces headlamp_type = Global iff data.hasGlobalHeadlamp() (== exterior string 'Global') else Original — so only Global vs Original are ever selected; 'Premium' collapses to Original. - has_tesla_badge: BayberryE41.set_hide_tesla_badge toggles the Hood_Spatial/Tesla_Badge mesh with NO rearlight gating (unlike Palladium, where badge/wordmark require rearlight_type==Global). - rhd: Model_Y.set_rhd swaps steering/dashboard/screen; BayberryE41.set_rhd additionally swaps Doorcard_LF/RF LHD vs RHD. - window_tint_color / charge_port_type / badging_material_type: base-Vehicle GLOBAL fields, apply to any car. WHAT IS INERT / ABSENT ON E41 (SOURCE — verified no bound node / overridden no-op): - interior_trim_type: BayberryE41.set_interior_config(interior) only stores the value (lines 79-80) — NO material or geometry switch. The scene ships fixed interior .tres (Interior_Black/Interior_White/Interior_Textile) but interior_config never switches them at runtime. So Black/White/Black2/White2 are all visually identical on E41 (renders the scene's default interior). Listed for completeness but flagged inert. - third_row_seats / rear_seat_type: Model_Y.setup_seat_config runs but interior_5_seater / interior_7_seater node paths are NOT bound in BayberryE41.tscn -> set_node_visible on null = no-op. E41 is a fixed single (5-seat) interior; the 7-seat/3-row Juniper body is BayberryE80 (LWB). No third-row question on E41. - aux_park_lamps (fog_lights_cover), spoiler_type, exterior_trim/exterior_trim_override, steering_wheel_type (Yoke), special_badging_type (Signature), drivetrain_type (Plaid badge), rearlight_type, has_tesla_word_mark: no bound node / handled only by Palladium or Model_3/S/X — all no-ops on E41. No yoke/signature/rearlight questions (E41 is non-Palladium). PROVENANCE SUMMARY: wheels tied to Ego/Wheels_Bayberry and the modely default (Gemini) = SOURCE. All exterior colors = renderer-GLOBAL, narrowed to the Juniper palette by REALWORLD product knowledge. headlamp_type/has_tesla_badge/rhd effects = SOURCE (E41/Model_Y script branches + bound nodes). interior_trim_type listed values = SOURCE-inert on E41.


| # | Question | Field | Options (label → value · provenance) | Default | Show-if |
|---|---|---|---|---|---|
| 1 | Exterior paint color | `exterior_color` | Pearl White Multi-Coat (renderer default) → `PearlWhite` · REALWORLD<br>Stealth Grey → `StealthGrey` · REALWORLD<br>Diamond Black → `DiamondBlack` · REALWORLD<br>Glacier Blue (Juniper-new) → `GlacierBlue` · REALWORLD<br>Ultra Red (Model Y dev-sample color) → `UltraRed` · REALWORLD<br>Quicksilver → `Quicksilver` · REALWORLD<br>Midnight Silver Metallic (legacy Y grey) → `MidnightSilver` · REALWORLD<br>Lunar Silver (low-confidence / region) → `LunarSilver` · REALWORLD<br>Frost Blue (low-confidence / region) → `FrostBlue` · REALWORLD<br>Silk Road Silver (China-market) → `SilkroadSilver` · REALWORLD<br>Marine Blue (low-confidence / China-market) → `MarineBlue` · REALWORLD<br>Custom paint override (r,g,b,metallic,roughness) → `<paint_color_override CSV>` · GLOBAL | `PearlWhite` | always |
| 2 | Wheel | `wheel_type` | 18" E41 aero (Juniper base) → `E4118` · SOURCE<br>19" Crossflow (GeminiDark mesh) → `Crossflow19` · SOURCE<br>19" Machina V2 → `MachinaV219` · SOURCE<br>20" Helix V2 → `HelixV220` · SOURCE<br>20" Helix V2 Dark → `HelixV220Dark` · SOURCE<br>21" Arachnid V2 (Juniper Performance) → `ArachnidV221` · SOURCE<br>Gemini (renderer modely absent-key fallback; legacy Y) → `Gemini19Square` · SOURCE | `E4118` | always |
| 3 | Headlamp / market lighting (rear turn-signal color) | `headlamp_type` | Premium/US (renders Original; red rear signal) → `Premium` · SOURCE<br>Original (red rear signal) → `Original` · SOURCE<br>Global/EU (amber rear turn signal) → `Global` · SOURCE | `Premium` | always |
| 4 | Show rear Tesla badge | `has_tesla_badge` | Badge visible → `true` · SOURCE<br>Badge hidden (debadged) → `false` · SOURCE | `true` | always |
| 5 | Steering side (RHD/LHD) | `rhd` | Left-hand drive → `false` · SOURCE<br>Right-hand drive → `true` · SOURCE | `false` | always |
| 6 | Window tint | `window_tint_color` | Default tint (alpha 153) → `0,0,0,153` · GLOBAL<br>Light tint (alpha 128) → `0,0,0,128` · GLOBAL<br>Dark tint (alpha 170) → `0,0,0,170` · GLOBAL<br>Limo tint (alpha 190) → `0,0,0,190` · GLOBAL | `0,0,0,153` | always |
| 7 | Interior trim (INERT on E41 — no visible change) | `interior_trim_type` | All Black (inert) → `Black` · SOURCE<br>Black & White (inert) → `White` · SOURCE<br>Black — refresh console (inert on E41) → `Black2` · SOURCE<br>White — refresh console (inert on E41) → `White2` · SOURCE | `Black` | always |
| 8 | License-plate region | `eu_vehicle` | US plate (default) → `false` · GLOBAL<br>EU plate → `true` · GLOBAL | `false` | always |
| 9 | Brake calipers | `red_brake_calipers` | Standard (default) → `false` · SOURCE<br>Red performance calipers → `true` · SOURCE | `false` | always |

### 4.14 Model Y — Juniper 6-seat LWB (E80)

**Routing keys:** `car_type=modely` · `fascia_type=IGNORED for routing (chassis LWB short-circuits fascia switch, ProductManager.gd:139-140); still parsed and drives Bayberry.is_performance but that is inert on E80` · `chassis_type=model_y_long_wheel_base`


> SCENE-GROUNDED NARROWING (all verified against /Users/ivan/Work/airgapp/godot/Ego/BayberryE80/BayberryE80.tscn root exported NodePaths): ROUTING: ProductManager.get_vehicle_node_path (ProductManager.gd:137-148) evaluates chassis_type FIRST for modely; chassis_type=="model_y_long_wheel_base" returns BayberryE80.tscn and SHORT-CIRCUITS the fascia sub-switch. So fascia_type is IGNORED for scene selection on LWB — any fascia routes to E80. car_type must be "modely" (or VIN[3]=='Y' → modely). Confirmed the exact branch line ProductManager.gd:139-140. E80 IS A THIN SUBCLASS: BayberryE80.gd only overrides get_roof_fade_resource_names() and get_skin_file_path(). All config behavior comes from Bayberry.gd (perf/badge/seat-material/light logic) and Model_Y.gd (seat-count/headlamp/interior). Crucially, most of that logic is INERT on E80 because the corresponding NodePaths are UNWIRED in the E80 .tscn (grep count = 0 for interior_5/7_seater_path, seats_standard/perf_path, fascia_standard/perf_path, mirror_left/right_*_path, center_console*, *_door_card*, spoiler_path, fog_lights_cover_path). SEATING IS NOT A RENDERER QUESTION ON E80 (key SOURCE finding): Model_Y.setup_seat_config (Model_Y.gd:137-147) runs on every update and calls set_seat_count → toggles interior_5_seater / interior_7_seater nodes. On E80 those NodePaths are UNWIRED (get_node_or_null→null) so set_node_visible is a no-op. rear_seat_type is never read by Model_Y at all. Therefore third_row_seats and rear_seat_type have ZERO visible effect on E80 — the 6-seat LWB cabin is BAKED single geometry (single "Interior"/LHD/RHD node set), not a toggle. The "6-seat" descriptor is REALWORLD product identity, NOT a renderer-exposed choice. No seating question is emitted. FASCIA / PERFORMANCE IS INERT ON E80: Bayberry.update (Bayberry.gd:64) sets is_performance = (fascia_type=="performanceBayberry"); set_is_performance (Bayberry.gd:70-82) toggles fascia_standard/perf, seats_standard/perf, mirror_left/right standard/perf and forces set_has_spoiler(is_perf). ALL of those NodePaths are unwired on E80, AND there is no spoiler_path either, so performanceBayberry produces NO visible change on E80. No fascia/performance question is emitted. HEADLAMP INERT: Bayberry.set_headlamp_type (Bayberry.gd:130-131) only stores the value — no geometry swap (unlike Model_Y/Y_High and Palladium). E80 scene default headlamp_type=2 but it's cosmetically fixed. No headlamp question. FOG/AUX PARK LAMPS INERT: Model_Y.update sets fog_lights_cover visibility from hasFogLamps(), but fog_lights_cover_path is unwired on E80. aux_park_lamps has no effect. No question. INTERIOR: Bayberry.set_interior_config (Bayberry.gd:84-98) first calls Model_Y.set_interior_config, which (E80 is NOT high-res: is_high_res_version()==false since local_dir=="Ego/BayberryE80") defers to base Vehicle.set_interior_config → base collapses {White,White2,WhiteCarbonFiber}→White (Interior_White.material, present) and {Black,Black2,BlackCarbonFiber}→Black (Interior_Black.material, present). Bayberry then applies Black_Seats.tres / White_Seats.tres (both present on E80) to "Seats"; the White_Seats_7S/Black_Seats_7S loads and "Seats7S" apply are dead on E80 (those .tres files are absent → load null, and no 7S node). Net: only two distinct interiors render — Black and White. Black2/White2 and Carbon* variants collapse onto Black/White. Cream is a no-op fallback (no Cream arm in Bayberry match, base loads nonexistent Interior_Cream; E80 has no *Cream* assets) and REALWORLD Juniper never shipped cream — so Cream is excluded. BADGE IS NOT REARLIGHT-GATED (unlike Palladium): Bayberry.set_hide_tesla_badge (Bayberry.gd:66-68) toggles the wired Hood_Spatial/Tesla_Badge node directly; update sets hide = not has_tesla_badge. So has_tesla_badge is a live question. There is NO Tesla wordmark node on Bayberry/E80 → has_tesla_word_mark excluded. PALLADIUM-ONLY OPTIONS EXCLUDED (E80 is not Palladium): steering_wheel_type (yoke), car_special_type/special_badging (SIGNATURE_SERIES), rearlight_type (Global), has_tesla_word_mark, and the Plaid-badge behavior of drivetrain_type all live only in Palladium.gd (lychee/tamarind) and have no consumer here. exterior_trim/exterior_trim_override are Model_3/S/X-only — no consumer on Model_Y/Bayberry/E80. LIVE QUESTIONS (wired on E80): exterior_color/paint_color_override (base paint path, GLOBAL renderer), wheel_type (wheel_type=42 scene default, overridden by wire; DefaultWheelForVehicleType["modely"]=Gemini is the hard fallback for absent/Unknown), interior_trim_type (Black/White), has_tesla_badge (Tesla_Badge wired), rhd (interior_lhd/rhd "LHD"/"RHD" + doorcard_lf/rf LHD/RHD all wired), red_brake_calipers (brakes_standard_* / brakes_perf_* all wired → base Vehicle.set_brakes), eu_vehicle plate region (plate_us_path/plate_eu_path wired, scene has_us_plate=true), charge_port_type + window_tint_color (GLOBAL cosmetics on base Vehicle). WHEELS: The Model-Y-Juniper-tied wheel meshes (SOURCE, by asset group Ego/Wheels_Bayberry, confirmed dir contents: Arachnid_V2, BayberryE41[E41], GeminiDark[Crossflow], Helix2, Helix2_Dark, Machina2) are E4118, MachinaV219, Crossflow19, HelixV220, HelixV220Dark, ArachnidV221. The renderer itself accepts ANY MobileWheelTypeEnumMap wireKey on E80 (GLOBAL), and an absent/unknown key falls back to WheelType.Gemini (DefaultWheelForVehicleType["modely"], a legacy Ego/Wheels mesh) — a SOURCE-grounded but non-Juniper fallback. The dev sample (_vehicle_config_model_y, LocalDevMessageInjector.gd) sends wheel_type "ArachnidV221" (Juniper Performance), though that sample targets Bayberry.tscn (chassis model_y, fascia performanceBayberry), not the E80/LWB path — there is NO dev sample exercising E80. No dev sample exercises the LWB/E80 route; defaults below follow VehicleData/base field defaults, with the injector _base_vehicle_config values noted where relevant (exterior_color "PearlWhite", interior_trim_type "Black", third_row_seats "None", red_brake_calipers false, eu_vehicle true, has_tesla_badge default true in VehicleData though the injector base fixture sets it false).


| # | Question | Field | Options (label → value · provenance) | Default | Show-if |
|---|---|---|---|---|---|
| 1 | Exterior paint color | `exterior_color` | Pearl White Multi-Coat (source default / FALLBACK color) → `PearlWhite` · SOURCE<br>Stealth Grey (Juniper) → `StealthGrey` · REALWORLD<br>Diamond Black (Juniper — replaced Solid Black) → `DiamondBlack` · REALWORLD<br>Glacier Blue (Juniper new color) → `GlacierBlue` · REALWORLD<br>Quicksilver (Juniper) → `Quicksilver` · REALWORLD<br>Ultra Red (Juniper; dev-sample color for Model Y) → `UltraRed` · REALWORLD<br>Deep Blue Metallic → `DeepBlue` · REALWORLD<br>Midnight Silver Metallic → `MidnightSilver` · REALWORLD | `PearlWhite` | always |
| 2 | Custom paint override (advanced; optional). CSV 'R,G,B,metallic,roughness' — RGB 0-255. Wins over exterior_color only when it splits to EXACTLY 5 floats; otherwise ignored and the named color is used. | `paint_color_override` | None — use named exterior_color → `` · SOURCE<br>Custom 5-float CSV, e.g. '20,20,20,0.6,0.05' → `<R,G,B,metallic,roughness>` · GLOBAL | `` | always (optional — leave empty to use exterior_color) |
| 3 | Wheel | `wheel_type` | E41 18" aero (Juniper base) — WheelType.E41_18, Ego/Wheels_Bayberry/BayberryE41 → `E4118` · SOURCE<br>Machina V2 19" — WheelType.MachinaV2_19, Ego/Wheels_Bayberry/Machina2 → `MachinaV219` · SOURCE<br>Crossflow 19" (GeminiDark mesh) — WheelType.Crossflow_19, Ego/Wheels_Bayberry/GeminiDark → `Crossflow19` · SOURCE<br>Helix V2 20" — WheelType.HelixV2_20, Ego/Wheels_Bayberry/Helix2 → `HelixV220` · SOURCE<br>Helix V2 20" Dark — WheelType.HelixV2_20_Dark, Ego/Wheels_Bayberry/Helix2_Dark → `HelixV220Dark` · SOURCE<br>Arachnid V2 21" (Performance) — WheelType.ArachnidV2_21, Ego/Wheels_Bayberry/Arachnid_V2 → `ArachnidV221` · SOURCE | `E4118` | always |
| 4 | Interior trim | `interior_trim_type` | All Black → `Black` · SOURCE<br>Black & White → `White` · SOURCE | `Black` | always |
| 5 | Rear Tesla badge | `has_tesla_badge` | Badge shown → `true` · SOURCE<br>Badge hidden (debadged) → `false` · SOURCE | `true` | always |
| 6 | Steering side (handedness) | `rhd` | Left-hand drive → `false` · SOURCE<br>Right-hand drive → `true` · SOURCE | `false` | always |
| 7 | Brake calipers | `red_brake_calipers` | Standard calipers → `false` · SOURCE<br>Red performance calipers → `true` · SOURCE | `false` | always |
| 8 | License plate region (drives which plate mesh shows; US and EU are mutually exclusive) | `eu_vehicle` | US plate (scene default) → `false` · SOURCE<br>EU plate → `true` · SOURCE | `false` | always |
| 9 | Charge port / charging-cable type (cable only appears while a charger is connected) | `charge_port_type` | US (NACS/Charging_Cable) → `US` · GLOBAL<br>EU (IEC) → `EU` · GLOBAL<br>GB / GB_AC / GB_DC (IEC) → `GB` · GLOBAL<br>CCS (CCS2_V3) → `CCS` · GLOBAL | `US` | always (cosmetic; cable mesh conditional on charger-connected state) |
| 10 | Window tint (advanced) | `window_tint_color` | Default tint (0,0,0,153) → `0,0,0,153` · SOURCE<br>Custom 'r,g,b,a' (0-255 each) → `<r,g,b,a>` · GLOBAL | `0,0,0,153` | always |

---

## 5. Master enumeration appendix (complete value sets)

The exhaustiveness guarantee: every value the renderer accepts, straight from `VehicleOptions.gd`. The per-generation nodes above narrow *from* these. Nothing here is omitted.


### 5.1 Exterior colors  (32 values)

*Resolution:* SOURCE FILES: colors defined in mobile/scripts/VehicleOptions.gd (enum ExteriorColor line 4; const ExteriorColorValue lines 18-51; FALLBACK_EXTERIOR_COLOR line 53). Wire fields parsed in mobile/scripts/data/VehicleData.gd VehicleConfig._init (exterior_color line 55 default "PearlWhite"; paint_color_override line 56 default ""). Applied in mobile/scripts/Vehicles/Vehicle.gd: update path calls set_paint_color_with_override(exterior_color, paint_color_override) at line 678. RESOLUTION PATH (Vehicle.gd): set_paint_color_with_override(paintName, override) line 1368 -> if override.split(",").size()==5 it takes precedence via set_paint_color_override(override) line 1387 (parses "R,G,B,metallic,roughness"; RGB are 0-255 divided by 255; metallic=field4, roughness=field5; arbitrary color, NOT limited to the 32 keys). Otherwise set_paint_color_by_name(paintName) line 1375 -> material = VehicleOptions.ExteriorColorValue.get(color_key, FALLBACK_EXTERIOR_COLOR). Model_S.gd overrides set_paint_color_by_name (line 141) and set_paint_color_by_dict (line 150) but still reads the SAME global ExteriorColorValue map with NO key filtering and additionally drives skybox_paint_original/paint_rough_original; it does not restrict which colors are valid. PROVENANCE: Every one of the 32 keys is in a single global dict with no per-car gating in any renderer path (no Model_3/S/X/Y branch filters keys, no per-model asset group for paint) -> provenance GLOBAL for all: the renderer applies ANY key to ANY car. The per-color modelFamilies lists below are REALWORLD narrowing (Tesla product knowledge about which S/3/X/Y generation actually shipped that paint) and are NOT enforced by the renderer. Do not read modelFamilies as a renderer restriction. FALLBACK COLOR: FALLBACK_EXTERIOR_COLOR = {color #161616, metallic 0.6, roughness 0.04} (VehicleOptions.gd line 53) — byte-identical to SilverMetallic. Any unrecognized exterior_color string silently renders as this medium silver. Default when field absent is the literal string "PearlWhite". TWO-TONE / OVERRIDE BEHAVIOR: has_two_toned_color() in Vehicle.gd line 1403 hard-returns false and is NOT overridden by any Model_S/3/X/Y subclass, so the color_bright/color_dark/away_and_up two-tone shader branches (lines 1416-1463) are dead for S/3/X/Y — all paint is single-tone. "paint_color_override" is therefore a full single-color REPLACEMENT (5-float CSV), not a second tone: when present with exactly 5 comma floats it wins over the named color and clears paint_color_name (line 1395); a named color conversely clears paint_color_override (line 1381). If a CSV override does not have exactly 5 fields it is ignored and the named color is used. Additional twist: set_paint_color_override applies colorizer remap when colorizer_color_remap_enabled is set (VehicleData VehicleState.colorizer_color_remap_enabled -> Vehicle.remap_color line 1409 multiplies HSV value by 0.325, darkening the override). HEX CAVEAT: the stored hex values are intentionally very dark near-black albedo (e.g. RedMulticoat #0a0101). The visible paint hue is produced by the skybox reflection/paint shader (metallic+roughness+skybox_paint_material), not the raw albedo. Hex reported below is the exact source value, not the perceived color. DEV SAMPLE CONFIGS (mobile/scripts/LocalDevMessageInjector.gd): base config default exterior_color "PearlWhite" (line 332); per-model dev samples assign Model S(lychee)->GarnetRed (line 354), Model 3->GlacierBlue (line 368), Model X(tamarind)->PearlWhite (line 382), Model Y->UltraRed (line 396). These are just dev fixtures, not gating. ALIASES: several keys are byte-duplicates of the "canonical" ones (Red==RedMulticoat #0a0101; Black==SolidBlack==MetallicBlack #0e0e0e; Silver==SilverMetallic #161616; Grey==SteelGrey==MidnightSilver #131416) — they are legacy/generic name aliases the backend may send. enumName column gives the VehicleOptions.ExteriorColor member; set_paint_color(int) also resolves via ExteriorColor.keys()[index] (Vehicle.gd line 1366) so enum ORDER matters for integer form. REALWORLD confidence: Model S/X legacy(pre-2021), Palladium S/X(2021+), Model 3/Y, Model 3 Highland(2023+) and Model Y Juniper(2025) mappings are best-effort product knowledge. Newer/region-specific keys (LunarSilver, FrostBlue, SilkroadSilver, MarineBlue, GarnetRed) are lower-confidence — flagged per entry. SCOPE limited to S/3/X/Y; Cybertruck/Semi/Cybercab excluded.


| wireKey | enumName | provenance | modelFamilies | meaning |
|---|---|---|---|---|
| `RedMulticoat` | VehicleOptions.ExteriorColor.RedMulticoat | GLOBAL | Model S, Model 3, Model X, Model Y | Red Multi-Coat. Source albedo #0a0101, metallic 0.1, roughness 0.04 (BASE). REALWORLD: premium red offered across S/3/X/Y all generations. |
| `SolidBlack` | VehicleOptions.ExteriorColor.SolidBlack | GLOBAL | Model S, Model 3, Model X, Model Y | Solid Black. #0e0e0e, metallic 1.0, roughness 0.04. REALWORLD: standard black across S/3/X/Y all generations. |
| `SilverMetallic` | VehicleOptions.ExteriorColor.SilverMetallic | GLOBAL | Model S, Model X | Silver Metallic (legacy). #161616, metallic 0.6, roughness 0.04 — IDENTICAL to FALLBACK color. REALWORLD: classic-gen S/X silver (discontinued ~2019). |
| `MidnightSilver` | VehicleOptions.ExteriorColor.MidnightSilver | GLOBAL | Model S, Model 3, Model X, Model Y | Midnight Silver Metallic. #131416, metallic 0.8, roughness 0.04. REALWORLD: staple grey on S/3/X/Y (pre-refresh 3/Y and classic/Palladium S/X). |
| `DeepBlue` | VehicleOptions.ExteriorColor.DeepBlue | GLOBAL | Model S, Model 3, Model X, Model Y | Deep Blue Metallic. #000919, metallic 0.7, roughness 0.04. REALWORLD: blue offered across S/3/X/Y all generations. |
| `PearlWhite` | VehicleOptions.ExteriorColor.PearlWhite | GLOBAL | Model S, Model 3, Model X, Model Y | Pearl White Multi-Coat. #181818, metallic 0.25, roughness 0.2. This is the DEFAULT exterior_color when field absent. REALWORLD: standard white across S/3/X/Y all generations. |
| `TitaniumCopper` | VehicleOptions.ExteriorColor.TitaniumCopper | GLOBAL | Model S, Model X | Titanium Metallic (legacy warm grey/copper). #181510, metallic 0.8, roughness 0.04. REALWORLD: classic-gen S/X only. |
| `Red` | VehicleOptions.ExteriorColor.Red | GLOBAL | Model S, Model 3, Model X, Model Y | Generic Red alias — byte-identical to RedMulticoat (#0a0101, m0.1, r0.04). Legacy/generic name the backend may send. REALWORLD: same red family, S/3/X/Y. |
| `Black` | VehicleOptions.ExteriorColor.Black | GLOBAL | Model S, Model 3, Model X, Model Y | Generic Black alias — identical to SolidBlack (#0e0e0e, m1.0). REALWORLD: black family, S/3/X/Y. |
| `Silver` | VehicleOptions.ExteriorColor.Silver | GLOBAL | Model S, Model X | Generic Silver alias — identical to SilverMetallic/FALLBACK (#161616, m0.6). REALWORLD: classic S/X silver. |
| `Grey` | VehicleOptions.ExteriorColor.Grey | GLOBAL | Model S, Model 3, Model X, Model Y | Generic Grey alias — identical to MidnightSilver/SteelGrey (#131416, m0.8). REALWORLD: grey family, S/3/X/Y. |
| `Blue` | VehicleOptions.ExteriorColor.Blue | GLOBAL | Model S, Model X | Generic/legacy Blue (Ocean/Metallic Blue). #000104, metallic 0.6, roughness 0.04. REALWORLD: classic-gen S/X blue. |
| `White` | VehicleOptions.ExteriorColor.White | GLOBAL | Model S, Model X | Solid White (legacy, non-pearl). #141414, metallic 0.2, roughness 0.3. REALWORLD: early classic S/X solid white. |
| `Titanium` | VehicleOptions.ExteriorColor.Titanium | GLOBAL | Model S, Model X | Titanium alias — identical to TitaniumCopper (#181510, m0.8). REALWORLD: classic S/X titanium. |
| `Pearl` | VehicleOptions.ExteriorColor.Pearl | GLOBAL | Model S, Model X | Pearl alias (very low metallic variant). #131313, metallic 0.01, roughness 0.04. REALWORLD: white/pearl family; treated as legacy S/X. |
| `MetallicBlack` | VehicleOptions.ExteriorColor.MetallicBlack | GLOBAL | Model S, Model X | Obsidian Black Metallic — identical bytes to SolidBlack (#0e0e0e, m1.0). REALWORLD: classic-gen S/X metallic black. |
| `SteelGrey` | VehicleOptions.ExteriorColor.SteelGrey | GLOBAL | Model S, Model X | Steel Grey (legacy) — identical to MidnightSilver (#131416, m0.8). REALWORLD: classic-gen S/X grey. |
| `Green` | VehicleOptions.ExteriorColor.Green | GLOBAL | Model S, Model X | Green (legacy British Racing / Sequoia Green). #060a0a, metallic 0.8, roughness 0.04. REALWORLD: early classic S/X special-order green. |
| `Brown` | VehicleOptions.ExteriorColor.Brown | GLOBAL | Model S, Model X | Brown (legacy metallic brown). #181514, metallic 0.8, roughness 0.04. REALWORLD: early classic S/X special-order brown. |
| `SigRed` | VehicleOptions.ExteriorColor.SigRed | GLOBAL | Model S, Model X | Signature Red. #110305, metallic 0.7, roughness 0.04. REALWORLD: Signature-series / early classic S/X red. |
| `SignatureBlue` | VehicleOptions.ExteriorColor.SignatureBlue | GLOBAL | Model S, Model X | Signature Blue. #000206, metallic 0.2, roughness 0.04. REALWORLD: 2012 Model S Signature series (very limited); classic S/X. |
| `MidnightCherryRed` | VehicleOptions.ExteriorColor.MidnightCherryRed | GLOBAL | Model S, Model X | Midnight Cherry Red. #200006, metallic 0.8, roughness 0.01. REALWORLD: premium red on Palladium Model S/X (Plaid era, 2023+). |
| `Quicksilver` | VehicleOptions.ExteriorColor.Quicksilver | GLOBAL | Model S, Model 3, Model X, Model Y | Quicksilver. #2b2d35, metallic 0.85, roughness 0.2. REALWORLD: Palladium S/X (2023), Model 3 Highland (2023+), Model Y Juniper (2025). |
| `UltraRed` | VehicleOptions.ExteriorColor.UltraRed | GLOBAL | Model S, Model 3, Model X, Model Y | Ultra Red. #250006, metallic 0.7, roughness 0.05. REALWORLD: Palladium S/X (2023), Model 3 Highland, Model Y (dev sample assigns this to Model Y). |
| `StealthGrey` | VehicleOptions.ExteriorColor.StealthGrey | GLOBAL | Model 3, Model Y | Stealth Grey. #121417, metallic 0.88, roughness 0.1. REALWORLD: Model 3 Highland (2023+) and Model Y (refresh/Juniper); not an S/X factory color. |
| `LunarSilver` | VehicleOptions.ExteriorColor.LunarSilver | GLOBAL | Model 3, Model Y | Lunar Silver (lighter warm silver). #343438, metallic 0.898, roughness 0.28. REALWORLD LOW-CONFIDENCE: newer/region 3/Y silver; not renderer-restricted. |
| `GlacierBlue` | VehicleOptions.ExteriorColor.GlacierBlue | GLOBAL | Model 3, Model Y | Glacier Blue. #12161f, metallic 0.7, roughness 0.1. REALWORLD: Model Y Juniper (2025) new color; dev sample also assigns it to Model 3. |
| `DiamondBlack` | VehicleOptions.ExteriorColor.DiamondBlack | GLOBAL | Model 3, Model Y | Diamond Black. #040404, metallic 0.75, roughness 0.02. REALWORLD: Model Y Juniper (2025) black (replaced Solid Black); likely 3 Highland refresh too. |
| `FrostBlue` | VehicleOptions.ExteriorColor.FrostBlue | GLOBAL | Model 3, Model Y | Frost Blue. #111317, metallic 0.716, roughness 0.05. REALWORLD LOW-CONFIDENCE: newer/region 3/Y blue; not renderer-restricted. |
| `SilkroadSilver` | VehicleOptions.ExteriorColor.SilkroadSilver | GLOBAL | Model 3, Model Y | Silk Road Silver. #2d2c2d, metallic 0.826, roughness 0.204. REALWORLD: China-market (Giga Shanghai) Model 3/Y color. |
| `MarineBlue` | VehicleOptions.ExteriorColor.MarineBlue | GLOBAL | Model 3, Model Y | Marine Blue. #01050a, metallic 0.85, roughness 0.02. REALWORLD LOW-CONFIDENCE: newer/region deep blue (likely China-market 3/Y); not renderer-restricted. |
| `GarnetRed` | VehicleOptions.ExteriorColor.GarnetRed | GLOBAL | Model S, Model X | Garnet Red. #1d0305, metallic 0.8, roughness 0.05. REALWORLD LOW-CONFIDENCE: newer premium red; dev sample assigns it to Model S (lychee). |


### 5.2 Wheels (mobile wire keys)  (65 values)

*Fallback:* Unknown/absent wireKey -> DefaultWheelForVehicleType[car_type] (else WheelType.StilettoSilver); a resolved WheelType with no WheelTypeToPathMap entry -> StilettoSilver mesh (res://Ego/Wheels/Wheel_Stiletto_Silver.tscn).

*Resolution:* Resolution path: Vehicle.gd:681 -> set_wheel_type_by_name_with_vehicle_default(wheel_type, car_type) at Vehicle.gd:1278 does `VehicleOptions.MobileWheelTypeEnumMap.get(wheel_type_key)`; if the key is absent it falls back to `DefaultWheelForVehicleType.get(car_type, WheelType.StilettoSilver)`. Then set_wheel_type (Vehicle.gd:1302) resolves `WheelTypeToPathMap.get(type)` (fallback StilettoSilver mesh) and instances it. CRITICAL: this is fully GLOBAL — there is NO per-model gating; any mobile wireKey renders its mesh on any car_type. The only SOURCE-grounded per-model signals are (a) the Ego/Wheels_* asset-group directory the mesh lives in, and (b) DefaultWheelForVehicleType (model3->Pinwheel, modely->Gemini, modelx->SlipstreamSilver, tamarind[=Model X Palladium/refresh]->Cyberstream, models/models2/lychee[=Model S]->TempestSilver). Everything narrower than the asset group is REALWORLD (Tesla product fitment), NOT renderer-enforced. Asset-group -> model-family SOURCE ties: Ego/Wheels = Model 3 / Model Y legacy + shared; Ego/Wheels_X_S = Model S / X classic (pre-2021); Ego/Wheels_Palladium = Model S / X refresh (2021+ Palladium); Ego/v2023/Wheels = Model 3 Highland (2024); Ego/Wheels_Bayberry = Model Y Juniper (2025); Ego/Wheels_P3 = performance/aftermarket kits (not tied to one model in source -> GLOBAL). Aliases / many-to-one: MANY mobile wireKeys collapse to the same enum/mesh — e.g. Apollo19 AND Gemini19Square AND Gemini19Staggered all -> WheelType.Gemini; Stiletto19/Stiletto20 -> StilettoSilver; UberTurbine21Black/UberTurbine20Gunpowder -> UberTurbine; Charcoal21/Charcoal21Euro/Super21Gray -> TurbineBlack; Silver21/Silver21Euro/Super21Silver/Turbine19/Turbine22 -> TurbineSilver; AeroTurbine19/AeroTurbine20 -> SlipstreamSilver; Slipstream19Carbon/Slipstream20Carbon/AeroTurbine19Black -> SlipstreamCarbon; AeroTurbine20Dark/Slipstream20Dark -> SlipstreamDark; Cyclone19Dark -> CycloneCarbon; Pinwheel18CapKit/PinwheelRefresh18CapKit -> PinwheelNoCap. So the size/staggered-vs-square hints in the wireKey NAME are cosmetic labels the renderer discards — the mesh is identical. Sizes in each meaning are read from the wireKey string, not from geometry. Anomaly: WheelType.D50_18 (wireKey D5018) mesh path is res://Ego/Wheels/Wheel_D50.tscn — it lives in the shared Ego/Wheels dir, NOT Ego/v2023/Wheels, even though D50/Photon is a Model 3 Highland base wheel. Also Apollo19 wireKey resolves to the Gemini mesh (not Apollo); the Apollo mesh is only reachable via Apollo19CapKit and Apollo19MetallicShadow. SCOPE: Model S/3/X/Y only. Excluded per instructions and NOT listed: CTBase18/CTBase20/CTPremium20 (Cybertruck) — the only Cybertruck entries in MobileWheelTypeEnumMap; no Semi/Cybercab entries exist in the mobile map (SemiDefault is not exposed via MobileWheelTypeEnumMap). Total mobile wireKeys = 65; 62 in-scope S/3/X/Y (below), 3 excluded Cybertruck.


| wireKey | enumName | assetOrPath | modelFamilies | meaning |
|---|---|---|---|---|
| `Apollo19` | WheelType.Gemini | res://Ego/Wheels/Wheel_Gemini.tscn | Model Y | 19in — resolves to Gemini mesh (Model Y split-spoke aero); Ego/Wheels (3/Y-legacy & shared). Despite the 'Apollo' name it renders Gemini. |
| `Apollo19CapKit` | WheelType.Apollo | res://Ego/Wheels/Wheel_Apollo.tscn | Model 3 | 19in — Apollo (aero-cap kit variant); Ego/Wheels (3/Y-legacy & shared). Narrowed to Model 3 by fitment. |
| `Gemini19Square` | WheelType.Gemini | res://Ego/Wheels/Wheel_Gemini.tscn | Model Y | 19in — Gemini (Model Y base aero, square/non-staggered); Ego/Wheels. Model Y default (DefaultWheelForVehicleType.modely=Gemini). |
| `Gemini19Staggered` | WheelType.Gemini | res://Ego/Wheels/Wheel_Gemini.tscn | Model Y | 19in — Gemini (staggered label, same mesh as square); Ego/Wheels. Model Y default. |
| `Induction20Black` | WheelType.Induction | res://Ego/Wheels/Wheel_Induction.tscn | Model Y | 20in — Induction (Model Y Perf/LR option); Ego/Wheels (3/Y-legacy & shared). Narrowed to Model Y by fitment. |
| `Pinwheel18` | WheelType.Pinwheel | res://Ego/Wheels/Wheel_Pinwheel.tscn | Model 3 | 18in — Pinwheel aero (Model 3 base, with cover); Ego/Wheels. Model 3 default (DefaultWheelForVehicleType.model3=Pinwheel). |
| `PinwheelRefresh18` | WheelType.PinwheelRefresh | res://Ego/Wheels/Wheel_Pinwheel_Refresh.tscn | Model 3 | 18in — Pinwheel refresh aero (Model 3 pre-Highland refresh); Ego/Wheels. Narrowed to Model 3 by fitment. |
| `Pinwheel18CapKit` | WheelType.PinwheelNoCap | res://Ego/Wheels/Wheel_Pinwheel_No_Cap.tscn | Model 3 | 18in — Pinwheel with aero cap removed (bare face); Ego/Wheels. Model 3. |
| `PinwheelRefresh18CapKit` | WheelType.PinwheelNoCap | res://Ego/Wheels/Wheel_Pinwheel_No_Cap.tscn | Model 3 | 18in — Pinwheel refresh, cap removed (same PinwheelNoCap mesh); Ego/Wheels. Model 3. |
| `Stiletto19` | WheelType.StilettoSilver | res://Ego/Wheels/Wheel_Stiletto_Silver.tscn | Model 3 | 19in — Stiletto silver; Ego/Wheels (3/Y-legacy & shared). Narrowed to Model 3 by fitment. (StilettoSilver is also the global fallback mesh.) |
| `Stiletto20` | WheelType.StilettoSilver | res://Ego/Wheels/Wheel_Stiletto_Silver.tscn | Model 3 | 20in — Stiletto silver (same mesh as Stiletto19); Ego/Wheels. Model 3. |
| `Stiletto20DarkSquare` | WheelType.StilettoDark | res://Ego/Wheels/Wheel_Stiletto_Dark.tscn | Model 3 | 20in — Stiletto dark (square label); Ego/Wheels. Model 3. |
| `Stiletto20DarkStaggered` | WheelType.StilettoDark | res://Ego/Wheels/Wheel_Stiletto_Dark.tscn | Model 3 | 20in — Stiletto dark (staggered label, same mesh); Ego/Wheels. Model 3. |
| `StilettoRefresh19` | WheelType.StilettoRefresh | res://Ego/Wheels/Wheel_Stiletto_Refresh.tscn | Model 3 | 19in — Stiletto refresh; Ego/Wheels. Model 3. |
| `UberTurbine21Black` | WheelType.UberTurbine | res://Ego/Wheels/Wheel_Uberturbine.tscn | Model Y | 21in — Uberturbine (Model Y Performance); Ego/Wheels (3/Y-legacy & shared). Narrowed to Model Y by size (21in Uberturbine = Model Y Perf). |
| `UberTurbine20Gunpowder` | WheelType.UberTurbine | res://Ego/Wheels/Wheel_Uberturbine.tscn | Model 3 | 20in — Uberturbine gunpowder (Model 3 Performance); same mesh as 21in. Ego/Wheels. Narrowed to Model 3 by size (20in Uberturbine = Model 3 Perf). |
| `ZeroG19Gunpowder` | WheelType.ZeroG | res://Ego/Wheels/Wheel_ZeroG.tscn | Model 3 | 19in — Zero-G gunpowder; Ego/Wheels (3/Y-legacy & shared). Narrowed to Model 3 by fitment. |
| `ZeroG20Gunpowder` | WheelType.ZeroG | res://Ego/Wheels/Wheel_ZeroG.tscn | Model 3 | 20in — Zero-G gunpowder (same mesh as 19in); Ego/Wheels. Model 3. |
| `Apollo19MetallicShadow` | WheelType.Apollo_19_Metallic_Shadow | res://Ego/Wheels/Wheel_Apollo_19_Metallic_Shadow.tscn | Model 3 | 19in — Apollo Metallic Shadow finish; Ego/Wheels (3/Y-legacy & shared). Narrowed to Model 3 by fitment. (The parallel enum WheelType.Apollo19MetallicShadow points at the same mesh but is only reachable via GTW, not mobile.) |
| `Aero19` | WheelType.Aero | res://Ego/Wheels_X_S/Wheel_Aero.tscn | Model S, Model X | 19in — Aero (Model S/X classic base aero); Ego/Wheels_X_S (S/X classic). |
| `AeroTurbine19` | WheelType.SlipstreamSilver | res://Ego/Wheels_X_S/Wheel_Slipstream_Silver.tscn | Model S, Model X | 19in — resolves to Slipstream silver; Ego/Wheels_X_S (S/X classic). SlipstreamSilver is the Model X classic default (DefaultWheelForVehicleType.modelx). |
| `AeroTurbine20` | WheelType.SlipstreamSilver | res://Ego/Wheels_X_S/Wheel_Slipstream_Silver.tscn | Model S, Model X | 20in — Slipstream silver (same mesh as AeroTurbine19); Ego/Wheels_X_S (S/X classic). |
| `AeroTurbine19Black` | WheelType.SlipstreamCarbon | res://Ego/Wheels_X_S/Wheel_Slipstream_Sonic_Carbon.tscn | Model S, Model X | 19in — Slipstream sonic carbon (dark); Ego/Wheels_X_S (S/X classic). |
| `AeroTurbine20Dark` | WheelType.SlipstreamDark | res://Ego/Wheels_X_S/Wheel_Slipstream_Two_Tone.tscn | Model S, Model X | 20in — Slipstream two-tone/dark; Ego/Wheels_X_S (S/X classic). |
| `Arachnid21` | WheelType.Arachnid | res://Ego/Wheels_Palladium/Arachnid21.tscn | Model S, Model X | 21in — Arachnid (Model S Plaid / X refresh); Ego/Wheels_Palladium (S/X refresh). Real-world most associated with Model S Plaid. |
| `Arachnid21Silver` | WheelType.ArachnidSilver | res://Ego/Wheels_X_S/Wheel_Arachnid_Silver.tscn | Model S, Model X | 21in — Arachnid silver (classic Arachnid mesh, S/X); Ego/Wheels_X_S (S/X classic). |
| `Arachnid21Black` | WheelType.ArachnidBlack | res://Ego/Wheels_X_S/Wheel_Arachnid_Armor_Black.tscn | Model S, Model X | 21in — Arachnid armor black; Ego/Wheels_X_S (S/X classic). |
| `Arachnid21Grey` | WheelType.ArachnidCarbon | res://Ego/Wheels_X_S/Wheel_Arachnid_Sonic_Carbon.tscn | Model S, Model X | 21in — Arachnid sonic carbon (grey); Ego/Wheels_X_S (S/X classic). |
| `Base19` | WheelType.BaseSilver | res://Ego/Wheels_X_S/Wheel_Base_Silver.tscn | Model S, Model X | 19in — Base silver; Ego/Wheels_X_S (S/X classic). |
| `Cyberstream20` | WheelType.Cyberstream | res://Ego/Wheels_Palladium/Cyberstream.tscn | Model X | 20in — Cyberstream (Model X refresh/Palladium); Ego/Wheels_Palladium (S/X refresh). Model X refresh default (DefaultWheelForVehicleType.tamarind=Cyberstream). |
| `Cardenio19` | WheelType.Cardenio | res://Ego/Wheels_Palladium/Cardenio.tscn | Model S | 19in — Cardenio (Model S refresh base); Ego/Wheels_Palladium (S/X refresh). Narrowed to Model S by fitment. |
| `Charcoal21` | WheelType.TurbineBlack | res://Ego/Wheels_X_S/Wheel_Turbine_Onyx_Black.tscn | Model S, Model X | 21in — Turbine onyx black; Ego/Wheels_X_S (S/X classic). |
| `Charcoal21Euro` | WheelType.TurbineBlack | res://Ego/Wheels_X_S/Wheel_Turbine_Onyx_Black.tscn | Model S, Model X | 21in — Turbine onyx black (Euro-market label, same mesh); Ego/Wheels_X_S (S/X classic). |
| `Cyclone19Dark` | WheelType.CycloneCarbon | res://Ego/Wheels_X_S/Wheel_Cyclone_Sonic_Carbon.tscn | Model S, Model X | 19in — Cyclone sonic carbon (dark); Ego/Wheels_X_S (S/X classic). (The CycloneSilver mesh exists but no mobile wireKey targets it.) |
| `Helix20` | WheelType.Helix | res://Ego/Wheels_X_S/Wheel_Helix_Silver.tscn | Model S, Model X | 20in — Helix silver (Model X classic Long Range); Ego/Wheels_X_S (S/X classic). Real-world most associated with Model X. |
| `TwinTurbine21Silver` | WheelType.TwinTurbineSilver | res://Ego/Wheels_X_S/Wheel_Twin_Turbine_Silver.tscn | Model S, Model X | 21in — Twin Turbine silver; Ego/Wheels_X_S (S/X classic). |
| `TwinTurbine21Carbon` | WheelType.TwinTurbineCarbon | res://Ego/Wheels_X_S/Wheel_Twin_Turbine_Sonic_Carbon.tscn | Model S, Model X | 21in — Twin Turbine sonic carbon; Ego/Wheels_X_S (S/X classic). |
| `Tempest19SonicSilver` | WheelType.TempestSilver | res://Ego/Wheels_X_S/Wheel_Tempest_Sonic_Silver.tscn | Model S, Model X | 19in — Tempest sonic silver; Ego/Wheels_X_S (S/X classic). Model S default (DefaultWheelForVehicleType.models/models2/lychee=TempestSilver). |
| `Silver21` | WheelType.TurbineSilver | res://Ego/Wheels_X_S/Wheel_Turbine_Silver.tscn | Model S, Model X | 21in — Turbine silver; Ego/Wheels_X_S (S/X classic). |
| `Silver21Euro` | WheelType.TurbineSilver | res://Ego/Wheels_X_S/Wheel_Turbine_Silver.tscn | Model S, Model X | 21in — Turbine silver (Euro label, same mesh); Ego/Wheels_X_S (S/X classic). |
| `Slipstream19Carbon` | WheelType.SlipstreamCarbon | res://Ego/Wheels_X_S/Wheel_Slipstream_Sonic_Carbon.tscn | Model S, Model X | 19in — Slipstream sonic carbon; Ego/Wheels_X_S (S/X classic). |
| `Slipstream20Carbon` | WheelType.SlipstreamCarbon | res://Ego/Wheels_X_S/Wheel_Slipstream_Sonic_Carbon.tscn | Model S, Model X | 20in — Slipstream sonic carbon (same mesh as 19in); Ego/Wheels_X_S (S/X classic). |
| `Slipstream20Dark` | WheelType.SlipstreamDark | res://Ego/Wheels_X_S/Wheel_Slipstream_Two_Tone.tscn | Model S, Model X | 20in — Slipstream two-tone/dark; Ego/Wheels_X_S (S/X classic). |
| `Super21Gray` | WheelType.TurbineBlack | res://Ego/Wheels_X_S/Wheel_Turbine_Onyx_Black.tscn | Model S, Model X | 21in — Turbine onyx black (Super label); Ego/Wheels_X_S (S/X classic). |
| `Super21Silver` | WheelType.TurbineSilver | res://Ego/Wheels_X_S/Wheel_Turbine_Silver.tscn | Model S, Model X | 21in — Turbine silver (Super label); Ego/Wheels_X_S (S/X classic). |
| `NewTurbine22Black` | WheelType.NewTurbine22Black | res://Ego/Wheels_Palladium/New_Turbine_22.tscn | Model S, Model X | 22in — New Turbine black (Model S/X refresh); Ego/Wheels_Palladium (S/X refresh). |
| `Turbine19` | WheelType.TurbineSilver | res://Ego/Wheels_X_S/Wheel_Turbine_Silver.tscn | Model S, Model X | 19in — Turbine silver (same mesh as 21in Turbine silver); Ego/Wheels_X_S (S/X classic). |
| `Turbine19Dark` | WheelType.TurbineBlack | res://Ego/Wheels_X_S/Wheel_Turbine_Onyx_Black.tscn | Model S, Model X | 19in — Turbine onyx black; Ego/Wheels_X_S (S/X classic). |
| `Turbine22` | WheelType.TurbineSilver | res://Ego/Wheels_X_S/Wheel_Turbine_Silver.tscn | Model S, Model X | 22in — Turbine silver (same mesh); Ego/Wheels_X_S (S/X classic). |
| `Turbine22Dark` | WheelType.TurbineBlack | res://Ego/Wheels_X_S/Wheel_Turbine_Onyx_Black.tscn | Model S, Model X | 22in — Turbine onyx black; Ego/Wheels_X_S (S/X classic). |
| `Glider18` | WheelType.Glider | res://Ego/v2023/Wheels/Glider.tscn | Model 3 | 18in — Glider aero (Model 3 Highland base); Ego/v2023/Wheels (3 Highland). |
| `Helix19` | WheelType.Helix19 | res://Ego/v2023/Wheels/Helix_19.tscn | Model 3 | 19in — Helix (Model 3 Highland); Ego/v2023/Wheels (3 Highland). Distinct mesh from the S/X Helix. |
| `Wishbone19Staggered` | WheelType.Wishbone_19 | res://Ego/v2023/Wheels/Wishbone_19.tscn | Model 3 | 19in — Wishbone (Model 3 Highland); Ego/v2023/Wheels (3 Highland). |
| `Wishbone20Staggered` | WheelType.Wishbone_20 | res://Ego/v2023/Wheels/Wishbone_20.tscn | Model 3 | 20in — Wishbone (Model 3 Highland Performance); Ego/v2023/Wheels (3 Highland). |
| `D5018` | WheelType.D50_18 | res://Ego/Wheels/Wheel_D50.tscn | Model 3 | 18in — D50 (Model 3 Highland base wheel). MESH ANOMALY: path is Ego/Wheels/Wheel_D50.tscn (shared Ego/Wheels dir), NOT Ego/v2023/Wheels. Model family narrowed to Model 3 Highland by real-world naming, not by asset group. |
| `E4118` | WheelType.E41_18 | res://Ego/Wheels_Bayberry/BayberryE41/Wheel_E41.tscn | Model Y | 18in — E41 aero (Model Y Juniper base); Ego/Wheels_Bayberry (Y Juniper). |
| `Crossflow19` | WheelType.Crossflow_19 | res://Ego/Wheels_Bayberry/GeminiDark/GeminiDark.tscn | Model Y | 19in — Crossflow (GeminiDark mesh; Model Y Juniper); Ego/Wheels_Bayberry (Y Juniper). |
| `HelixV220` | WheelType.HelixV2_20 | res://Ego/Wheels_Bayberry/Helix2/Helix2.tscn | Model Y | 20in — Helix V2 (Model Y Juniper); Ego/Wheels_Bayberry (Y Juniper). |
| `HelixV220Dark` | WheelType.HelixV2_20_Dark | res://Ego/Wheels_Bayberry/Helix2_Dark/Helix2_Dark.tscn | Model Y | 20in — Helix V2 dark (Model Y Juniper); Ego/Wheels_Bayberry (Y Juniper). |
| `ArachnidV221` | WheelType.ArachnidV2_21 | res://Ego/Wheels_Bayberry/Arachnid_V2/Arachnid_V2_21.tscn | Model Y | 21in — Arachnid V2 (Model Y Juniper Performance); Ego/Wheels_Bayberry (Y Juniper). |
| `MachinaV219` | WheelType.MachinaV2_19 | res://Ego/Wheels_Bayberry/Machina2/Machina2.tscn | Model Y | 19in — Machina V2 (Model Y Juniper); Ego/Wheels_Bayberry (Y Juniper). |
| `Standard19` | WheelType.Standard_19 | res://Ego/Wheels_P3/Wheel_Standard.tscn |  | 19in — Standard (performance/aftermarket kit); Ego/Wheels_P3 (performance kits). Group not tied to a single model in source. |
| `Halo22` | WheelType.Halo22 | res://Ego/Wheels_P3/Wheel_Halo.tscn |  | 22in — Halo (performance/aftermarket kit); Ego/Wheels_P3 (performance kits). Not tied to a single model in source. |
| `Riptide20` | WheelType.Riptide20 | res://Ego/Wheels_P3/Wheel_Riptide.tscn |  | 20in — Riptide (performance/aftermarket kit); Ego/Wheels_P3 (performance kits). Not tied to a single model in source. |
| `Cypress21` | WheelType.Cypress21 | res://Ego/Wheels_P3/Wheel_Cypress_NoInsert.tscn |  | 21in — Cypress (no-insert variant; performance/aftermarket kit); Ego/Wheels_P3 (performance kits). Not tied to a single model in source. |


### 5.3 Interior trims  (25 values)

*Resolution:* RESOLUTION PATH. Two independent wire paths land on the same InteriorConfig enum (VehicleOptions.gd:57-67): (1) PRIMARY — vehicle_config.interior_trim_type (String; VehicleData.gd:25,62, default "Black"). Vehicle.set_interior_type(type) [Vehicle.gd:1510] does VehicleOptions.InteriorMap.get(type, InteriorConfig.Black) -> set_interior_config(). Unknown/missing key => InteriorConfig.Black. These are the InteriorMap keys (VehicleOptions.gd:346-370). (2) SECONDARY/parallel — set_interior_by_viz_name(name) [Vehicle.gd:1298] does VehicleOptions.VizInteriorMap[name] (DIRECT index, NO default -> an unknown viz name would error) -> set_interior_config(). These are the VizInteriorMap keys (VehicleOptions.gd:372-384). I could not find a live caller of set_interior_by_viz_name in the in-scope files (only Ghost.gd:10 stubs it out); it is a GTW/viz-name entry point that resolves to the SAME enum. Included for completeness. HOW InteriorConfig RENDERS (the actual per-model narrowing signal). Base Vehicle.set_interior_config (Vehicle.gd:983-999) is the fallback every model inherits and only branches on 3 seat colors: {White,White2,WhiteCarbonFiber}->Interior_White, {Black,Black2,BlackCarbonFiber}->Interior_Black, {Cream,CreamCarbonFiber}->Interior_Cream. Note base COLLAPSES *2 and *CarbonFiber into the plain color, and has NO arm for TacticalGrey (mat stays null => nothing applied). - CARBON FIBER + WOOD DECOR is a distinct look ONLY on the Palladium generation: Palladium.set_interior_config (Palladium.gd:256-287) additionally loads Carbon_Fiber.material onto the "Wood" mesh for the three *CarbonFiber values, and Wood_Ebony (Black) / Wood_Walnut (White,Cream) otherwise, plus Sport_Seats_Interior_*. Palladium.gd is used by car_type "lychee" (Ego/S_Palladium) and, via Model_X_Palladium.gd, by "tamarind" (Ego/X_Palladium). On legacy S ("models"/"models2", Model_S.gd) and legacy X ("modelx", Model_X.gd) and all Model 3/Y, carbon* renders IDENTICALLY to its plain color (base fallback) — SOURCE narrowing: the carbon/decor branch only exists in Palladium.gd. This is the "carbon/decor only Palladium" fact. - BLACK2 / WHITE2 = Model 3 / Model Y "refresh" center-console + door-card geometry. is_new_interior := interior==Black2 or ==White2 toggles center_console2 / door_card2 / door_decor nodes in Model_3.gd:104-126 and Model_Y.gd:149-178 (and subclasses Poppyseed.gd [new Model 3 / Highland] and Bayberry/BayberryE41/BayberryE80 [new Model Y / Juniper]). On S/X (base + Palladium) Black2/White2 are just grouped with Black/White — no separate console. SOURCE: the is_new_interior branch + center_console2 node exist only in Model_3.gd / Model_Y.gd (+subclasses). - CREAM: rendered by base on every model, but only S/X give it bespoke decor (Palladium Wood_Walnut + Sport_Seats_Cream; legacy S/X plain Interior_Cream). Model_3/Model_Y set_interior_config only branch White/Black, so Cream falls through to base seat with default decor; Poppyseed uses default Decor_Textile; Bayberry has no Cream seat .tres. Cream on 3/Y is thus generic. REALWORLD: cream/tan is an S/X-only offering. - TACTICALGREY: no set_interior_config in scope (base, Palladium, Model_3, Model_Y, Poppyseed, Bayberry) has an arm for it => NO material applied => effective no-op on S/3/X/Y (interior keeps prior/default look). It is a Cybertruck interior. SOURCE: absent from every in-scope match; REALWORLD: never shipped on S/3/X/Y. ALIASES. InteriorMap: AllBlack, EbonyBlack -> Black; BlackAndWhite, WalnutWhite -> White; WalnutCream -> Cream. (Ebony/Walnut product names line up with Palladium's decor: Black->Wood_Ebony, White/Cream->Wood_Walnut.) VizInteriorMap: UNKNOWN, BLACK_DEFAULT, BLACK_BLACK_TRIM, TAN_DEFAULT -> Black (TAN is folded into Black!); WHITE_DEFAULT, WHITE_BLACK_TRIM -> White; CREAM_DEFAULT -> Cream. There is NO White2/Black2 key in VizInteriorMap and NO TacticalGrey/Carbon key in the primary sample configs (LocalDevMessageInjector only ever sends Black/White/Cream). CAR_TYPE -> SCRIPT/SCENE (scope S/3/X/Y only; ProductManager.gd:119-148, VehicleData.gd:6-9 maps VIN S->models2,3->model3,X->modelx,Y->modely): models/models2=Ego/S/Model_S.tscn(Model_S.gd, base only); lychee=Ego/S_Palladium(Palladium.gd, carbon+decor); modelx=Ego/X/Model_X.tscn(Model_X.gd, base only); tamarind=Ego/X_Palladium(Model_X_Palladium.gd extends Palladium, carbon+decor); model3=Ego/3_High/Model3_High.tscn(Model_3.gd) or Ego/v2023/Poppyseed(Poppyseed.gd extends Model_3) for basePoppyseed/performancePoppyseed/d50Poppyseed fascia; modely=Ego/Y_High(Model_Y.gd) or Ego/Bayberry\|BayberryE41\|BayberryE80(extend Model_Y.gd) for Bayberry fascia/long-wheel-base. Cybertruck/Semi/Cybercab excluded per scope. PROVENANCE NOTE: every listed wireKey lives in a GLOBAL map (InteriorMap / VizInteriorMap) and is accepted for ANY car_type — the renderer does not gate interior_trim_type per model. All per-model narrowing below is encoded in modelFamilies with SOURCE (a set_interior_config branch / node toggle grounds it) vs REALWORLD (renderer accepts it but Tesla never shipped it on that model).


| wireKey | enumName | provenance | modelFamilies | meaning |
|---|---|---|---|---|
| `Black` | InteriorConfig.Black | GLOBAL | models/models2 (SOURCE base Black arm), lychee (SOURCE Palladium Black+Wood_Ebony), modelx (SOURCE base), tamarind (SOURCE Palladium), model3 3_High+Poppyseed (SOURCE), modely Y_High+Bayberry (SOURCE) | All-black interior. Base seat mat Interior_Black; Palladium adds Wood_Ebony decor + Sport_Seats_Black |
| `AllBlack` | InteriorConfig.Black | GLOBAL | all S/3/X/Y (SOURCE, resolves to Black) | ALIAS of Black (InteriorMap.'AllBlack'->Black). Identical render to Black |
| `EbonyBlack` | InteriorConfig.Black | GLOBAL | lychee/tamarind (SOURCE Palladium Wood_Ebony), models2/modelx/model3/modely (SOURCE, plain black — no ebony wood) | ALIAS of Black. Product name for S/X black-with-ebony-wood; enum->Black which Palladium pairs with Wood_Ebony |
| `White` | InteriorConfig.White | GLOBAL | models/models2 (SOURCE base), lychee (SOURCE Palladium), modelx (SOURCE base), tamarind (SOURCE Palladium), model3 3_High+Poppyseed (SOURCE Decor_White), modely Y_High+Bayberry (SOURCE) | Black-and-white interior. Base seat Interior_White; Palladium Wood_Walnut+Sport_Seats_White; 3/Y Decor_White |
| `BlackAndWhite` | InteriorConfig.White | GLOBAL | all S/3/X/Y (SOURCE, resolves to White) | ALIAS of White (InteriorMap.'BlackAndWhite'->White) |
| `WalnutWhite` | InteriorConfig.White | GLOBAL | lychee/tamarind (SOURCE Palladium Wood_Walnut), others (SOURCE, plain white) | ALIAS of White. Product name for white interior w/ walnut wood; enum->White (Palladium pairs White with Wood_Walnut) |
| `Cream` | InteriorConfig.Cream | GLOBAL | lychee (SOURCE Palladium cream+walnut), tamarind (SOURCE Palladium), models2/modelx (SOURCE base Interior_Cream), model3/modely (SOURCE base cream seat only; REALWORLD: 3/Y never shipped cream) | Cream interior. Base Interior_Cream; Palladium Sport_Seats_Cream+Wood_Walnut. On 3/Y falls to base seat with default decor (no bespoke cream) |
| `WalnutCream` | InteriorConfig.Cream | GLOBAL | lychee/tamarind (SOURCE Palladium), others (SOURCE base) | ALIAS of Cream (InteriorMap.'WalnutCream'->Cream) |
| `Black2` | InteriorConfig.Black2 | GLOBAL | model3 3_High+Poppyseed (SOURCE refresh console), modely Y_High+Bayberry (SOURCE refresh console), models2/lychee/modelx/tamarind (SOURCE: base groups Black2 with Black — renders as plain Black, no new console) | Black interior on the Model 3/Y REFRESH console. is_new_interior=true toggles center_console2 + door_card2/decor geometry. Base/Palladium collapse it to plain Black |
| `White2` | InteriorConfig.White2 | GLOBAL | model3 3_High+Poppyseed (SOURCE refresh console), modely Y_High+Bayberry (SOURCE refresh console), models2/lychee/modelx/tamarind (SOURCE: renders as plain White) | White interior on Model 3/Y REFRESH console (is_new_interior branch). Base/Palladium collapse to plain White |
| `CarbonBlack` | InteriorConfig.BlackCarbonFiber | GLOBAL | lychee (SOURCE Palladium carbon), tamarind (SOURCE Palladium carbon), models2/modelx/model3/modely (SOURCE: base collapses to plain Black — carbon NOT rendered) | Black seats + carbon-fiber decor. Distinct carbon look ONLY on Palladium (Carbon_Fiber.material on 'Wood' mesh). Elsewhere = plain Black |
| `CarbonWhite` | InteriorConfig.WhiteCarbonFiber | GLOBAL | lychee (SOURCE Palladium carbon), tamarind (SOURCE Palladium carbon), models2/modelx/model3/modely (SOURCE: renders plain White) | White seats + carbon decor. Distinct only on Palladium; else = plain White |
| `CarbonCream` | InteriorConfig.CreamCarbonFiber | GLOBAL | lychee (SOURCE Palladium carbon), tamarind (SOURCE Palladium carbon), models2/modelx (SOURCE: plain cream), model3/modely (SOURCE base cream; REALWORLD n/a) | Cream seats + carbon decor. Distinct only on Palladium; else = plain Cream |
| `TacticalGrey` | InteriorConfig.TacticalGrey | GLOBAL | S/3/X/Y all (SOURCE: absent from every in-scope match arm — no-op), REALWORLD: Cybertruck-only, never on S/3/X/Y | Tactical grey. NO set_interior_config arm handles it in any S/3/X/Y script => mat null => no material applied (effective no-op, keeps default). Cybertruck interior |
| `BLACK_DEFAULT` | InteriorConfig.Black | GLOBAL | all S/3/X/Y (viz path -> Black) | VIZ-PATH key (VizInteriorMap, via set_interior_by_viz_name — NOT interior_trim_type). Resolves to Black |
| `UNKNOWN` | InteriorConfig.Black | GLOBAL | all (viz path -> Black) | VIZ-PATH fallback key -> Black (the only reason set_interior_by_viz_name doesn't crash on unknowns is callers pass 'UNKNOWN') |
| `BLACK_BLACK_TRIM` | InteriorConfig.Black | GLOBAL | all (viz path -> Black) | VIZ-PATH key -> Black (upper-trim variant folded to plain Black) |
| `TAN_DEFAULT` | InteriorConfig.Black | GLOBAL | all (viz path -> Black; tan not distinctly rendered) | VIZ-PATH key. NOTE: Tan is FOLDED INTO Black (VizInteriorMap.TAN_DEFAULT->InteriorConfig.Black), not Cream — there is no dedicated tan render |
| `WHITE_DEFAULT` | InteriorConfig.White | GLOBAL | all (viz path -> White) | VIZ-PATH key -> White |
| `WHITE_BLACK_TRIM` | InteriorConfig.White | GLOBAL | all (viz path -> White) | VIZ-PATH key -> White (upper-trim variant folded to White) |
| `CREAM_DEFAULT` | InteriorConfig.Cream | GLOBAL | lychee/tamarind (SOURCE Palladium cream), others (base/none) | VIZ-PATH key -> Cream |
| `BLACK_CARBON_FIBER` | InteriorConfig.BlackCarbonFiber | GLOBAL | lychee/tamarind (SOURCE Palladium carbon), others (plain Black) | VIZ-PATH key -> BlackCarbonFiber (distinct carbon only on Palladium) |
| `WHITE_CARBON_FIBER` | InteriorConfig.WhiteCarbonFiber | GLOBAL | lychee/tamarind (SOURCE Palladium carbon), others (plain White) | VIZ-PATH key -> WhiteCarbonFiber (distinct only on Palladium) |
| `CREAM_CARBON_FIBER` | InteriorConfig.CreamCarbonFiber | GLOBAL | lychee/tamarind (SOURCE Palladium carbon), others (plain Cream) | VIZ-PATH key -> CreamCarbonFiber (distinct only on Palladium) |
| `TACTICAL_GREY` | InteriorConfig.TacticalGrey | GLOBAL | S/3/X/Y all (SOURCE no-op), REALWORLD Cybertruck-only | VIZ-PATH key -> TacticalGrey. Same as TacticalGrey wireKey: no-op on S/3/X/Y (no set_interior_config arm) |


### 5.4 Seating (3rd row + rear seat type)  (10 values)

*Resolution:* RESOLUTION PATH. Wire parsing (VehicleData.gd): :63 rear_seat_type = getValue('rear_seat_type', RearSeatType.BASE) [raw int, NO string map]; :64 third_row_seats = ThirdRowSeatValue.get(getValue('third_row_seats','None'), ThirdRowSeatType.NONE) [string->enum map :94-101]. Enums: RearSeatType{BASE=0,RECARO=1,EXECUTIVE=2,TWO_SEAT=3,FOLD_FLAT=4} (:85-91); ThirdRowSeatType{INVALID=0,NONE=1,FUTURIS_FOLD_FLAT=2,FUTURIS_NO_FOLD_FLAT=3,FLAT_FOLD=4} (:93). GATING (third_row gates rear_seat) — core structure: - Model_X.gd:92-101 (car_type 'tamarind', scene Ego/X/Model_X.tscn): has_3_rows = third_row_seats != NONE. If NOT has_3_rows -> 5-seat (rear_seat_type IGNORED). If has_3_rows -> rear_seat_type is tiebreaker: TWO_SEAT or null -> 6-seat, else -> 7-seat. So on X, rear_seat_type ONLY matters once third_row supplies a 3rd row, and only distinguishes 6 vs 7. EXECUTIVE/BASE/RECARO/FOLD_FLAT all land in else -> 7-seat. - Model_X_Palladium.gd:69-78 (scene Ego/X_Palladium/X_Palladium.tscn): has_3_rows = third_row_seats != NONE OR rear_seat_type == EXECUTIVE. EXECUTIVE ALONE forces 3 rows even with third_row_seats='None'. Then 6-seat if rear_seat_type in {TWO_SEAT, EXECUTIVE, null}; else 7-seat. This is the ONE place EXECUTIVE breaks the third_row gate. - Model_Y.gd:137-139 (scene Ego/Y_High/ModelY_High.tscn, only 5/7 nodes): has_3_rows = third_row_seats != NONE -> 7-seat else 5-seat. rear_seat_type NEVER read by Y. No 6-seat node exists for Y. - Model_S.gd:138,178-182 (car_type 'lychee'/'models', scene Ego/S/Model_S.tscn): reads rear_seat_type ONLY (third_row_seats NEVER read). EXECUTIVE toggles Interior_Executive(_RHD) vs base Interior_(l/r)hd. No seat-count concept; S not gated by third_row. - Model_3.gd: neither field read anywhere -> both inert for Model 3. SCENE-NODE PROVENANCE (SOURCE, verified in .tscn): - Ego/X/Model_X.tscn: Interior_5_seater(_RHD), Interior_6_Seater(_RHD), Interior_7_Seater(_RHD) -> X supports 5/6/7-seat, LHD+RHD (Model_X.gd:81-86). - Ego/X_Palladium/X_Palladium.tscn: Interior_5_seater, Interior_6_seater_{Left,Center,Right}, Interior_7_seater (each +_Color; no RHD split) -> X-Palladium supports 5/6/7, EXECUTIVE-forced 6. - Ego/Y_High/ModelY_High.tscn: ONLY Interior_5_seater + Interior_7_seater (+_Color) -> Y supports 5/7 only. - Ego/S/Model_S.tscn: Interior_Executive, Interior_Executive_RHD (+ base Interior/Interior_RHD) with Ego/S/Objects/Interior_Executive(_RHD).obj -> S supports BASE vs EXECUTIVE rear interior only. SAMPLE CONFIGS (LocalDevMessageInjector.gd): _base_vehicle_config():337 sets 'third_row_seats':'None' and does NOT set rear_seat_type (defaults BASE=0). All four in-scope samples (_vehicle_config_model_s :349 'lychee', _model_3 :363 'model3', _model_x :377 'tamarind', _model_y :391 'modely') inherit base and override NEITHER field -> every dev sample renders 5-seat (X/Y) / base interior (S). No sample exercises 6/7-seat or Executive. CROSS-DIM GOTCHAS: (1) rear_seat_type has NO string->enum map; app must send the raw int; an out-of-range int never matches a branch -> behaves like BASE. (2) third_row_seats literal '<invalid>' maps to INVALID(0) which is != NONE(1), so it PRODUCES a 3rd row rather than suppressing one; only 'None' (or an unrecognized string hitting map default NONE) yields 5-seat. (3) '== null' rear_seat_type checks in Model_X/Palladium are dead in practice because :63 always defaults to BASE(0), never null, but the branch exists in source. All per-model narrowing here is SOURCE-grounded (script branches + scene nodes + per-model defaults), NOT REALWORLD.


| wireKey | enumName | provenance | modelFamilies | meaning |
|---|---|---|---|---|
| `None` | ThirdRowSeatType.NONE (=1) | SOURCE | X, X-Palladium, Y | third_row_seats='None' (string) -> ThirdRowSeatType.NONE. The ONLY value the renderer treats as 'no 3rd row'. Default when key absent. |
| `FuturisFoldFlat` | ThirdRowSeatType.FUTURIS_FOLD_FLAT (=2) | SOURCE | X, X-Palladium, Y | third_row_seats='FuturisFoldFlat' (string) -> FUTURIS_FOLD_FLAT. Counts as has_3_rows (!= NONE) on X/X-Pal/Y. |
| `FuturisNoFoldFlat` | ThirdRowSeatType.FUTURIS_NO_FOLD_FLAT (=3) | SOURCE | X, X-Palladium, Y | third_row_seats='FuturisNoFoldFlat' (string) -> FUTURIS_NO_FOLD_FLAT. Counts as has_3_rows. |
| `FlatFold` | ThirdRowSeatType.FLAT_FOLD (=4) | SOURCE | X, X-Palladium, Y | third_row_seats='FlatFold' (string) -> FLAT_FOLD. Counts as has_3_rows. |
| `<invalid>` | ThirdRowSeatType.INVALID (=0) | SOURCE | X, X-Palladium, Y | third_row_seats='<invalid>' (string) -> ThirdRowSeatType.INVALID (=0). GOTCHA: INVALID != NONE, so has_3_rows evaluates TRUE. Renderer treats '<invalid>' as HAVING a 3rd row (X->6/7, Y->7). Unrecognized strings fall back to NONE via map default, but the literal '<invalid>' is explicitly mapped to INVALID and does NOT get that fallback. |
| `0` | RearSeatType.BASE | SOURCE | X, X-Palladium, S | rear_seat_type=0 (int) BASE. Default (VehicleData.gd:63). X/X-Pal: with 3rd row present -> 7-seat (else branch). S: non-executive interior shown. |
| `1` | RearSeatType.RECARO | SOURCE | X, X-Palladium, S | rear_seat_type=1 (int) RECARO. Not special-cased in any script branch -> behaves like BASE: X/X-Pal with 3rd row -> 7-seat; S -> non-executive interior. No dedicated RECARO mesh/branch in scope models. |
| `2` | RearSeatType.EXECUTIVE | SOURCE | S, X-Palladium | rear_seat_type=2 (int) EXECUTIVE. S: toggles Interior_Executive / Interior_Executive_RHD on, hides base interior (Model_S.gd:178-182). X-Palladium: forces has_3_rows TRUE and selects 6-seat (Model_X_Palladium.gd:70,75). X (non-Palladium): NOT special-cased -> else -> 7-seat when a 3rd row present. Y: ignored. |
| `3` | RearSeatType.TWO_SEAT | SOURCE | X, X-Palladium | rear_seat_type=3 (int) TWO_SEAT. X: with 3rd row -> 6-seat (Model_X.gd:98). X-Palladium: -> 6-seat (Model_X_Palladium.gd:75). Selects the 6-seater (captain's chairs) interior nodes. S/Y: ignored. |
| `4` | RearSeatType.FOLD_FLAT | SOURCE | X, X-Palladium, S | rear_seat_type=4 (int) FOLD_FLAT. Not special-cased in any in-scope script branch -> behaves like BASE/RECARO: X/X-Pal with 3rd row -> 7-seat; S -> non-executive interior. No dedicated FOLD_FLAT branch or mesh in S/3/X/Y scripts. |


### 5.5 Lighting / badging / trim / charge / booleans  (18 values)

*Resolution:* SCOPE: Model S/3/X/Y only. car_type→scene→script (mobile/scripts/data/ProductManager.gd:119-148): models/models2→Ego/S/Model_S.tscn=Model_S.gd(extends Vehicle); lychee→Ego/S_Palladium/S_Palladium.tscn=Palladium.gd; model3(original)→Ego/3_High/Model3_High.tscn=Model_3.gd; model3(*Poppyseed)→Ego/v2023/Poppyseed; modelx→Ego/X/Model_X.tscn=Model_X.gd; tamarind→Ego/X_Palladium/X_Palladium.tscn=Model_X_Palladium.gd(extends Palladium.gd); modely→Y_High/ModelY_High.tscn=Model_Y.gd, or Bayberry/BayberryE41/BayberryE80 by fascia/chassis. So "Palladium family" = lychee(S) + tamarind(X). ALL fields are wire-parsed globally in VehicleData.VehicleConfig._init (mobile/scripts/data/VehicleData.gd:48-83) with no per-model restriction; provenance=GLOBAL means base Vehicle.gd applies it to every car, provenance=SOURCE means the visible effect is gated by a script that only exists on the listed families (narrowing is renderer-grounded, not product-knowledge). No REALWORLD narrowing was needed here. GATING/CONDITIONAL flags (visible effect NOT unconditional): (1) rearlight_type — value Global also RELOCATES charge_port to chargeport_locator_global and GATES has_tesla_badge/has_tesla_word_mark (badge/wordmark meshes only shown when rearlight==Global, Palladium.gd:387,398). (2) has_tesla_badge & has_tesla_word_mark — only render when has_global_rearlight() true. (3) special_badging_type SIGNATURE_SERIES — signature brakes only load when red_brake_calipers/perf also true (Palladium.gd:293); also re-drives set_drivetrain_type so plaid_badge vs plaid_badge_signature swap depends on it. (4) drivetrain_type — plaid badge only visible when AWDTriMotor AND not signature (Palladium.gd:189-192); no visible effect on non-Palladium cars. (5) aux_park_lamps — only toggles fog_lights_cover node, and only on Model_3/Model_Y. (6) charge_port_type — cable only spawns while charger connected (Vehicle.update_charge_state, isChargerConnected). (7) headlamp_type — binary: only "Global" swaps geometry; "Premium"(default)/"Original"/anything-else all render Original. NO-OP FIELDS (parsed but zero renderer consumers anywhere under mobile/): has_stalk, has_front_fascia_camera. NOTE drivetrain_type has a +1 offset applied at parse (VehicleData.gd:75): wire 0→RWD,1→AWD,2→AWDTriMotor(Plaid). NOTE special_badging_type's wire key is car_special_type (VehicleData.gd:83), NOT special_badging_type.


| wireKey | enumName | provenance | modelFamilies | meaning |
|---|---|---|---|---|
| `headlamp_type` | VehicleOptions.HeadlampType | SOURCE | model3, modely, lychee, tamarind | String enum. Values seen: 'Original','Premium','Global'. VehicleOptions.HeadlampType{Original=0,Premium=1,Global=2}. Default 'Premium'. Binary effect: only 'Global' shows global headlamp/trunk/charge-cap geometry via hasGlobalHeadlamp()(=="Global"); Premium/Original both render Original. Applied by Model_3.set_headlamp_type (Model_3.gd:155,251), Model_Y.set_headlamp_type (Model_Y.gd:190,133), Palladium.set_headlamp_type_from_data (Palladium.gd:313). NO-OP on models/models2 (Model_S.gd has no headlamp handling) and modelx (Model_X.gd has none). |
| `rearlight_type` | VehicleOptions.RearLightType | SOURCE | lychee, tamarind | Int enum. VehicleOptions.RearLightType{Original=0,Global=2}. Default 0. Only Global(2) swaps rear lights/trunk/charge-cap/chargeport geometry AND relocates charge_port origin to chargeport_locator_global AND enables the tesla badge/wordmark meshes. Handled ONLY by Palladium.set_rearlight_type_from_data/set_rearlight_type (Palladium.gd:330-363,482). CONDITIONAL: gates tesla badge/wordmark. No consumer on Model_S/Model_3/Model_X/Model_Y. |
| `badging_material_type` | VehicleOptions.BadgingMaterialType | GLOBAL |  | Int enum. VehicleOptions.BadgingMaterialType{CHROME_SILVER=0,BLACK_MATTE=1}. Default -1. If >=0 applied directly; if <0 falls back to badge_version (<=V1 -> CHROME_SILVER else BLACK_MATTE). Applies material over the scene's 'badging' material set. Base Vehicle.gd so all families; visible only if scene defines badging_materials. |
| `car_special_type` | VehicleOptions.SpecialBadgingType | SOURCE | lychee, tamarind | Int enum (WIRE KEY is car_special_type, mapped to field special_badging_type). VehicleOptions.SpecialBadgingType{NONE=0,FOUNDATION_SERIES=1,LAUNCH_SERIES=2,SIGNATURE_SERIES=3}. Default 0. Only SIGNATURE_SERIES has a real branch: toggles node groups 'signature'/'not_signature', loads signature brakes (only if perf brakes also on), and switches plaid_badge->plaid_badge_signature. FOUNDATION/LAUNCH render same as NONE. Handled ONLY by Palladium.set_special_badging_type (Palladium.gd:365). CONDITIONAL (see notes). No consumer on non-Palladium cars. |
| `has_tesla_badge` |  | SOURCE | lychee, tamarind | Bool. Default true. Palladium.set_hide_tesla_badge(not has_tesla_badge) toggles tesla_badge_global mesh. CONDITIONAL: mesh only shown when rearlight_type==Global (has_global_rearlight()). Palladium-only; no-op on Model_S/3/X/Y. |
| `has_tesla_word_mark` |  | SOURCE | lychee, tamarind | Bool. Default true. Palladium.set_hide_tesla_wordmark(not has_tesla_word_mark) toggles tesla_wordmark_global mesh. CONDITIONAL: shown only when rearlight_type==Global. Palladium-only. |
| `red_brake_calipers` |  | GLOBAL |  | Bool. Default false. Vehicle.set_brakes(performance) swaps standard vs perf brake caliper models in all four sockets. Base Vehicle.gd -> all families. Palladium overrides to load signature calipers when special_badging==SIGNATURE_SERIES (else falls back to base). |
| `window_tint_color` |  | GLOBAL |  | String 'r,g,b,a' each 0-255. Default '0,0,0,153'. Vehicle.set_window_tint parses split_floats; must be exactly 4 values or ignored. Lerps glass shader tint per channel + alpha. Base Vehicle.gd -> all families. Sample values in injector: 0,0,0,128 / 170 / 190 / 153. |
| `exterior_trim` | Vehicle.ExteriorTrim | SOURCE | model3 | String. Vehicle.ExteriorTrim{Original=0,Black=1}; ExteriorTrimMap{'Chrome':Original,'Black':Black}. Default 'Black'. ONLY Model_3 reads the base exterior_trim field (Model_3.gd:247, override takes precedence). Model_S/Model_X use exterior_trim_override exclusively. Material differs per model (Model_3: Exterior_Hydroxide). |
| `exterior_trim_override` | Vehicle.ExteriorTrim | SOURCE | models, models2, model3, modelx | String (same 'Chrome'/'Black' map). Default ''. When non-empty overrides exterior_trim. Consumed by Model_3 (override precedence, Model_3.gd:248), Model_S.update (only source, Model_S.gd:139) and Model_X.update (only source, Model_X.gd:76). Empty string is ignored (early-return) in Model_S/Model_X. NO consumer in Model_Y or Palladium, so no-op on modely/lychee/tamarind. Trim material path differs per model (Model_X: Exterior_Black_Trim_Colorizer; Model_S1: Exterior_Original_Black_Trim_Colorizer; Model_S2: Exterior_Black_Trim_Colorizer). |
| `steering_wheel_type` | Palladium.SteeringWheelType | SOURCE | lychee, tamarind | Int enum. Palladium.SteeringWheelType{Standard=0,Yoke=1}. Default 0. Palladium.set_steering_wheel_type toggles steering_wheel_standard(+rhd) vs steering_wheel_yoke(+rhd) meshes. Handled ONLY by Palladium (Palladium.gd:231). Base Vehicle.gd and Model_S/3/X/Y have no setter, so no-op on non-Palladium. |
| `drivetrain_type` | Vehicle.DrivetrainType | SOURCE | lychee, tamarind | Int, PARSED WITH +1 OFFSET (VehicleData.gd:75): wire 0->RWD, 1->AWD, 2->AWDTriMotor(Plaid). Vehicle.DrivetrainType{None=0,RWD=1,AWD=2,AWDTriMotor=3}. Default wire 0 -> RWD. Base Vehicle.set_drivetrain_type only stores the value (no geometry). VISIBLE effect only in Palladium.set_drivetrain_type: shows plaid_badge when AWDTriMotor and not signature, else plaid_badge_signature (Palladium.gd:186-192). CONDITIONAL. No visible effect on Model_S/3/X/Y. |
| `rhd` |  | GLOBAL |  | Bool. Default false. Vehicle.set_rhd swaps interior_lhd/interior_rhd; per-model overrides swap steering/dashboard/screens and (Model_X) seat sets, (Model_S) executive-vs-normal interior, and door-open side mapping in Vehicle.update (RHD branch). Base + every per-model override -> all families. |
| `aux_park_lamps` |  | SOURCE | model3, modely | String. Default 'NaPremium'. VehicleData.hasFogLamps() = (aux_park_lamps != 'None'). Consumed ONLY by Model_3.update and Model_Y.update: set_node_visible(fog_lights_cover, not hasFogLamps()). 'None' -> fog cover shown (no fog lamps); any other value (incl default) -> cover hidden. CONDITIONAL/gating. No consumer on Model_S/Model_X/Palladium. |
| `spoiler_type` |  | GLOBAL |  | String. Default 'None'. Vehicle.set_has_spoiler(spoiler_type != 'None') toggles spoiler node. Values seen: 'None','CarbonFiber'. Base -> all families, BUT Model_X.update and Model_X_Palladium.update force set_has_spoiler(true) unconditionally (Model_X.gd:74, Model_X_Palladium.gd:51), so on modelx/tamarind spoiler is always on regardless of wire value. |
| `charge_port_type` |  | GLOBAL |  | String key into VehicleOptions.ChargePortTypeToCableMap. Keys: 'US'(Charging_Cable), 'EU'(IEC), 'GB'/'GB_AC'/'GB_DC'(IEC), 'CCS'(CCS2_V3). Default 'US'; unknown key falls back to 'US'. CONDITIONAL: cable only instanced while charger connected (Vehicle.update_charge_state -> add_charge_cable). Base -> all families. |
| `has_stalk` |  | GLOBAL |  | Bool. Default false. Parsed into VehicleConfig (VehicleData.gd:40,77) but has ZERO consumers anywhere under mobile/ — no renderer effect (no-op). Interior stalk geometry is not driven by this flag. |
| `has_front_fascia_camera` |  | GLOBAL |  | Bool. Default false. Parsed into VehicleConfig (VehicleData.gd:41,78) but has ZERO consumers anywhere under mobile/ — no renderer effect (no-op). |


### 5.6 Scene routing reference  (20 entries)

*Notes:* RESOLUTION PATH: mobile app sends vehicle_config in SHOW_PRODUCT/UPDATE_PRODUCT. ProductManager.get_resource_path_for_product() (mobile/scripts/data/ProductManager.gd:74) pulls model_key = vehicle_config.car_type (get_model_key_for_product, default 'modely' if config null), fascia_type (get_fascia_type_for_product, default 'original'), chassis_type (get_chassis_type_for_product, default 'model_y'), then calls get_vehicle_node_path(model_key, fascia_type, chassis_type, default=res://Ego/Y_High/ModelY_High.tscn) at line 119. That match{} on model_key IS the entire routing table transcribed above. VIN DECODE: VehicleData.gd:52 — inside VehicleConfig._init, if car_type == 'unknown' (i.e. server omitted it), car_type = vehicle_model_key_from_vin.get(vin[3], 'modely'). vin defaults to '0003' (VehicleData._init line 224), so vin[3] is the 4th character. Map (VehicleData.gd:5): S->models2, 3->model3, X->modelx, Y->modely, C->cybertruck, T->semitruck. Unmapped -> 'modely'. Note the S decode yields 'models2' (not 'models'/'lychee'), so a VIN-only Model S always renders the legacy S scene, never S_Palladium. PRECEDENCE RULES (all SOURCE, from get_vehicle_node_path): 1. Model S: car_type alone decides. 'models' and 'models2' -> Model_S.tscn; 'lychee' (Palladium/refresh codename) -> S_Palladium.tscn. fascia_type and chassis_type are never read for S. 2. Model X: car_type alone. 'modelx' -> Model_X.tscn; 'tamarind' (Palladium/refresh codename) -> X_Palladium.tscn. fascia/chassis never read for X. 3. Model 3: scene chosen by car_type + fascia_type. chassis_type is NOT read for Model 3. Poppyseed fascias {basePoppyseed, performancePoppyseed, d50Poppyseed} -> Poppyseed.tscn; everything else (incl. 'original' and default) -> Model3_High.tscn. 4. Model Y: chassis_type is evaluated FIRST and 'model_y_long_wheel_base' WINS over any fascia -> BayberryE80.tscn. Only when chassis is NOT LWB does fascia_type decide: e41Bayberry -> BayberryE41.tscn; {baseBayberry, performanceBayberry} -> Bayberry.tscn; else (incl. 'original'/default) -> ModelY_High.tscn. PROVENANCE: every route above is SOURCE — grounded directly in the get_vehicle_node_path switch and the VIN map, with all target .tscn files confirmed to exist on disk under /Users/ivan/Work/airgapp/godot/Ego/. There are no REALWORLD narrowings in this dimension (routing is fully renderer-enforced by the match statement). GENERATION/CODENAME KEY: models/models2 = legacy Model S; lychee = Model S Palladium refresh (S_Palladium). modelx = legacy Model X; tamarind = Model X Palladium refresh (X_Palladium). model3 original = pre-Highland Model 3 (3_High); *Poppyseed = Model 3 Highland (v2023/Poppyseed). modely original = Model Y (Y_High); *Bayberry = Model Y Juniper refresh (Bayberry / BayberryE41 for E41 fascia); model_y_long_wheel_base chassis = Model Y L / 3-row LWB (BayberryE80). DEFAULTS/GOTCHAS: (a) The default_node_path argument is res://Ego/Y_High/ModelY_High.tscn, so any unmatched car_type renders Model Y High. (b) get_chassis_type_for_product default is 'model_y' (not a case the modely branch matches), so a Model Y with missing chassis falls through to the fascia sub-switch — correct. (c) Model Y High scene (ModelY_High.tscn) is reachable both as the modely-fascia-default AND as the global unknown-model default. (d) Sample dev configs (LocalDevMessageInjector.gd): S=lychee/original/model_s, 3=model3/performancePoppyseed/model_3, X=tamarind/original/model_x, Y=modely/performanceBayberry/model_y — note the dev harness exercises the refresh generations (lychee/tamarind/Poppyseed/Bayberry), not the legacy models/models2/modelx or the LWB E80 path. OUT OF SCOPE (exist in the same switch but excluded per scope): 'semitruck' -> res://Ego/Semi/Semi.tscn; 'cybertruck' -> res://Ego/Cybertruck/Cybertruck.tscn; 'cybercab' -> res://Ego/Cybercab/Cybercab.tscn; plus vin[3] 'C'->cybertruck and 'T'->semitruck. These branches are present in get_vehicle_node_path / vehicle_model_key_from_vin but were intentionally not enumerated.


| car_type / fascia / chassis key | Scene | Notes |
|---|---|---|
| `models` | res://Ego/S/Model_S.tscn | Model S — legacy/classic generation. Routes by car_type ALONE; fascia_type and chassis_type are ignored. |
| `models2` | res://Ego/S/Model_S.tscn | Model S — legacy/classic generation (2nd variant key; same scene as 'models'). Routes by car_type ALONE. Also the vin[3]='S' decode target. |
| `lychee` | res://Ego/S_Palladium/S_Palladium.tscn | Model S — Palladium/refresh generation (codename 'lychee'). Routes by car_type ALONE; fascia/chassis ignored. Sample config uses chassis_type='model_s', fascia_type='original'. |
| `modelx` | res://Ego/X/Model_X.tscn | Model X — legacy/classic generation. Routes by car_type ALONE; fascia/chassis ignored. |
| `tamarind` | res://Ego/X_Palladium/X_Palladium.tscn | Model X — Palladium/refresh generation (codename 'tamarind'). Routes by car_type ALONE; fascia/chassis ignored. Sample config uses chassis_type='model_x', fascia_type='original'. |
| `model3 + fascia_type=original` | res://Ego/3_High/Model3_High.tscn | Model 3 — legacy/pre-Highland fascia. car_type=model3 chooses scene by fascia_type; 'original' -> High scene. chassis_type ignored for Model 3. |
| `model3 + fascia_type=basePoppyseed` | res://Ego/v2023/Poppyseed/Poppyseed.tscn | Model 3 — Highland refresh (codename 'Poppyseed'), base fascia. chassis_type ignored. |
| `model3 + fascia_type=performancePoppyseed` | res://Ego/v2023/Poppyseed/Poppyseed.tscn | Model 3 — Highland refresh (Poppyseed), Performance fascia. chassis_type ignored. This is the sample dev config for Model 3. |
| `model3 + fascia_type=d50Poppyseed` | res://Ego/v2023/Poppyseed/Poppyseed.tscn | Model 3 — Highland refresh (Poppyseed), d50 fascia variant. chassis_type ignored. |
| `model3 + fascia_type=<any other / default>` | res://Ego/3_High/Model3_High.tscn | Model 3 fallback: any fascia_type not in {original, basePoppyseed, performancePoppyseed, d50Poppyseed} (including missing -> resolves to 'original' upstream) falls through to the High scene. |
| `modely + chassis_type=model_y_long_wheel_base` | res://Ego/BayberryE80/BayberryE80.tscn | Model Y LWB (long wheel base). chassis_type is checked FIRST and WINS over fascia_type — any fascia is ignored when chassis is LWB. |
| `modely + chassis_type!=LWB + fascia_type=e41Bayberry` | res://Ego/BayberryE41/BayberryE41.tscn | Model Y — Juniper/Bayberry E41 fascia (chassis not LWB). Reached only when chassis_type != model_y_long_wheel_base. |
| `modely + chassis_type!=LWB + fascia_type=baseBayberry` | res://Ego/Bayberry/Bayberry.tscn | Model Y — Bayberry refresh, base fascia (chassis not LWB). |
| `modely + chassis_type!=LWB + fascia_type=performanceBayberry` | res://Ego/Bayberry/Bayberry.tscn | Model Y — Bayberry refresh, Performance fascia (chassis not LWB). This is the sample dev config for Model Y. |
| `modely + chassis_type!=LWB + fascia_type=<any other / default>` | res://Ego/Y_High/ModelY_High.tscn | Model Y fallback: chassis not LWB and fascia not in {e41Bayberry, baseBayberry, performanceBayberry} (including 'original' or missing) -> High scene. This is also the overall default target (default_node_path passed by get_resource_path_for_product). |
| `<unknown car_type / vehicle_config null>` | res://Ego/Y_High/ModelY_High.tscn | Any car_type not matched by the switch returns default_node_path. get_resource_path_for_product passes res://Ego/Y_High/ModelY_High.tscn as that default. Also, when vehicle_config is null, model_key falls back to 'modely', fascia to 'original', chassis to 'model_y' -> ModelY_High.tscn. |
| `vin[3]='S'` | res://Ego/S/Model_S.tscn | VIN 4th char (index 3) decode when car_type is absent/'unknown': maps to car_type 'models2' (Model S). Applied in VehicleConfig._init via vehicle_model_key_from_vin. |
| `vin[3]='3'` | res://Ego/3_High/Model3_High.tscn | VIN index-3 decode -> car_type 'model3' (Model 3). Default vin '0003' has vin[3]='3', so the default decode is Model 3. |
| `vin[3]='X'` | res://Ego/X/Model_X.tscn | VIN index-3 decode -> car_type 'modelx' (Model X, legacy). |
| `vin[3]='Y'` | res://Ego/Y_High/ModelY_High.tscn (via modely routing) | VIN index-3 decode -> car_type 'modely' (Model Y). Also the fallback for any unmapped vin[3] char (.get default is 'modely'). |

---

## 6. Cross-option gating graph  (60 constraints)

Every place a field's visible effect depends on another field, on the generation, or is auto-driven. This is the edge set that makes the tree a *tree* rather than a flat form.


| Field | Rule / condition | Effect | Applies to | Source |
|---|---|---|---|---|
| `car_type / fascia_type / chassis_type` | ProductManager.get_vehicle_node_path selects the scene+script from car_type first, then sub-branches. S/models,models2 -> Model_S.tscn(Model_S.gd); lychee -> S_Palladium(Palladium.gd); modelx -> Model_X; tamarind -> X_Palladium(Model_X_Palladium.gd); model3 fascia 'original' -> 3_High(Model_3.gd), fascia basePoppyseed/performancePoppyseed/d50Poppyseed -> Poppyseed.gd; modely chassis 'model_y_long_wheel_base' -> BayberryE80, else fascia e41Bayberry -> BayberryE41, base/performanceBayberry -> Bayberry, else Y_High(Model_Y.gd) | Which model script/geometry is instantiated at all; downstream field behavior differs per selected script | all | mobile/scripts/data/ProductManager.gd:119-160 |
| `chassis_type (LWB) vs fascia_type (Model Y)` | For modely, chassis_type=='model_y_long_wheel_base' returns BayberryE80.tscn BEFORE the fascia_type match is evaluated, so LWB overrides/short-circuits the fascia-based scene choice | CONFIRMED: LWB chassis forces the E80 body regardless of fascia_type; fascia only chooses scene when NOT LWB | modely | mobile/scripts/data/ProductManager.gd:149-159 |
| `exterior_color / paint_color_override` | set_paint_color_with_override applies the 5-float override string ('r,g,b,metallic,roughness') only when it split to exactly 5 values; otherwise falls back to the named exterior_color | Custom paint override gates/replaces the enum color; wrong-sized override string is ignored | all | mobile/scripts/Vehicles/Vehicle.gd:1368-1372 (set_paint_color_with_override), 1387-1401 (set_paint_color_override) |
| `colorizer_paint_remap_enabled` | remap_color() (v*=0.325) is applied to an override color ONLY when colorizer_paint_remap_enabled is true; toggling it re-applies the current override | Gates whether custom paint override colors are darkened/remapped | all | mobile/scripts/Vehicles/Vehicle.gd:345-348, 1398-1399, 1409-1413 |
| `wheel_type` | set_wheel_type_by_name_with_vehicle_default: if wheel_type name not in MobileWheelTypeEnumMap, falls back to DefaultWheelForVehicleType[car_type] (e.g. model3->Pinwheel, modely->Gemini, modelx->SlipstreamSilver, models/lychee->TempestSilver, tamarind->Cyberstream) | Unknown/absent wheel auto-resolves to a car_type-specific default wheel | all | mobile/scripts/Vehicles/Vehicle.gd:1278-1284; VehicleOptions.gd DefaultWheelForVehicleType |
| `spoiler_type -> has_spoiler` | Base update sets has_spoiler = (spoiler_type != 'None'). Overridden/forced on some models (see Model_X, X_Palladium, Poppyseed, Bayberry) | Spoiler mesh visibility | all | mobile/scripts/Vehicles/Vehicle.gd:680, 1007-1009 |
| `has_us_plate / has_eu_plate` | Mutually exclusive: setting one forces the other to its negation and toggles both plate meshes. update() drives from eu_vehicle | Exactly one of US/EU plate mesh visible | all | mobile/scripts/Vehicles/Vehicle.gd:677, 1011-1022 |
| `rhd -> interior side` | Base set_rhd shows interior_rhd / hides interior_lhd (and inverse). Per-model overrides additionally swap steering wheel, dashboard, screen, door cards | RHD/LHD interior geometry selection | all | mobile/scripts/Vehicles/Vehicle.gd:974-981 |
| `drive_state (isDriving) -> headlights_on` | set_is_driving auto-sets headlights_on = data.isDriving(); driving is shift_state != P | AUTO-DRIVE: headlights turn on whenever the car is in gear, independent of the headlights field | all | mobile/scripts/Vehicles/Vehicle.gd:1583-1585 |
| `turn_signal_l/r_state -> brake_lights` | Base set_turn_signal_*_state also toggles brake_lights_l/r visibility on state==1 (coupled with turn signal) | Turn-signal state co-drives same-side brake light node in base implementation | all | mobile/scripts/Vehicles/Vehicle.gd:938-948 |
| `badging_material_type / badge_version` | If vehicle_config.badging_material_type < 0 (unset), it is auto-derived: badge_version <= V1 -> CHROME_SILVER, else BLACK_MATTE | AUTO-DRIVE: badging material inferred from badge_version when not explicitly set | all | mobile/scripts/Vehicles/Vehicle.gd:724-730 |
| `fascia_type (string) -> FasciaType enum` | Base update() maps fascia_type strings ('original','basePoppyseed','performancePoppyseed','d50Poppyseed','baseBayberry','performanceBayberry','e41Bayberry') to VehicleOptions.FasciaType enum via set_fascia_type | Drives the fascia_type enum consumed by Poppyseed/Bayberry geometry logic | all | mobile/scripts/Vehicles/Vehicle.gd:705-719; VehicleOptions.gd FasciaType |
| `charge_port_open (roof-fade/charger)` | update_charge_state: charger cable added only when isChargerConnected; else if vehicle_to_home_ready, powershare home node added, otherwise removed | Charger cable vs powershare-home geometry gated on charge/V2H state | all | mobile/scripts/Vehicles/Vehicle.gd:1063-1087 |
| `interior_config (Black2/White2) - Model 3` | is_new_interior = (Black2 or White2) toggles center_console1/2, door_card1/2, door_decor visibility and swaps seat/decor (Wood_Walnut for Black, Decor_White for White) | 'New' interior variant gates console/door-card/decor geometry and materials | model3 (3_High) | mobile/scripts/Vehicles/Model_3.gd:104-126 |
| `headlamp_type (Global) - Model 3` | set_headlamp_type: is_global toggles headlights_object_original/global, lights_trunk_original/global, charge_cap_original/global (+right). Every light setter (fog/reverse/turn/drl/headlights/brake) is re-gated by is_global choosing original vs global node | CONFIRMED: Global headlamp swaps front/charge-cap GEOMETRY and each lamp uses global vs original nodes; Original/Premium share the same (non-global) geometry | model3 (3_High) | mobile/scripts/Vehicles/Model_3.gd:155-243 |
| `headlamp_type source - Model 3` | update() sets headlamp_type = Global if data.hasGlobalHeadlamp() else Original (Premium enum value never selected here) | Only Global vs Original ever chosen at runtime; hasGlobalHeadlamp == (headlamp_type_string=='Global') | model3 (3_High) | mobile/scripts/Vehicles/Model_3.gd:251; VehicleData.gd:273-274 |
| `aux_park_lamps -> fog_lights_cover` | fog_lights_cover shown when NOT hasFogLamps(); hasFogLamps() == (aux_park_lamps != 'None') | AUTO-DRIVE: fog-lamp cover mesh visibility inverse of aux_park_lamps presence | model3, modely | mobile/scripts/Vehicles/Model_3.gd:252, Model_Y.gd:134, Poppyseed.gd:279; VehicleData.gd:276-277 |
| `version (S1/S2) - Model S` | car_type=='models' -> Version.S1 else S2. set_version toggles body/bodyS2, bumperS1/S2, hood/hoodS2, lightsS1/S2, lights_glassS1/S2 AND rebinds drl/headlights/turn-signal node paths to Original vs new nodes | Generation (S1 legacy vs S2 refresh) swaps body/bumper/hood/light geometry and the light NodePaths themselves | models, models2 | mobile/scripts/Vehicles/Model_S.gd:51-73, 132-137 |
| `exterior_trim x version - Model S` | set_exterior_trim material depends on BOTH exterior_trim (Original/Black) and version (S1 uses Exterior_Original*.material, S2 uses Exterior*.material) | Exterior trim material selection is generation-dependent | models, models2 | mobile/scripts/Vehicles/Model_S.gd:104-125 |
| `rear_seat_type (EXECUTIVE) - Model S` | set_rear_seat_type: EXECUTIVE shows executive_interior_(rhd/lhd) and hides standard interior_(rhd/lhd); combined with rhd flag | Executive rear-seat option swaps the entire interior mesh (gated with RHD) | models, models2 | mobile/scripts/Vehicles/Model_S.gd:178-182 |
| `has_spoiler - Model X` | Model_X forces set_has_spoiler(true) in set_default_state and update, overriding base spoiler_type logic | AUTO-DRIVE: Model X always has spoiler regardless of spoiler_type | modelx | mobile/scripts/Vehicles/Model_X.gd:47-49, 72-74 |
| `third_row_seats + rear_seat_type -> seat_count - Model X` | setup_seat_config: third_row_seats==NONE -> 5 seats; else rear_seat_type TWO_SEAT/null -> 6 seats, otherwise 7 seats | CONFIRMED: third_row_seats gates seat count and further disambiguated by rear_seat_type | modelx | mobile/scripts/Vehicles/Model_X.gd:92-101 |
| `seat_count x rhd -> interior - Model X` | set_seat_count shows interior_(5/6/7)_seater gated by (count AND not RHD) and interior_(5/6/7)_rhd_seater gated by (count AND RHD) | Interior mesh chosen by seat_count AND handedness together | modelx | mobile/scripts/Vehicles/Model_X.gd:78-90 |
| `rhd -> seat_count refresh - Model X` | Model_X.set_rhd does NOT call base set_rhd; instead re-runs set_seat_count(seat_count) so RHD/LHD interior is re-selected | Changing RHD re-evaluates which seat interior is shown | modelx | mobile/scripts/Vehicles/Model_X.gd:88-90 |
| `turn signals not headlamp-gated - Model X` | Model_X overrides set_turn_signal_*_state to simple on/off (no is_global branch, no brake coupling) | Model X turn signals are NOT gated by headlamp_type (unlike Model 3/Y) | modelx | mobile/scripts/Vehicles/Model_X.gd:113-119 |
| `rear doors use top animation - Model X / X_Palladium` | set_lr_door_open/set_rr_door_open route to LRDoorAnimationTop/RRDoorAnimationTop (falcon-wing) instead of base door animations | Rear-door open animation differs for X falcon-wing doors | modelx, tamarind | mobile/scripts/Vehicles/Model_X.gd:103-111, Model_X_Palladium.gd:80-88 |
| `third_row_seats / rear_seat_type (EXECUTIVE) -> seat_count - X Palladium` | setup_seat_config: has_3_rows if third_row_seats!=NONE OR rear_seat_type==EXECUTIVE; then EXECUTIVE/TWO_SEAT/null -> 6-seat, else 7-seat, no-3rows -> 5-seat | EXECUTIVE rear seat counts as 3-row and maps to 6-seat interior on X Palladium | tamarind | mobile/scripts/Vehicles/Model_X_Palladium.gd:69-78 |
| `seat_count -> interior + extras - X Palladium` | set_seat_count toggles interior_5/6(L/C/R)/7 meshes AND matching *_extras nodes together | Seat count drives both seat mesh and its extras group | tamarind | mobile/scripts/Vehicles/Model_X_Palladium.gd:54-67 |
| `headlamp_type (Global) - Model Y` | set_headlamp_type: is_global toggles headlights_object/lights_trunk/charge_cap original vs global and re-runs all lamp setters gated on is_global (fog/reverse/turn/drl/headlights/brake choose global vs original nodes) | Global headlamp swaps front + charge-cap + rear-trunk light geometry on Y_High | modely (Y_High) | mobile/scripts/Vehicles/Model_Y.gd:190-279 |
| `third_row_seats -> seat_count - Model Y` | setup_seat_config: seat_count = 7 if third_row_seats!=NONE else 5; set_seat_count toggles interior_5/7_seater(+_color) | third_row_seats gates 5- vs 7-seat interior mesh | modely (Y_High) | mobile/scripts/Vehicles/Model_Y.gd:137-147 |
| `local_dir (is_high_res_version) -> interior handling - Model Y` | set_interior_config: only when local_dir=='Ego/Y_High' does it do the Black2/White2 new-interior console/door-card/decor toggling; otherwise defers to base set_interior_config | Interior variant geometry gating only active on the high-res Y build | modely (Y_High) | mobile/scripts/Vehicles/Model_Y.gd:109-110, 149-178 |
| `interior_upper_trim_materials / badging default - Model Y` | _enter_tree seeds interior_upper_trim_materials map (BLACK/GREY -> material name arrays), defaults upper_trim_type=BLACK and badging_material_type=CHROME_SILVER | Upper-trim material set and default badging established per model at tree-enter | modely (Y_High) | mobile/scripts/Vehicles/Model_Y.gd:100-107 |
| `steering_wheel_type (Yoke) - Palladium` | set_steering_wheel_type toggles steering_wheel_standard(_rhd) vs steering_wheel_yoke(_rhd) on Standard vs Yoke | CONFIRMED: Yoke vs round wheel geometry exists only on Palladium (lychee/tamarind) | lychee, tamarind | mobile/scripts/Vehicles/Palladium.gd:231-237 |
| `rearlight_type (Global) - Palladium` | set_rearlight_type: has_global_rearlight (rearlight_type==Global,2) toggles lights_rear/lights_glass_rear/lights_trunk/lights_glass_trunk/trunk/charge_cap_left+right/chargeport original vs global; and re-applies tesla badge/wordmark. set_rearlight_type_from_data also repositions charge_port to chargeport_locator_global when Global | Global rear light swaps entire rear-end + trunk + chargeport geometry and moves the charge port | lychee, tamarind | mobile/scripts/Vehicles/Palladium.gd:330-359, 481-482 |
| `has_tesla_badge / has_tesla_word_mark x rearlight_type - Palladium` | set_hide_tesla_badge shows tesla_badge_global only when has_global_rearlight() AND not hide; set_hide_tesla_wordmark likewise for tesla_wordmark_global. update() sets hide = not has_tesla_badge / not has_tesla_word_mark | CONFIRMED: badge & wordmark render ONLY when rearlight_type==Global(2) AND the has_* flag is true; on non-global rear they never show | lychee, tamarind | mobile/scripts/Vehicles/Palladium.gd:183-184, 362-363, 378-398 |
| `headlamp_type (Global) - Palladium` | set_headlamp_type: has_global_headlamp() toggles lights_front_original/global and lights_glass_front_original/global; all front lamp setters branch on has_global_headlamp() | Global headlamp swaps front light geometry on Palladium | lychee, tamarind | mobile/scripts/Vehicles/Palladium.gd:318-328, 401-459 |
| `special_badging_type (SIGNATURE_SERIES) - Palladium` | set_special_badging_type: is_signature toggles all nodes in 'signature' group visible and 'not_signature' group hidden, then forces brake reload and re-runs drivetrain. set_brakes uses signature brake models only when SIGNATURE_SERIES AND performance | Signature Series gates a whole node group, signature brakes, and re-drives plaid badge variant | lychee, tamarind | mobile/scripts/Vehicles/Palladium.gd:290-311, 365-376 |
| `drivetrain_type (Plaid) x special_badging - Palladium` | set_drivetrain_type: is_plaid = (type==AWDTriMotor,3); shows plaid_badge when plaid AND not signature, plaid_badge_signature when plaid AND signature. NOTE: base update() never sets drivetrain_type from data.vehicle_config.drivetrain_type; it is only (re)applied via editor value or set_special_badging_type re-calling set_drivetrain_type(drivetrain_type) | CONFIRMED: Plaid badge is NOT data-driven from drivetrain_type in the update path; it depends on the stored drivetrain_type enum and special_badging_type | lychee, tamarind | mobile/scripts/Vehicles/Palladium.gd:186-192, 376; Vehicle.gd:1004-1005 (no update() call) |
| `fascia_type_enum (P3ModelSPlaid / P3ModelX) - Palladium` | set_fascia_type_enum: if P3ModelX returns early (no group toggle); show_original = (fascia != P3ModelSPlaid); toggles 'p3_fascia' group vs 'original_fascia' group; then re-applies special_badging | Plaid fascia (P3ModelSPlaid) swaps the p3_fascia vs original_fascia node groups; P3ModelX leaves groups untouched | lychee, tamarind | mobile/scripts/Vehicles/Palladium.gd:194-214 |
| `fascia_type_enum -> skin folder - Palladium` | get_skin_file_path uses subfolder 'P3SPlaid' when fascia_type_enum==P3ModelSPlaid else 'Base' | Skin texture path depends on Plaid fascia | lychee, tamarind | mobile/scripts/Vehicles/Palladium.gd:227-229 |
| `interior_config (carbon fiber / wood decor) - Palladium` | set_interior_config selects Sport_Seats material by color and a Wood/Carbon_Fiber decor: *CarbonFiber variants -> Carbon_Fiber.material, White->Wood_Walnut, Black->Wood_Ebony, Cream->Wood_Walnut | CONFIRMED: carbon-fiber decor + sport seat materials exist only on Palladium (lychee/tamarind) | lychee, tamarind | mobile/scripts/Vehicles/Palladium.gd:256-287 |
| `rearlight_type -> charge port animation - Palladium` | set_charge_port_open uses chargeport_global_animation when has_global_rearlight() else chargeport_animation | Charge-port open animation target depends on Global rear light | lychee, tamarind | mobile/scripts/Vehicles/Palladium.gd:470-476 |
| `fascia_type (POPPYSEED_PERF) - Model 3 Poppyseed` | set_fascia_type calls set_is_performance(type==POPPYSEED_PERF) which toggles bumper base/perf arrays, seat base/perf arrays, forces set_has_spoiler(is_perf), and re-applies interior_config | CONFIRMED: Performance fascia auto-drives spoiler, bumper and seat geometry (and perf interior materials) | model3 (Poppyseed) | Ego/v2023/Poppyseed/script/Poppyseed.gd:99-117, 140-144 |
| `fascia_type (POPPYSEED_D50) - Model 3 Poppyseed` | set_fascia_type: set_has_rear_display(type != D50) hides center_console(rear display) when D50; is_d50 also toggles seat_buttom vs seat_buttom_d50, and hides tweeter_lf/rf and sill_plate | CONFIRMED: D50 fascia auto-hides the rear-display center console and swaps seat-bottom/tweeter/sill geometry | model3 (Poppyseed) | Ego/v2023/Poppyseed/script/Poppyseed.gd:131-134, 145-155 |
| `fascia_type (D50 / PERF) -> interior materials - Model 3 Poppyseed` | set_interior_config: is_d50 forces Textile decor+seats regardless of interior color; POPPYSEED_PERF applies perf seat/decor materials to body and base seat material to rear_seats separately | Interior material set gated by fascia variant (D50 textile, PERF perf-seats) | model3 (Poppyseed) | Ego/v2023/Poppyseed/script/Poppyseed.gd:157-188 |
| `has_stalk x rhd - Model 3 Poppyseed` | set_has_stalk shows stalk (LHD) or stalk_rhd (RHD) based on current RHD; set_rhd re-applies stalk visibility gated by has_stalk | Turn-stalk mesh gated by BOTH has_stalk flag and handedness | model3 (Poppyseed) | Ego/v2023/Poppyseed/script/Poppyseed.gd:119-125, 203-204 |
| `has_front_fascia_camera -> has_fascia_cam - Model 3 Poppyseed` | update() sets has_fascia_cam from data.vehicle_config.has_front_fascia_camera; set_has_fascia_cam toggles fascia_cam mesh | Front fascia camera mesh visibility | model3 (Poppyseed) | Ego/v2023/Poppyseed/script/Poppyseed.gd:127-129, 281 |
| `fascia_type -> skin folder - Model 3 Poppyseed` | get_skin_file_path uses 'Performance' subfolder when POPPYSEED_PERF else 'Base' | Skin texture path depends on performance fascia | model3 (Poppyseed) | Ego/v2023/Poppyseed/script/Poppyseed.gd:284-288 |
| `headlamp lights not headlamp-gated - Model 3 Poppyseed` | set_headlamp_type only stores the value; turn/drl/headlights/brake setters are overridden to show both front+rear nodes unconditionally (only fog/reverse still branch on is_global) | On Poppyseed, most lamp geometry is NOT gated by headlamp_type (differs from 3_High/Model_3) | model3 (Poppyseed) | Ego/v2023/Poppyseed/script/Poppyseed.gd:223-270 |
| `fascia_type (performanceBayberry) - Model Y Bayberry` | update sets is_performance = (fascia_type=='performanceBayberry'); set_is_performance toggles fascia_standard/perf, seats_standard/perf, mirror_left/right standard/perf and forces set_has_spoiler(is_perf) | Performance Bayberry fascia auto-drives fascia, seats, mirrors and spoiler geometry | modely (Bayberry) | Ego/Bayberry/Script/Bayberry.gd:61-82 |
| `has_tesla_badge - Model Y Bayberry/E41` | set_hide_tesla_badge shows tesla_badge only when not hide; update sets hide = not data.has_tesla_badge | Rear Tesla badge mesh visibility driven by has_tesla_badge (no rearlight gating here, unlike Palladium) | modely (Bayberry,E41) | Ego/Bayberry/Script/Bayberry.gd:63,66-68; BayberryE41.gd:49,51-53 |
| `headlight_beam auto-drive - Model Y Bayberry` | headlight_beam and drl visibility = (drl_on OR headlights_on OR parking_lights_on); park_light_rear = (parking OR headlights_on) | AUTO-DRIVE: beam/DRL/rear park lights are OR-combined across drl, headlights and parking states | modely (Bayberry) | Ego/Bayberry/Script/Bayberry.gd:104-128 |
| `headlamp_type no-op geometry - Model Y Bayberry` | Bayberry.set_headlamp_type only stores the value (no geometry switch), unlike Model_Y/Y_High | Base Bayberry does NOT swap headlamp geometry on Global; headlamp_type inert for geometry | modely (Bayberry) | Ego/Bayberry/Script/Bayberry.gd:130-131 |
| `fascia_type -> skin folder - Model Y Bayberry` | get_skin_file_path uses 'Performance' subfolder when BAYBERRY_PERF else 'Base' | Skin path depends on performance fascia | modely (Bayberry) | Ego/Bayberry/Script/Bayberry.gd:165-169 |
| `interior_config -> 7-seat seats material - Model Y Bayberry` | set_interior_config additionally loads *_Seats and *_Seats_7S materials by color and applies to 'Seats'/'Seats7S' | Second (7-seat) seat material applied alongside standard seats | modely (Bayberry) | Ego/Bayberry/Script/Bayberry.gd:84-98 |
| `headlamp_type (Global) x lamp states - Model Y BayberryE41` | Rear turn signals turn_signal_rear_l/r visibility is a function of is_global(headlamp_type==Global) AND (headlights_on OR parking_lights_on OR brake_lights_on [OR turn_signal_state==1 when not global]); set_headlamp_type also recolors global turn-signal material orange(global)/white(non-global) | E41 rear-signal visibility and color are gated by headlamp_type combined with brake/park/headlight/turn states | modely (E41) | Ego/BayberryE41/Script/BayberryE41.gd:82-151, 189-242 |
| `brake_lights_on -> rear turn-signal color - Model Y BayberryE41` | set_brake_lights_on tints turn_signal_rear_r material brake_on_color when braking else brake_off_color | Brake state recolors the shared rear turn-signal material (combined tail/brake element) | modely (E41) | Ego/BayberryE41/Script/BayberryE41.gd:225-234 |
| `interior_config no-op - Model Y E41 / E80 handling` | BayberryE41.set_interior_config only stores interior_config (no material/geometry change) | E41 interior config is inert for geometry/materials | modely (E41) | Ego/BayberryE41/Script/BayberryE41.gd:79-80 |
| `drivetrain_type offset` | VehicleData._init stores drivetrain_type = raw drivetrain_type + 1 (mapping to Vehicle.DrivetrainType where 0=None,1=RWD,2=AWD,3=AWDTriMotor/Plaid) | Data-layer +1 offset must be accounted for when reasoning about Plaid(AWDTriMotor=3) gating | all | mobile/scripts/data/VehicleData.gd:75; Vehicle.gd:15-20 |
| `has_two_toned_color (base)` | Base has_two_toned_color() returns false; paint/skybox color helpers branch on it (color_bright/color_dark vs single color) | Two-tone paint shader path is gated off in base S3XY vehicles (single-color path used) | all | mobile/scripts/Vehicles/Vehicle.gd:1403-1404, 1441-1472 |

---

## 7. Machine-readable decision tree (JSON)

The full data-driven tree — `models → generations → questions → options` for all 14 generations — is emitted as a separate file so the UI can import it directly:

**`docs/vehicle-decision-tree.json`** (14 generations, 641 total options)


Excerpt (shape reference — first generation, first two questions):

```json
{
  "models": {
    "Model S": {
      "generations": [
        {
          "generation": "Model S \u2014 Classic (nosecone, S1)",
          "routing": {
            "car_type": "models",
            "fascia_type": "(ignored \u2014 get_vehicle_node_path routes Model S by car_type alone; fascia_type never read)",
            "chassis_type": "(ignored \u2014 never read for Model S)"
          },
          "questions": [
            {
              "order": 1,
              "field": "exterior_color",
              "question": "Exterior paint color",
              "default": "PearlWhite",
              "showIf": "always",
              "options": [
                {
                  "label": "Pearl White Multi-Coat (default; absent-field default)",
                  "value": "PearlWhite",
                  "provenance": "REALWORLD"
                },
                {
                  "label": "Solid Black (aliases Black, MetallicBlack/Obsidian)",
                  "value": "SolidBlack",
                  "provenance": "REALWORLD"
                },
                {
                  "label": "Midnight Silver Metallic (aliases Grey, SteelGrey)",
                  "value": "MidnightSilver",
                  "provenance": "REALWORLD"
                },
                {
                  "label": "Silver Metallic \u2014 legacy (alias Silver; byte-identical to fallback)",
                  "value": "SilverMetallic",
                  "provenance": "REALWORLD"
                },
                {
                  "label": "Titanium Metallic \u2014 legacy warm grey/copper (alias Titanium)",
                  "value": "TitaniumCopper",
                  "provenance": "REALWORLD"
                },
                {
                  "label": "Deep Blue Metallic",
                  "value": "DeepBlue",
                  "provenance": "REALWORLD"
                },
                {
                  "label": "Ocean/Metallic Blue \u2014 legacy",
                  "value": "Blue",
                  "provenance": "REALWORLD"
                },
                {
                  "label": "Signature Blue (2012 Signature series)",
                  "value": "SignatureBlue",
                  "provenance": "REALWORLD"
                },
                {
                  "label": "Red Multi-Coat (alias Red)",
                  "value": "RedMulticoat",
                  "provenance": "REALWORLD"
                },
                {
                  "label": "Signature Red",
                  "value": "SigRed",
                  "provenance": "REALWORLD"
                },
                {
                  "label": "Solid White \u2014 legacy non-pearl",
                  "value": "White",
                  "provenance": "REALWORLD"
                },
                {
                  "label": "Pearl \u2014 low-metallic white variant",
                  "value": "Pearl",
                  "provenance": "REALWORLD"
                },
                {
                  "label": "Green \u2014 legacy special-order (Sequoia/British Racing)",
                  "value": "Green",
                  "provenance": "REALWORLD"
                },
                {
                  "label": "Brown \u2014 legacy special-order metallic",
                  "value": "Brown",
                  "provenance": "REALWORLD"
                }
              ]
            },
            {
              "order": 2,
              "field": "wheel_type",
              "question": "Wheels",
              "default": "Tempest19SonicSilver",
              "showIf": "always",
              "options": [
                {
                  "label": "Tempest Sonic Silver 19\" (DEFAULT; WheelType.TempestSilver)",
                  "value": "Tempest19SonicSilver",
                  "provenance": "SOURCE"
                },
                {
                  "label": "Aero 19\" (classic base aero; WheelType.Aero)",
                  "value": "Aero19",
                  "provenance": "SOURCE"
                },
                {
                  "label": "Base Silver 19\" (WheelType.BaseSilver)",
                  "value": "Base19",
                  "provenance": "SOURCE"
                },
                {
                  "label": "Turbine Silver (WheelType.TurbineSilver; aliases Silver21/Silver21Euro/Super21Silver/Turbine19/Turbine22)",
                  "value": "Turbine19",
                  "provenance": "SOURCE"
                },
                {
                  "label": "Turbine Onyx Black (WheelType.TurbineBlack; aliases Charcoal21/Charcoal21Euro/Super21Gray/Turbine19Dark/Turbine22Dark)",
                  "value": "Turbine19Dark",
                  "provenance": "SOURCE"
                },
                {
                  "label": "Slipstream Silver (WheelType.SlipstreamSilver; alias AeroTurbine19/AeroTurbine20)",
                  "value": "AeroTurbine19",
                  "provenance": "SOURCE"
                },
                {
                  "label": "Slipstream Sonic Carbon (WheelType.SlipstreamCarbon; aliases AeroTurbine19Black/Slipstream19Carbon/Slipstream20Carbon)",
                  "value": "Slipstream19Carbon",
                  "provenance": "SOURCE"
                },
                {
                  "label": "Slipstream Two-Tone/Dark (WheelType.SlipstreamDark; aliases AeroTurbine20Dark/Slipstream20Dark)",
                  "value": "AeroTurbine20Dark",
                  "provenance": "SOURCE"
                },
                {
                  "label": "Cyclone Sonic Carbon 19\" (WheelType.CycloneCarbon; wireKey Cyclone19Dark)",
                  "value": "Cyclone19Dark",
                  "provenance": "SOURCE"
                },
                {
                  "label": "Helix Silver 20\" (WheelType.Helix)",
                  "value": "Helix20",
                  "provenance": "SOURCE"
                },
                {
                  "label": "Arachnid Silver 21\" (WheelType.ArachnidSilver)",
                  "value": "Arachnid21Silver",
                  "provenance": "SOURCE"
                },
                {
                  "label": "Arachnid Armor Black 21\" (WheelType.ArachnidBlack)",
                  "value": "Arachnid21Black",
                  "provenance": "SOURCE"
                },
                {
                  "label": "Arachnid Sonic Carbon 21\" (WheelType.ArachnidCarbon; wireKey Arachnid21Grey)",
                  "value": "Arachnid21Grey",
                  "provenance": "SOURCE"
                },
                {
                  "label": "Twin Turbine Silver 21\" (WheelType.TwinTurbineSilver)",
                  "value": "TwinTurbine21Silver",
                  "provenance": "SOURCE"
                },
                {
                  "label": "Twin Turbine Sonic Carbon 21\" (WheelType.TwinTurbineCarbon)",
                  "value": "TwinTurbine21Carbon",
                  "provenance": "SOURCE"
                }
              ]
            }
          ]
        }
      ]
    }
  }
}
```

---

## 8. Adversarial verification — full correction log

Each generation node was independently verified against the renderer source. All nodes were judged *substantially accurate*; the mechanical corrections are applied in §4 and the nuanced ones summarized in §4.0a. This is the complete refutation log for transparency (source refs included).


**ADVERSARIAL VERIFICATION RESULT: The node is substantively accurate and I could ** — 2 correction(s):

- **Claim:** Q2 Wheels: "default":"Pinwheel18"
  **Fix:** default should be "Unknown" (absent), which resolves to WheelType.Pinwheel via DefaultWheelForVehicleType['model3'] — same mesh as Pinwheel18 · `mobile/scripts/data/VehicleData.gd:57; VehicleOptions.gd:179; Vehicle.gd:681,1278-1284`
- **Claim:** Q10 Headlamp: "default":"Original"
  **Fix:** wire default is "Premium", which resolves to HeadlampType.Original at runtime (hasGlobalHeadlamp checks =="Global"); rendered default Original is correct · `mobile/scripts/data/VehicleData.gd:67,274; Ego/v2023/Poppyseed/script/Poppyseed.gd:278`

**ADVERSARIAL VERIFICATION RESULT for "Model 3 Highland — Performance (Poppyseed /** — 1 correction(s):

- **Claim:** Q4 Exterior trim: option 'Black / Hydroxide trim (Highland spec)', value Black, provenance SOURCE; narrows states 'Black'->ExteriorTrim.Black (Exterior_Hydroxide.material).
  **Fix:** Black exterior_trim is a no-op on Poppyseed (Exterior_Hydroxide.material absent from res://Ego/v2023/Poppyseed/; load returns null -> early return at Poppyseed.gd:218), so it keeps the scene's default Exterior material r · `Ego/v2023/Poppyseed/script/Poppyseed.gd:207-221; Ego/v2023/Poppyseed/Poppyseed.tscn:402 (local_dir) and :30 (Exterior.material ext_resource); directory listing of Ego/v2023/Poppyseed/ (no Exterior_Hydroxide.material); mobile/scripts/Vehicles/Vehicle.gd:9-12 (ExteriorTrimMap); mobile/scripts/data/VehicleData.gd:60 (default 'Black')`

**Adversarial verification of Model S — Classic facelift (S2 / car_type "models2")** — 2 correction(s):

- **Claim:** Question 9 (License plate region) field is "has_eu_plate" with values false/true.
  **Fix:** field should be "eu_vehicle" (bool; false=US plate default, true=EU plate). Behavior/provenance (GLOBAL) and default direction are otherwise correct. · `VehicleData.gd:59; Vehicle.gd:677, 1011-1022`
- **Claim:** Question 10 (Badging material) is an emitted question with options Auto/-1, Chrome/0, Black/1, provenance GLOBAL.
  **Fix:** Move badging_material_type to NO-OP FIELDS (parsed, zero visible effect on the Model S scene) and drop the badging question, consistent with headlamp_type et al. · `Ego/S/Model_S.tscn (no 'Badging' surface); Vehicle.gd:640-665, 1197, 1205-1208; Ego/Shared/Badging_Chrome.tres:124`

**Adversarial verification of the Model Y — Juniper (Bayberry) baseBayberry node a** — 3 correction(s):

- **Claim:** Question 5 label: 'Rear Tesla badge' with field has_tesla_badge
  **Fix:** Label should be 'Front hood Tesla badge' (or just 'Tesla badge'); the qualifier 'Rear' is not source-grounded. · `Ego/Bayberry/Bayberry.tscn:232,264 (tesla_badge_path=Hood_Spatial/Tesla_Badge); Bayberry.gd:66-68`
- **Claim:** Question 2 (Wheels) default: 'E4118'
  **Fix:** Source data default is 'Unknown' -> renders Gemini; E4118 is fine as a recommended pre-selection but is not the code default. · `VehicleData.gd:57; VehicleOptions.gd:182; Vehicle.gd:1278-1284`
- **Claim:** Question 8 (Badging material) default: '0' (Chrome/Silver)
  **Fix:** Source config default is -1 (auto-derive); 0 is a reasonable UI pre-selection but not the data default. · `VehicleData.gd:82; Vehicle.gd:724-730; Model_Y.gd:106`

**Model 3 — Legacy (pre-Highland)** — 1 correction(s):

- **Claim:** generationNotes SOURCE fact (2): 'the door_card1/2 and door_decor NodePaths that Model_3.gd references have NO matching nodes in Model3_High.tscn -> get_node_or_null returns null -
  **Fix:** The 2021-refresh interior (Black2/White2, is_new_interior=true) swaps THREE geometry groups, not one: the center console (Center_Console <-> Center_Console_2_0), the front door cards (Doorcard_LF/RF <-> Doorcard_2_0_LF/R · `Ego/3_High/Model3_High.tscn:403-408 (NodePath wiring) and :668-727 (Doorcard_LF/RF, Doorcard_2_0_LF/RF, Doorcard_2_0_LF_Decor/RF_Decor node declarations); Model_3.gd:49-54 (get_node_or_null), :104-114 (set_interior_config toggles)`

**Model S — Classic / legacy, S1 nosecone (car_type "models")** — 3 correction(s):

- **Claim:** Q8 'Badge material finish' (badging_material_type) is a live GLOBAL question: 'Applied over the scene's "badging" material set by base Vehicle.gd ... Visible only where the scene d
  **Fix:** Remove Q8 and move badging_material_type into the EXCLUDED list as a renderer no-op on the classic S scene (no 'Badging' material surface exists), alongside headlamp_type/TacticalGrey. · `Vehicle.gd:724-730 (base always calls set_badging_material_type), Vehicle.gd:1205-1208 + :640-665 (apply_material matches on material name/resource_name), Ego/Shared/Badging_Chrome.tres resource_name='Badging'; Ego/S/Objects/*.mtl newmtl list has no 'Badging'; grep 'badg' in Ego/S/Model_S.tscn returns nothing.`
- **Claim:** The node's 11 questions plus EXCLUDED list are exhaustive for what the S1 scene can render; no source-supported option is missing.
  **Fix:** Add a GLOBAL question for red_brake_calipers (default false = standard calipers; true = red/performance calipers), or at minimum document it — it is not a no-op and not Palladium-gated. · `Vehicle.gd:684 and :1335-1353 (set_brakes); Ego/S/Model_S.tscn:442-456 (brake path + brakes_standard_*/brakes_perf_* exports) and :887-896 (Brakes_*_Spatial nodes); VehicleData.gd:33 (red_brake_calipers).`
- **Claim:** The node fully enumerates renderable exterior toggles for the S1 scene (spoiler, trim, tint, badging, charge port, etc.).
  **Fix:** Add a GLOBAL question for eu_vehicle (default false = US plate; true = EU plate), or document it as an intentionally-hidden always-default toggle; it is not a no-op on this scene. · `Vehicle.gd:677 and :1011-1022 (set_has_eu_plate/set_has_us_plate); Ego/S/Model_S.tscn:414-415 (plate_us_path/plate_eu_path) and :779,:785 (Plate_EU/Plate_US nodes); VehicleData.gd:22 (eu_vehicle).`

**Model S — Refresh / Plaid (Palladium)** — 2 correction(s):

- **Claim:** Q3 Wheels: 'Cardenio 19" (refresh S base → WheelType.Cardenio, Wheels_Palladium)' is labeled provenance REALWORLD, while its sibling Wheels_Palladium wheels Arachnid21 and NewTurbi
  **Fix:** Mark Cardenio19 provenance as SOURCE (asset-group tie to Ego/Wheels_Palladium, this generation), consistent with Arachnid21 and NewTurbine22Black. · `mobile/scripts/VehicleOptions.gd:212 (Cardenio→Ego/Wheels_Palladium/Cardenio.tscn), :207, :221`
- **Claim:** Q6 fascia option 'P3 S Base (P3ModelSBase — enum only, no group swap)' and narrows text: 'p3s'→P3ModelSBase (enum set, no group swap — group swap only fires for P3ModelSPlaid).
  **Fix:** p3s→P3ModelSBase runs the same group-visibility code but resolves show_original=true, so it shows original_fascia and hides p3_fascia — rendering identical to 'original'. Only P3ModelX skips the swap (early return). The  · `mobile/scripts/Vehicles/Palladium.gd:198-214 (set_fascia_type_enum; early return only for FasciaType.P3ModelX)`

**Model S — Refresh / Plaid (Palladium)** — 1 correction(s):

- **Claim:** Q3 Wheels: option 'Cardenio 19" (refresh S base → WheelType.Cardenio, Wheels_Palladium)' is labeled provenance=REALWORLD, while the sibling wheels Arachnid21 and NewTurbine22Black 
  **Fix:** Provenance for Cardenio19 should be SOURCE (asset-group tie to Ego/Wheels_Palladium), consistent with Arachnid21 and NewTurbine22Black. · `mobile/scripts/VehicleOptions.gd lines 212 (WheelType.Cardenio → Ego/Wheels_Palladium/Cardenio.tscn) and 294 ('Cardenio19' → WheelType.Cardenio); cf. lines 207, 221`

**Model X — Palladium / Refresh (2021+), codename "tamarind"** — 2 correction(s):

- **Claim:** Q7 (has_tesla_badge, SOURCE): 'tesla_badge_global renders only when has_global_rearlight() AND has_tesla_badge (Palladium.set_hide_tesla_badge:378).' Cross-dim gating (a) likewise 
  **Fix:** Q7 has_tesla_badge is a NO-OP on tamarind (no tesla_badge_global node in X_Palladium.tscn) and must not be presented as a SOURCE-grounded renderable option. Either drop the question or relabel it as EXCLUDED/NO-OP alongs · `Ego/X_Palladium/X_Palladium.tscn:911 (only tesla_wordmark_global_path set; no tesla_badge_global_path); Palladium.gd:114,378-387; Vehicle.gd:1270-1272; scene nodes TBadge/TBadge_Signature at X_Palladium.tscn:1887-1895 gated by signature groups`
- **Claim:** generationNotes / Q3 provenance (SOURCE): Palladium interior 'applies ... plus Interior_Seats_* to InteriorSeats and Sport_Seats_Interior_* [to Sport_Seats_Interior]'.
  **Fix:** The Q3 interior options themselves are valid (Interior_Seats_* + Wood_Ebony/Wood_Walnut/Carbon_Fiber all exist and render), so no option changes. But the 'Sport_Seats_Interior_*' material application should not be cited  · `Palladium.gd:261-272; Vehicle.gd:526-542; Ego/X_Palladium/ directory listing (no Sport_Seats_Interior_*.material)`

**Model Y — Juniper / Bayberry, Performance fascia (car_type=modely, fascia_type=p** — 3 correction(s):

- **Claim:** The node enumerates every consumed field as either a question, a GLOBAL entry, or an EXCLUDED/INERT entry. red_brake_calipers appears nowhere, implying it is not a renderable optio
  **Fix:** Add a question for red_brake_calipers (bool), provenance SOURCE. set_brakes(true) removes the children of Brake_LF/RL/RF/RR_Spatial and instances the performance (red) caliper models (Brakes_Perf_F=ExtResource 5, Brakes_ · `Vehicle.gd:684 (update->set_brakes), Vehicle.gd:1335-1361 (set_brakes), Bayberry.tscn:5-9 (brake ext_resources) & :195-206 (brake paths + brakes_standard_*/brakes_perf_* exports); set_brakes not overridden in Model_Y.gd or Bayberry.gd`
- **Claim:** The node's GLOBAL section lists the base-Vehicle fields still valid here (exterior_color/paint_color_override, window_tint_color, badging_material_type, rhd, charge_port_type) as t
  **Fix:** Add eu_vehicle (bool), provenance GLOBAL/SOURCE. set_has_eu_plate toggles Plate_EU visible vs Plate_US hidden (and vice-versa). Both nodes are present in Bayberry.tscn (plate_us_path=NodePath("Plate_US"), plate_eu_path=N · `Vehicle.gd:677 (update->set_has_eu_plate), Vehicle.gd:1018-1023 (set_has_eu_plate toggles plate_eu/plate_us), Bayberry.tscn:165 (has_us_plate=true), :171-172 (plate_us_path/plate_eu_path), :526 (node Plate_EU)`
- **Claim:** Question 5 label: 'Show rear Tesla badge / wordmark' for has_tesla_badge.
  **Fix:** Relabel to 'Show Tesla badge (Hood_Spatial/Tesla_Badge)' or drop 'rear'. Everything else about the question is source-accurate (Bayberry.gd:63,66-68 set_hide_tesla_badge from has_tesla_badge, tesla_badge_path=NodePath("H · `Bayberry.gd:66-68, Bayberry.tscn:232 (tesla_badge_path) & :264 (node Tesla_Badge under Hood_Spatial)`

**Node is substantially accurate on routing, wheels, gating, provenance labels, an** — 2 correction(s):

- **Claim:** the door_card1/2 and door_decor NodePaths that Model_3.gd references have NO matching nodes in Model3_High.tscn -> get_node_or_null returns null -> those toggles are silent no-ops 
  **Fix:** Model3_High.tscn contains Doorcard_LF (668), Doorcard_2_0_LF_Decor (675), Doorcard_2_0_LF (679), Doorcard_RF (711), Doorcard_2_0_RF_Decor (723), Doorcard_2_0_RF (727), matching lf/rf_door_card1/2 and _decor paths (tscn 4 · `Ego/3_High/Model3_High.tscn:403-408,668-727; Model_3.gd:107-114`
- **Claim:** chassis_type (ignored for Model 3 — any value; default 'model_3')
  **Fix:** ProductManager.get_chassis_type_for_product defaults to 'model_y', not 'model_3' (still ignored on the model3 routing branch). · `ProductManager.gd:106-113`

**VERDICT: Node is substantially ACCURATE. Every load-bearing claim was confirmed ** — 2 correction(s):

- **Claim:** Question 2 (Wheel) declares "default":"E4118".
  **Fix:** Renderer absent-field wheel default is Gemini (Wheel_Gemini.tscn); E4118 is a product-recommended base, not the renderer default. · `mobile/scripts/VehicleOptions.gd L182 (DefaultWheelForVehicleType.modely=Gemini), L331 (E4118 mapping); Vehicle.gd L1278-1284; VehicleData.gd L57`
- **Claim:** generationNotes: "Model_Y.update forces headlamp_type = Global iff data.hasGlobalHeadlamp() (== exterior string 'Global') else Original".
  **Fix:** hasGlobalHeadlamp() == (vehicle_config.headlamp_type == "Global"), driven by the headlamp_type field, not exterior. · `mobile/scripts/data/VehicleData.gd L273-274; Model_Y.gd L133`

**VERDICT: The node is accurate on all load-bearing, source-grounded claims. Routi** — 1 correction(s):

- **Claim:** Question 10 'Badge material finish' (badging_material_type) is a live option with Auto/Chrome/Black-Matte choices, hedged as 'Visible only if the scene defines badging materials.'
  **Fix:** Exclude Q10 from this node, or reclassify badging_material_type as a confirmed NO-OP on classic Model X (scene defines no badging surface), rather than presenting it as an active badge-finish question. · `Ego/X/Model_X.tscn (0 'badging' refs); mobile/scripts/Vehicles/Vehicle.gd:1171-1198 (_apply_material_from_map), :109-113 (badging_materials map), :724-730 (auto-derive)`

**VERDICT: The node is overwhelmingly accurate — routing, all wheel wireKeys, prov** — 1 correction(s):

- **Claim:** The node presents 11 questions and its generationNotes explicitly enumerates exclusions, implying the set of source-supported, scene-renderable Model Y options is complete (check #
  **Fix:** Add a question: field 'eu_vehicle' (bool), showIf 'always', provenance GLOBAL, default false (VehicleData.gd:59 default eu_vehicle=false → US plate). Options: false → North America plate (Plate_US shown), true → EU plate · `Vehicle.gd:677 (set_has_eu_plate(data.vehicle_config.eu_vehicle)) and 1018-1023 (toggles plate_eu/plate_us); VehicleData.gd:59 (eu_vehicle default false); Ego/Y_High/ModelY_High.tscn (Plate_EU, Plate_US nodes + plate_eu_path/plate_us_path).`

**VERIFIED CORRECT (no refutation found): - ROUTING: get_vehicle_node_path (Produc** — 2 correction(s):

- **Claim:** The question set covers all source-supported interior appearance options on D50; only interior_trim_type (inert), exterior_trim, and interior are interior-facing choices.
  **Fix:** Add a question: field interior_upper_trim_materials (int enum InteriorUpperTrimType GREY=0 / BLACK=1), showIf always, default 0 (GREY — VehicleData:81 default 0 and Poppyseed _enter_tree seeds GREY), provenance SOURCE. O · `Poppyseed.gd:60-64; Vehicle.gd:723,1200-1203,1510; VehicleData.gd:81`
- **Claim:** charge_port_type and window_tint are the appropriate GLOBAL cosmetic options; the license-plate region is not a question.
  **Fix:** Add a question: field eu_vehicle (bool), showIf always, default false (VehicleData:59 -> US plate), provenance GLOBAL. Options: {label 'US plate', value 'false'} and {label 'EU plate', value 'true'}. · `Vehicle.gd:677,1018-1022; VehicleData.gd:59; Poppyseed.tscn:369-370,898,902`

**VERIFIED with corrections. All structural/routing/wiring/mechanical claims in th** — 2 correction(s):

- **Claim:** exterior_color options StealthGrey, DiamondBlack, GlacierBlue, Quicksilver, UltraRed, DeepBlue, and MidnightSilver are labeled provenance REALWORLD (implying real-world product kno
  **Fix:** provenance = SOURCE for all seven (they are source-grounded distinct ExteriorColorValue entries, not merely real-world knowledge). · `VehicleOptions.gd:18-51 (ExteriorColorValue); Vehicle.gd:1375-1385 (set_paint_color_by_name)`
- **Claim:** PearlWhite option is labeled 'Pearl White Multi-Coat (source default / FALLBACK color)'.
  **Fix:** PearlWhite = source-grounded field default (SOURCE). The renderer's unrecognized-key fallback is FALLBACK_EXTERIOR_COLOR (grey #161616), a different color. · `VehicleOptions.gd:53 (FALLBACK_EXTERIOR_COLOR); Vehicle.gd:1384; VehicleData.gd:55`

---

## 9. Defaults, fallbacks & implementation checklist

**Absent-field behavior (send explicit values; don't rely on these):**
- `exterior_color` omitted → `PearlWhite`; unknown key → grey `FALLBACK_EXTERIOR_COLOR` (#161616).
- `wheel_type` omitted or `Unknown` → `DefaultWheelForVehicleType[car_type]`.
- `fascia_type` unknown → legacy scene for that line; `chassis_type` omitted → `model_y` (only load-bearing for Model Y LWB).
- `headlamp_type` → `Premium` (renders Original); `interior_trim_type` → `Black`; `charge_port_type` → `US`; booleans → `false`; `badging_material_type` → `-1`.

**Checklist for the visual agent:**
- [ ] Decode `vin[3]` → model line; parse char 10 (year) as a generation *candidate* only.
- [ ] At a refresh boundary, ask the one disambiguation question (§3.4) before anything else.
- [ ] Resolve `car_type` / `fascia_type` / `chassis_type` (§3b) — send all three explicitly; never rely on the renderer's VIN fallback.
- [ ] Show the generation's ordered question set (§4.x) + the common GLOBAL questions.
- [ ] Narrow each list to its per-generation options; respect `show-if` gating (§6) — e.g. only ask `rear_seat_type` when `third_row_seats != None`; only offer yoke/signatures on Palladium (`lychee`/`tamarind`).
- [ ] Send an explicit `wheel_type` (don't leave `Unknown`); send `eu_vehicle` and `red_brake_calipers` on every car.
- [ ] Assemble `vehicle_config` (§2.3) + the dynamic-state defaults (§2.2); emit `SHOW_PRODUCT` first, `UPDATE_PRODUCT` for edits (identical shape).
- [ ] Skip no-op fields where flagged (e.g. `badging_material_type` on classic S/X and `tamarind`; `has_tesla_badge` on `tamarind`).

---

*v2 — exhaustive decision-tree edition. Enumerations, per-generation nodes, and the gating graph were extracted and adversarially verified against the renderer source (`VehicleOptions.gd`, `VehicleData.gd`, `ProductManager.gd`, `Vehicles/*.gd`, and the `Ego/` scene + wheel asset groups). §1–§3b reuse the verified v1 prose; §4–§9 are the exhaustive rebuild. Every per-model narrowing is provenance-tagged SOURCE / REALWORLD / GLOBAL because the renderer enforces no per-model option restriction.*
