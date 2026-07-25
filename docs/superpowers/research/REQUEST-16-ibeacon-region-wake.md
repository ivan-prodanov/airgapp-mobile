# RE REQUEST #16 — the car's iBeacon region (the reboot-surviving wake source)

**Requested:** 2026-07-25
**Short, high-value, and specific.** You already flagged this in RESPONSE-15's residual list — *"the car's
iBeacon UUID (the iOS-correct replacement for Android's BG-scan watchdog — but needs Location-Always)"*.
It turned out to be the root cause of a real user-visible failure, so we'd like it closed properly.

## What we hit (measured, on-device)

**After a phone REBOOT, airgapp does not unlock the car at all** until the user manually opens the app.
The official app does survive a reboot with no launch. Our native log shows iOS never relaunches us: the
next entry after the restart is a **foreground** launch (the user opening the app), never a background one.

Diagnosis: our only background wake source is `bluetooth-central`, and a reboot clears the OS-held pending
connect, so there is no event left that can wake us. Your findings show the official app has a second,
independent wake source we lack:

- `UIBackgroundModes = [location, bluetooth-central, fetch, remote-notification, nearby-interaction]`
  (ours was `[bluetooth-central]` only)
- `startMonitoringForVehicle:` @`0x1012afd3c` → `connectPeripheral` @`0x1012afd4c`
- `didEnterBeaconRegion` @`0x1012be19c` → `connectPeripheral` @`0x1012be22c`
- `-[LocationServicesHelper locationManager:didEnterRegion:]`, `CLBeaconIdentityConstraint`

i.e. **region entry → re-arm the BLE connect**, and region monitoring is one of the few iOS mechanisms that
survives a reboot and relaunches a terminated app.

## What we shipped in the meantime (so you know what to compare against)

We added `location` to `UIBackgroundModes`, requested Location **Always**, and now monitor a
**`CLCircularRegion`** (radius 150 m) centred on the car's **last known parked position** — which we already
have from `locationState`. On `didEnterRegion`/`didDetermineState(.inside)` we re-arm the standing pending
connect. Same reboot-survival property, and it needs no unknown UUID.

## Questions (in priority order)

1. **What exactly does `startMonitoringForVehicle:` construct?** A `CLBeaconRegion` /
   `CLBeaconIdentityConstraint` — with what **proximity UUID**, and are `major`/`minor` used (VIN-derived?
   per-vehicle? one constant Tesla UUID for all cars)? This is the one value we can't get ourselves: iOS
   deliberately hides iBeacon payloads from CoreBluetooth, so we cannot discover it by scanning.
2. **Does the car actually advertise an iBeacon frame** (Apple manufacturer-data 0x004C type 0x02), and if
   so is it **always on**, or only while awake / in some proximity state? If the car only beacons
   intermittently, beacon monitoring may be *less* reliable than our parked-location geofence and we'd stay
   as-is.
3. **Beacon region vs circular region — which does the official app actually rely on for the reboot case?**
   Does it *also* monitor a location-based region or significant-location-change as a fallback (e.g. for a
   car parked somewhere the beacon isn't heard)? We want to know whether our geofence is a genuine
   equivalent or a weaker substitute.
4. **What does it do on region entry beyond `connectPeripheral`** — any ranging (`startRangingBeacons`),
   any state it feeds to the car (proximity/zone), or is it purely "wake up and connect"? If ranging feeds
   the car's localization we'd want to know (it would touch the drive-latency question from P0-2).
5. **Region lifecycle:** when does it start/stop monitoring (on enrollment? per-vehicle? on drive-away?),
   and how does it handle **multiple vehicles** against iOS's 20-region cap?
6. **Is Location-Always genuinely required**, or does the official app function on WhenInUse with reduced
   behavior? (We assume Always is required for a terminated-app wake; confirming avoids us over-asking for
   a scary permission.)

## Why it matters
This is the difference between "passive entry works" and "passive entry works *reliably*". Everything else
in our stack is at parity; this is the last structural wake-source gap we know of. If beacon monitoring is
strictly better than our parked-location geofence, we'll switch; if it's equivalent or conditional, we'll
document and keep what we have.
