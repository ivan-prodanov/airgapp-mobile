import CoreLocation
import Foundation

// CarRegionMonitor — the SECOND background wake source, so passive entry survives
// a phone REBOOT.
//
// THE PROBLEM (measured 2026-07-25): our only wake source was `bluetooth-central`.
// After a device restart there is no pending BLE connect for iOS to honor (the
// reboot clears it), so nothing wakes us and the car's approach reaches a dead
// app — passive entry stayed broken until the user opened the app by hand.
//
// THE FIX (what the official app does): monitor a geographic region around the
// car and re-arm the BLE connect on entry. Region monitoring is one of the few
// iOS mechanisms that SURVIVES A REBOOT and relaunches a terminated app. The
// official iOS app wires exactly this — `startMonitoringForVehicle:`@0x1012afd3c
// → `connectPeripheral`@0x1012afd4c, and `didEnterBeaconRegion`@0x1012be19c →
// `connectPeripheral`@0x1012be22c, with `UIBackgroundModes` including `location`.
//
// Tesla monitors a CLBeaconRegion (iBeacon). We don't know the car's iBeacon UUID
// yet (RESPONSE-15 lists it as a residual unknown), so we monitor a CLCircularRegion
// centred on the car's last known parked location instead — which we already read
// from `locationState`. Same reboot-survival property, no unknown UUID. Swapping in
// a beacon region later is a drop-in change to `region()`.
//
// Requires Location ALWAYS: WhenInUse only delivers region events while the app is
// in use, which is precisely the case we're trying to fix.
final class CarRegionMonitor: NSObject, CLLocationManagerDelegate {
  static let shared = CarRegionMonitor()

  private static let latKey = "airgapp.passiveentry.carLat"
  private static let lonKey = "airgapp.passiveentry.carLon"
  private static let regionId = "airgapp.car.region"

  // ── The iBeacon region: the wake source that actually carries the REBOOT case ──
  //
  // RESPONSE-16 found the flaw in the circular region alone: iOS relaunches a
  // terminated app for a CLCircularRegion only on a BOUNDARY CROSSING, and a 150 m
  // circle centred on a car parked at home swallows the whole house. Reboot
  // overnight → you are already INSIDE → walking to the car crosses nothing → no
  // relaunch. A CLBeaconRegion's boundary is BLE detection range (metres), so the
  // walk-up genuinely IS a crossing.
  //
  // proximityUUID is a HARDCODED compile-time constant in the official app — not
  // cloud-provisioned, not VIN-derived (both branches of `BLEBeaconRegion
  // initFromVIN:` store the same string), so an air-gapped client can use it.
  // Verified twice by the miner at file offset 0x342c35d.
  //
  // UUID-ONLY on purpose: the app constrains major/minor per-VIN, but a
  // right-UUID/wrong-major region fires NOTHING, silently. Tesla itself uses a
  // UUID-only constraint for ranging, so this shape is supported. Tighten only
  // after a sniffer confirms the derivation.
  private static let beaconUUID = UUID(uuidString: "74278BDA-B644-4520-8F0C-720EAF059935")!
  private static let beaconRegionId = "airgapp.car.beacon"
  // UUID-only matching means we also wake near OTHER Teslas. Harmless (re-arming a
  // pending connect for an absent peripheral is a no-op) but don't let a parking
  // lot thrash relaunches.
  private static let beaconDebounceSec: TimeInterval = 30
  private var lastBeaconWakeSec: TimeInterval = 0
  // Big enough that we're woken well BEFORE BLE range (so the pending connect is
  // already armed when the user reaches the car), small enough to be meaningful.
  // iOS silently enforces a floor of ~100 m on region radius anyway.
  private static let radiusMeters: CLLocationDistance = 150

  private var manager: CLLocationManager?

  // Whether we have a car position to monitor — checked WITHOUT constructing a
  // CLLocationManager (so we never trigger a location prompt on a fresh install).
  static func hasCarLocation() -> Bool {
    UserDefaults.standard.object(forKey: latKey) != nil
      && UserDefaults.standard.object(forKey: lonKey) != nil
  }

  private func ensureManager() {
    if manager != nil { return }
    let m = CLLocationManager()
    m.delegate = self
    m.allowsBackgroundLocationUpdates = false // region monitoring only; no continuous GPS
    manager = m
  }

  // Ask for ALWAYS. Called from the foreground when passive entry arms — iOS shows
  // the upgrade prompt on top of the WhenInUse grant the app already holds.
  func requestAlwaysAuthorization() {
    ensureManager()
    guard let m = manager else { return }
    let status = m.authorizationStatus
    PassiveEntryCentral.shared.logExternal("car region: auth status=\(status.rawValue) (3=always, 4=whenInUse) — requesting always")
    if status == .notDetermined {
      m.requestWhenInUseAuthorization() // must precede Always
    }
    if status != .authorizedAlways {
      m.requestAlwaysAuthorization()
    }
  }

  // Record where the car is and (re)arm monitoring. Called whenever telemetry gives
  // us a fresh car position; cheap and idempotent — we only restart monitoring when
  // the car has actually MOVED beyond a fraction of the radius (parking drift and
  // GPS jitter must not churn region registration).
  func setCarLocation(lat: Double, lon: Double) {
    let d = UserDefaults.standard
    if let oldLat = d.object(forKey: CarRegionMonitor.latKey) as? Double,
       let oldLon = d.object(forKey: CarRegionMonitor.lonKey) as? Double {
      let moved = CLLocation(latitude: oldLat, longitude: oldLon)
        .distance(from: CLLocation(latitude: lat, longitude: lon))
      if moved < CarRegionMonitor.radiusMeters / 3 { return } // same spot — leave it armed
    }
    d.set(lat, forKey: CarRegionMonitor.latKey)
    d.set(lon, forKey: CarRegionMonitor.lonKey)
    PassiveEntryCentral.shared.logExternal("car region: position updated → re-arming monitor")
    startIfConfigured()
  }

  // Called at APP LAUNCH (foreground, background, or a region-entry relaunch) and
  // whenever the position changes. Idempotent.
  func startIfConfigured() {
    guard PassiveEntryCentral.isArmed() else { return }
    ensureManager()
    guard let m = manager else { return }
    let status = m.authorizationStatus
    guard status == .authorizedAlways else {
      // WhenInUse can't deliver the reboot wake — say so plainly in the log rather
      // than registering regions that will never fire while we're terminated.
      // (RESPONSE-16 Q6: the official app also gates region monitoring on Always.)
      PassiveEntryCentral.shared.logExternal("car region: NOT armed — need Location Always (status=\(status.rawValue))")
      return
    }
    // TWO INDEPENDENT WAKE SOURCES with disjoint failure sets (RESPONSE-16: "ship
    // both"). One relaunch of ANY kind re-arms the standing CoreBluetooth connect,
    // which iOS then holds until the next reboot — so independent triggers multiply.
    // The official app has a third backstop we structurally cannot have (silent
    // push), which is exactly why an air-gapped client should run two local ones.
    armBeaconRegion(m)   // no car position needed — works from a cold install
    armCircularRegion(m) // needs a parked position; gives 150 m of lead time
  }

  // The beacon region — carries the reboot case. Needs NO bootstrap: no car
  // position, no prior sighting. Fires at BLE range, so a walk-up is a real
  // boundary crossing even when the phone rebooted inside the house.
  private func armBeaconRegion(_ m: CLLocationManager) {
    guard CLLocationManager.isMonitoringAvailable(for: CLBeaconRegion.self) else {
      PassiveEntryCentral.shared.logExternal("car beacon: monitoring unavailable on this device")
      return
    }
    let r = CLBeaconRegion(uuid: CarRegionMonitor.beaconUUID, identifier: CarRegionMonitor.beaconRegionId)
    r.notifyOnEntry = true
    r.notifyOnExit = true
    // A launch trigger CLCircularRegion has no equivalent for: turning the screen
    // on while already inside BLE range re-delivers the state.
    r.notifyEntryStateOnDisplay = true
    for existing in m.monitoredRegions where existing.identifier == CarRegionMonitor.beaconRegionId {
      m.stopMonitoring(for: existing)
    }
    m.startMonitoring(for: r)
    m.requestState(for: r)
    PassiveEntryCentral.shared.logExternal("car beacon: ARMED uuid=74278BDA… (UUID-only)")
  }

  private func armCircularRegion(_ m: CLLocationManager) {
    guard CarRegionMonitor.hasCarLocation() else {
      PassiveEntryCentral.shared.logExternal("car region: no car position yet — open the app near the car once")
      return
    }
    guard CLLocationManager.isMonitoringAvailable(for: CLCircularRegion.self) else { return }
    guard let r = region() else { return }
    // Re-registering the same identifier replaces it; stop first so we never stack.
    for existing in m.monitoredRegions where existing.identifier == CarRegionMonitor.regionId {
      m.stopMonitoring(for: existing)
    }
    m.startMonitoring(for: r)
    // We may ALREADY be inside the region at launch (parked at home) — iOS only
    // reports transitions, so ask for the current state explicitly. NOTE: this only
    // helps once the app is alive; it cannot relaunch a terminated app, which is
    // precisely why the beacon exists.
    m.requestState(for: r)
    PassiveEntryCentral.shared.logExternal("car region: ARMED r=\(Int(CarRegionMonitor.radiusMeters))m")
  }

  func stop() {
    guard let m = manager else { return }
    for existing in m.monitoredRegions where existing.identifier == CarRegionMonitor.regionId {
      m.stopMonitoring(for: existing)
    }
    UserDefaults.standard.removeObject(forKey: CarRegionMonitor.latKey)
    UserDefaults.standard.removeObject(forKey: CarRegionMonitor.lonKey)
  }

  private func region() -> CLCircularRegion? {
    let d = UserDefaults.standard
    guard let lat = d.object(forKey: CarRegionMonitor.latKey) as? Double,
          let lon = d.object(forKey: CarRegionMonitor.lonKey) as? Double else { return nil }
    let r = CLCircularRegion(
      center: CLLocationCoordinate2D(latitude: lat, longitude: lon),
      radius: CarRegionMonitor.radiusMeters,
      identifier: CarRegionMonitor.regionId
    )
    r.notifyOnEntry = true
    r.notifyOnExit = false // we only care about arriving at the car
    return r
  }

  // MARK: - CLLocationManagerDelegate

  func locationManager(_ m: CLLocationManager, didEnterRegion region: CLRegion) {
    handleRegionWake(region.identifier, event: "ENTERED")
  }

  func locationManager(_ m: CLLocationManager, didDetermineState state: CLRegionState, for region: CLRegion) {
    guard state == .inside else { return }
    handleRegionWake(region.identifier, event: "already INSIDE")
  }

  // NOTE: we deliberately do NOT implement didExitRegion. Exit must never
  // disconnect — the official app only clears its in-region flag on exit and keeps
  // the link (RESPONSE-16 Q4).
  //
  // Each source is logged under its own name so field data answers the one thing
  // the miner could not prove statically: whether the car emits an iBeacon frame
  // at all, and whether that emission is sleep-gated. If `car beacon: ENTERED`
  // never appears in a week of real use, the car isn't beaconing (or only does so
  // while awake) and the circular region is carrying everything.
  private func handleRegionWake(_ identifier: String, event: String) {
    switch identifier {
    case CarRegionMonitor.regionId:
      PassiveEntryCentral.shared.logExternal("car region: \(event) → re-arming BLE")
    case CarRegionMonitor.beaconRegionId:
      // UUID-only matching wakes us near ANY Tesla — debounce so a parking lot
      // can't thrash relaunches.
      let now = Date().timeIntervalSince1970
      guard now - lastBeaconWakeSec >= CarRegionMonitor.beaconDebounceSec else { return }
      lastBeaconWakeSec = now
      PassiveEntryCentral.shared.logExternal("car beacon: \(event) → re-arming BLE")
    default:
      return // someone else's region
    }
    PassiveEntryCentral.shared.wakeForRegionEntry()
  }

  func locationManagerDidChangeAuthorization(_ m: CLLocationManager) {
    // The user may grant Always later (or via Settings) — arm the moment they do.
    if m.authorizationStatus == .authorizedAlways { startIfConfigured() }
  }
}
