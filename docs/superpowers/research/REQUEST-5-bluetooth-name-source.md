# RE REQUEST #5 — where does the Bluetooth name in the bond-repair copy come from?

**Requested:** 2026-07-20 (follow-up to RESPONSE-4, which we implemented and got partly wrong)
**Goal:** print the EXACT string iOS shows in Settings > Bluetooth, so the user can match it by
eye while recovering from a bond wedge. Everything else in the flow now works on-car.

## What happened (why this is being asked)

RESPONSE-4 told us the official copy is `VehicleSuggestRemoveBondRow` —
*"Remove '{{name}}' in Settings > Bluetooth and try again"* — and that `{{name}}` is the vehicle
display name, which Tesla propagates into the BLE GAP name.

We bound `{{name}}` to **our app's** vehicle nickname (`fleet.activeName` = `"Red Velvet"`).
On-device, Settings > Bluetooth and the iOS pairing sheet both show **`🔑 CHUŠKOPEK`**. So our row
told the user to remove an entry that does not exist in that list.

**We suspect the report was right and our BINDING was wrong**: `Red Velvet` is a nickname local to
our app, whereas `CHUŠKOPEK` is presumably the name set on the car itself, with a `🔑 ` prefix from
somewhere. We have not verified any of that — hence this request rather than another guess.

Current stopgap (already shipped): capture `peripheral.name` on each successful BLE connect and
persist it. That is an INFERENCE about ble-plx/CoreBluetooth semantics, not a verified fact, and is
exactly what we would like replaced with something grounded.

## Questions

### Q1 (blocking) — what fills `{{name}}`?
- Which field, precisely, does the official app interpolate — the car's user-set vehicle name from
  its own config, a cached cloud `display_name`, the CoreBluetooth `peripheral.name`, or the
  advertised local name?
- Is it read from the CAR (GATT / VCSEC) or from app-side state?
- Given ours is a local nickname the user chose in *our* app: is Tesla's equivalent field also
  user-editable app-side, or is it always the car's own name? (i.e. can the official app itself
  print a string that does NOT match Settings > Bluetooth?)

### Q2 — the `🔑 ` prefix
- Where does the key emoji come from — car firmware composing the GAP name, the app prepending it
  for display, or the user having literally named the car that?
- If the app composes it, we need the exact composition rule (prefix, separator, any truncation).

### Q3 — GAP name vs advertised local name
- Tesla advertises the VIN-derived `S<hex>C` local name for scanning. Is the friendly name exposed
  as the **GAP Device Name characteristic `0x2A00`**, and is that what iOS caches for its Settings
  list?
- Does the official app ever READ `0x2A00` explicitly, or does it rely on `peripheral.name`?
  (This decides whether our `dev.name` capture is correct or needs an explicit read.)
- Is the friendly name readable on a link that is NOT bonded/encrypted? Our capture happens on a
  working link, so this matters only for the first-ever-connect case — see Q4.

### Q4 — the cold case
- On a fresh install that has NEVER completed a BLE connect, the official app cannot have cached a
  GAP name either. What does it print in `VehicleSuggestRemoveBondRow` then — a fallback string, a
  different row, or is the row suppressed entirely?
- This is our one known-bad edge: we currently degrade to `"your car"`, which is useless in the
  exact moment the user needs the name.

## Constraints
- Static RE only; cite locations and flag confidence as before. Your citations have been reliable
  and let us confirm each claim on-car.
- If the name source is not statically determinable, say so and tell us what to log on-device
  instead — we have a working log pipeline (`connect ok` already records both `name` and
  `localName`) and a car we can wedge on demand.
