# Restart Charging — an alert-driven software re-plug

**Date:** 2026-09-05
**Status:** design agreed with Ivan ("I just don't want to go to the car every time"), building
**Research:** `docs/superpowers/research/tesla-charging-alerts-FINDINGS.md`

## The problem

Home AC charging runs for one to two hours, then stops on an error. The only fix that works is
the physical one: unlock the port, pull the cable, push it back. From the app, "Start Charging"
is accepted by the car every time (five accepted starts in today's log, empty OK replies), the
panel shows Charging for about 30 s, then the car stops again. Nobody knows which fault it is,
because the app never asks the car.

## What we established

- The car serves the fault by name over BLE: `VehicleData.alert_state` (request
  `GetVehicleData.getAlertState = 20`, response field 25) carries `repeated ChargingAlert
  { alert_name, alert_type }`. The firmware has the handler; neither our app nor the official
  app over BLE ever requests it. The official app's cloud path feeds the same data into its
  `ChargingAlerts` home row.
- The 128 alert names map to Tesla's own title and remedy lines, recovered from the bundle.
  Thirty-two of them say some form of "unplug and retry"; five are the voltage-drop family
  ("remove extension cords"), whose physics is current times line resistance.
- ChargeState already carries `charge_port_latch` (35), `charge_cable_unlatched` (159),
  `charge_enable_request` (133), `user_charge_enable_request` (132), `charger_phases` (134)
  and `charge_port_cold_weather_mode` (136). We decode none of them.
- There is no reset or re-plug action in the protocol. A software re-plug is composed from
  VCSEC unlatch (`closureMoveRequest.chargePort = OPEN`), `chargingStartStopAction.start`, and
  `setChargingAmpsAction`.

## Design

### 1. Read the fault (parity: Tesla's ChargingAlerts row)

Proto: add `GetAlertState`, `AlertState`, `ChargingAlert`, the `ChargingAlertName` and
`ChargingAlertType` enums, `GetVehicleData.getAlertState = 20`, `VehicleData.alert_state = 25`;
regenerate bindings. A new infotainment state key `alerts` reads it.

`src/ble/chargingAlerts.ts` (pure): the 128-entry table `{ n, name, title, subtitle, family }`
generated from the recovered map, `parseChargingAlerts(alertState)` → `ChargingAlertInfo[]`
(unknown numbers become `ALERT_<n>` with a generic title, never dropped), and
`alertFamily(name)`.

Telemetry: `snap.alerts` and six new charge fields → view state keys `chargingAlerts`,
`chargePortLatch` (`'sna' | 'disengaged' | 'engaged' | 'blocking'`), `chargeCableUnlatched`,
`chargeEnableRequest`, `userChargeEnableRequest`, `chargerPhases`,
`chargePortColdWeatherMode`. `chargingAlerts` and the latch pair are cached like
`chargingState`, so a relaunch shows the last fault.

When it is read: the 60 s background sync and pull-to-refresh add `alerts` whenever a cable is
attached; the restart macro reads it before and after every attempt. A successful `alerts`
read that returns no `alert_state` clears the list (the car omits an empty message).

UI: `ChargingAlertCard` above the charge panel on Home and on the Charging screen, shown when a
cable is attached and either the car reports an alert or `chargingState` is Stopped/NoPower.
Warning glyph for WARNING, info glyph otherwise; title + remedy in the charge panel's face; the
Restart button and its progress line live in this card. `ChargeCard` gains Tesla's latch tip:
when `chargeCableUnlatched`, "Charge port latch not engaged" plus "Latch may be frozen…" in
cold-weather mode or "Fully insert charge cable or check for obstruction" otherwise.

### 2. Restart macro (`src/ble/chargeRestart.ts`, pure, injected IO)

```
restartCharging(io, opts) → { ok, attempts, alertsBefore, alertsAfter, ampsChangedTo, reason, trace }
```

IO: `runCommand(cmd)`, `readCharge()`, `readAlerts()`, `sleep(ms, signal)`, `now()`, `log(step,
data)`, `onProgress(p)`. Everything time-based is injected so the tests run on a fake clock.

Per attempt `n` (max 3):

1. Read alerts + charge; if already Charging → done.
2. Unlatch (`openChargePort`). Poll charge every 2.5 s until `chargePortLatch === 'disengaged'`
   or `chargeCableUnlatched`, 15 s cap; proceed either way, logging which.
3. Dwell: 15 s, 45 s, 120 s by attempt.
4. Lower amps when the plan says so: `max(5, floor(chargingAmps × 0.7))` via
   `setChargingAmps`. Voltage-drop family: from attempt 1. Thermal, power, unknown, no alert:
   from attempt 2. Never raised back; the result reports the new value.
5. `chargeStart`. A rejected start ends the attempt.
6. Verify for 90 s, polling every 3 s: Charging or Complete on the final read → success.
   Stopped/NoPower after Charging/Starting was seen, or after 20 s, → attempt failed. The 20 s
   grace covers the car's own state lag right after start.
7. On failure re-read alerts, keep the newest as the reason, and go to the next attempt.

Families `equipment` and `dc/public` (wall-connector internals, GFCI, service, Supercharger) get
one plain attempt and then stop with "needs the charger"; the car cannot clear those.

Cancel: an AbortSignal aborts sleeps and polls; the result says `aborted`.

### 3. Wiring

`useCarLink` gets `readChargingAlerts()` (scoped read that applies the patch, modelled on
`readSecurity`) and `restartCharging()` / `cancelChargeRestart()`, with a `chargeRestart` status
`{ running, attempt, phase, startedAt, result }` exposed through `CarLinkStatus` so both screens
render the same progress. The macro wakes the car first through the existing wake gate. Reads go
through `awakeSync({ states: ['charge'] | ['alerts'], priority: 'user' })` and their patches are
applied to the vehicle state, so the panel updates live while it runs. Every step logs to the
`charge` category of the log ring, so the first real fault leaves a complete trace even if the
restart fails.

Buttons: `Start Charging` / `Unlock Charge Port` are untouched (parity). The card's button is
`Restart Charging`, disabled and replaced by the progress line while running, with `Cancel`.
Toast on completion: "Charging · 11 A" or the fault title and "Could not restart — <remedy>".

### 4. Out of scope

- Charger-side resets (Pi + relay / wall-box API): unknown hardware; only needed if the first
  real trace shows an EVSE-latched fault.
- Unattended auto-retry (Android foreground service): after the first traces prove the macro.
- Alerts in the streaming subscription: polling is enough at this cadence.

## Verification

Unit: alert table and parser; macro state machine on a fake clock (success first try, success
after amps step-down, equipment family stops after one, abort mid-dwell, unlatch timeout
proceeds); telemetry parse of the new fields; proto round-trip of `AlertState`.

On the car, from the couch: the next fault. The trace in the log ring answers the three open
questions (does `getAlertState` answer, does start re-latch after an app unlatch, does the fault
clear), and the dwell/amps numbers get tuned from it.
