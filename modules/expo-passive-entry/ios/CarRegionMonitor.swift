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
    guard PassiveEntryCentral.isArmed(), CarRegionMonitor.hasCarLocation() else { return }
    ensureManager()
    guard let m = manager else { return }
    guard CLLocationManager.isMonitoringAvailable(for: CLCircularRegion.self) else {
      PassiveEntryCentral.shared.logExternal("car region: monitoring unavailable on this device")
      return
    }
    let status = m.authorizationStatus
    guard status == .authorizedAlways else {
      // WhenInUse can't deliver the reboot wake — say so plainly in the log rather
      // than registering a region that will never fire while we're terminated.
      PassiveEntryCentral.shared.logExternal("car region: NOT armed — need Location Always (status=\(status.rawValue))")
      return
    }
    guard let r = region() else { return }
    // Re-registering the same identifier replaces it; stop first so we never stack.
    for existing in m.monitoredRegions where existing.identifier == CarRegionMonitor.regionId {
      m.stopMonitoring(for: existing)
    }
    m.startMonitoring(for: r)
    // We may ALREADY be inside the region at launch (parked at home) — iOS only
    // reports transitions, so ask for the current state explicitly.
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
    guard region.identifier == CarRegionMonitor.regionId else { return }
    PassiveEntryCentral.shared.logExternal("car region: ENTERED → re-arming BLE")
    PassiveEntryCentral.shared.wakeForRegionEntry()
  }

  func locationManager(_ m: CLLocationManager, didDetermineState state: CLRegionState, for region: CLRegion) {
    guard region.identifier == CarRegionMonitor.regionId, state == .inside else { return }
    PassiveEntryCentral.shared.logExternal("car region: already INSIDE → re-arming BLE")
    PassiveEntryCentral.shared.wakeForRegionEntry()
  }

  func locationManagerDidChangeAuthorization(_ m: CLLocationManager) {
    // The user may grant Always later (or via Settings) — arm the moment they do.
    if m.authorizationStatus == .authorizedAlways { startIfConfigured() }
  }
}
